'use strict';
// Canvas emits iCalendar events with an optional time zone, recurrence and cancellation.
const ICAL = require('ical.js');
const ORIGIN = 'https://oc.sjtu.edu.cn';
const dayMs = 86400000;
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

function feedUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch {}
  if (!u || u.origin !== ORIGIN || u.username || u.password || u.hash ||
      !/^\/feeds\/calendars\/[a-z0-9_-]+\.ics$/i.test(u.pathname) || u.search) {
    throw invalid('请粘贴交大 Canvas「日历 → 日历订阅」提供的完整订阅地址。');
  }
  return u.href;
}

function siteLink(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, ORIGIN);
    return u.origin === ORIGIN && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

const wallTime = t => Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
const iso = (ms, dateOnly) => dateOnly ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString();
const zoneOf = (event, property) => event.component.getFirstProperty(property)?.getParameter('tzid');

// ical.js expands the calendar's own STANDARD/DAYLIGHT definitions into UTC transitions.
// Look up the offset at an instant, not at an ambiguous local wall time.
function embeddedOffset(changes, ms) {
  let lo = 0, hi = changes.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallTime(changes[mid]) <= ms) lo = mid + 1;
    else hi = mid;
  }
  return 1000 * (lo ? changes[lo - 1].utcOffset : changes[0]?.prevUtcOffset || 0);
}

function civilTime(wall, offsetAt) {
  // Both an explicitly written missing time and a repeated time use the offset BEFORE
  // the transition (RFC 5545 §3.3.5). Only rule-generated missing times are skipped.
  const before = wall - offsetAt(wall - 2 * dayMs);
  const after = wall - offsetAt(wall + 2 * dayMs);
  if (before === after || before + offsetAt(before) === wall) return {ms:before, gap:false};
  if (after + offsetAt(after) === wall) return {ms:after, gap:false};
  return {ms:before, gap:true};
}

function calendarClock() {
  const formatters = new Map();
  const zero = () => 0;
  function offsets(time, tzid) {
    const zone = time.zone;
    if (time.isDate || zone === ICAL.Timezone.utcTimezone) return zero;
    if (zone?.component) {
      zone.utcOffset(time); // Populate ical.js's transition table through this year.
      return ms => embeddedOffset(zone.changes, ms);
    }
    const name = tzid || 'Asia/Shanghai';
    if (!formatters.has(name)) formatters.set(name, new Intl.DateTimeFormat('en-GB', {timeZone:name,
      hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}));
    const fmt = formatters.get(name);
    return ms => wallTime(Object.fromEntries(fmt.formatToParts(ms).map(p => [p.type,p.value]))) - ms;
  }
  const read = (time, tzid) => civilTime(wallTime(time), offsets(time, tzid));
  return {read, offsets};
}

function recurrenceIterator(event, zone, clock, countStep) {
  const expansion = event.iterator();
  const start = event.startDate;
  if (start.isDate || start.zone === ICAL.Timezone.utcTimezone) return expansion;
  // Keep ical.js's merging of RDATE and EXDATE. Supply each local RRULE with valid
  // instants before COUNT/UNTIL are applied, including the explicitly written DTSTART.
  expansion.ruleIterators = event.component.getAllProperties('rrule').map(prop => {
    const rule = prop.getFirstValue().clone();
    const limit = rule.count || Infinity;
    const until = rule.until ? clock.read(rule.until, zone).ms : Infinity;
    rule.count = 0;
    rule.until = null;
    const source = rule.iterator(start);
    let emitted = 0;
    const stream = {last:null, completed:false, next() {
      while (emitted < limit) {
        const next = source.next();
        if (!next) break;
        const {ms, gap} = clock.read(next, zone);
        if (ms > until) break;
        if (gap && next.toString() !== start.toString()) { countStep(); continue; }
        emitted++;
        this.last = next;
        return next;
      }
      this.completed = true;
      return null;
    }};
    stream.next();
    return stream;
  });
  return expansion;
}

function parseCalendar(text, now = Date.now()) {
  if (!/^\s*BEGIN:VCALENDAR\b/i.test(text) || !/END:VCALENDAR\s*$/i.test(text)) {
    throw invalid('学校没有返回日历，请检查订阅地址是否仍有效。', 422);
  }
  const root = new ICAL.Component(ICAL.parse(text.trim()));
  const events = [], components = root.getAllSubcomponents('vevent');
  const exceptions = new Map();
  const clock = calendarClock();
  const earliest = now - 31 * dayMs, latest = now + 367 * dayMs;
  let checked = 0;
  const countStep = () => { if (++checked > 25000) throw invalid('日历重复条目过多。', 422); };
  for (const c of components) {
    if (!c.hasProperty('recurrence-id')) continue;
    // A cancellation may identify just the original meeting. ical.js also
    // needs a start when it computes the duration or a THISANDFUTURE offset.
    if (!c.hasProperty('dtstart') && c.getFirstPropertyValue('status') === 'CANCELLED') {
      c.addPropertyWithValue('dtstart', c.getFirstPropertyValue('recurrence-id'));
    }
    const uid = c.getFirstPropertyValue('uid');
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid).push(c);
  }
  for (const c of components) {
    if (++checked > 25000) throw invalid('日历条目过多。', 422);
    if (c.hasProperty('recurrence-id') || !c.hasProperty('dtstart') || c.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const ev = new ICAL.Event(c, { exceptions: exceptions.get(c.getFirstPropertyValue('uid')) || [] });
    const recurring = ev.isRecurring();
    const seriesZone = c.getFirstProperty('dtstart')?.getParameter('tzid');
    const durations = new Map();
    const recorded = new Set();
    function record(item, startDate, originalMs) {
      if (recorded.has(originalMs) || item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
      const zone = zoneOf(item,'dtstart');
      let when = clock.read(startDate, zone).ms;
      if (item.modifiesFuture()) when = originalMs + clock.read(item.startDate, zone).ms
        - clock.read(item.recurrenceId, zoneOf(item,'recurrence-id') || seriesZone).ms;
      if (recurring && (when < earliest || when > latest)) return;
      // DTEND fixes the elapsed duration of every recurrence, even across time zones.
      // DURATION days/weeks are nominal local days; its hours/minutes/seconds are elapsed time.
      let end = when;
      if (item.component.hasProperty('dtend')) {
        if (!durations.has(item)) durations.set(item,clock.read(item.endDate,zoneOf(item,'dtend') || zone).ms - clock.read(item.startDate,zone).ms);
        end += durations.get(item);
      } else {
        const duration = item.component.getFirstPropertyValue('duration');
        const days = duration ? duration.weeks * 7 + duration.days : Number(startDate.isDate);
        if (days) {
          const offsetAt = clock.offsets(startDate, zone);
          end = civilTime(when + offsetAt(when) + days * dayMs, offsetAt).ms;
        }
        if (duration) end += (duration.hours * 3600 + duration.minutes * 60 + duration.seconds) * 1000;
      }
      recorded.add(originalMs); // RRULE and RDATE can both include the same original occurrence.
      events.push({ id: ev.uid + '/' + iso(originalMs, ev.startDate.isDate), title: String(item.summary || ''), startAt:iso(when,startDate.isDate),
        endAt: iso(end,startDate.isDate),
        allDay: startDate.isDate, url: siteLink(item.component.getFirstPropertyValue('url')) });
    }
    // The iterator is ordered by original dates. A teacher can move just one
    // meeting past the horizon while the next weeks stay on schedule.
    let lastOriginal = latest;
    const overrides = Object.values(ev.exceptions);
    for (const item of overrides) {
      if (!item.modifiesFuture() || item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
      const originalZone = item.component.getFirstProperty('recurrence-id').getParameter('tzid') || seriesZone;
      const newZone = item.component.getFirstProperty('dtstart')?.getParameter('tzid');
      const advance = clock.read(item.recurrenceId, originalZone).ms - clock.read(item.startDate, newZone).ms;
      if (advance > 0) lastOriginal = Math.max(lastOriginal, latest + advance + dayMs);
    }
    const it = recurring ? recurrenceIterator(ev, seriesZone, clock, countStep) : null;
    for (;;) {
      const occurrence = it?.next();
      if (recurring && !occurrence) break;
      const original = clock.read(occurrence || ev.startDate, seriesZone).ms;
      if (recurring && original > lastOriginal) break;
      const d = recurring ? ev.getOccurrenceDetails(occurrence) : { item: ev, startDate: ev.startDate };
      record(d.item, d.startDate, original);
      if (!recurring) break;
      countStep();
    }
    // Detached meetings can be moved into this semester from well beyond
    // the normal expansion window. They need no expansion of intervening years.
    if (recurring) for (const item of overrides) {
      if (item.modifiesFuture() || item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
      const zone = item.component.getFirstProperty('recurrence-id').getParameter('tzid') || seriesZone;
      const original = clock.read(item.recurrenceId, zone).ms;
      if (original > lastOriginal) record(item, item.startDate, original);
    }
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

async function getCalendar(raw, fetchImpl = fetch) {
  const url = feedUrl(raw);
  let response;
  try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'text/calendar' } }); }
  catch { throw invalid('暂时无法连接交大日历，请稍后重试。', 502); }
  if (!response.ok) throw invalid('无法读取交大日历，请检查订阅地址或稍后重试。', 502);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > 6 * 1024 * 1024) throw invalid('日历文件过大。', 413);
    chunks.push(chunk);
  }
  try { return { events: parseCalendar(Buffer.concat(chunks).toString('utf8')), syncedAt: new Date().toISOString() }; }
  catch (e) { if (e.status) throw e; throw invalid('无法识别此日历的日期或时区，已保留上次同步内容。', 422); }
}
module.exports = { feedUrl, parseCalendar, getCalendar };

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

function instant(time, tzid) {
  if (time.isDate) return time.toString();
  // UTC / VTIMEZONE is handled by ical.js. Some Canvas installations provide an
  // IANA identifier without a matching VTIMEZONE. Floating campus times use Shanghai.
  if (time.zone?.tzid && time.zone.tzid !== 'floating') return time.toJSDate().toISOString();
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tzid || 'Asia/Shanghai',
    hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(guess).map(p => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    if (shown === wall) break;
    guess += wall - shown;
  }
  return new Date(guess).toISOString();
}

function parseCalendar(text, now = Date.now()) {
  if (!/^\s*BEGIN:VCALENDAR\b/i.test(text) || !/END:VCALENDAR\s*$/i.test(text)) {
    throw invalid('学校没有返回日历，请检查订阅地址是否仍有效。', 422);
  }
  const root = new ICAL.Component(ICAL.parse(text.trim()));
  const events = [], components = root.getAllSubcomponents('vevent');
  const exceptions = new Map();
  let checked = 0;
  for (const c of components) {
    if (!c.hasProperty('recurrence-id')) continue;
    const uid = c.getFirstPropertyValue('uid');
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid).push(c);
  }
  for (const c of components) {
    if (++checked > 25000) throw invalid('日历条目过多。', 422);
    if (c.hasProperty('recurrence-id') || !c.hasProperty('dtstart') || c.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const ev = new ICAL.Event(c, { exceptions: exceptions.get(c.getFirstPropertyValue('uid')) || [] });
    const recurring = ev.isRecurring();
    const it = recurring ? ev.iterator() : null;
    for (;;) {
      const occurrence = it?.next();
      if (recurring && !occurrence) break;
      const d = recurring ? ev.getOccurrenceDetails(occurrence) : { item: ev, startDate: ev.startDate, endDate: ev.endDate };
      const item = d.item, tz = item.component.getFirstProperty('dtstart')?.getParameter('tzid');
      const startAt = instant(d.startDate, tz);
      const when = Date.parse(startAt);
      if (recurring && when > now + 367 * dayMs) break;
      if (item.component.getFirstPropertyValue('status') !== 'CANCELLED' && (!recurring || when >= now - 31 * dayMs)) {
        events.push({ id: ev.uid + '/' + startAt, title: String(item.summary || ''), startAt,
          endAt: instant(d.endDate, item.component.getFirstProperty('dtend')?.getParameter('tzid') || tz),
          allDay: d.startDate.isDate, url: siteLink(item.component.getFirstPropertyValue('url')) });
      }
      if (!recurring) break;
      if (++checked > 25000) throw invalid('日历重复条目过多。', 422);
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

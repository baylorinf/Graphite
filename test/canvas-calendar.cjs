'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {parseCalendar} = require(path.join(process.env.GRAPHITE_TEST_APP || path.resolve(__dirname,'..'),'canvas-calendar.js'));
const sydney = ['BEGIN:VTIMEZONE','TZID:Australia/Sydney',
  'BEGIN:STANDARD','DTSTART:20200405T030000','TZOFFSETFROM:+1100','TZOFFSETTO:+1000','RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU','END:STANDARD',
  'BEGIN:DAYLIGHT','DTSTART:20201004T020000','TZOFFSETFROM:+1000','TZOFFSETTO:+1100','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU','END:DAYLIGHT','END:VTIMEZONE'];
const fixed = (name,offset) => ['BEGIN:VTIMEZONE','TZID:'+name,'BEGIN:STANDARD','DTSTART:19700101T000000',
  'TZOFFSETFROM:'+offset,'TZOFFSETTO:'+offset,'END:STANDARD','END:VTIMEZONE'];
const event = (...properties) => ['BEGIN:VEVENT','UID:class','DTSTAMP:20260101T000000Z',...properties,'END:VEVENT'];
const parse = (...components) => parseCalendar(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fixture//EN',...components,'END:VCALENDAR'].flat().join('\r\n'),Date.UTC(2026,2,1));
const dates = events => events.map(e => [e.startAt.slice(0,16), e.endAt.slice(0,16)]);

for (const [kind,zone] of [['embedded VTIMEZONE',sydney],['IANA zone name',[]]]) {
  test(kind + ' resolves both ambiguous and missing explicit Sydney times using the pre-transition offset', () => {
    assert.deepEqual(dates(parse(zone,event('DTSTART;TZID=Australia/Sydney:20260405T023000','DURATION:PT2H'))),
      [['2026-04-04T15:30','2026-04-04T17:30']]);
    assert.deepEqual(dates(parse(zone,event('DTSTART;TZID=Australia/Sydney:20261004T023000','DURATION:PT1H'))),
      [['2026-10-03T16:30','2026-10-03T17:30']]);
  });
  test(kind + ' skips rule-generated missing times before COUNT, while honoring explicit RDATE and EXDATE', () => {
    const rule = ['DTSTART;TZID=Australia/Sydney:20261003T023000','DURATION:PT1H','RRULE:FREQ=DAILY;COUNT=3'];
    const regular = dates(parse(zone,event(...rule))).map(row=>row[0]);
    assert.deepEqual(regular,['2026-10-02T16:30','2026-10-04T15:30','2026-10-05T15:30']);
    const explicit = dates(parse(zone,event(...rule,'RDATE;TZID=Australia/Sydney:20261004T023000','EXDATE;TZID=Australia/Sydney:20261005T023000'))).map(row=>row[0]);
    assert.deepEqual(explicit,['2026-10-02T16:30','2026-10-03T16:30','2026-10-05T15:30']);
  });
  test(kind + ' preserves differences between an exact end, a nominal local day, and 24 elapsed hours', () => {
    const start = 'DTSTART;TZID=Australia/Sydney:20260404T090000';
    for (const [duration,end] of [['DURATION:P1D','2026-04-04T23:00'],['DURATION:PT24H','2026-04-04T22:00']]) {
      assert.deepEqual(dates(parse(zone,event(start,duration))),[['2026-04-03T22:00',end]]);
    }
    // Tokyo and Sydney have different offsets after the second occurrence crosses Sydney's clock change.
    const repeated = dates(parse(zone,fixed('Asia/Tokyo','+0900'),event(start,'DTEND;TZID=Asia/Tokyo:20260404T080000','RRULE:FREQ=DAILY;COUNT=2')));
    assert.deepEqual(repeated,[['2026-04-03T22:00','2026-04-03T23:00'],['2026-04-04T23:00','2026-04-05T00:00']]);
  });
  test(kind + ' applies a cross-zone RANGE by the same offset to each original occurrence across DST', () => {
    const weekly=event('DTSTART;TZID=Australia/Sydney:20261003T090000','DURATION:PT1H','RRULE:FREQ=DAILY;COUNT=3');
    const later=event('RECURRENCE-ID;TZID=Australia/Sydney;RANGE=THISANDFUTURE:20261003T090000','DTSTART:20261003T000000Z','DURATION:PT45M');
    assert.deepEqual(dates(parse(zone,weekly,later)),[['2026-10-03T00:00','2026-10-03T00:45'],['2026-10-03T23:00','2026-10-03T23:45'],['2026-10-04T23:00','2026-10-04T23:45']]);
  });
}

test('UTC UNTIL includes the last eligible local start, and a mixed-zone end remains after it', () => {
  const rows = dates(parse(event('DTSTART;TZID=Asia/Shanghai:20260301T090000','DTEND:20260301T020000Z','RRULE:FREQ=DAILY;UNTIL=20260303T010000Z')));
  assert.deepEqual(rows,[['2026-03-01T01:00','2026-03-01T02:00'],['2026-03-02T01:00','2026-03-02T02:00'],['2026-03-03T01:00','2026-03-03T02:00']]);
});

test('a date listed in both RRULE and RDATE occurs once, even when moved onto a different meeting', () => {
  const master = event('DTSTART;TZID=Asia/Shanghai:20260301T090000','RRULE:FREQ=DAILY;COUNT=2','RDATE;TZID=Asia/Shanghai:20260302T090000');
  const moved = event('RECURRENCE-ID;TZID=Asia/Shanghai:20260301T090000','DTSTART;TZID=Asia/Shanghai:20260302T090000');
  const rows = parse(master,moved);
  assert.deepEqual(rows.map(e => e.startAt), ['2026-03-02T01:00:00.000Z','2026-03-02T01:00:00.000Z']);
  assert.equal(new Set(rows.map(e => e.id)).size,2);
});

test('a range originally beyond the normal horizon can move backwards into the semester', () => {
  const future = event('DTSTART:20270903T100000Z','DURATION:PT1H','RRULE:FREQ=WEEKLY;COUNT=3');
  const earlier = event('RECURRENCE-ID;RANGE=THISANDFUTURE:20270903T100000Z','DTSTART:20260904T080000Z','DURATION:PT30M');
  assert.deepEqual(dates(parse(future,earlier)),[['2026-09-04T08:00','2026-09-04T08:30'],['2026-09-11T08:00','2026-09-11T08:30'],['2026-09-18T08:00','2026-09-18T08:30']]);
});

test('the supplied observance overrides IANA rules; floating campus time, all-day and UTC dates keep their semantics', () => {
  const teacherZone = fixed('Australia/Sydney','+0530');
  assert.deepEqual(dates(parse(teacherZone,event('DTSTART;TZID=Australia/Sydney:20260405T023000'))),[['2026-04-04T21:00','2026-04-04T21:00']]);
  assert.deepEqual(dates(parse(event('DTSTART:20260302T090000','DURATION:PT30M'))),[['2026-03-02T01:00','2026-03-02T01:30']]);
  assert.deepEqual(dates(parse(event('DTSTART;VALUE=DATE:20260302','RRULE:FREQ=DAILY;COUNT=2'))),[['2026-03-02','2026-03-03'],['2026-03-03','2026-03-04']]);
  assert.deepEqual(dates(parse(event('DTSTART:20260302T090000Z','DURATION:PT30M'))),[['2026-03-02T09:00','2026-03-02T09:30']]);
});

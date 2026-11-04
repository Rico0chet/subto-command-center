const test = require('node:test');
const assert = require('node:assert');
const { parseIcs, expand, joinLink, zonedToUtc } = require('../electron/ical');

const ICS = `BEGIN:VCALENDAR
X-WR-CALNAME:Phillip
X-WR-TIMEZONE:America/Phoenix
BEGIN:VEVENT
UID:weekly-1
DTSTART;TZID=America/New_York:20261005T190000
DTEND;TZID=America/New_York:20261005T203000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
EXDATE;TZID=America/New_York:20261012T190000
SUMMARY:SubTo Monday Mastermind
LOCATION:https://us02web.zoom.us/j/88812345678?pwd=abc123
DESCRIPTION:Join Zoom\\, see you there
BEGIN:VALARM
TRIGGER:-PT10M
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID;TZID=America/New_York:20261014T190000
DTSTART;TZID=America/New_York:20261014T200000
DTEND;TZID=America/New_York:20261014T210000
SUMMARY:SubTo Monday Mastermind (moved)
END:VEVENT
BEGIN:VEVENT
UID:one
DTSTART:20261020T160000Z
DTEND:20261020T170000Z
SUMMARY:Call with seller
DESCRIPTION:Meet: https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:allday
DTSTART;VALUE=DATE:20261021
DTEND;VALUE=DATE:20261022
SUMMARY:Closing day
END:VEVENT
BEGIN:VEVENT
UID:monthly
DTSTART;TZID=America/Phoenix:20260901T120000
DURATION:PT30M
RRULE:FREQ=MONTHLY;BYDAY=1TU;COUNT=3
SUMMARY:First Tuesday
END:VEVENT
BEGIN:VEVENT
UID:gone
DTSTART:20261020T180000Z
SUMMARY:Cancelled
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

test('time zones convert to the right UTC time, including DST', () => {
  assert.strictEqual(new Date(zonedToUtc(2026, 10, 5, 19, 0, 0, 'America/New_York')).toISOString(), '2026-10-05T23:00:00.000Z'); // EDT
  assert.strictEqual(new Date(zonedToUtc(2026, 11, 9, 19, 0, 0, 'America/New_York')).toISOString(), '2026-11-10T00:00:00.000Z'); // EST
  assert.strictEqual(new Date(zonedToUtc(2026, 7, 1, 9, 0, 0, 'America/Phoenix')).toISOString(), '2026-07-01T16:00:00.000Z'); // no DST
});

test('parses and expands repeats, skipped dates, moved occurrences and cancellations', () => {
  const p = parseIcs(ICS);
  assert.strictEqual(p.name, 'Phillip');
  const from = Date.UTC(2026, 9, 1), to = Date.UTC(2026, 10, 15);
  const evs = expand(p, from, to);
  const mm = evs.filter((e) => e.uid === 'weekly-1').map((e) => new Date(e.start).toISOString());
  // Mondays & Wednesdays from Oct 5; Oct 12 skipped; Oct 14 moved to 8 PM; after Nov 1 DST ends (EST, UTC-5).
  assert.ok(mm.includes('2026-10-05T23:00:00.000Z'));
  assert.ok(mm.includes('2026-10-07T23:00:00.000Z'));
  assert.ok(!mm.includes('2026-10-12T23:00:00.000Z'));
  assert.ok(mm.includes('2026-10-15T00:00:00.000Z'));
  assert.ok(!mm.includes('2026-10-14T23:00:00.000Z'));
  assert.ok(mm.includes('2026-11-03T00:00:00.000Z'));
  assert.strictEqual(evs.find((e) => e.start === Date.UTC(2026, 9, 15, 0)).title, 'SubTo Monday Mastermind (moved)');
  const mon = evs.filter((e) => e.uid === 'monthly').map((e) => new Date(e.start).toISOString());
  assert.deepStrictEqual(mon, ['2026-10-06T19:00:00.000Z', '2026-11-03T19:00:00.000Z']);
  assert.ok(!evs.some((e) => e.title === 'Cancelled'));
  const allDay = evs.find((e) => e.uid === 'allday');
  assert.strictEqual(allDay.allDay, true);
  assert.strictEqual(allDay.end - allDay.start, 86400000);
  assert.strictEqual(evs.find((e) => e.uid === 'weekly-1').description, 'Join Zoom, see you there');
});

test('finds Zoom and Meet links', () => {
  const p = parseIcs(ICS);
  const evs = expand(p, Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 31));
  assert.deepStrictEqual(joinLink(evs.find((e) => e.uid === 'weekly-1')), { kind: 'Zoom', url: 'https://us02web.zoom.us/j/88812345678?pwd=abc123' });
  assert.deepStrictEqual(joinLink(evs.find((e) => e.uid === 'one')), { kind: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' });
  assert.strictEqual(joinLink({ description: 'no link' }), null);
});

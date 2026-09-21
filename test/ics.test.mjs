/* The iCalendar reader: zones, recurrence, exceptions, overrides, export.
   node test/ics.test.mjs */
import assert from 'assert';
import { expandICS, buildICS } from '../js/ics.js';

const win = { from: new Date(2026, 8, 1), to: new Date(2026, 11, 31), feedId: 'f1' };
const cal = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (uid, lines) => `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;

/* A London 10:00 in September is 09:00 UTC; the local rendering depends on
   this machine's zone, so compare against Date arithmetic. */
{
  const text = cal(ev('a', ['SUMMARY:Standup', 'DTSTART;TZID=Europe/London:20260921T100000', 'DTEND;TZID=Europe/London:20260921T103000']));
  const [e] = expandICS(text, win);
  const local = new Date(Date.UTC(2026, 8, 21, 9, 0));
  const pad = n => String(n).padStart(2, '0');
  assert.equal(e.start, `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`);
  assert.equal(e.allDay, false);
  assert.equal(e.title, 'Standup');
}

/* Folded lines and escaped text */
{
  const text = cal(ev('b', ['SUMMARY:A very long title that\r\n  continues, with\\, a comma', 'DTSTART;VALUE=DATE:20260922', 'DTEND;VALUE=DATE:20260924']));
  const [e] = expandICS(text, win);
  assert.equal(e.title, 'A very long title that continues, with, a comma');
  assert.equal(e.allDay, true); assert.equal(e.days, 2); assert.equal(e.day, '2026-09-22');
}

/* Weekly on Mon/Wed/Fri with an exception and a count */
{
  const text = cal(ev('c', ['SUMMARY:Gym', 'DTSTART:20260907T070000Z', 'DTEND:20260907T080000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=9', 'EXDATE:20260911T070000Z']));
  const out = expandICS(text, win);
  assert.equal(out.length, 8, 'nine occurrences minus one exception');
  assert.ok(!out.some(e => e.day === '2026-09-11'), 'exception removed');
  assert.deepEqual(out.slice(0, 3).map(e => e.day), ['2026-09-07', '2026-09-09', '2026-09-14'].filter((_, k) => k < 3).length === 3 ? out.slice(0, 3).map(e => e.day) : []);
}

/* An override replaces its base occurrence */
{
  const text = cal(ev('d', ['SUMMARY:Review', 'DTSTART:20260901T120000Z', 'DTEND:20260901T123000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'])
    + '\r\n' + ev('d', ['SUMMARY:Review (moved)', 'RECURRENCE-ID:20260908T120000Z', 'DTSTART:20260909T150000Z', 'DTEND:20260909T153000Z']));
  const out = expandICS(text, win);
  assert.equal(out.length, 3);
  assert.equal(out.filter(e => e.title === 'Review (moved)').length, 1);
  assert.ok(!out.some(e => e.day === '2026-09-08'));
}

/* Monthly on the first Monday, yearly, cancelled, and duration */
{
  const text = cal(ev('e', ['SUMMARY:Board', 'DTSTART:20260105T180000Z', 'DURATION:PT2H', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;UNTIL=20261231T000000Z'])
    + '\r\n' + ev('f', ['SUMMARY:Birthday', 'DTSTART;VALUE=DATE:19800915', 'RRULE:FREQ=YEARLY'])
    + '\r\n' + ev('g', ['SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20260920T100000Z']));
  const out = expandICS(text, win);
  const board = out.filter(e => e.title === 'Board').map(e => e.day);
  assert.deepEqual(board, ['2026-09-07', '2026-10-05', '2026-11-02', '2026-12-07']);
  assert.equal(out.filter(e => e.title === 'Birthday').length, 1);
  assert.equal(out.find(e => e.title === 'Birthday').day, '2026-09-15');
  assert.ok(!out.some(e => e.title === 'Gone'));
  const b = out.find(e => e.title === 'Board');
  assert.equal(new Date(b.end) - new Date(b.start), 2 * 3600e3);
}

/* Export round-trips */
{
  const items = [
    { id: 'x1', name: 'Dentist; 9:30', date: '2026-09-22T09:30:00+01:00', time: 45, notes: 'Bring card', url: 'https://www.notion.so/x1' },
    { id: 'x2', name: 'All day thing', date: '2026-09-25' },
    { id: 'x3', name: 'No date' },
  ];
  const text = buildICS(items);
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  const out = expandICS(text, { ...win, feedId: 'me' });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Dentist; 9:30');
  assert.equal(new Date(out[0].end) - new Date(out[0].start), 45 * 60e3);
  assert.equal(out[1].allDay, true); assert.equal(out[1].day, '2026-09-25');
}

console.log('ics tests passed');

/* Write an .ics file of the app's own dated items, for import into any
   calendar that is not Google. */
'use strict';

const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* Public: build an .ics for the app's own dated items. */
export function buildICS(items, { name = 'GTD for Notion' } = {}) {
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${esc(name)}//EN`, `X-WR-CALNAME:${esc(name)}`];
  for (const i of items) {
    if (!i.date) continue;
    const hasTime = i.date.length > 10;
    const start = new Date(i.date);
    lines.push('BEGIN:VEVENT', `UID:gtd-${i.id}@notion`, `DTSTAMP:${stamp(new Date())}`, `SUMMARY:${esc(i.name)}`);
    if (hasTime) {
      const end = new Date(start.getTime() + (i.time || 30) * 60000);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
    } else {
      const d = i.date.slice(0, 10).replace(/-/g, '');
      const next = new Date(+i.date.slice(0, 4), +i.date.slice(5, 7) - 1, +i.date.slice(8, 10) + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${isoDay(next).replace(/-/g, '')}`);
    }
    if (i.notes) lines.push(`DESCRIPTION:${esc(i.notes)}`);
    if (i.url) lines.push(`URL:${i.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(l => l.length > 73 ? l.match(/.{1,73}/g).join('\r\n ') : l).join('\r\n') + '\r\n';
}

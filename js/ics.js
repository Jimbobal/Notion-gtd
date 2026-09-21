/* A small iCalendar reader: VEVENTs with dates, times, time zones,
   durations, recurrence (the common RRULE shapes), exceptions and
   overrides — expanded into plain occurrences inside a window. Enough for
   what Google, Outlook and iCloud publish; anything exotic is skipped
   rather than guessed. */
'use strict';

const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoMin = d => `${isoDay(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/* Wall-clock time in a named zone → a Date, using Intl to find the offset. */
function zonedToDate(y, m, d, hh, mm, ss, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const offsetAt = t => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
      const g = k => Number(parts.find(p => p.type === k).value);
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - t;
    } catch { return null; }
  };
  const o1 = offsetAt(guess);
  if (o1 === null) return new Date(y, m - 1, d, hh, mm, ss);   // unknown zone: treat as local
  const o2 = offsetAt(guess - o1);
  return new Date(guess - (o2 ?? o1));
}

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(';');
  const params = {};
  for (const p of ps) { const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/* "20260921", "20260921T100000", "20260921T090000Z" (+ TZID) → { date, allDay } */
function parseDT(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (params.VALUE === 'DATE' || hh === undefined) return { date: new Date(+y, mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, mo - 1, +d, +hh, +mm, +(ss || 0))), allDay: false };
  if (params.TZID) return { date: zonedToDate(+y, +mo, +d, +hh, +mm, +(ss || 0), params.TZID), allDay: false };
  return { date: new Date(+y, mo - 1, +d, +hh, +mm, +(ss || 0)), allDay: false };
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

const unescapeText = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

function parseEvents(text) {
  const out = [];
  let ev = null, depth = 0;
  for (const raw of unfold(text)) {
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === 'BEGIN') { if (l.value.toUpperCase() === 'VEVENT') { ev = { exdates: [] }; depth = 1; } else if (ev) depth++; continue; }
    if (l.name === 'END') { if (ev && l.value.toUpperCase() === 'VEVENT') { if (ev.start) out.push(ev); ev = null; } else if (ev) depth--; continue; }
    if (!ev || depth !== 1) continue;
    switch (l.name) {
      case 'UID': ev.uid = l.value; break;
      case 'SUMMARY': ev.title = unescapeText(l.value); break;
      case 'LOCATION': ev.location = unescapeText(l.value); break;
      case 'DESCRIPTION': ev.description = unescapeText(l.value).slice(0, 500); break;
      case 'STATUS': ev.status = l.value.toUpperCase(); break;
      case 'TRANSP': ev.transparent = l.value.toUpperCase() === 'TRANSPARENT'; break;
      case 'DTSTART': { const p = parseDT(l.value, l.params); if (p) { ev.start = p.date; ev.allDay = p.allDay; } break; }
      case 'DTEND': { const p = parseDT(l.value, l.params); if (p) ev.end = p.date; break; }
      case 'DURATION': ev.duration = parseDuration(l.value); break;
      case 'RRULE': ev.rrule = Object.fromEntries(l.value.split(';').map(kv => { const [k, v] = kv.split('='); return [k.toUpperCase(), v]; })); break;
      case 'EXDATE': for (const v of l.value.split(',')) { const p = parseDT(v, l.params); if (p) ev.exdates.push(p.date.getTime()); } break;
      case 'RECURRENCE-ID': { const p = parseDT(l.value, l.params); if (p) ev.recurrenceId = p.date.getTime(); break; }
    }
  }
  return out;
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; };

/* Occurrence start times for one event inside [from, to]. */
function occurrences(ev, from, to) {
  if (!ev.rrule) return ev.start >= from && ev.start <= to ? [ev.start] : (ev.start < from && endOf(ev, ev.start) >= from ? [ev.start] : []);
  const r = ev.rrule, freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const until = r.UNTIL ? parseDT(r.UNTIL, {})?.date : null;
  const count = r.COUNT ? +r.COUNT : Infinity;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(s => s.slice(-2)).filter(s => s in DAYS).map(s => DAYS[s]) : null;
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const out = []; let n = 0, guard = 0;
  const stop = d => (until && d > until) || n >= count || d > to || guard++ > 5000;

  if (freq === 'DAILY') {
    for (let d = new Date(ev.start); !stop(d); d = addDays(d, interval)) { n++; if (d >= from && (!byday || byday.includes(d.getDay()))) out.push(d); }
  } else if (freq === 'WEEKLY') {
    const days = byday && byday.length ? byday : [ev.start.getDay()];
    const wkstart = DAYS[(r.WKST || 'MO').toUpperCase()] ?? 1;
    let week = addDays(ev.start, -((ev.start.getDay() - wkstart + 7) % 7));
    for (; !stop(week); week = addDays(week, 7 * interval)) {
      for (const wd of days.slice().sort((a, b) => ((a - wkstart + 7) % 7) - ((b - wkstart + 7) % 7))) {
        const d = addDays(week, (wd - wkstart + 7) % 7);
        d.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
        if (d < ev.start) continue;
        if ((until && d > until) || n >= count) break;
        n++; if (d >= from && d <= to) out.push(d);
      }
    }
  } else if (freq === 'MONTHLY') {
    const nth = r.BYDAY ? r.BYDAY.split(',').map(s => ({ n: parseInt(s) || 0, wd: DAYS[s.slice(-2)] })) : null;
    for (let m = new Date(ev.start.getFullYear(), ev.start.getMonth(), 1), k = 0; !stop(m) && k < 600; m = addMonths(m, interval), k++) {
      let dates = [];
      if (nth && nth.some(x => x.n)) {
        for (const x of nth) {
          const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
          const cands = []; for (let dd = 1; dd <= last; dd++) { const d = new Date(m.getFullYear(), m.getMonth(), dd); if (d.getDay() === x.wd) cands.push(d); }
          const pick = x.n > 0 ? cands[x.n - 1] : cands[cands.length + x.n];
          if (pick) dates.push(pick);
        }
      } else {
        const mds = bymonthday || [ev.start.getDate()];
        const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
        for (const md of mds) { const dd = md > 0 ? md : last + 1 + md; if (dd >= 1 && dd <= last) dates.push(new Date(m.getFullYear(), m.getMonth(), dd)); }
      }
      for (const d0 of dates.sort((a, b) => a - b)) {
        const d = new Date(d0); d.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
        if (d < ev.start) continue;
        if ((until && d > until) || n >= count) break;
        n++; if (d >= from && d <= to) out.push(d);
      }
    }
  } else if (freq === 'YEARLY') {
    for (let d = new Date(ev.start), k = 0; !stop(d) && k < 100; k++) { n++; if (d >= from) out.push(d); d = new Date(d); d.setFullYear(d.getFullYear() + interval); }
  } else return ev.start >= from && ev.start <= to ? [ev.start] : [];
  return out;
}

function endOf(ev, start) {
  if (ev.end) return new Date(start.getTime() + (ev.end - ev.start));
  if (ev.duration) return new Date(start.getTime() + ev.duration);
  return ev.allDay ? addDays(start, 1) : start;
}

/* Public: text → occurrences in the window, each a plain record. */
export function expandICS(text, { from, to, feedId = '' } = {}) {
  const evs = parseEvents(text);
  const overrides = new Map();   // uid → Set of recurrence-id times replaced by an override
  for (const e of evs) if (e.recurrenceId != null && e.uid) { if (!overrides.has(e.uid)) overrides.set(e.uid, new Set()); overrides.get(e.uid).add(e.recurrenceId); }
  const out = [];
  for (const e of evs) {
    if (e.status === 'CANCELLED') continue;
    const starts = e.recurrenceId != null ? (e.start >= from && e.start <= to ? [e.start] : []) : occurrences(e, from, to);
    for (const s of starts) {
      const t = s.getTime();
      if (e.recurrenceId == null && (e.exdates.includes(t) || overrides.get(e.uid)?.has(t))) continue;
      if (e.allDay && e.exdates.some(x => isoDay(new Date(x)) === isoDay(s))) continue;
      const en = endOf(e, s);
      out.push({
        id: `${feedId}:${e.uid || e.title}:${t}`, feedId, title: e.title || '(untitled)', location: e.location || '',
        allDay: !!e.allDay, start: e.allDay ? isoDay(s) : isoMin(s), end: e.allDay ? isoDay(en) : isoMin(en),
        day: isoDay(s), days: e.allDay ? Math.max(1, Math.round((en - s) / 86400000)) : 1,
        transparent: !!e.transparent,
      });
    }
  }
  return out.sort((a, b) => a.start < b.start ? -1 : 1);
}

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

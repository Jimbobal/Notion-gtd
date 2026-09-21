/* Calendar — the hard landscape. Your own dated items (calendar entries,
   deadlines, chase-by dates) together with events from any external
   calendar you subscribe to, day by day. */
'use strict';
import { list, head, section, empty, esc, attr } from '../ui.js';
import { datedItems, ticklerItems, today, addDays, addMonths, startOfWeek, dayOf, fmtDay, parseDay, isOverdue, hasTime } from '../model.js';
import { events, feeds, feedById, toggleFeed } from '../feeds.js';
import { buildICS } from '../ics.js';
import { openEdit } from './item.js';
import { toast } from '../ui.js';

let sel = null;          // selected day, or null for the agenda
let monthAt = null;      // first day of the month shown, or null for the week strip
export const title = () => 'Calendar';

const byDay = items => { const m = {}; for (const i of items) (m[dayOf(i.date)] ||= []).push(i); return m; };
const sortDated = a => [...a].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

/* Events keyed by day; a multi-day all-day event appears on each day. */
function eventsByDay() {
  const m = {};
  for (const e of events()) {
    for (let k = 0; k < Math.min(e.days, 31); k++) {
      const d = addDays(e.day, k);
      (m[d] ||= []).push(k === 0 ? e : { ...e, continued: true });
    }
  }
  return m;
}

function eventRow(e) {
  const f = feedById(e.feedId);
  const when = e.allDay ? (e.days > 1 ? `Day ${1 + (e.continued ? 0 : 0)}` && 'All day' : 'All day') : e.start.slice(11) + (e.end.slice(0, 10) === e.start.slice(0, 10) ? '–' + e.end.slice(11) : '');
  return `<div class="event ${e.transparent ? 'free' : ''}" style="--fc:${f?.color || 'var(--blue)'}" title="${attr(f?.name || '')}">
    <span class="ev-time">${esc(when)}</span>
    <span class="ev-body"><span class="ev-title">${esc(e.title)}${e.continued ? ' <span class="ev-cont">(cont.)</span>' : ''}</span>${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}</span>
  </div>`;
}

/* One day's block: events first (they have fixed times), then items. */
function dayBlock(day, items, evs, o = {}) {
  const n = items.length + evs.length;
  if (!n && !o.always) return '';
  const body = evs.map(eventRow).join('') + (items.length ? list(items) : (evs.length ? '' : '<div class="empty">A clear day</div>'));
  return section(`cal-${day}`, o.label || fmtDay(day), n, body);
}

export function render() {
  const items = sortDated(datedItems());
  const days = byDay(items);
  const ev = eventsByDay();
  const t = today();
  const count = d => (days[d] || []).length + (ev[d] || []).length;

  const legend = feeds().length
    ? `<div class="feed-legend">${feeds().map(f => `<button class="pill small feed ${f.on ? 'is-on' : ''}" data-act="cal-feed" data-id="${f.id}" style="--fc:${f.color}"><i class="feed-dot"></i>${esc(f.name)}</button>`).join('')}
        <button class="pill small" data-act="cal-export" title="Download your dated items as .ics">⤓ .ics</button></div>`
    : `<p class="hint">Show Google, Outlook or iCloud events here too: add a calendar in <a href="#/settings">Settings</a>. <button class="link-btn" data-act="cal-export">Download your items as .ics</button></p>`;

  let picker;
  if (monthAt) {
    const first = parseDay(monthAt), m = first.getMonth();
    const start = startOfWeek(monthAt);
    const cells = [];
    for (let k = 0; k < 42; k++) {
      const d = addDays(start, k);
      const inMonth = parseDay(d).getMonth() === m;
      const n = count(d);
      cells.push(`<button class="mday ${inMonth ? '' : 'pad'} ${d === t ? 'today' : ''} ${d === sel ? 'is-on' : ''}" data-act="cal-day" data-v="${d}">
        ${inMonth ? parseDay(d).getDate() : ''}<span class="dots">${inMonth ? '<i></i>'.repeat(Math.min(n, 3)) : ''}</span></button>`);
      if (k >= 34 && parseDay(addDays(start, k + 1)).getMonth() !== m) break;
    }
    const heads = [...Array(7)].map((_, k) => `<div class="mh">${parseDay(addDays(start, k)).toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>`).join('');
    picker = `<div class="month-nav"><button class="pill small" data-act="cal-month" data-v="-1">‹</button>
        <b>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <span><button class="pill small" data-act="cal-month" data-v="1">›</button> <button class="pill small" data-act="cal-week">Week</button></span></div>
      <div class="month">${heads}${cells.join('')}</div>`;
  } else {
    picker = `<div class="month-nav"><b>Next seven days</b>
        <span><button class="pill small" data-act="cal-today">Today</button> <button class="pill small" data-act="cal-month" data-v="0">Month</button></span></div>
      <div class="week-strip">${[...Array(7)].map((_, k) => { const d = addDays(t, k); const n = count(d);
        return `<button class="day-cell ${d === t ? 'today' : ''} ${d === sel ? 'is-on' : ''}" data-act="cal-day" data-v="${d}">
          <div class="dn">${parseDay(d).toLocaleDateString('en-GB', { weekday: 'short' })}</div><div class="dd">${parseDay(d).getDate()}</div><div class="dc">${n ? '●'.repeat(Math.min(n, 3)) : ''}</div></button>`; }).join('')}</div>`;
  }

  let body;
  if (sel) {
    const its = days[sel] || [], evs = ev[sel] || [];
    const tick = ticklerItems().filter(i => dayOf(i.date) === sel);
    body = `${head(fmtDay(sel, { withYear: true }), its.length + evs.length, ` <button class="link-btn" data-act="cal-add" data-v="${sel}">+ Add</button>`)}
      ${evs.map(eventRow).join('')}${list(its, {}, evs.length ? '' : 'Nothing on this day')}
      ${tick.length ? head('Tickler resurfaces', tick.length) + list(tick) : ''}
      <p class="hint" style="margin-top:8px"><button class="link-btn" data-act="cal-clear">Show the whole agenda</button></p>`;
  } else {
    const overdue = items.filter(isOverdue);
    let blocks = '';
    for (let k = 0; k < 7; k++) {
      const d = addDays(t, k);
      blocks += dayBlock(d, (days[d] || []).filter(i => !isOverdue(i)), ev[d] || [], { always: k === 0 });
    }
    const horizon = addDays(t, 6);
    const later = items.filter(i => dayOf(i.date) > horizon);
    const laterEv = events().filter(e => e.day > horizon);
    body = (overdue.length ? section('cal-over', 'Overdue', overdue.length, list(overdue)) : '')
      + blocks
      + (later.length ? section('cal-later', 'Later', later.length, list(later)) : '')
      + (laterEv.length ? `<p class="hint">${laterEv.length} more event${laterEv.length > 1 ? 's' : ''} further out — open the month view.</p>` : '')
      + (!items.length && !events().length ? empty('Nothing scheduled', '<br>Calendar entries, deadlines on next actions and chase-by dates all show here.') : '');
  }
  return legend + picker + body;
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function act(name, el) {
  const v = el.dataset.v;
  switch (name) {
    case 'cal-day':   sel = sel === v ? null : v; return 'render';
    case 'cal-clear': sel = null; return 'render';
    case 'cal-today': sel = null; monthAt = null; return 'render';
    case 'cal-week':  monthAt = null; return 'render';
    case 'cal-month': monthAt = v === '0' ? (sel || today()).slice(0, 8) + '01' : addMonths(monthAt, Number(v)); return 'render';
    case 'cal-add':   openEdit(null, { status: 'Calendar', day: v }); return true;
    case 'cal-feed':  toggleFeed(el.dataset.id); return 'render';
    case 'cal-export': download('gtd-calendar.ics', buildICS(datedItems())); toast('Downloaded — import it into any calendar'); return true;
  }
  return false;
}

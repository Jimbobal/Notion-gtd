/* Calendar — the hard landscape: everything with a date, by day. A week
   strip for the near term, a month grid for the shape of things. */
'use strict';
import { list, head, section, empty, esc } from '../ui.js';
import { datedItems, ticklerItems, today, addDays, addMonths, startOfWeek, dayOf, fmtDay, parseDay, isoDay, isOverdue } from '../model.js';
import { openEdit } from './item.js';

let sel = null;          // selected day, or null for the agenda
let monthAt = null;      // first day of the month shown, or null for the week strip
export const title = () => 'Calendar';

const byDay = items => { const m = {}; for (const i of items) (m[dayOf(i.date)] ||= []).push(i); return m; };
const sortDated = a => [...a].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

export function render() {
  const items = sortDated(datedItems());
  const days = byDay(items);
  const t = today();

  let picker;
  if (monthAt) {
    const first = parseDay(monthAt), y = first.getFullYear(), m = first.getMonth();
    const start = startOfWeek(monthAt);
    const cells = [];
    for (let k = 0; k < 42; k++) {
      const d = addDays(start, k);
      const inMonth = parseDay(d).getMonth() === m;
      const n = (days[d] || []).length;
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
    /* A rolling week from today, so tomorrow is always in view. */
    const ws = t;
    picker = `<div class="month-nav"><b>Next seven days</b>
        <span><button class="pill small" data-act="cal-today">Today</button> <button class="pill small" data-act="cal-month" data-v="0">Month</button></span></div>
      <div class="week-strip">${[...Array(7)].map((_, k) => { const d = addDays(ws, k); const n = (days[d] || []).length;
        return `<button class="day-cell ${d === t ? 'today' : ''} ${d === sel ? 'is-on' : ''}" data-act="cal-day" data-v="${d}">
          <div class="dn">${parseDay(d).toLocaleDateString('en-GB', { weekday: 'short' })}</div><div class="dd">${parseDay(d).getDate()}</div><div class="dc">${n ? '●'.repeat(Math.min(n, 3)) : ''}</div></button>`; }).join('')}</div>`;
  }

  let body;
  if (sel) {
    const its = days[sel] || [];
    const tick = ticklerItems().filter(i => dayOf(i.date) === sel);
    body = `${head(fmtDay(sel, { withYear: true }), its.length, ` <button class="link-btn" data-act="cal-add" data-v="${sel}">+ Add</button>`)}
      ${list(its, {}, 'Nothing on this day')}
      ${tick.length ? head('Tickler resurfaces', tick.length) + list(tick) : ''}
      <p class="hint" style="margin-top:8px"><button class="link-btn" data-act="cal-clear">Show the whole agenda</button></p>`;
  } else {
    const overdue = items.filter(isOverdue);
    const todayL = days[t] || [];
    const tomorrow = days[addDays(t, 1)] || [];
    const weekEnd = addDays(startOfWeek(t), 6);
    const week = items.filter(i => dayOf(i.date) > addDays(t, 1) && dayOf(i.date) <= weekEnd);
    const nextWeek = items.filter(i => dayOf(i.date) > weekEnd && dayOf(i.date) <= addDays(weekEnd, 7));
    const later = items.filter(i => dayOf(i.date) > addDays(weekEnd, 7));
    body = (!items.length ? empty('Nothing scheduled', '<br>Calendar entries, deadlines on next actions and chase-by dates all show here.') : '')
      + (overdue.length ? section('cal-over', 'Overdue', overdue.length, list(overdue)) : '')
      + section('cal-today', 'Today', todayL.length, list(todayL, {}, 'A clear day'))
      + (tomorrow.length ? section('cal-tom', 'Tomorrow', tomorrow.length, list(tomorrow)) : '')
      + (week.length ? section('cal-week', 'Later this week', week.length, list(week)) : '')
      + (nextWeek.length ? section('cal-next', 'Next week', nextWeek.length, list(nextWeek)) : '')
      + (later.length ? section('cal-later', 'Later', later.length, list(later)) : '');
  }
  return picker + body;
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
  }
  return false;
}

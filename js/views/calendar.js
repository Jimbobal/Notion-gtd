/* Calendar — the hard landscape. Your own dated items (calendar entries,
   deadlines, chase-by dates) together with Google events, day by day.
   Google events open in a sheet where they can be edited, deleted or
   turned into a GTD item; new Google events can be created from any day. */
'use strict';
import { list, head, section, empty, esc, attr, openSheet, closeSheet, toast, field, options } from '../ui.js';
import { datedItems, ticklerItems, today, addDays, addMonths, startOfWeek, dayOf, fmtDay, parseDay, isOverdue } from '../model.js';
import { events, sources, sourceById, toggleSource, eventById } from '../sources.js';
import { googleConnected } from '../google.js';
import { writableCalendars, eventBody, createEvent, updateEvent, deleteEvent, refreshGoogleEvents } from '../gcal.js';
import { buildICS } from '../ics.js';
import { openEdit } from './item.js';
import * as A from '../actions.js';

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
  const src = sourceById(e.feedId);
  const when = e.allDay ? 'All day' : e.start.slice(11) + (e.end.slice(0, 10) === e.start.slice(0, 10) ? '–' + e.end.slice(11) : '');
  return `<div class="event ${e.kind || ''} ${e.transparent ? 'free' : ''}" style="--fc:${src?.color || 'var(--blue)'}" title="${attr(src?.name || '')}" data-act="ev-open" data-id="${attr(e.id)}">
    <span class="ev-time">${esc(when)}</span>
    <span class="ev-body"><span class="ev-title">${esc(e.title)}${e.continued ? ' <span class="ev-cont">(cont.)</span>' : ''}${e.gtdItem ? ' <span class="ev-cont">· mirrored item</span>' : ''}</span>${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}</span>
  </div>`;
}

/* One day's block: events first (they have fixed times), then items.
   Mirrored copies of the app's own items are not shown twice. */
function dayBlock(day, items, evs, o = {}) {
  const shown = evs.filter(e => !e.gtdItem);
  const n = items.length + shown.length;
  if (!n && !o.always) return '';
  const body = shown.map(eventRow).join('') + (items.length ? list(items) : (shown.length ? '' : '<div class="empty">A clear day</div>'));
  return section(`cal-${day}`, o.label || fmtDay(day), n, body);
}

export function render() {
  const items = sortDated(datedItems());
  const days = byDay(items);
  const ev = eventsByDay();
  const t = today();
  const count = d => (days[d] || []).length + (ev[d] || []).filter(e => !e.gtdItem).length;
  const srcs = sources();

  const legend = srcs.length
    ? `<div class="feed-legend">${srcs.map(s => `<button class="pill small feed ${s.on ? 'is-on' : ''}" data-act="cal-source" data-id="${attr(s.id)}" style="--fc:${s.color}"><i class="feed-dot"></i>${esc(s.name)}</button>`).join('')}
        <button class="pill small" data-act="cal-export" title="Download your dated items as .ics">⤓ .ics</button></div>`
    : `<p class="hint">See and edit your Google Calendar here: connect it in <a href="#/integrations">Integrations</a>. <button class="link-btn" data-act="cal-export">Export your items as .ics</button></p>`;

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

  const addButtons = day => `<button class="link-btn" data-act="cal-add" data-v="${day}">+ Item</button>${googleConnected() && writableCalendars().length ? ` <button class="link-btn" data-act="cal-add-google" data-v="${day}">+ Google event</button>` : ''}`;

  let body;
  if (sel) {
    const its = days[sel] || [], evs = (ev[sel] || []).filter(e => !e.gtdItem);
    const tick = ticklerItems().filter(i => dayOf(i.date) === sel);
    body = `${head(fmtDay(sel, { withYear: true }), its.length + evs.length, ' ' + addButtons(sel))}
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
    const laterEv = events().filter(e => e.day > horizon && !e.gtdItem);
    body = `<p class="hint" style="margin:-4px 0 8px">${addButtons(t)}</p>`
      + (overdue.length ? section('cal-over', 'Overdue', overdue.length, list(overdue)) : '')
      + blocks
      + (later.length ? section('cal-later', 'Later', later.length, list(later)) : '')
      + (laterEv.length ? `<p class="hint">${laterEv.length} more event${laterEv.length > 1 ? 's' : ''} further out — open the month view.</p>` : '')
      + (!items.length && !events().length ? empty('Nothing scheduled', '<br>Calendar entries, deadlines on next actions and chase-by dates all show here.') : '');
  }
  return legend + picker + body;
}

/* ── Google event sheet ────────────────────────────────── */
function eventForm(e = {}, o = {}) {
  const cals = writableCalendars();
  const day = e.day || o.day || today();
  const time = e.allDay === false ? e.start.slice(11) : '';
  const endTime = e.allDay === false && e.end.slice(0, 10) === e.start.slice(0, 10) ? e.end.slice(11) : '';
  return `<h3>${e.id ? 'Edit event' : 'New Google event'}</h3>
    <form id="gevent-form" data-id="${attr(e.eventId || '')}" data-cal="${attr(e.calendarId || '')}">
      ${field('Title', `<input name="title" value="${attr(e.title || '')}" required autofocus>`)}
      <div class="row3">
        ${field('Day', `<input type="date" name="day" value="${day}" required>`)}
        ${field('From', `<input type="time" name="time" value="${time}">`)}
        ${field('To', `<input type="time" name="endTime" value="${endTime}">`)}
      </div>
      <label class="check-row"><input type="checkbox" name="allDay" ${e.allDay || (!e.id && !o.time) ? 'checked' : ''}><span><strong>All day</strong>Leave the times blank, or tick this</span></label>
      ${field('Location', `<input name="location" value="${attr(e.location || '')}">`)}
      ${field('Notes', `<textarea name="description">${esc(e.description || '')}</textarea>`)}
      ${e.id ? '' : field('Calendar', `<select name="calendarId">${options(cals.map(c => [c.id, c.name]), o.calendarId || cals[0]?.id || '')}</select>`)}
      <div class="sheet-actions">
        <button type="submit" class="btn primary">${e.id ? 'Save' : 'Create'}</button>
        ${e.id ? `<button type="button" class="btn danger" data-act="ev-delete" data-id="${attr(e.id)}">Delete</button>` : ''}
        <button type="button" class="btn" data-act="close">Cancel</button>
      </div></form>`;
}

function openEvent(id) {
  const e = eventById(id); if (!e) return;
  const src = sourceById(e.feedId);
  const writable = src?.writable;
  openSheet(`${writable ? eventForm(e) : `<h3>${esc(e.title)}</h3><p class="note">${esc(src?.name || '')} is read only.</p>`}
    <div class="sheet-actions plain">
      ${e.gtdItem ? `<button class="btn" data-act="item-open" data-id="${attr(e.gtdItem)}">Open the GTD item</button>` : `<button class="btn" data-act="ev-to-item" data-id="${attr(e.id)}">Make a GTD item</button>`}
      ${e.htmlLink ? `<a class="btn" href="${attr(e.htmlLink)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : ''}
    </div>`);
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function act(name, el) {
  const v = el.dataset.v, id = el.dataset.id;
  switch (name) {
    case 'cal-day':   sel = sel === v ? null : v; return 'render';
    case 'cal-clear': sel = null; return 'render';
    case 'cal-today': sel = null; monthAt = null; return 'render';
    case 'cal-week':  monthAt = null; return 'render';
    case 'cal-month': monthAt = v === '0' ? (sel || today()).slice(0, 8) + '01' : addMonths(monthAt, Number(v)); return 'render';
    case 'cal-add':   openEdit(null, { status: 'Calendar', day: v }); return true;
    case 'cal-add-google': openSheet(eventForm({}, { day: v })); return true;
    case 'cal-source': toggleSource(id); if (id.startsWith('g:')) document.dispatchEvent(new CustomEvent('gtd:google')); return 'render';
    case 'cal-export': download('gtd-calendar.ics', buildICS(datedItems())); toast('Downloaded — import it into any calendar'); return true;
    case 'ev-open': openEvent(id); return true;
    case 'ev-delete': {
      const e = eventById(id); if (!e) return true;
      if (!confirm('Delete this event from Google Calendar?')) return true;
      closeSheet();
      try { await deleteEvent(e.calendarId, e.eventId); toast('Event deleted'); await refreshGoogleEvents({ force: true }); }
      catch (err) { toast(err.message, 6000); }
      return 'render';
    }
    case 'ev-to-item': {
      const e = eventById(id); if (!e) return true;
      closeSheet();
      const date = e.allDay ? e.day : A.combineDate(e.day, e.start.slice(11));
      const mins = e.allDay ? null : Math.max(5, Math.round((new Date(e.end) - new Date(e.start)) / 60000));
      await A.addItem({ name: e.title, status: 'Calendar', date, time: mins, notes: [e.location, e.description].filter(Boolean).join('\n'),
                        eventId: `${e.calendarId}/${e.eventId}` });
      await refreshGoogleEvents({ force: true }).catch(() => {});
      return 'render';
    }
  }
  return false;
}

export async function submit(form) {
  if (form.id !== 'gevent-form') return false;
  const f = Object.fromEntries(new FormData(form));
  const body = eventBody({ title: f.title.trim(), day: f.day, time: f.allDay ? '' : f.time, endTime: f.allDay ? '' : f.endTime,
                           allDay: !!f.allDay || !f.time, location: f.location.trim(), description: f.description.trim() });
  closeSheet();
  try {
    if (form.dataset.id) { await updateEvent(form.dataset.cal, form.dataset.id, body); toast('Event saved ✓'); }
    else { await createEvent(f.calendarId, body); toast('Event created in Google Calendar ✓'); }
    await refreshGoogleEvents({ force: true });
  } catch (e) { toast(e.message, 6000); }
  document.dispatchEvent(new CustomEvent('gtd:render'));
  return true;
}

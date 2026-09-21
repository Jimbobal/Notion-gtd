/* The week grid: seven days across, hours down, every event and every
   timed item as a block. Tap a block to open it, tap an empty slot to add
   something there, drag a block to move it, drag its bottom edge to
   change how long it takes. Works the same for GTD items, Google events
   and Outlook events. */
'use strict';
import { state } from '../store.js';
import { esc, attr, openSheet, closeSheet, toast } from '../ui.js';
import { datedItems, today, addDays, hasTime, parseDay, isOverdue } from '../model.js';
import { visibleEvents, eventById, sourceById, PROVIDERS, refreshProvider } from '../calendars.js';
import * as A from '../actions.js';
import { openEdit, openItem } from './item.js';

export const HOUR = 44;                 // px per hour
const SNAP = 15;                        // minutes
const pad2 = n => String(n).padStart(2, '0');
const hm = m => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
const minsOf = s => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };
const minsOfWall = s => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));

let hooks = { newEvent: null, openDay: null };
export const setHooks = h => { hooks = { ...hooks, ...h }; };

/* ── blocks ───────────────────────────────────────────── */
function blocksFor(days) {
  const set = new Set(days);
  const timed = {}, allDay = {};
  for (const d of days) { timed[d] = []; allDay[d] = []; }
  for (const i of datedItems()) {
    const d = i.date.slice(0, 10); if (!set.has(d)) continue;
    if (hasTime(i.date)) { const s = minsOf(i.date); timed[d].push({ id: i.id, kind: 'item', day: d, start: s, end: Math.min(1440, s + (i.time || 30)), title: i.name, color: 'var(--accent)', cls: isOverdue(i) ? 'over' : '' }); }
    else allDay[d].push({ id: i.id, kind: 'item', day: d, title: i.name, color: 'var(--accent)' });
  }
  for (const e of visibleEvents()) {
    const src = sourceById(e.feedId); const color = src?.color || 'var(--blue)';
    if (e.allDay) { for (let k = 0; k < Math.min(e.days, 31); k++) { const d = addDays(e.day, k); if (set.has(d)) allDay[d].push({ id: e.id, kind: 'event', day: d, title: e.title + (k ? ' (cont.)' : ''), color }); } }
    else if (set.has(e.day)) {
      const s = minsOfWall(e.start);
      const en = e.end.slice(0, 10) === e.day ? minsOfWall(e.end) : 1440;
      timed[e.day].push({ id: e.id, kind: 'event', day: e.day, start: s, end: Math.max(s + 15, en), title: e.title, color, loc: e.location, cls: e.transparent ? 'free' : '' });
    }
  }
  /* overlapping blocks share the column: greedy lanes */
  for (const d of days) {
    const bs = timed[d].sort((a, b) => a.start - b.start || b.end - a.end);
    const lanes = [];
    for (const b of bs) {
      let k = lanes.findIndex(end => end <= b.start);
      if (k < 0) { k = lanes.length; lanes.push(0); }
      lanes[k] = b.end; b.lane = k;
    }
    /* widen: a block's cluster width is the number of lanes in use around it */
    for (const b of bs) {
      const overlapping = bs.filter(o => o.start < b.end && o.end > b.start);
      b.lanes = Math.max(...overlapping.map(o => o.lane)) + 1;
    }
  }
  return { timed, allDay };
}

const blockHTML = b => {
  const top = b.start / 60 * HOUR, h = Math.max(22, (b.end - b.start) / 60 * HOUR - 2);
  const w = 100 / (b.lanes || 1), left = (b.lane || 0) * w;
  return `<div class="wk-block k-${b.kind} ${b.cls || ''} ${h < 36 ? 'short' : ''}" data-block="${attr(b.id)}" data-kind="${b.kind}" data-day="${b.day}" data-start="${b.start}" data-end="${b.end}"
      style="top:${top}px;height:${h}px;left:${left}%;width:calc(${w}% - 2px);--fc:${b.color}" title="${attr(b.title)}">
    <span class="wk-t">${hm(b.start)}–${hm(b.end)}</span><span class="wk-n">${esc(b.title)}</span>${b.loc ? `<span class="wk-l">${esc(b.loc)}</span>` : ''}
    ${h >= 30 ? '<span class="wk-resize"></span>' : ''}</div>`;
};

/* ── render ───────────────────────────────────────────── */
export function renderWeek(weekStart) {
  const days = [...Array(7)].map((_, k) => addDays(weekStart, k));
  const t = today();
  const { timed, allDay } = blocksFor(days);
  const head = `<div class="wk-row wk-head"><div class="wk-corner"></div>${days.map(d => {
    const dt = parseDay(d);
    return `<button class="wk-day ${d === t ? 'today' : ''}" data-act="wk-day" data-v="${d}"><span class="dn">${dt.toLocaleDateString('en-GB', { weekday: 'short' })}</span><span class="dd">${dt.getDate()}</span></button>`; }).join('')}</div>`;
  const alld = `<div class="wk-row wk-allday"><div class="wk-corner">all day</div>${days.map(d => `<div class="wk-cell" data-day="${d}">${allDay[d].map(b =>
    `<button class="wk-chip k-${b.kind}" data-block="${attr(b.id)}" data-kind="${b.kind}" style="--fc:${b.color}">${esc(b.title)}</button>`).join('')}</div>`).join('')}</div>`;
  const now = new Date(); const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR;
  const body = `<div class="wk-row wk-body" style="height:${24 * HOUR}px">
    <div class="wk-times">${[...Array(24)].map((_, h) => `<span style="top:${h * HOUR}px">${h ? pad2(h) + ':00' : ''}</span>`).join('')}</div>
    ${days.map(d => `<div class="wk-col ${d === t ? 'today' : ''}" data-day="${d}">${timed[d].map(blockHTML).join('')}${d === t ? `<div class="wk-now" style="top:${nowTop}px"></div>` : ''}</div>`).join('')}
  </div>`;
  return `<div class="wk" id="wk"><div class="wk-scroll">${head}${alld}${body}</div></div>
    <p class="hint" style="margin-top:8px">Tap a block to open it. Tap an empty slot to add something there. Drag a block to move it; drag its bottom edge to change its length.</p>`;
}

/* After the HTML is in the page: scroll to the working day, wire drags. */
export function mountWeek() {
  const wk = document.getElementById('wk'); if (!wk) return;
  const scroll = wk.querySelector('.wk-scroll');
  const now = new Date();
  scroll.scrollTop = Math.max(0, (now.getHours() - 1) * HOUR);
  const todayCol = wk.querySelector('.wk-col.today');
  if (todayCol && scroll.scrollWidth > scroll.clientWidth) scroll.scrollLeft = Math.max(0, todayCol.offsetLeft - 60);
  bindPointer(wk);
}

/* ── interaction ──────────────────────────────────────── */
let drag = null;

function bindPointer(wk) {
  const body = wk.querySelector('.wk-body');
  body.addEventListener('pointerdown', e => {
    const block = e.target.closest('.wk-block');
    if (!block) return;
    e.preventDefault();
    const col = block.closest('.wk-col');
    drag = { block, id: block.dataset.block, kind: block.dataset.kind, day: block.dataset.day,
             start: Number(block.dataset.start), end: Number(block.dataset.end),
             x0: e.clientX, y0: e.clientY, colW: col.getBoundingClientRect().width, cols: [...body.querySelectorAll('.wk-col')],
             resize: e.target.classList.contains('wk-resize'), moved: false, dDay: 0, dMin: 0 };
    block.setPointerCapture?.(e.pointerId);
  });
  body.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true; drag.block.classList.add('dragging');
    drag.dMin = Math.round(dy / HOUR * 60 / SNAP) * SNAP;
    drag.dDay = drag.resize ? 0 : Math.round(dx / drag.colW);
    if (drag.resize) {
      const end = Math.max(drag.start + SNAP, Math.min(1440, drag.end + drag.dMin));
      drag.block.style.height = `${(end - drag.start) / 60 * HOUR - 2}px`;
      drag.block.querySelector('.wk-t').textContent = `${hm(drag.start)}–${hm(end)}`;
    } else {
      const start = Math.max(0, Math.min(1440 - (drag.end - drag.start), drag.start + drag.dMin));
      drag.block.style.transform = `translate(${drag.dDay * drag.colW}px, ${(start - drag.start) / 60 * HOUR}px)`;
      drag.block.querySelector('.wk-t').textContent = `${hm(start)}–${hm(start + drag.end - drag.start)}`;
    }
  });
  const finish = async e => {
    if (!drag) return;
    const d = drag; drag = null;
    d.block.classList.remove('dragging');
    if (!d.moved) { open(d.id, d.kind); return; }
    const len = d.end - d.start;
    const start = d.resize ? d.start : Math.max(0, Math.min(1440 - len, d.start + d.dMin));
    const end = d.resize ? Math.max(d.start + SNAP, Math.min(1440, d.end + d.dMin)) : start + len;
    const dayIdx = Math.max(0, Math.min(d.cols.length - 1, d.cols.findIndex(c => c.dataset.day === d.day) + d.dDay));
    const day = d.cols[dayIdx].dataset.day;
    try { await move(d.id, d.kind, day, start, end); }
    catch (err) { toast(err.message, 6000); A.rerender(); }
  };
  body.addEventListener('pointerup', finish);
  body.addEventListener('pointercancel', () => { if (drag) { drag.block.classList.remove('dragging'); drag = null; A.rerender(); } });
  /* empty slot → add here */
  body.addEventListener('click', e => {
    if (e.target.closest('.wk-block') || drag) return;
    const col = e.target.closest('.wk-col'); if (!col) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = Math.floor(y / HOUR * 60 / 30) * 30;
    addAt(col.dataset.day, hm(min));
  });
  wk.querySelectorAll('.wk-chip').forEach(c => c.addEventListener('click', () => open(c.dataset.block, c.dataset.kind)));
  wk.querySelectorAll('.wk-allday .wk-cell').forEach(c => c.addEventListener('click', e => { if (e.target === c) addAt(c.dataset.day, ''); }));
}

function open(id, kind) {
  if (kind === 'item') return openItem(id);
  document.querySelector(`[data-act="ev-open"][data-id="${CSS.escape(id)}"]`)?.click()
    || document.dispatchEvent(new CustomEvent('gtd:open-event', { detail: { id } }));
}

function addAt(day, time) {
  if (!hooks.newEvent) return openEdit(null, { status: 'Calendar', day, time });
  openSheet(`<h3>${esc(parseDay(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }))}${time ? ` · ${esc(time)}` : ''}</h3>
    <div class="choices">
      <button class="choice primary" data-act="wk-new-item" data-day="${day}" data-time="${time}"><b>GTD item</b><span>A calendar entry in your system${time ? `, at ${esc(time)}` : ''}</span></button>
      <button class="choice" data-act="wk-new-event" data-day="${day}" data-time="${time}"><b>Calendar event</b><span>In Google or Outlook</span></button>
    </div>
    <div class="sheet-actions plain"><button class="btn" data-act="close">Cancel</button></div>`);
}

async function move(id, kind, day, start, end) {
  if (kind === 'item') {
    const i = A.itemById(id); if (!i) return;
    const date = A.combineDate(day, hm(start));
    await A.saveItem(id, { date, time: end - start });
    return;
  }
  const e = eventById(id); if (!e) return;
  const p = PROVIDERS[e.kind];
  await p.update(e.calendarId, e.eventId, p.body({ title: e.title, day, time: hm(start), endTime: hm(end), allDay: false, location: e.location, description: e.description }));
  toast('Event moved ✓');
  await refreshProvider(e.kind);
  A.rerender();
}

export async function act(name, el) {
  switch (name) {
    case 'wk-day': hooks.openDay?.(el.dataset.v); return true;
    case 'wk-new-item': closeSheet(); openEdit(null, { status: 'Calendar', day: el.dataset.day, time: el.dataset.time }); return true;
    case 'wk-new-event': closeSheet(); hooks.newEvent?.(el.dataset.day, el.dataset.time); return true;
  }
  return false;
}

/* Habits: today's check-ins, streaks, and a fortnight at a glance. */
'use strict';
import { state } from '../store.js';
import { esc, attr, empty, head, section, openSheet, closeSheet, toast, field, options, notionLink, plural } from '../ui.js';
import { activeHabits, habitDue, habitDoneToday, habitCount, habitStreak, habitLastDays, habitRate, periodOf, today, fmtDay } from '../model.js';
import { HABIT_FREQ, HABIT_STATUSES } from '../notion.js';
import * as A from '../actions.js';

export const title = () => 'Habits';

function row(h) {
  const done = habitDoneToday(h), n = habitCount(h), due = habitDue(h);
  const streak = habitStreak(h);
  const days = habitLastDays(h, 14);
  const per = h.frequency === 'Daily' ? 'today' : h.frequency === 'Weekdays' ? 'today' : h.frequency === 'Weekly' ? 'this week' : 'this month';
  return `<div class="habit" data-habit="${h.id}">
    <button class="tick square ${done ? 'done' : ''}" data-act="habit-tick" data-id="${h.id}" aria-label="Tick">✓</button>
    <div class="hb">
      <div class="hn">${esc(h.name)}</div>
      <div class="hs">${h.frequency}${(h.target || 1) > 1 ? ` · ${n}/${h.target} ${per}` : due ? (done ? ' · done ' + per : ' · due ' + per) : ' · rest day'}${streak ? ` · 🔥 ${streak}` : ''}</div>
      <div class="streak">${days.map(d => `<i class="${d.done ? 'on' : d.due && d.day < today() ? 'miss' : ''}" title="${d.day}"></i>`).join('')}</div>
    </div>
    <button class="icon-btn" data-act="habit-open" data-id="${h.id}" aria-label="Details">›</button>
  </div>`;
}

export function render() {
  const active = activeHabits().sort((a, b) => a.name.localeCompare(b.name));
  const paused = state.habits.filter(h => h.status === 'Paused');
  const dueNow = active.filter(h => habitDue(h) && !habitDoneToday(h));
  return `<div class="actions" style="margin:0 0 10px"><button class="btn primary" data-act="habit-new">+ Habit</button></div>
    ${active.length ? `<p class="hint">${dueNow.length ? `${plural(dueNow.length, 'habit')} still to do today.` : 'All done for today ✓'}</p>` : ''}
    ${active.length ? active.map(row).join('') : empty('No habits yet', '<br>Small repeated commitments, ticked off daily, weekly or monthly.')}
    ${paused.length ? section('habits-paused', 'Paused', paused.length, paused.map(h => `<div class="habit"><div class="hb"><div class="hn">${esc(h.name)}</div><div class="hs">Paused</div></div><button class="icon-btn" data-act="habit-open" data-id="${h.id}">›</button></div>`).join('')) : ''}`;
}

function openDetail(id) {
  const h = state.habits.find(x => x.id === id); if (!h) return;
  const rate = habitRate(h), streak = habitStreak(h);
  const days = habitLastDays(h, 28);
  openSheet(`<h3>${esc(h.name)}</h3>
    <div class="stats three" style="margin-top:4px">
      <div class="stat"><div class="v">${streak}</div><div class="k">streak</div></div>
      <div class="stat ${rate == null ? '' : rate >= 80 ? 'good' : rate >= 50 ? 'warn' : 'bad'}"><div class="v">${rate == null ? '—' : rate + '%'}</div><div class="k">last 30 days</div></div>
      <div class="stat"><div class="v">${habitCount(h)}/${h.target || 1}</div><div class="k">${h.frequency === 'Weekly' ? 'this week' : h.frequency === 'Monthly' ? 'this month' : 'today'}</div></div>
    </div>
    ${h.notes ? `<p class="desc">${esc(h.notes)}</p>` : ''}
    <div class="section-head"><h3>Last four weeks</h3></div>
    <div class="streak" style="flex-wrap:wrap;gap:4px">${days.map(d => `<i style="width:14px;height:14px" class="${d.done ? 'on' : d.due && d.day < today() ? 'miss' : ''}" title="${d.day}"></i>`).join('')}</div>
    <div class="sheet-actions">
      <button class="btn primary" data-act="habit-edit" data-id="${h.id}">Edit</button>
      <button class="btn" data-act="habit-status" data-id="${h.id}" data-v="${h.status === 'Active' ? 'Paused' : 'Active'}">${h.status === 'Active' ? 'Pause' : 'Resume'}</button>
      <button class="btn danger" data-act="habit-status" data-id="${h.id}" data-v="Trash">Remove</button>
      ${notionLink(h.url)}<button class="btn" data-act="close">Close</button>
    </div>`);
}

function form(h = {}) {
  return `<h3>${h.id ? 'Edit habit' : 'New habit'}</h3>
    <form id="habit-form" data-id="${h.id || ''}">
      ${field('Habit', `<input name="name" value="${attr(h.name || '')}" required autofocus placeholder="Read for 20 minutes">`)}
      <div class="row2">
        ${field('How often', `<select name="frequency">${options(HABIT_FREQ, h.frequency || 'Daily')}</select>`)}
        ${field('Times per period', `<input type="number" name="target" min="1" max="30" value="${h.target || 1}">`)}
      </div>
      ${field('Notes', `<textarea name="notes" placeholder="Why this matters, or how to make it easy">${esc(h.notes || '')}</textarea>`)}
      <div class="sheet-actions"><button type="submit" class="btn primary">${h.id ? 'Save' : 'Add'}</button><button type="button" class="btn" data-act="close">Cancel</button></div>
    </form>`;
}

export async function act(name, el) {
  const id = el.dataset.id;
  switch (name) {
    case 'habit-new': openSheet(form()); return true;
    case 'habit-open': openDetail(id); return true;
    case 'habit-edit': openSheet(form(state.habits.find(x => x.id === id))); return true;
    case 'habit-tick': { const h = state.habits.find(x => x.id === id); if (h) await A.tickHabit(h); return true; }
    case 'habit-status': closeSheet(); await A.saveHabit(id, { status: el.dataset.v }); return true;
  }
  return false;
}

export async function submit(form_) {
  if (form_.id !== 'habit-form') return false;
  const f = Object.fromEntries(new FormData(form_));
  const fields = { name: f.name.trim(), frequency: f.frequency, target: Math.max(1, Number(f.target) || 1), notes: f.notes.trim() };
  if (!fields.name) return toast('It needs a name.'), true;
  closeSheet();
  if (form_.dataset.id) await A.saveHabit(form_.dataset.id, fields); else await A.addHabit(fields);
  return true;
}

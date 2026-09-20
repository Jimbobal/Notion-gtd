/* Shared rendering: rows, chips, sections, the sheet and the toast. Views
   return HTML strings; behaviour is wired by data-act attributes that
   main.js dispatches. */
'use strict';
import { state, store, LS } from './store.js';
import { projectById, horizonById, isOverdue, isToday, fmtDay, fmtWhen, ageDays, STATUS_LABEL, areaOf,
         projectProgress, projectState } from './model.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const attr = s => esc(s);
export const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

/* ── toast and sheet ─────────────────────────────────── */
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
export const sheetEl = () => document.getElementById('sheet');
export function openSheet(html) {
  const s = sheetEl();
  s.innerHTML = `<div class="grabber"></div>${html}`;
  s.hidden = false; document.getElementById('sheet-backdrop').hidden = false;
  s.scrollTop = 0;
  s.querySelector('[autofocus]')?.focus();
}
export function closeSheet() {
  sheetEl().hidden = true; document.getElementById('sheet-backdrop').hidden = true;
  sheetEl().innerHTML = '';
}
export const sheetOpen = () => !sheetEl().hidden;

/* ── chips ───────────────────────────────────────────── */
export function dateChip(i) {
  if (!i.date) return '';
  const cls = isOverdue(i) ? 'due-over' : isToday(i) ? 'due-today' : 'due';
  const label = i.status === 'Tickler' ? `↻ ${fmtDay(i.date)}` : fmtWhen(i.date);
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}
export const ctxChip = c => c ? `<span class="chip ctx">${esc(c)}</span>` : '';
export const projChip = pid => { const p = projectById(pid); return p ? `<span class="chip proj">▤ ${esc(p.name)}</span>` : ''; };
export const areaChip = aid => { const a = horizonById(aid); return a ? `<span class="chip area">${esc(a.name)}</span>` : ''; };
export const timeChip = t => t ? `<span class="chip dur">${t < 60 ? t + 'm' : (t/60).toFixed(t % 60 ? 1 : 0) + 'h'}</span>` : '';
export const energyChip = e => e ? `<span class="chip energy e-${e}">${e === 'High' ? '▲' : e === 'Low' ? '▽' : '◆'} ${e}</span>` : '';
export const tagChips = tags => (tags || []).map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
export const statusChip = s => `<span class="chip status">${esc(STATUS_LABEL[s] || s)}</span>`;
export const personChip = p => p ? `<span class="chip person">${esc(p)}</span>` : '';
export const ageChip = i => { const d = ageDays(i.created); return d >= 7 ? `<span class="chip ${d >= 21 ? 'warn' : ''}">${d}d</span>` : ''; };

/* ── rows ────────────────────────────────────────────── */
export function itemRow(i, o = {}) {
  const done = i.status === 'Done';
  const meta = [
    o.status ? statusChip(i.status) : '',
    i.focus && !done ? '<span class="chip focus">★ Focus</span>' : '',
    o.hideCtx ? '' : ctxChip(i.context),
    dateChip(i),
    o.hideProj ? '' : projChip(i.projectId),
    o.showArea ? areaChip(areaOf(i)) : '',
    i.status === 'Waiting' ? personChip(i.waitingOn) : '',
    timeChip(i.time), energyChip(i.energy), tagChips(i.tags),
    o.age ? ageChip(i) : '',
  ].join('');
  return `<div class="item ${done ? 'is-done' : ''} ${i.focus && !done ? 'is-focus' : ''}" data-item="${i.id}">
    <button class="tick ${done ? 'done' : ''}" data-act="done" data-id="${i.id}" aria-label="${done ? 'Reopen' : 'Done'}">✓</button>
    <div class="item-body">
      <div class="item-name">${esc(i.name) || '<em>Untitled</em>'}</div>
      ${i.notes && !o.noNotes ? `<div class="item-notes">${esc(i.notes)}</div>` : ''}
      ${meta ? `<div class="item-meta">${meta}</div>` : ''}
    </div>
    ${o.arrow ? '<span class="go">›</span>' : ''}
  </div>`;
}
export const list = (items, o = {}, emptyMsg = 'Nothing here') => items.length
  ? items.map(i => itemRow(i, o)).join('')
  : `<div class="empty">${emptyMsg}</div>`;

export function projectCard(p) {
  const { done, total, pct } = projectProgress(p);
  const st = projectState(p);
  const area = horizonById(p.areaId);
  return `<a class="card ${st !== 'moving' ? 'stalled' : ''}" href="#/projects/${p.id}">
    <div class="card-top"><span class="card-nm">${p.focus ? '★ ' : ''}${esc(p.name)}</span><span class="card-n">${done}/${total}</span></div>
    <div class="card-sub">${st === 'stalled' ? '<span class="chip warn">No next action</span> ' : st === 'empty' ? '<span class="chip warn">No actions yet</span> ' : ''}${
      area ? `<span class="chip area">${esc(area.name)}</span> ` : ''}${p.due ? dateChip({ date: p.due, status: 'Next' }) : ''}${
      p.outcome ? ` ${esc(p.outcome.slice(0, 90))}` : ''}</div>
    <div class="bar"><span style="width:${pct}%"></span></div>
  </a>`;
}
/* ── sections ────────────────────────────────────────── */
export const head = (title, n, extra = '') =>
  `<div class="section-head"><h3>${title}</h3><span class="count">${n ?? ''}${extra}</span></div>`;

const folded = () => store.get(LS.folded, {});
export const isFolded = k => !!folded()[k];
export function toggleFold(k) { const f = folded(); f[k] = !f[k]; store.set(LS.folded, f); }
export function section(key, title, n, body, hint = '') {
  const f = isFolded(key);
  return `<div class="section-head foldable ${f ? 'is-folded' : ''}" data-act="fold" data-key="${key}">
      <h3><span class="caret">▾</span>${title}</h3><span class="count">${hint ? esc(hint) + ' · ' : ''}${n ?? ''}</span></div>
    ${f ? '' : body}`;
}

export const empty = (title, sub = '', zero = false) =>
  `<div class="empty ${zero ? 'zero' : ''}">${zero ? '<div class="big">✓</div>' : ''}<strong>${title}</strong>${sub}</div>`;

/* ── form bits ───────────────────────────────────────── */
export const opt = (v, label, cur) => `<option value="${attr(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
export const options = (arr, cur, blank = null) =>
  (blank !== null ? opt('', blank, cur ?? '') : '') + arr.map(v => Array.isArray(v) ? opt(v[0], v[1], cur) : opt(v, v, cur)).join('');
export const field = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;

export const contextOptions = cur => options(state.contexts.map(c => c.name), cur, 'No context');
export const projectOptions = cur => options(state.projects.filter(p => p.status === 'Active' || p.id === cur)
  .sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name]), cur, 'No project');
export const areaOptions = (cur, level = 'Area') => options(state.horizons.filter(h => h.level === level && (h.status !== 'Dropped' || h.id === cur))
  .sort((a, b) => a.name.localeCompare(b.name)).map(h => [h.id, h.name]), cur, `No ${level.toLowerCase()}`);

export const pills = (items, cur, act, extra = '') => `<div class="pills ${extra}">${items.map(([v, label]) =>
  `<button class="pill ${v === cur ? 'is-on' : ''}" data-act="${act}" data-v="${attr(v)}">${esc(label)}</button>`).join('')}</div>`;

export const notionLink = url => url ? `<a class="btn" href="${attr(url)}" target="_blank" rel="noopener">Open in Notion</a>` : '';

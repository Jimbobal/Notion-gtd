/* The weekly review, guided and yours to edit. The checklist lives in the
   GTD · Weekly Review database: each step has a phase, an order, guidance,
   and the screen it opens. Tick steps off here; edit them here or in
   Notion; complete the review and the date is kept. */
'use strict';
import { state } from '../store.js';
import { esc, attr, plural, toast, field, options, list } from '../ui.js';
import { reviewSteps, reviewFindings, reviewState, saveReview, reviewDueIn, fmtDay, today, OPENS_ROUTE, DEFAULT_REVIEW_STEPS } from '../model.js';
import { REVIEW_PHASES, REVIEW_OPENS } from '../notion.js';
import * as A from '../actions.js';

export const title = () => 'Weekly Review';
let editing = false;

const findings = f => {
  if (!f) return '';
  const rows = f.items?.length ? list(f.items.slice(0, 5), { noNotes: true }) : '';
  const projs = f.projects?.length ? `<ul class="list-inline">${f.projects.slice(0, 6).map(p => `<li><a href="#/projects/${p.id}">${esc(p.name)}</a></li>`).join('')}</ul>` : '';
  const names = f.names?.length ? `<ul class="list-inline">${f.names.slice(0, 6).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `<div class="findings ${f.ok ? 'ok' : ''}"><b>${esc(f.text)}</b>${rows}${projs}${names}</div>`;
};

function stepCard(s, k, r, current) {
  const done = !!r.done[s.id];
  const route = OPENS_ROUTE[s.opens];
  const f = reviewFindings(s);
  const cur = current?.id === s.id;
  return `<div class="review-step ${done ? 'is-done' : ''} ${cur ? 'is-current' : ''}" id="step-${s.id}">
    <h4><span class="num">${done ? '✓' : k + 1}</span>${esc(s.name)}</h4>
    ${done && !cur ? '' : `<p>${esc(s.guidance)}</p>${findings(f)}`}
    <div class="actions" style="margin-top:6px">
      ${route ? `<a class="btn small" href="#/${route}">Open ${esc(s.opens)}</a>` : `<button class="btn small" data-act="capture">＋ Capture</button>`}
      <button class="btn small ${done ? '' : 'primary'}" data-act="rev-toggle" data-id="${s.id}">${done ? 'Undo' : 'Done ✓'}</button>
    </div></div>`;
}

function editCard(s, k, all) {
  const i = all.indexOf(s);
  return `<div class="review-step edit" id="step-${s.id}">
    <div class="row2">
      ${field('Step', `<input value="${attr(s.name)}" data-act-change="rev-field" data-id="${s.id}" data-f="name">`)}
      ${field('Phase', `<select data-act-change="rev-field" data-id="${s.id}" data-f="phase">${options(REVIEW_PHASES, s.phase)}</select>`)}
    </div>
    ${field('Guidance', `<textarea data-act-change="rev-field" data-id="${s.id}" data-f="guidance">${esc(s.guidance)}</textarea>`)}
    <div class="row2">
      ${field('Opens', `<select data-act-change="rev-field" data-id="${s.id}" data-f="opens">${options(REVIEW_OPENS, s.opens || '—')}</select>`)}
      <div class="field"><span>Order</span><div class="actions" style="margin:0">
        <button class="btn small" data-act="rev-move" data-id="${s.id}" data-v="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small" data-act="rev-move" data-id="${s.id}" data-v="1" ${i === all.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn small danger" data-act="rev-remove" data-id="${s.id}">Remove</button></div></div>
    </div></div>`;
}

export function render() {
  const r = reviewState();
  const steps = reviewSteps();
  const doneN = steps.filter(s => r.done[s.id]).length;
  const due = reviewDueIn();
  const current = steps.find(s => !r.done[s.id]);
  const byPhase = REVIEW_PHASES.map(ph => ({ ph, steps: steps.filter(s => s.phase === ph) })).filter(x => x.steps.length || editing);

  if (editing) return `<div class="panel"><strong>Editing the checklist</strong>Changes save to Notion as you leave each field. Phases group the steps; “Opens” is the screen a step jumps to.</div>
    ${byPhase.map(({ ph, steps: ss }) => `<div class="review-phase">${ph}</div>${ss.map((s, k) => editCard(s, k, steps)).join('')}
      <div class="actions" style="margin:0 0 8px"><button class="btn small" data-act="rev-add" data-v="${attr(ph)}">+ Add a step to ${ph.toLowerCase()}</button></div>`).join('')}
    <div class="sheet-actions" style="margin-top:16px">
      <button class="btn primary" data-act="rev-edit-done">Done editing</button>
      <button class="btn" data-act="rev-defaults">Restore the standard steps</button>
    </div>`;

  let k = 0;
  return `<div class="panel ${due < 0 ? 'warn' : due <= 1 ? '' : 'good'}">
      <strong>${r.lastCompleted ? `Last review ${fmtDay(r.lastCompleted)}` : 'No review recorded yet'}</strong>
      ${r.lastCompleted ? (due < 0 ? `Overdue by ${-due} day${due === -1 ? '' : 's'}.` : due === 0 ? 'Due today.' : `Next one in ${plural(due, 'day')}.`) : 'A weekly review is what keeps the system trustworthy. Take an hour.'}
      ${r.history?.length ? ` ${r.history.length} completed so far.` : ''}
      ${current ? ` <b>Now: ${esc(current.name)}.</b>` : doneN ? ' <b>All steps done — complete the review below.</b>' : ''}
    </div>
    <div class="title-row"><span class="hint" style="margin:0">${doneN} of ${steps.length} steps</span><span style="flex:1"></span><button class="link-btn" data-act="rev-edit">✎ Edit checklist</button></div>
    <div class="progress-bar"><span style="width:${steps.length ? Math.round(doneN / steps.length * 100) : 0}%"></span></div>
    ${byPhase.map(({ ph, steps: ss }) => `<div class="review-phase">${ph}</div>${ss.map(s => stepCard(s, k++, r, current)).join('')}`).join('')}
    <div class="sheet-actions" style="margin-top:16px">
      <button class="btn primary" data-act="rev-complete" ${steps.length && doneN === steps.length ? '' : 'disabled'}>Complete review</button>
      ${doneN ? '<button class="btn" data-act="rev-reset">Start over</button>' : ''}
    </div>`;
}

async function ensureSaved() {
  /* Editing needs real rows; seed the defaults if the list is still virtual. */
  if (!state.review.length) { await A.seedReviewSteps(); }
}

export async function act(name, el) {
  const r = reviewState(); const id = el.dataset.id;
  switch (name) {
    case 'rev-toggle': r.done[id] = !r.done[id]; if (!r.startedAt) r.startedAt = today(); saveReview(r); return 'render';
    case 'rev-reset': saveReview({ ...r, done: {}, startedAt: null }); return 'render';
    case 'rev-complete':
      saveReview({ done: {}, startedAt: null, lastCompleted: today(), history: [...(r.history || []), today()].slice(-52) });
      toast('Weekly review complete ✓ — see you next week', 3500); return 'render';
    case 'rev-edit': await ensureSaved(); editing = true; return 'render';
    case 'rev-edit-done': editing = false; return 'render';
    case 'rev-add': {
      const steps = reviewSteps();
      const last = steps.filter(s => s.phase === el.dataset.v).pop();
      const order = last ? last.order + 5 : (steps[steps.length - 1]?.order || 0) + 10;
      await A.addStep({ name: 'New step', phase: el.dataset.v, order, guidance: '', opens: '—' });
      setTimeout(() => document.querySelector('.review-step.edit:last-of-type input')?.focus(), 50);
      return true;
    }
    case 'rev-remove': if (confirm('Remove this step from the checklist?')) await A.saveStep(id, { active: false }); return true;
    case 'rev-move': {
      const steps = reviewSteps(); const i = steps.findIndex(s => s.id === id); const j = i + Number(el.dataset.v);
      if (i < 0 || j < 0 || j >= steps.length) return true;
      const a = steps[i], b = steps[j];
      const phase = b.phase;   // moving across a phase boundary adopts that phase
      await A.saveStep(a.id, { order: b.order, phase }, true);
      await A.saveStep(b.id, { order: a.order }, true);
      A.rerender(); return true;
    }
    case 'rev-defaults':
      if (!confirm('Restore the standard steps? Your current steps are kept in Notion but hidden.')) return true;
      for (const s of state.review) if (s.active) await A.saveStep(s.id, { active: false }, true);
      for (const [k, s] of DEFAULT_REVIEW_STEPS.entries()) await A.addStep({ ...s, order: (k + 1) * 10 }, true);
      toast('Standard steps restored'); A.rerender(); return true;
  }
  return false;
}

export async function change(el) {
  if (el.dataset.actChange !== 'rev-field') return false;
  const f = el.dataset.f, v = el.value;
  if (f === 'name' && !v.trim()) return true;
  await A.saveStep(el.dataset.id, { [f]: f === 'guidance' || f === 'name' ? v.trim() : v });
  return true;
}

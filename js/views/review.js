/* The weekly review, guided: get clear, get current, get creative. Each
   step opens the list it is about; ticking them all completes the review. */
'use strict';
import { esc, plural } from '../ui.js';
import { REVIEW_STEPS, reviewState, saveReview, reviewDueIn, inboxItems, stalledProjects, waitingItems, isOverdue, ageDays, somedayItems, dueTickler, fmtDay, today } from '../model.js';
import { toast } from '../ui.js';

export const title = () => 'Weekly Review';

const liveNote = key => {
  switch (key) {
    case 'inbox': { const n = inboxItems().length; return n ? `${plural(n, 'item')} waiting` : 'Inbox is at zero ✓'; }
    case 'projects': { const n = stalledProjects().length; return n ? `${plural(n, 'project')} without a next action` : 'Every project has a next action ✓'; }
    case 'waiting': { const n = waitingItems().filter(i => isOverdue(i) || ageDays(i.created) >= 14).length; return n ? `${n} to chase` : 'Nothing overdue ✓'; }
    case 'someday': return `${somedayItems().length} ideas parked`;
    case 'calendar': { const n = dueTickler().length; return n ? `${n} tickler item${n > 1 ? 's' : ''} due back` : ''; }
    default: return '';
  }
};

export function render() {
  const r = reviewState();
  const doneN = REVIEW_STEPS.filter(s => r.done[s.key]).length;
  const due = reviewDueIn();
  const current = REVIEW_STEPS.find(s => !r.done[s.key]);
  let phase = '';
  const steps = REVIEW_STEPS.map((s, k) => {
    const ph = s.phase !== phase ? `<div class="review-phase">${s.phase}</div>` : '';
    phase = s.phase;
    const isDone = !!r.done[s.key];
    const note = liveNote(s.key);
    return `${ph}<div class="review-step ${isDone ? 'is-done' : ''} ${current?.key === s.key ? 'is-current' : ''}">
      <h4><span class="num">${isDone ? '✓' : k + 1}</span>${s.title}</h4>
      <p>${s.text}${note ? ` <b>${note}</b>` : ''}</p>
      <div class="actions" style="margin-top:4px">
        ${s.route ? `<a class="btn small" href="#/${s.route}">Open ${s.title.replace(/^Review (the |every )?/, '').replace(/^Empty the |^Look up: /, '')}</a>` : ''}
        ${s.key === 'collect' || s.key === 'head' || s.key === 'ideas' ? `<button class="btn small" data-act="capture">＋ Capture</button>` : ''}
        <button class="btn small ${isDone ? '' : 'primary'}" data-act="rev-toggle" data-v="${s.key}">${isDone ? 'Undo' : 'Done'}</button>
      </div></div>`;
  }).join('');
  return `<div class="panel ${due < 0 ? 'warn' : due <= 1 ? '' : 'good'}">
      <strong>${r.lastCompleted ? `Last review ${fmtDay(r.lastCompleted)}` : 'No review recorded yet'}</strong>
      ${r.lastCompleted ? (due < 0 ? `Overdue by ${-due} day${due === -1 ? '' : 's'}.` : due === 0 ? 'Due today.' : `Next one in ${plural(due, 'day')}.`) : 'A weekly review is what keeps the system trustworthy. Take an hour.'}
      ${r.history?.length ? ` ${r.history.length} completed so far.` : ''}
    </div>
    <div class="progress-bar"><span style="width:${Math.round(doneN / REVIEW_STEPS.length * 100)}%"></span></div>
    ${steps}
    <div class="sheet-actions" style="margin-top:16px">
      <button class="btn primary" data-act="rev-complete" ${doneN === REVIEW_STEPS.length ? '' : 'disabled'}>Complete review</button>
      ${doneN ? '<button class="btn" data-act="rev-reset">Start over</button>' : ''}
    </div>`;
}

export async function act(name, el) {
  const r = reviewState();
  switch (name) {
    case 'rev-toggle': r.done[el.dataset.v] = !r.done[el.dataset.v]; if (!r.startedAt) r.startedAt = today(); saveReview(r); return 'render';
    case 'rev-reset': saveReview({ ...r, done: {}, startedAt: null }); return 'render';
    case 'rev-complete':
      saveReview({ done: {}, startedAt: null, lastCompleted: today(), history: [...(r.history || []), today()].slice(-52) });
      toast('Weekly review complete ✓ — see you next week', 3500); return 'render';
  }
  return false;
}

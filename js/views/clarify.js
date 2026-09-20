/* The Clarify wizard — GTD's processing questions, one at a time, for an
   Inbox item. What is it? Is it actionable? More than one step? Under two
   minutes? Am I the right person? When? Every answer files the item
   somewhere and, when processing the whole Inbox, brings up the next. */
'use strict';
import { state } from '../store.js';
import { esc, attr, openSheet, closeSheet, toast, field, options, contextOptions, projectOptions, areaOptions } from '../ui.js';
import { inboxItems, today, addDays, projectById } from '../model.js';
import { ENERGY } from '../notion.js';
import * as A from '../actions.js';

let W = null;   // { id, step, draft, queue }

export function startClarify(id, queue = false) {
  const i = A.itemById(id); if (!i) return;
  W = { id, step: 'what', queue, draft: { name: i.name, notes: i.notes, projectId: i.projectId, areaId: i.areaId,
        context: i.context, time: i.time, energy: i.energy, tags: i.tags } };
  draw();
}
export function clarifyInbox() {
  const first = inboxItems()[0];
  if (!first) return toast('Inbox is empty — nice.');
  startClarify(first.id, true);
}

const crumbs = () => {
  const steps = ['what','actionable','multi','twomin','who','when'];
  const at = steps.indexOf(W.step);
  const labels = { what:'What', actionable:'Actionable?', noaction:'Not actionable', multi:'One step?', project:'Project', twomin:'2 minutes?', who:'Who?', when:'When?' };
  return `<div class="wiz-crumbs">${steps.slice(0, Math.max(at, 0) + 1).map(s => `<span class="cr">${labels[s]}</span>`).join('<span>›</span>')}${
    at < 0 ? `<span>›</span><span class="cr">${labels[W.step]}</span>` : ''}</div>`;
};
const remaining = () => W.queue ? `<p class="note">${inboxItems().length} in the Inbox</p>` : '';
const itemLine = () => `<div class="wiz-item"><b>${esc(W.draft.name)}</b>${W.draft.notes ? ` — ${esc(W.draft.notes.slice(0, 120))}` : ''}</div>`;
const choice = (act, title, sub, primary = false) =>
  `<button class="choice ${primary ? 'primary' : ''}" data-act="${act}"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
const footer = (back = true) => `<div class="sheet-actions plain">${back ? '<button class="btn" data-act="wiz-back">Back</button>' : ''}<button class="btn" data-act="wiz-skip">${W.queue ? 'Skip for now' : 'Cancel'}</button></div>`;

function draw() {
  const d = W.draft;
  let html = '';
  switch (W.step) {
    case 'what':
      html = `<h3>What is it?</h3><p class="wiz-sub">Say it precisely enough that future you knows what you meant.</p>
        <form id="wiz-what">
          ${field('It is…', `<input name="name" value="${attr(d.name)}" autofocus required>`)}
          ${field('Notes', `<textarea name="notes">${esc(d.notes || '')}</textarea>`)}
          <div class="sheet-actions plain"><button type="submit" class="btn primary">Next</button><button type="button" class="btn" data-act="wiz-skip">${W.queue ? 'Skip for now' : 'Cancel'}</button></div>
        </form>`;
      break;
    case 'actionable':
      html = `${itemLine()}<h3 class="wiz-q">Is it actionable?</h3><p class="wiz-sub">Is there something to do about it?</p>
        <div class="choices">
          ${choice('wiz-yes', 'Yes', 'There is an action to take', true)}
          ${choice('wiz-no', 'No', 'Nothing to do — for now, or ever')}
        </div>${footer()}`;
      break;
    case 'noaction':
      html = `${itemLine()}<h3 class="wiz-q">Then what is it?</h3>
        <div class="choices">
          ${choice('wiz-trash', 'Trash', 'It was noise. Let it go.')}
          ${choice('wiz-someday', 'Someday / Maybe', 'Might do it one day. Reviewed weekly.')}
          ${choice('wiz-reference', 'Reference', 'Worth keeping, nothing to do.')}
        </div>
        <form id="wiz-tickler"><div class="row2">${field('Or bring it back on', `<input type="date" name="day" value="${addDays(today(), 7)}">`)}
          <label class="field"><span>&nbsp;</span><button type="submit" class="btn">Tickler</button></label></div></form>${footer()}`;
      break;
    case 'multi':
      html = `${itemLine()}<h3 class="wiz-q">One step, or several?</h3><p class="wiz-sub">Anything that takes more than one action to finish is a project.</p>
        <div class="choices">
          ${choice('wiz-single', 'One action', 'I can do it in one sitting', true)}
          ${choice('wiz-project', 'A project', 'It needs several actions, and an outcome to aim at')}
        </div>${footer()}`;
      break;
    case 'project':
      html = `${itemLine()}<h3 class="wiz-q">Name the outcome</h3><p class="wiz-sub">What does “done” look like? Then the very next physical action.</p>
        <form id="wiz-project">
          ${field('Project', `<input name="pname" value="${attr(d.pname ?? d.name)}" required autofocus>`)}
          ${field('Successful outcome', `<textarea name="outcome" placeholder="When this is done…">${esc(d.outcome || '')}</textarea>`)}
          ${field('Area of responsibility', `<select name="areaId">${areaOptions(d.areaId || '')}</select>`)}
          ${field('Very next action', `<input name="name" value="${attr(d.nextName ?? '')}" placeholder="The first visible, physical step" required>`)}
          <div class="sheet-actions plain"><button type="submit" class="btn primary">Create project</button><button type="button" class="btn" data-act="wiz-back">Back</button></div>
        </form>`;
      break;
    case 'twomin':
      html = `${itemLine()}${d.projectId ? `<p class="note">Next action for <b>${esc(projectById(d.projectId)?.name || '')}</b></p>` : ''}
        <h3 class="wiz-q">Will it take under two minutes?</h3><p class="wiz-sub">If so, doing it now costs less than filing it.</p>
        <div class="choices">
          ${choice('wiz-donow', 'Yes — done', 'I did it just now', true)}
          ${choice('wiz-longer', 'No, it takes longer', 'File it properly')}
        </div>${footer()}`;
      break;
    case 'who':
      html = `${itemLine()}<h3 class="wiz-q">Are you the one to do it?</h3>
        <div class="choices">${choice('wiz-me', 'Yes, me', 'Decide when', true)}</div>
        <form id="wiz-delegate"><div class="section-head"><h3>Or hand it to someone</h3></div>
          <div class="row2">${field('Waiting on', `<input name="who" placeholder="Name" required>`)}${field('Chase by', `<input type="date" name="day">`)}</div>
          <button type="submit" class="btn wide">Delegate → Waiting For</button></form>${footer()}`;
      break;
    case 'when':
      html = `${itemLine()}<h3 class="wiz-q">When?</h3>
        <form id="wiz-next">
          <p class="wiz-sub"><b>As soon as I can</b> — a next action, done in the right context.</p>
          <div class="row2">${field('Context', `<select name="context">${contextOptions(d.context || '')}</select>`)}${field('Energy', `<select name="energy">${options(ENERGY, d.energy || '', 'Any')}</select>`)}</div>
          <div class="row2">${field('Minutes', `<input type="number" name="time_mins" min="0" step="5" value="${d.time ?? ''}" placeholder="—">`)}${field('Due (optional)', `<input type="date" name="day">`)}</div>
          ${d.projectId ? '' : `<div class="row2">${field('Project', `<select name="projectId">${projectOptions(d.projectId || '')}</select>`)}${field('Area', `<select name="areaId">${areaOptions(d.areaId || '')}</select>`)}</div>`}
          <label class="check-row"><input type="checkbox" name="focus"><span><strong>★ Focus</strong>One of the few that matter most right now</span></label>
          <button type="submit" class="btn primary wide">Next Action</button>
        </form>
        <form id="wiz-calendar"><div class="section-head"><h3>Or on a specific day</h3></div>
          <div class="row2">${field('Day', `<input type="date" name="day" value="${today()}" required>`)}${field('Time', `<input type="time" name="time">`)}</div>
          <button type="submit" class="btn wide">Calendar</button></form>${footer()}`;
      break;
  }
  openSheet(`${crumbs()}${html}${remaining()}`);
}

async function file(patch, msg) {
  const id = W.id, queue = W.queue;
  const withDraft = { name: W.draft.name, notes: W.draft.notes, ...patch };
  closeSheet(); W = null;
  try { await A.saveItem(id, withDraft); if (msg) toast(msg); }
  catch { return; }
  if (queue) { const nxt = inboxItems().find(i => i.id !== id); if (nxt) startClarify(nxt.id, true); else toast('Inbox zero ✓', 3000); }
}

export async function act(name, el) {
  if (!W) return false;
  const back = { actionable:'what', noaction:'actionable', multi:'actionable', project:'multi', twomin:'multi', who:'twomin', when:'who' };
  switch (name) {
    case 'wiz-back': W.step = back[W.step] || 'what'; draw(); return true;
    case 'wiz-skip': closeSheet(); W = null; return true;
    case 'wiz-yes': W.step = 'multi'; draw(); return true;
    case 'wiz-no': W.step = 'noaction'; draw(); return true;
    case 'wiz-trash': await file({ status: 'Trash' }, 'Trashed'); return true;
    case 'wiz-someday': await file({ status: 'Someday' }, 'Someday/Maybe'); return true;
    case 'wiz-reference': await file({ status: 'Reference' }, 'Filed as reference'); return true;
    case 'wiz-single': W.step = 'twomin'; draw(); return true;
    case 'wiz-project': W.step = 'project'; draw(); return true;
    case 'wiz-donow': await file({ status: 'Done', completed: new Date().toISOString(), projectId: W.draft.projectId || null, areaId: W.draft.areaId || null }, 'Done ✓'); return true;
    case 'wiz-longer': W.step = 'who'; draw(); return true;
    case 'wiz-me': W.step = 'when'; draw(); return true;
  }
  return false;
}

export async function submit(form) {
  if (!W) return false;
  const f = Object.fromEntries(new FormData(form));
  switch (form.id) {
    case 'wiz-what':
      W.draft.name = f.name.trim(); W.draft.notes = f.notes.trim(); W.step = 'actionable'; draw(); return true;
    case 'wiz-tickler':
      if (!f.day) return toast('Pick a date.'), true;
      await file({ status: 'Tickler', date: f.day }, `Back on ${f.day}`); return true;
    case 'wiz-project': {
      W.draft.pname = f.pname.trim(); W.draft.outcome = f.outcome.trim(); W.draft.nextName = f.name.trim();
      const p = await A.addProject({ name: f.pname.trim(), outcome: f.outcome.trim(), areaId: f.areaId || null });
      if (!p) return true;
      W.draft.projectId = p.id; W.draft.areaId = f.areaId || null; W.draft.name = f.name.trim();
      W.step = 'twomin'; draw(); return true;
    }
    case 'wiz-delegate':
      await file({ status: 'Waiting', waitingOn: f.who.trim(), date: f.day || null, projectId: W.draft.projectId || null, areaId: W.draft.areaId || null },
                 `Waiting for ${f.who.trim()}`); return true;
    case 'wiz-next':
      await file({ status: 'Next', context: f.context || null, energy: f.energy || null,
                   time: f.time_mins === '' ? null : Number(f.time_mins), date: f.day || null, focus: !!f.focus,
                   projectId: W.draft.projectId || f.projectId || null, areaId: W.draft.areaId || f.areaId || null }, 'Next action ✓'); return true;
    case 'wiz-calendar':
      await file({ status: 'Calendar', date: A.combineDate(f.day, f.time), projectId: W.draft.projectId || null, areaId: W.draft.areaId || null }, `On the calendar`); return true;
  }
  return false;
}

/* Projects: the list (stalled ones first, because a project with no next
   action is the thing GTD exists to catch) and the project page. */
'use strict';
import { state } from '../store.js';
import { esc, attr, list, head, section, empty, projectCard, openSheet, closeSheet, toast, field, options, areaOptions,
         dateChip, areaChip, notionLink, pills, plural } from '../ui.js';
import { activeProjects, somedayProjects, doneProjects, projectById, projectItems, projectState, projectProgress,
         horizonById, fmtDay, sortNext, ago, today } from '../model.js';
import * as A from '../actions.js';
import { openEdit } from './item.js';

let tab = 'Active';
export const title = r => r.id ? (projectById(r.id)?.name || 'Project') : 'Projects';

export function render(r) {
  if (r.id) return detail(r.id);
  const pool = tab === 'Active' ? activeProjects() : tab === 'Someday' ? somedayProjects() : doneProjects();
  const stalled = pool.filter(p => projectState(p) !== 'moving');
  const moving = pool.filter(p => projectState(p) === 'moving');
  const sortN = a => [...a].sort((x, y) => (y.focus - x.focus) || x.name.localeCompare(y.name));
  return `<div class="actions" style="margin:0 0 10px"><button class="btn primary" data-act="proj-new">+ Project</button></div>
    ${pills([['Active', `Active · ${activeProjects().length}`], ['Someday', `Someday · ${somedayProjects().length}`], ['Done', `Done · ${doneProjects().length}`]], tab, 'proj-tab')}
    ${!pool.length ? empty(tab === 'Active' ? 'No active projects' : `No ${tab.toLowerCase()} projects`, tab === 'Active' ? '<br>Anything needing more than one action is a project.' : '') : ''}
    ${tab === 'Active'
      ? (stalled.length ? section('proj-stalled', 'Needs a next action', stalled.length, sortN(stalled).map(projectCard).join('')) : '')
        + (moving.length ? section('proj-moving', 'Moving', moving.length, sortN(moving).map(projectCard).join('')) : '')
      : sortN(pool).map(projectCard).join('')}`;
}

function detail(id) {
  const p = projectById(id);
  if (!p) return empty('Project not found', '<br><a href="#/projects">Back to projects</a>');
  const its = projectItems(id);
  const by = s => its.filter(i => i.status === s);
  const next = sortNext(by('Next')), cal = by('Calendar'), wait = by('Waiting'), some = by('Someday'), inbox = by('Inbox'), tick = by('Tickler'), done = by('Done');
  const { done: dn, total, pct } = projectProgress(p);
  const st = projectState(p);
  const area = horizonById(p.areaId), goal = horizonById(p.goalId);
  return `<p class="hint"><a href="#/projects">‹ Projects</a></p>
    <div class="title-row"><h3>${p.focus ? '★ ' : ''}${esc(p.name)}</h3></div>
    <div class="item-meta" style="margin:-4px 0 12px">
      <span class="chip status">${esc(p.status)}</span>${area ? areaChip(area.id) : ''}${goal ? `<span class="chip area">◎ ${esc(goal.name)}</span>` : ''}${p.due ? dateChip({ date: p.due, status: 'Next' }) : ''}
    </div>
    ${p.outcome ? `<div class="panel"><strong>Successful outcome</strong>${esc(p.outcome)}</div>` : ''}
    ${p.notes ? `<p class="desc">${esc(p.notes)}</p>` : ''}
    <div class="panel ${st === 'moving' ? '' : 'warn'}"><strong>${dn} of ${total} actions done${total ? ` · ${pct}%` : ''}</strong>
      ${st === 'stalled' ? 'No next action — this project cannot move until it has one.' : st === 'empty' ? 'No actions yet. What is the very next physical step?' : `${next.length} next, ${cal.length} scheduled, ${wait.length} waiting, ${some.length} someday.`}</div>
    <div class="actions" style="margin:0 0 6px">
      ${p.status === 'Active' ? `<button class="btn primary" data-act="proj-add-action" data-id="${p.id}">+ Next action</button>` : ''}
      <button class="btn" data-act="proj-edit" data-id="${p.id}">Edit</button>
      ${p.status === 'Active' ? `<button class="btn" data-act="proj-complete" data-id="${p.id}">Complete ✓</button>` : ''}
    </div>
    ${next.length ? head('Next actions', next.length) + list(next, { hideProj: true }) : ''}
    ${inbox.length ? head('In the Inbox', inbox.length) + list(inbox, { hideProj: true }) : ''}
    ${cal.length ? head('Scheduled', cal.length) + list(cal, { hideProj: true }) : ''}
    ${wait.length ? head('Waiting for', wait.length) + list(wait, { hideProj: true, age: true }) : ''}
    ${tick.length ? head('Tickler', tick.length) + list(tick, { hideProj: true }) : ''}
    ${some.length ? head('Someday', some.length) + list(some, { hideProj: true }) : ''}
    ${done.length ? section(`proj-done-${p.id}`, 'Done', done.length, list(done.sort((a, b) => (b.completed || '') < (a.completed || '') ? -1 : 1), { hideProj: true })) : ''}
    <div class="sheet-actions" style="margin-top:18px">
      ${p.status !== 'Someday' ? `<button class="btn" data-act="proj-status" data-id="${p.id}" data-v="Someday">→ Someday</button>` : ''}
      ${p.status !== 'Active' ? `<button class="btn" data-act="proj-status" data-id="${p.id}" data-v="Active">→ Active</button>` : ''}
      ${p.status !== 'Trash' ? `<button class="btn danger" data-act="proj-status" data-id="${p.id}" data-v="Trash">Trash</button>` : ''}
      ${notionLink(p.url)}
    </div>
    <p class="note" style="margin-top:10px">Created ${esc(ago(p.created))}${p.completed ? ` · completed ${esc(fmtDay(p.completed))}` : ''}</p>`;
}

export function projectForm(p = {}) {
  return `<h3>${p.id ? 'Edit project' : 'New project'}</h3>
    <form id="project-form" data-id="${p.id || ''}">
      ${field('Project', `<input name="name" value="${attr(p.name || '')}" required autofocus placeholder="Verb the noun">`)}
      ${field('Successful outcome', `<textarea name="outcome" placeholder="When this is done…">${esc(p.outcome || '')}</textarea>`)}
      <div class="row2">
        ${field('Area', `<select name="areaId">${areaOptions(p.areaId || '')}</select>`)}
        ${field('Goal', `<select name="goalId">${areaOptions(p.goalId || '', 'Goal')}</select>`)}
      </div>
      <div class="row2">
        ${field('Due', `<input type="date" name="due" value="${attr(p.due || '')}">`)}
        ${field('Status', `<select name="status">${options(['Active','Someday','Done'], p.status || 'Active')}</select>`)}
      </div>
      ${field('Notes', `<textarea name="notes">${esc(p.notes || '')}</textarea>`)}
      <label class="check-row"><input type="checkbox" name="focus" ${p.focus ? 'checked' : ''}><span><strong>★ Focus</strong>A project that matters most this week</span></label>
      <div class="sheet-actions"><button type="submit" class="btn primary">${p.id ? 'Save' : 'Create'}</button><button type="button" class="btn" data-act="close">Cancel</button></div>
    </form>`;
}

export async function act(name, el) {
  const id = el.dataset.id;
  switch (name) {
    case 'proj-tab': tab = el.dataset.v; return 'render';
    case 'proj-new': openSheet(projectForm()); return true;
    case 'proj-edit': openSheet(projectForm(projectById(id))); return true;
    case 'proj-add-action': openEdit(null, { status: 'Next', projectId: id, areaId: projectById(id)?.areaId || '' }); return true;
    case 'proj-complete': if (confirm('Mark this project done? Open actions are closed with it.')) await A.completeProject(id); return true;
    case 'proj-status': await A.setProjectStatus(id, el.dataset.v); if (el.dataset.v === 'Trash') location.hash = '#/projects'; return true;
  }
  return false;
}

export async function submit(form) {
  if (form.id !== 'project-form') return false;
  const f = Object.fromEntries(new FormData(form));
  const fields = { name: f.name.trim(), outcome: f.outcome.trim(), areaId: f.areaId || null, goalId: f.goalId || null,
                   due: f.due || null, status: f.status, notes: f.notes.trim(), focus: !!f.focus };
  if (!fields.name) return toast('It needs a name.'), true;
  if (fields.status === 'Done') fields.completed = today();
  closeSheet();
  if (form.dataset.id) await A.saveProject(form.dataset.id, fields);
  else { const p = await A.addProject(fields); if (p) location.hash = `#/projects/${p.id}`; }
  return true;
}

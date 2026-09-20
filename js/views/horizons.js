/* Horizons of focus: areas of responsibility, goals, vision, purpose.
   Projects hang off areas and goals; goals hang off areas. */
'use strict';
import { state } from '../store.js';
import { esc, attr, empty, head, openSheet, closeSheet, toast, field, options, areaOptions, pills, projectCard, notionLink, plural } from '../ui.js';
import { horizonsAt, horizonById, childrenOf, projectsUnder, fmtDay, dayOf, today } from '../model.js';
import { HORIZON_LEVELS, HORIZON_STATUSES } from '../notion.js';
import * as A from '../actions.js';
import { projectForm } from './projects.js';

let level = 'Area';
const LABEL = { Area: 'Areas of responsibility', Goal: 'Goals & objectives', Vision: 'Vision', Purpose: 'Purpose & principles' };
const BLURB = {
  Area: 'The roles and standards you maintain — the hats you wear. Projects belong to one.',
  Goal: 'What you want to have achieved in a year or two. Each goal sits under an area.',
  Vision: 'Three to five years out: what does wild success look like?',
  Purpose: 'Why you do any of this, and the principles you will not trade away.',
};
export const title = () => 'Horizons';

export function render() {
  const rows = horizonsAt(level).sort((a, b) => a.name.localeCompare(b.name));
  return `${pills(HORIZON_LEVELS.map(l => [l, `${LABEL[l].split(' ')[0]} · ${horizonsAt(l).length}`]), level, 'hz-level')}
    <p class="hint">${BLURB[level]}</p>
    <div class="actions" style="margin:0 0 10px"><button class="btn" data-act="hz-new">+ ${level === 'Purpose' ? 'Principle' : level}</button></div>
    ${rows.length ? rows.map(card).join('') : empty(`No ${LABEL[level].toLowerCase()} yet`)}`;
}

function card(h) {
  const projects = projectsUnder(h), kids = childrenOf(h.id);
  const sub = [
    h.level === 'Area' || h.level === 'Goal' ? plural(projects.length, 'active project') : '',
    h.level === 'Area' && kids.length ? plural(kids.length, 'goal') : '',
    h.level === 'Goal' && h.parentId ? `in ${esc(horizonById(h.parentId)?.name || '')}` : '',
    h.target ? `by ${fmtDay(h.target)}` : '',
    h.status !== 'Active' ? h.status : '',
  ].filter(Boolean).join(' · ');
  return `<button class="card" data-act="hz-open" data-id="${h.id}">
    <div class="card-top"><span class="card-nm">${esc(h.name)}</span><span class="card-n">${h.status === 'Achieved' ? '✓' : ''}</span></div>
    ${h.notes ? `<div class="card-sub">${esc(h.notes.slice(0, 140))}</div>` : ''}
    ${sub ? `<div class="card-sub">${sub}</div>` : ''}
  </button>`;
}

function openDetail(id) {
  const h = horizonById(id); if (!h) return;
  const projects = projectsUnder(h), kids = childrenOf(h.id), parent = horizonById(h.parentId);
  openSheet(`<h3>${esc(h.name)}</h3>
    <div class="item-meta" style="margin:-6px 0 12px"><span class="chip status">${h.level}</span><span class="chip ${h.status === 'Achieved' ? 'ok' : ''}">${h.status}</span>${h.target ? `<span class="chip due">by ${fmtDay(h.target)}</span>` : ''}${parent ? `<span class="chip area">${esc(parent.name)}</span>` : ''}</div>
    ${h.notes ? `<p class="desc">${esc(h.notes)}</p>` : ''}
    ${kids.length ? head('Goals', kids.length) + kids.map(k => `<button class="card" data-act="hz-open" data-id="${k.id}"><div class="card-nm">${esc(k.name)}</div></button>`).join('') : ''}
    ${projects.length ? head('Active projects', projects.length) + projects.map(projectCard).join('') : ''}
    <div class="sheet-actions">
      <button class="btn primary" data-act="hz-edit" data-id="${h.id}">Edit</button>
      ${['Area','Goal'].includes(h.level) ? `<button class="btn" data-act="hz-add-project" data-id="${h.id}">+ Project</button>` : ''}
      ${h.level === 'Area' ? `<button class="btn" data-act="hz-add-goal" data-id="${h.id}">+ Goal</button>` : ''}
      ${notionLink(h.url)}<button class="btn" data-act="close">Close</button>
    </div>`);
}

function form(h = {}) {
  const lv = h.level || level;
  return `<h3>${h.id ? 'Edit' : 'New'} ${lv.toLowerCase()}</h3>
    <form id="horizon-form" data-id="${h.id || ''}">
      ${field('Name', `<input name="name" value="${attr(h.name || '')}" required autofocus>`)}
      <div class="row2">
        ${field('Level', `<select name="level">${options(HORIZON_LEVELS, lv)}</select>`)}
        ${field('Status', `<select name="status">${options(HORIZON_STATUSES, h.status || 'Active')}</select>`)}
      </div>
      <div class="row2">
        ${field('Under (area)', `<select name="parentId">${areaOptions(h.parentId || '')}</select>`)}
        ${field('Target date', `<input type="date" name="target" value="${attr(h.target || '')}">`)}
      </div>
      ${field('Notes', `<textarea name="notes" placeholder="What does maintaining this well look like?">${esc(h.notes || '')}</textarea>`)}
      <div class="sheet-actions"><button type="submit" class="btn primary">${h.id ? 'Save' : 'Add'}</button><button type="button" class="btn" data-act="close">Cancel</button></div>
    </form>`;
}

export async function act(name, el) {
  const id = el.dataset.id;
  switch (name) {
    case 'hz-level': level = el.dataset.v; return 'render';
    case 'hz-new': openSheet(form()); return true;
    case 'hz-open': openDetail(id); return true;
    case 'hz-edit': openSheet(form(horizonById(id))); return true;
    case 'hz-add-goal': openSheet(form({ level: 'Goal', parentId: id })); return true;
    case 'hz-add-project': { const h = horizonById(id); openSheet(projectForm(h.level === 'Area' ? { areaId: id } : { goalId: id, areaId: h.parentId || '' })); return true; }
  }
  return false;
}

export async function submit(form_) {
  if (form_.id !== 'horizon-form') return false;
  const f = Object.fromEntries(new FormData(form_));
  const fields = { name: f.name.trim(), level: f.level, status: f.status, parentId: f.parentId || null, target: f.target || null, notes: f.notes.trim() };
  if (!fields.name) return toast('It needs a name.'), true;
  closeSheet();
  if (form_.dataset.id) await A.saveHorizon(form_.dataset.id, fields); else { level = fields.level; await A.addHorizon(fields); }
  return true;
}

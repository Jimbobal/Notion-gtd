/* Perspectives: saved filters across every list, stored in Notion so they
   follow you between devices. */
'use strict';
import { state } from '../store.js';
import { esc, attr, empty, head, list, openSheet, closeSheet, toast, field, options, projectOptions, areaOptions, plural } from '../ui.js';
import { filterItems, sortNext, STATUS_LABEL } from '../model.js';
import { ITEM_STATUSES, ENERGY } from '../notion.js';
import * as A from '../actions.js';

export const title = r => r.id ? (state.perspectives.find(p => p.id === r.id)?.name || 'Perspective') : 'Perspectives';

const pool = () => state.items.filter(i => i.status !== 'Trash');
const describe = f => [
  f.statuses?.length ? f.statuses.map(s => STATUS_LABEL[s]).join(', ') : 'Any list',
  f.contexts?.length ? f.contexts.join(', ') : '', f.tags?.length ? f.tags.map(t => '#' + t).join(' ') : '',
  f.energy ? `≤ ${f.energy} energy` : '', f.maxTime ? `≤ ${f.maxTime}m` : '', f.focus ? '★ focus' : '',
  f.dueWithin != null ? `due within ${f.dueWithin}d` : '', f.text ? `“${f.text}”` : '',
].filter(Boolean).join(' · ');

export function render(r) {
  if (r.id) return detail(r.id);
  const ps = [...state.perspectives].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return `<div class="actions" style="margin:0 0 10px"><button class="btn primary" data-act="persp-new">+ Perspective</button></div>
    <p class="hint">A perspective is a saved filter: any combination of list, context, tag, energy, time, project and area.</p>
    ${ps.length ? ps.map(p => `<a class="card" href="#/perspectives/${p.id}">
        <div class="card-top"><span class="card-nm">${esc(p.name)}</span><span class="card-n">${filterItems(pool(), p.filter).length}</span></div>
        <div class="card-sub">${esc(describe(p.filter))}</div></a>`).join('') : empty('No perspectives yet')}`;
}

function detail(id) {
  const p = state.perspectives.find(x => x.id === id);
  if (!p) return empty('Perspective not found', '<br><a href="#/perspectives">Back</a>');
  const items = sortNext(filterItems(pool(), p.filter));
  return `<p class="hint"><a href="#/perspectives">‹ Perspectives</a></p>
    <p class="hint">${esc(describe(p.filter))}</p>
    <div class="actions" style="margin:0 0 10px"><button class="btn" data-act="persp-edit" data-id="${p.id}">Edit</button><button class="btn danger" data-act="persp-delete" data-id="${p.id}">Remove</button></div>
    ${head('Matches', items.length)}${list(items, { status: true })}`;
}

const checks = (name, values, cur, label = v => v) => `<div class="pills wrap" style="margin-bottom:12px">${values.map(v =>
  `<label class="pill small ${cur.includes(v) ? 'is-on' : ''}"><input type="checkbox" name="${name}" value="${attr(v)}" ${cur.includes(v) ? 'checked' : ''} hidden>${esc(label(v))}</label>`).join('')}</div>`;

function form(p = {}) {
  const f = p.filter || {};
  return `<h3>${p.id ? 'Edit perspective' : 'New perspective'}</h3>
    <form id="persp-form" data-id="${p.id || ''}">
      ${field('Name', `<input name="name" value="${attr(p.name || '')}" required autofocus placeholder="e.g. Quick wins at home">`)}
      <span class="note">Lists</span>${checks('statuses', ITEM_STATUSES.filter(s => s !== 'Trash'), f.statuses || [], s => STATUS_LABEL[s])}
      <span class="note">Contexts</span>${checks('contexts', state.contexts.map(c => c.name), f.contexts || [])}
      ${state.tags.length ? `<span class="note">Tags</span>${checks('tags', state.tags.map(t => t.name), f.tags || [], t => '#' + t)}` : ''}
      <div class="row3">
        ${field('Energy up to', `<select name="energy">${options(ENERGY, f.energy || '', 'Any')}</select>`)}
        ${field('Minutes up to', `<input type="number" name="maxTime" min="0" step="5" value="${f.maxTime ?? ''}" placeholder="—">`)}
        ${field('Due within days', `<input type="number" name="dueWithin" min="0" value="${f.dueWithin ?? ''}" placeholder="—">`)}
      </div>
      <div class="row2">
        ${field('Project', `<select name="projectId">${projectOptions(f.projectId || '')}</select>`)}
        ${field('Area', `<select name="areaId">${areaOptions(f.areaId || '')}</select>`)}
      </div>
      ${field('Text contains', `<input name="text" value="${attr(f.text || '')}">`)}
      <label class="check-row"><input type="checkbox" name="focus" ${f.focus ? 'checked' : ''}><span><strong>★ Focus only</strong></span></label>
      <div class="sheet-actions"><button type="submit" class="btn primary">${p.id ? 'Save' : 'Create'}</button><button type="button" class="btn" data-act="close">Cancel</button></div>
    </form>`;
}

export async function act(name, el) {
  const id = el.dataset.id;
  switch (name) {
    case 'persp-new': openSheet(form()); return true;
    case 'persp-edit': openSheet(form(state.perspectives.find(x => x.id === id))); return true;
    case 'persp-delete': if (confirm('Remove this perspective?')) { await A.deletePerspective(id); location.hash = '#/perspectives'; } return true;
  }
  return false;
}

export function pillToggle(el) {
  /* Checkbox pills inside the form: reflect state on the label. */
  const box = el.querySelector?.('input[type=checkbox]');
  if (box && el.classList.contains('pill')) { setTimeout(() => el.classList.toggle('is-on', box.checked), 0); return true; }
  return false;
}

export async function submit(form_) {
  if (form_.id !== 'persp-form') return false;
  const fd = new FormData(form_);
  const filter = {
    statuses: fd.getAll('statuses'), contexts: fd.getAll('contexts'), tags: fd.getAll('tags'),
    energy: fd.get('energy') || null, maxTime: fd.get('maxTime') ? Number(fd.get('maxTime')) : null,
    dueWithin: fd.get('dueWithin') !== '' ? Number(fd.get('dueWithin')) : null,
    projectId: fd.get('projectId') || null, areaId: fd.get('areaId') || null,
    text: (fd.get('text') || '').trim(), focus: !!fd.get('focus'),
  };
  const name = (fd.get('name') || '').trim();
  if (!name) return toast('It needs a name.'), true;
  closeSheet();
  if (form_.dataset.id) await A.savePerspective(form_.dataset.id, { name, filter });
  else { const p = await A.addPerspective({ name, filter, order: state.perspectives.length }); if (p) location.hash = `#/perspectives/${p.id}`; }
  return true;
}

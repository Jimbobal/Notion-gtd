/* The item sheet: detail, edit form and quick capture. Opened from any
   list; all its buttons carry data-act values handled in act(). */
'use strict';
import { state, prefs } from '../store.js';
import { esc, attr, openSheet, closeSheet, toast, field, options, contextOptions, projectOptions, areaOptions,
         dateChip, ctxChip, projChip, areaChip, timeChip, energyChip, tagChips, personChip, notionLink, statusChip } from '../ui.js';
import { STATUS_LABEL, fmtWhen, ago, projectById, horizonById } from '../model.js';
import { ENERGY, REPEATS } from '../notion.js';
import * as A from '../actions.js';
import { startClarify } from './clarify.js';
import { attachSection } from './attach.js';

const MOVES = ['Inbox','Next','Calendar','Waiting','Someday','Tickler','Reference'];

export function openItem(id) {
  const i = A.itemById(id); if (!i) return;
  const p = projectById(i.projectId), a = horizonById(i.areaId);
  openSheet(`
    <h3>${esc(i.name) || '<em>Untitled</em>'}</h3>
    <div class="item-meta" style="margin:-6px 0 12px">${statusChip(i.status)}${i.focus ? '<span class="chip focus">★ Focus</span>' : ''}${ctxChip(i.context)}${dateChip(i)}${timeChip(i.time)}${energyChip(i.energy)}${tagChips(i.tags)}</div>
    ${i.notes ? `<p class="desc">${esc(i.notes)}</p>` : ''}
    <dl class="kv">
      ${p ? `<dt>Project</dt><dd><a href="#/projects/${p.id}" data-act="close">${esc(p.name)}</a></dd>` : ''}
      ${a ? `<dt>Area</dt><dd>${esc(a.name)}</dd>` : ''}
      ${i.status === 'Waiting' ? `<dt>Waiting on</dt><dd>${esc(i.waitingOn) || '—'}</dd>` : ''}
      ${i.date ? `<dt>${i.status === 'Tickler' ? 'Resurfaces' : i.status === 'Calendar' ? 'When' : 'Due'}</dt><dd>${esc(fmtWhen(i.date))}</dd>` : ''}
      ${i.repeat && i.repeat !== 'None' ? `<dt>Repeats</dt><dd>${esc(i.repeat)}</dd>` : ''}
      ${i.completed ? `<dt>Completed</dt><dd>${esc(fmtWhen(i.completed))}</dd>` : ''}
      <dt>Captured</dt><dd>${esc(ago(i.created))}</dd>
    </dl>
    <div class="sheet-actions plain">
      ${i.status === 'Inbox' ? `<button class="btn primary" data-act="item-clarify" data-id="${i.id}">Clarify</button>` : ''}
      ${i.status !== 'Trash' ? `<button class="btn ${i.status === 'Inbox' ? '' : 'primary'}" data-act="item-done" data-id="${i.id}">${i.status === 'Done' ? 'Reopen' : 'Done ✓'}</button>` : ''}
      <button class="btn" data-act="item-edit" data-id="${i.id}">Edit</button>
      ${i.status !== 'Done' && i.status !== 'Trash' ? `<button class="btn" data-act="item-focus" data-id="${i.id}">${i.focus ? 'Unfocus' : '★ Focus'}</button>` : ''}
    </div>
    ${i.status !== 'Trash' ? attachSection('items', i) : ''}
    <div class="section-head" style="margin-top:14px"><h3>Move to</h3></div>
    <div class="pills wrap">${MOVES.filter(s => s !== i.status).map(s =>
      `<button class="pill small" data-act="item-move" data-id="${i.id}" data-v="${s}">${STATUS_LABEL[s]}</button>`).join('')}</div>
    <div class="sheet-actions">
      ${i.status === 'Trash' ? `<button class="btn" data-act="item-restore" data-id="${i.id}">Restore</button>
                                <button class="btn danger" data-act="item-delete" data-id="${i.id}">Delete forever</button>`
                             : `<button class="btn danger" data-act="item-trash" data-id="${i.id}">Trash</button>`}
      ${notionLink(i.url)}
      <button class="btn" data-act="close">Close</button>
    </div>`);
}

export function itemForm(i = {}, o = {}) {
  const { day, time } = A.splitDate(i.date);
  const status = i.status || o.status || 'Inbox';
  return `<form id="item-form" data-id="${i.id || ''}">
    ${field('What', `<input name="name" value="${attr(i.name || '')}" autocomplete="off" placeholder="One thing" ${o.autofocus === false ? '' : 'autofocus'} required>`)}
    <div class="row2">
      ${field('List', `<select name="status">${options(Object.keys(STATUS_LABEL).filter(s => s !== 'Trash').map(s => [s, STATUS_LABEL[s]]), status)}</select>`)}
      ${field('Context', `<select name="context">${contextOptions(i.context || o.context || '')}</select>`)}
    </div>
    <div class="row2">
      ${field('Project', `<select name="projectId">${projectOptions(i.projectId || o.projectId || '')}</select>`)}
      ${field('Area', `<select name="areaId">${areaOptions(i.areaId || o.areaId || '')}</select>`)}
    </div>
    <div class="row2">
      ${field('Date', `<input type="date" name="day" value="${attr(day || o.day || '')}">`)}
      ${field('Time of day', `<input type="time" name="time" value="${attr(time)}">`)}
    </div>
    <div class="row3">
      ${field('Minutes', `<input type="number" name="time_mins" inputmode="numeric" min="0" step="5" value="${i.time ?? ''}" placeholder="—">`)}
      ${field('Energy', `<select name="energy">${options(ENERGY, i.energy || '', 'Any')}</select>`)}
      ${field('Repeat', `<select name="repeat">${options(REPEATS, i.repeat || 'None')}</select>`)}
    </div>
    ${field('Waiting on', `<input name="waitingOn" value="${attr(i.waitingOn || '')}" placeholder="Who owes you this?">`)}
    ${field('Tags', `<input name="tags" value="${attr((i.tags || []).join(', '))}" placeholder="comma, separated" list="tag-list"><datalist id="tag-list">${state.tags.map(t => `<option value="${attr(t.name)}">`).join('')}</datalist>`)}
    ${field('Notes', `<textarea name="notes">${esc(i.notes || '')}</textarea>`)}
    <label class="check-row"><input type="checkbox" name="focus" ${i.focus ? 'checked' : ''}><span><strong>★ Focus</strong>One of the few things that matter most right now</span></label>
    <div class="sheet-actions">
      <button type="submit" class="btn primary">${i.id ? 'Save' : 'Add'}</button>
      <button type="button" class="btn" data-act="${i.id ? 'item-open' : 'close'}" data-id="${i.id || ''}">Cancel</button>
    </div></form>`;
}

export function readItemForm(form) {
  const f = Object.fromEntries(new FormData(form));
  return {
    name: f.name.trim(), status: f.status, context: f.context || null,
    projectId: f.projectId || null, areaId: f.areaId || null,
    date: A.combineDate(f.day, f.time), time: f.time_mins === '' ? null : Number(f.time_mins),
    energy: f.energy || null, repeat: f.repeat || 'None',
    waitingOn: f.waitingOn.trim(), tags: f.tags.split(',').map(s => s.trim()).filter(Boolean),
    notes: f.notes.trim(), focus: !!f.focus,
  };
}

export const openEdit = (id, o = {}) => openSheet(`<h3>${id ? 'Edit' : 'New item'}</h3>${itemForm(id ? A.itemById(id) : {}, o)}`);

export function openCapture(o = {}) {
  openSheet(`<h3>Capture</h3>
    <form id="capture-form">
      ${field("What's on your mind?", `<input name="name" autocomplete="off" placeholder="One thing" value="${attr(o.name || '')}" autofocus required>`)}
      ${field('Notes', `<textarea name="notes" placeholder="Optional"></textarea>`)}
      <p class="note">Goes into the Inbox, unclarified. Decide what it means later — or now, with <em>Capture &amp; clarify</em>.</p>
      <div class="sheet-actions">
        <button type="submit" class="btn primary">Capture</button>
        <button type="submit" class="btn" data-clarify="1">Capture &amp; clarify</button>
        <button type="button" class="btn" data-act="close">Cancel</button>
      </div></form>`);
}

/* Returns true if the act was handled. */
export async function act(name, el, ev) {
  const id = el.dataset.id;
  switch (name) {
    case 'item-open':    openItem(id); return true;
    case 'item-edit':    openEdit(id); return true;
    case 'item-clarify': closeSheet(); startClarify(id); return true;
    case 'item-done':    closeSheet(); await A.completeItem(id); return true;
    case 'item-focus':   await A.toggleFocus(id); openItem(id); return true;
    case 'item-move':    closeSheet(); await A.moveItem(id, el.dataset.v); return true;
    case 'item-trash':   closeSheet(); await A.trashItem(id); return true;
    case 'item-restore': closeSheet(); await A.restoreItem(id); return true;
    case 'item-delete':  if (confirm('Delete this item for good? It stays in Notion’s trash for 30 days.')) { closeSheet(); await A.deleteForever('items', id); } return true;
  }
  return false;
}

export async function submit(form) {
  if (form.id === 'item-form') {
    const fields = readItemForm(form);
    if (!fields.name) return toast('It needs a name.');
    closeSheet();
    if (form.dataset.id) await A.saveItem(form.dataset.id, fields);
    else await A.addItem(fields);
    return true;
  }
  if (form.id === 'capture-form') {
    const f = Object.fromEntries(new FormData(form));
    const name = f.name.trim(); if (!name) return toast('Write something first.');
    const clarify = form._submitter?.dataset.clarify === '1';
    closeSheet();
    const rec = await A.addItem({ name, notes: f.notes.trim(), status: 'Inbox' });
    if (clarify && rec) startClarify(rec.id);
    return true;
  }
  return false;
}

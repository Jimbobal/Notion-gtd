/* Domain actions: each one changes Notion (through notion.js), shows a
   toast, and asks the shell to redraw. Views call these; they never call
   notion.js directly for writes. */
'use strict';
import { state } from './store.js';
import * as N from './notion.js';
import { toast, closeSheet } from './ui.js';
import { today, nextOccurrence, projectItems, STATUS_LABEL, hasTime } from './model.js';
import { syncItemToGoogle, deleteEvent } from './gcal.js';

export const rerender = () => document.dispatchEvent(new CustomEvent('gtd:render'));

async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); rerender(); return r; }
  catch (e) { toast(e.message, 5000); rerender(); throw e; }
}

export const itemById = id => state.items.find(i => i.id === id);

/* Keep the Google mirror in step after any change to an item. Never blocks
   the change itself; a failure is reported and the next write retries. */
async function mirror(id) {
  const i = itemById(id); if (!i) return;
  try { await syncItemToGoogle(i); }
  catch (e) { toast(`Google Calendar: ${e.message}`, 6000); }
}

/* Complete. A repeating item spawns its next occurrence and this one is
   kept as the record of having done it. */
export async function completeItem(id) {
  const i = itemById(id); if (!i) return;
  if (i.status === 'Done') { await guard(() => N.updateItem(id, { status: 'Next', completed: null }), 'Reopened'); return mirror(id); }
  await guard(async () => {
    await N.updateItem(id, { status: 'Done', completed: new Date().toISOString(), focus: false });
    if (i.repeat && i.repeat !== 'None') {
      const date = nextOccurrence(i);
      await N.createItem({ name: i.name, status: i.status === 'Done' ? 'Next' : i.status, context: i.context,
        tags: i.tags, projectId: i.projectId, areaId: i.areaId, date, time: i.time, energy: i.energy,
        repeat: i.repeat, notes: i.notes });
      toast(`Done ✓ — next one ${date.slice(0, 10)}`);
    }
  }, i.repeat && i.repeat !== 'None' ? null : 'Done ✓');
  await mirror(id);
}

export async function moveItem(id, status, extra = {}) {
  const patch = { status, ...extra };
  if (status !== 'Done') patch.completed = null;
  if (status !== 'Waiting' && !('waitingOn' in extra)) patch.waitingOn = '';
  const r = await guard(() => N.updateItem(id, patch), `Moved to ${STATUS_LABEL[status]}`);
  await mirror(id); return r;
}

export const trashItem   = async id => { const r = await guard(() => N.updateItem(id, { status: 'Trash', focus: false }), 'Moved to Trash'); await mirror(id); return r; };
export const restoreItem = id => guard(() => N.updateItem(id, { status: 'Inbox' }), 'Restored to Inbox');
export const toggleFocus = id => { const i = itemById(id); return guard(() => N.updateItem(id, { focus: !i.focus }), !i.focus ? '★ In focus' : 'Out of focus'); };
export const saveItem    = async (id, patch) => { const r = await guard(() => N.updateItem(id, patch), 'Saved'); await mirror(id); return r; };
export const addItem     = async fields => { const r = await guard(() => N.createItem(fields), fields.status === 'Inbox' || !fields.status ? 'Captured ✓' : `Added to ${STATUS_LABEL[fields.status]}`); if (r) await mirror(r.id); return r; };

/* Attachments on an item or a project */
const recOf = (kind, id) => kind === 'projects' ? state.projects.find(p => p.id === id) : itemById(id);
const upd = (kind, id, patch) => kind === 'projects' ? N.updateProject(id, patch) : N.updateItem(id, patch);
export const attach = (kind, id, files) => guard(() => upd(kind, id, { attachments: [...(recOf(kind, id)?.attachments || []), ...files.map(f => ({ name: f.name, url: f.url }))] }), `${files.length === 1 ? 'Attached' : files.length + ' attached'} ✓`);
export const detach = (kind, id, k) => guard(() => upd(kind, id, { attachments: (recOf(kind, id)?.attachments || []).filter((_, i) => i !== k) }), 'Removed');

/* Every tickler item whose date has come goes back to the Inbox. */
export async function surfaceTickler(items) {
  for (const i of items) { try { await N.updateItem(i.id, { status: 'Inbox' }); } catch {} }
  if (items.length) rerender();
}

/* Projects */
export const addProject    = f => guard(() => N.createProject(f), 'Project created');
export const saveProject   = (id, p) => guard(() => N.updateProject(id, p), 'Saved');
export async function completeProject(id) {
  const open = projectItems(id).filter(i => !['Done','Trash'].includes(i.status));
  await guard(async () => {
    await N.updateProject(id, { status: 'Done', completed: today(), focus: false });
    for (const i of open) await N.updateItem(i.id, { status: 'Done', completed: new Date().toISOString(), focus: false });
  }, open.length ? `Project done — ${open.length} open action${open.length > 1 ? 's' : ''} closed with it` : 'Project done ✓');
}
export const setProjectStatus = (id, status) => guard(() => N.updateProject(id, { status, ...(status === 'Active' ? { completed: null } : {}) }), `Project → ${status}`);

/* Horizons, habits, perspectives */
export const addHorizon  = f => guard(() => N.createHorizon(f), 'Added');
export const saveHorizon = (id, p) => guard(() => N.updateHorizon(id, p), 'Saved');
export const addHabit    = f => guard(() => N.createHabit(f), 'Habit added');
export const saveHabit   = (id, p) => guard(() => N.updateHabit(id, p), 'Saved');
export async function tickHabit(h, day = today()) {
  const existing = state.habitLog.find(l => l.habitId === h.id && l.date === day);
  if (existing) return guard(() => N.archivePage('habitLog', existing.id), 'Unticked');
  return guard(() => N.logHabit(h, day), `${h.name} ✓`);
}
export const addPerspective  = f => guard(() => N.createPerspective(f), 'Perspective saved');
export const savePerspective = (id, p) => guard(() => N.updatePerspective(id, p), 'Saved');
export const deletePerspective = id => guard(() => N.archivePage('perspectives', id), 'Perspective removed');

/* Trash */
export async function emptyTrash() {
  const its = state.items.filter(i => i.status === 'Trash');
  const prs = state.projects.filter(p => p.status === 'Trash');
  await guard(async () => {
    for (const i of its) { if (i.eventId) { const [c, e] = i.eventId.split('/'); try { await deleteEvent(c, e); } catch {} } await N.archivePage('items', i.id); }
    for (const p of prs) await N.archivePage('projects', p.id);
  }, `Trash emptied — ${its.length + prs.length} sent to Notion's trash`);
}
export const deleteForever = async (key, id) => {
  const i = key === 'items' ? itemById(id) : null;
  if (i?.eventId) { const [c, e] = i.eventId.split('/'); try { await deleteEvent(c, e); } catch {} }
  return guard(() => N.archivePage(key, id), 'Deleted (recoverable in Notion for 30 days)');
};

/* Local date+time inputs → what Notion stores. A time gets the local
   offset so it means the same wall-clock hour in Notion. */
export function combineDate(day, time) {
  if (!day) return null;
  if (!time) return day;
  const off = -new Date(`${day}T${time}`).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${day}T${time.length === 5 ? time + ':00' : time}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
export const splitDate = s => ({ day: (s || '').slice(0, 10), time: hasTime(s) ? new Date(s).toTimeString().slice(0, 5) : '' });

export { closeSheet };

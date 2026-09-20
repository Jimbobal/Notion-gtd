'use strict';
import { esc, list, head, empty, plural } from '../ui.js';
import { trashItems, trashProjects } from '../model.js';
import * as A from '../actions.js';

export const title = () => 'Trash';

export function render() {
  const items = trashItems(), projects = trashProjects();
  if (!items.length && !projects.length) return empty('Trash is empty');
  return `<div class="actions" style="margin:0 0 10px"><button class="btn danger" data-act="trash-empty">Empty trash</button></div>
    <p class="hint">Emptying sends these to Notion's own trash, where they can still be recovered for 30 days.</p>
    ${projects.length ? head('Projects', projects.length) + projects.map(p => `<div class="card"><div class="card-top"><span class="card-nm">${esc(p.name)}</span>
        <button class="link-btn" data-act="trash-restore-project" data-id="${p.id}">Restore</button></div></div>`).join('') : ''}
    ${items.length ? head('Items', items.length) + list(items, { noNotes: true }) : ''}`;
}

export async function act(name, el) {
  switch (name) {
    case 'trash-empty': if (confirm('Empty the trash? Items go to Notion’s trash.')) await A.emptyTrash(); return true;
    case 'trash-restore-project': await A.setProjectStatus(el.dataset.id, 'Active'); return true;
  }
  return false;
}

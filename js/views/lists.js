/* Someday/Maybe, Tickler and Reference — three plain lists. */
'use strict';
import { list, head, section, empty, esc, projectCard, plural } from '../ui.js';
import { somedayItems, somedayProjects, ticklerItems, referenceItems, dueTickler, groupBy, fmtDay, dayOf, today } from '../model.js';
import { openEdit } from './item.js';

let refQuery = '';

export const someday = {
  title: () => 'Someday / Maybe',
  render() {
    const items = somedayItems().sort((a, b) => a.name.localeCompare(b.name));
    const projects = somedayProjects();
    const add = `<div class="actions" style="margin:0 0 10px"><button class="btn" data-act="add-someday">+ Someday idea</button></div>`;
    if (!items.length && !projects.length) return add + empty('Nothing parked', '<br>Ideas you are not committing to yet live here, reviewed weekly.');
    return `${add}
      ${projects.length ? head('Projects on hold', projects.length) + projects.map(projectCard).join('') : ''}
      ${head('Ideas', items.length)}${list(items, { age: true })}`;
  },
  async act(name) { if (name === 'add-someday') { openEdit(null, { status: 'Someday' }); return true; } return false; },
};

export const tickler = {
  title: () => 'Tickler',
  render() {
    const items = ticklerItems();
    const due = dueTickler();
    const add = `<div class="actions" style="margin:0 0 10px"><button class="btn" data-act="add-tickler">+ Tickler item</button></div>`;
    if (!items.length) return add + empty('Tickler is empty', '<br>Park something with a date and it comes back to the Inbox that day.');
    const months = groupBy(items, i => (i.date || '').slice(0, 7), k => k ? new Date(k + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'No date');
    return `${add}
      ${due.length ? `<div class="panel warn"><strong>${plural(due.length, 'item')} due back</strong>They return to the Inbox on the next sync.</div>` : ''}
      ${months.map(m => section(`tick-${m.key}`, esc(m.label), m.items.length, list(m.items))).join('')}`;
  },
  async act(name) { if (name === 'add-tickler') { openEdit(null, { status: 'Tickler', day: today() }); return true; } return false; },
};

export const reference = {
  title: () => 'Reference',
  render() {
    const all = referenceItems().sort((a, b) => a.name.localeCompare(b.name));
    const q = refQuery.toLowerCase();
    const items = q ? all.filter(i => `${i.name} ${i.notes} ${i.tags.join(' ')}`.toLowerCase().includes(q)) : all;
    return `<div class="search-wrap"><input id="ref-q" type="search" placeholder="Search reference…" value="${esc(refQuery)}"><button class="btn small" data-act="add-reference">+ Add</button></div>
      ${all.length ? head(q ? 'Matches' : 'Everything', items.length) + list(items, {}, 'No matches') : empty('No reference material', '<br>Support material with nothing to do — worth keeping, findable later.')}`;
  },
  async act(name) { if (name === 'add-reference') { openEdit(null, { status: 'Reference' }); return true; } return false; },
  input(el) { if (el.id === 'ref-q') { refQuery = el.value; return 'render'; } return false; },
};

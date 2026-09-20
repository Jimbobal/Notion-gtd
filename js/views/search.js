'use strict';
import { state } from '../store.js';
import { esc, attr, list, head, empty, projectCard } from '../ui.js';
import { search } from '../model.js';

export const title = () => 'Search';

export function render(r) {
  const q = state.query;
  const res = search(q);
  const n = res.items.length + res.projects.length + res.horizons.length;
  return `<div class="search-wrap"><input id="search-q" type="search" placeholder="Search everything…" value="${attr(q)}" autofocus></div>
    ${!q ? '<p class="hint">Items, projects and horizons — names, notes, tags and people.</p>' :
      !n ? empty('No matches') :
      (res.items.length ? head('Items', res.items.length) + list(res.items, { status: true }) : '')
      + (res.projects.length ? head('Projects', res.projects.length) + res.projects.map(projectCard).join('') : '')
      + (res.horizons.length ? head('Horizons', res.horizons.length) + res.horizons.map(h => `<a class="card" href="#/horizons"><div class="card-nm">${esc(h.name)}</div><div class="card-sub">${h.level}</div></a>`).join('') : '')}`;
}
export const act = async () => false;
export function input(el) { if (el.id === 'search-q') { state.query = el.value; return 'render-soft'; } return false; }

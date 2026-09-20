/* Next Actions — the Engage view. Filter by context, energy and time,
   see focus items first, and the rest grouped by context. */
'use strict';
import { state, prefs, savePrefs } from '../store.js';
import { list, head, section, empty, esc, pills, attr } from '../ui.js';
import { nextItems, sortNext, filterItems, groupBy, focusItems } from '../model.js';

export const title = () => 'Next Actions';

export function render() {
  const e = prefs().engage;
  const all = nextItems();
  const f = { contexts: e.context ? [e.context] : [], energy: e.energy, maxTime: e.time, focus: e.focusOnly };
  const shown = sortNext(filterItems(all, f));
  const counts = groupBy(all, i => i.context);
  const ctxPills = [['', `All · ${all.length}`], ...state.contexts.map(c => [c.name, `${c.name} · ${counts.find(g => g.key === c.name)?.items.length || 0}`])];
  const none = all.filter(i => !i.context).length;
  if (none) ctxPills.push(['__none', `No context · ${none}`]);

  let body;
  if (!all.length) body = empty('No next actions', '<br>Clarify the Inbox, or add one with ＋.');
  else if (!shown.length) body = empty('Nothing fits those filters', '<br>Loosen the energy or time, or pick another context.');
  else if (e.context || e.focusOnly) body = list(shown);
  else {
    const focus = shown.filter(i => i.focus);
    const groups = groupBy(shown.filter(i => !i.focus), i => i.context || '', k => k || 'No context');
    body = (focus.length ? section('next-focus', '★ Focus', focus.length, list(focus)) : '')
      + groups.map(g => section(`next-${g.key}`, esc(g.label), g.items.length, list(g.items, { hideCtx: true }))).join('');
  }

  return `${pills(ctxPills, e.context === null ? '' : e.context, 'eng-ctx')}
    <div class="pills">
      ${[['', 'Any energy'], ['Low', '▽ Low'], ['Medium', '◆ Medium'], ['High', '▲ High']].map(([v, l]) =>
        `<button class="pill small ${(e.energy || '') === v ? 'is-on' : ''}" data-act="eng-energy" data-v="${v}">${l}</button>`).join('')}
      ${[['', 'Any time'], [15, '≤ 15m'], [30, '≤ 30m'], [60, '≤ 1h'], [120, '≤ 2h']].map(([v, l]) =>
        `<button class="pill small ${(e.time || '') === v ? 'is-on' : ''}" data-act="eng-time" data-v="${v}">${l}</button>`).join('')}
      <button class="pill small ${e.focusOnly ? 'is-on' : ''}" data-act="eng-focus">★ Focus only</button>
    </div>
    ${all.length && shown.length !== all.length ? `<p class="hint">${shown.length} of ${all.length} shown.</p>` : ''}
    ${body}`;
}

export async function act(name, el) {
  const e = { ...prefs().engage };
  switch (name) {
    case 'eng-ctx':    e.context = el.dataset.v === '' ? null : el.dataset.v; break;
    case 'eng-energy': e.energy = el.dataset.v || null; break;
    case 'eng-time':   e.time = el.dataset.v ? Number(el.dataset.v) : null; break;
    case 'eng-focus':  e.focusOnly = !e.focusOnly; break;
    default: return false;
  }
  savePrefs({ engage: e });
  return 'render';
}

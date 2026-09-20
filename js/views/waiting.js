/* Waiting For — by person, oldest first, so a chase is one glance away. */
'use strict';
import { list, section, empty, esc, plural } from '../ui.js';
import { waitingItems, groupBy, ageDays, isOverdue } from '../model.js';

export const title = () => 'Waiting For';

export function render() {
  const items = waitingItems().sort((a, b) => a.created < b.created ? -1 : 1);
  if (!items.length) return empty('Nobody owes you anything', '<br>Delegated actions and things you are waiting on land here.');
  const groups = groupBy(items, i => i.waitingOn.trim(), k => k || 'Unnamed').sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  const chase = items.filter(i => isOverdue(i) || ageDays(i.created) >= 14);
  return `<p class="hint">${plural(items.length, 'thing')} with ${plural(groups.length, 'person', 'people')}. ${chase.length ? `<b>${chase.length}</b> past a chase-by date or older than two weeks.` : ''}</p>
    ${chase.length ? section('wait-chase', 'Chase', chase.length, list(chase, { age: true })) : ''}
    ${groups.map(g => section(`wait-${g.key}`, esc(g.label), g.items.length, list(g.items, { age: true }))).join('')}`;
}
export const act = async () => false;

'use strict';
import { list, head, empty, plural } from '../ui.js';
import { inboxItems } from '../model.js';
import { clarifyInbox } from './clarify.js';

export const title = () => 'Inbox';

export function render() {
  const items = inboxItems();
  if (!items.length) return empty('Inbox zero', '<br>Everything captured has been clarified.', true);
  return `<div class="actions" style="margin:0 0 10px">
      <button class="btn primary" data-act="clarify-all">Clarify ${plural(items.length, 'item')}</button>
    </div>
    <p class="hint">Oldest first. Tap an item to open it, or clarify them one at a time: what is it, is it actionable, what is the next action?</p>
    ${head('To clarify', items.length)}
    ${list(items, { age: true, arrow: true })}`;
}

export async function act(name) {
  if (name === 'clarify-all') { clarifyInbox(); return true; }
  return false;
}

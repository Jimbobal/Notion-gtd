/* Settings: the Notion connection, contexts and tags (which live on the
   Items database), preferences, and the privacy note. */
'use strict';
import { state, cfg, saveCfg, prefs, savePrefs, clearAll } from '../store.js';
import { esc, attr, head, toast, pills, field, options, plural } from '../ui.js';
import { DB_TITLES, setOptions, refreshOptions } from '../notion.js';
import { ago } from '../model.js';
import { rerender } from '../actions.js';
import { feeds, addFeed, removeFeed, toggleFeed, feedError, feedFetchedAt } from '../feeds.js';

export const title = () => 'Settings';

export function render() {
  const c = cfg() || {}, p = prefs();
  const dbLink = key => `<a href="https://www.notion.so/${c.dbs?.[key] || ''}" target="_blank" rel="noopener">${DB_TITLES[key]}</a>`;
  return `
  <div class="settings-group"><h3>Notion</h3>
    <div class="opt-row"><div class="grow">${esc(c.bot || 'Integration')}<div class="sub">${esc(c.workspace || '')} · parent page: ${esc(c.parentTitle || '—')}</div></div><span class="status-on">Connected</span></div>
    <div class="opt-row"><div class="grow">Databases<div class="sub">${Object.keys(DB_TITLES).map(dbLink).join(' · ')}</div></div></div>
    <div class="opt-row"><div class="grow">Last sync<div class="sub">${state.syncedAt ? ago(new Date(state.syncedAt).toISOString()) : 'never'} · ${plural(state.items.length, 'item')}, ${plural(state.projects.length, 'project')}</div></div>
      <button class="btn small" data-act="set-fullsync">Full resync</button></div>
    <div class="actions"><button class="btn" data-act="set-reconnect">Change token or databases</button><button class="btn danger" data-act="set-disconnect">Disconnect</button></div>
  </div>

  <div class="settings-group"><h3>External calendars</h3>
    <p class="hint">Show Google, Outlook or iCloud events in the Calendar. Paste a calendar's private subscription address (.ics): Google Calendar → Settings → your calendar → <em>Secret address in iCal format</em>; Outlook → Settings → Calendar → Shared calendars → Publish → ICS link; iCloud → share the calendar publicly and copy its link.</p>
    ${feeds().map(f => `<div class="opt-row"><i class="feed-dot" style="--fc:${f.color}"></i><div class="grow">${esc(f.name)}<div class="sub">${esc(f.url.replace(/^https?:\/\/([^/]+).*$/, '$1'))} · ${feedError(f.id) ? `<span class="bad">${esc(feedError(f.id))}</span>` : feedFetchedAt(f.id) ? 'fetched ' + ago(new Date(feedFetchedAt(f.id)).toISOString()) : 'not fetched yet'}</div></div>
      <label class="check-row" style="margin:0;padding:6px 8px"><input type="checkbox" data-act-change="feed-on" data-id="${f.id}" ${f.on ? 'checked' : ''}></label>
      <button class="link-btn" data-act="feed-remove" data-id="${f.id}">Remove</button></div>`).join('')}
    <form id="feed-add-form" class="opt-row"><input type="text" name="name" placeholder="Name" style="flex:0 1 110px"><input type="text" name="url" placeholder="https://…/basic.ics or webcal://…" required><button class="btn small" type="submit">Add</button></form>
    ${feeds().length ? '<div class="actions" style="margin-top:6px"><button class="btn small" data-act="feed-refresh">Refresh calendars now</button></div>' : ''}
  </div>

  <div class="settings-group"><h3>Contexts</h3>
    <p class="hint">Where or how an action can be done. Rename in place; removing one clears it from every item that had it.</p>
    ${state.contexts.map(ctx => `<div class="opt-row"><input type="text" value="${attr(ctx.name)}" data-act-change="ctx-rename" data-id="${ctx.id}"><button class="link-btn" data-act="ctx-remove" data-id="${ctx.id}">Remove</button></div>`).join('')}
    <form id="ctx-add-form" class="opt-row"><input type="text" name="name" placeholder="@NewContext"><button class="btn small" type="submit">Add</button></form>
  </div>

  <div class="settings-group"><h3>Tags</h3>
    <p class="hint">Tags are created by typing them on an item. ${state.tags.length ? 'Remove one here to drop it everywhere.' : 'None yet.'}</p>
    <div class="pills wrap">${state.tags.map(t => `<button class="pill small" data-act="tag-remove" data-id="${t.id}" title="Remove">#${esc(t.name)} ×</button>`).join('')}</div>
  </div>

  <div class="settings-group"><h3>Preferences</h3>
    <div class="opt-row"><div class="grow">Theme</div>${pills([['auto','Auto'],['dark','Dark'],['light','Light']], p.theme, 'pref-theme', 'wrap')}</div>
    <div class="opt-row"><div class="grow">Week starts on</div>${pills([[1,'Monday'],[0,'Sunday'],[6,'Saturday']], p.weekStart, 'pref-weekstart', 'wrap')}</div>
    <div class="opt-row"><div class="grow">Weekly review day<div class="sub">Shown as a reminder in the sidebar</div></div>
      <select data-act-change="pref-reviewday" class="btn small">${options([[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']].map(([v,l]) => [String(v), l]), String(p.reviewDay))}</select></div>
    <label class="check-row"><input type="checkbox" data-act-change="pref-tickler" ${p.autoTickler ? 'checked' : ''}><span><strong>Return tickler items automatically</strong>When their date arrives, move them to the Inbox on the next sync.</span></label>
  </div>

  <div class="settings-group"><h3>Privacy</h3>
    <p class="hint">Your Notion token lives in this browser's local storage and nowhere else. Every request passes through a relay on this same domain because Notion's API refuses browser calls; the relay forwards and stores nothing — no database, no logs, no secrets of its own. Disconnecting deletes the token and the local cache here; revoke the integration in Notion too if a device is lost.</p>
  </div>`;
}

export async function act(name, el) {
  const id = el.dataset.id;
  try {
    switch (name) {
      case 'set-fullsync': document.dispatchEvent(new CustomEvent('gtd:sync', { detail: { full: true } })); return true;
      case 'set-reconnect': saveCfg({ dbs: null }); location.reload(); return true;
      case 'set-disconnect': if (confirm('Disconnect? The token and cached data are deleted from this device. Nothing in Notion changes.')) { clearAll(); location.reload(); } return true;
      case 'ctx-remove': {
        const ctx = state.contexts.find(x => x.id === id);
        if (confirm(`Remove ${ctx.name}? Items using it lose their context.`)) { await setOptions('Context', state.contexts.filter(x => x.id !== id)); toast('Context removed'); return 'render'; }
        return true;
      }
      case 'tag-remove': {
        const t = state.tags.find(x => x.id === id);
        if (confirm(`Remove #${t.name} from every item?`)) { await setOptions('Tags', state.tags.filter(x => x.id !== id)); toast('Tag removed'); return 'render'; }
        return true;
      }
      case 'feed-remove': removeFeed(id); toast('Calendar removed'); return 'render';
      case 'feed-refresh': document.dispatchEvent(new CustomEvent('gtd:feeds')); return true;
      case 'pref-theme': savePrefs({ theme: el.dataset.v }); document.dispatchEvent(new CustomEvent('gtd:theme')); return 'render';
      case 'pref-weekstart': savePrefs({ weekStart: Number(el.dataset.v) }); return 'render';
    }
  } catch (e) { toast(e.message, 5000); return 'render'; }
  return false;
}

export async function change(el) {
  const what = el.dataset.actChange;
  try {
    if (what === 'ctx-rename') {
      const name = el.value.trim(); const ctx = state.contexts.find(x => x.id === el.dataset.id);
      if (!name || !ctx || name === ctx.name) return false;
      await setOptions('Context', state.contexts.map(x => x.id === ctx.id ? { ...x, name } : x));
      toast(`Renamed to ${name}`); return 'render';
    }
    if (what === 'feed-on') { toggleFeed(el.dataset.id); return 'render'; }
    if (what === 'pref-reviewday') { savePrefs({ reviewDay: Number(el.value) }); return 'render'; }
    if (what === 'pref-tickler') { savePrefs({ autoTickler: el.checked }); return true; }
  } catch (e) { toast(e.message, 5000); return 'render'; }
  return false;
}

export async function submit(form) {
  if (form.id === 'feed-add-form') {
    const f = Object.fromEntries(new FormData(form));
    const url = f.url.trim();
    if (!/^(https?|webcal):\/\//i.test(url)) { toast('That does not look like a calendar address.'); return true; }
    addFeed({ name: f.name.trim() || 'Calendar', url });
    toast('Calendar added — fetching…');
    document.dispatchEvent(new CustomEvent('gtd:feeds'));
    return true;
  }
  if (form.id !== 'ctx-add-form') return false;
  const name = new FormData(form).get('name').trim();
  if (!name) return true;
  try { await setOptions('Context', [...state.contexts, { name }]); toast(`${name} added`); rerender(); }
  catch (e) { toast(e.message, 5000); }
  return true;
}

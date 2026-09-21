/* Integrations — one card per service, its state, a Connect / Disconnect
   and its options. Notion is the store; Google gives the two-way calendar
   and Drive attachments; Dropbox gives attachments. */
'use strict';
import { state, cfg } from '../store.js';
import { esc, attr, toast, field, options, plural } from '../ui.js';
import { DB_TITLES } from '../notion.js';
import { ago } from '../model.js';
import { gcfg, saveGoogle, googleConfigured, googleConnected, connectGoogle, disconnectGoogle } from '../google.js';
import { listCalendars, setCalendars, googleCalendars, writableCalendars, syncAllItemsToGoogle, googleFetchedAt, googleError, clearGoogleEvents } from '../gcal.js';
import { dcfg, saveDropbox, dropboxReady, driveReady } from '../files.js';

export const title = () => 'Integrations';
let busy = '';

const ON = '<span class="status on">Connected</span>', OFF = '<span class="status">Not connected</span>';
const card = (id, logo, name, blurb, status, body) => `<section class="svc" id="svc-${id}">
  <div class="svc-head"><span class="svc-logo ${logo.cls}">${logo.glyph}</span>
    <div class="svc-title"><h3>${name}</h3><p>${blurb}</p></div>${status}</div>
  <div class="svc-body">${body}</div></section>`;

function notionCard() {
  const c = cfg() || {};
  return card('notion', { cls: 'notion', glyph: 'N' }, 'Notion', 'Where everything lives: six databases under a page you chose. Any Notion page can also be attached to an item.', ON,
    `<dl class="kv"><dt>Integration</dt><dd>${esc(c.bot || '—')}</dd><dt>Workspace</dt><dd>${esc(c.workspace || '—')}</dd><dt>Parent page</dt><dd>${esc(c.parentTitle || '—')}</dd>
      <dt>Databases</dt><dd>${Object.keys(DB_TITLES).map(k => `<a href="https://www.notion.so/${c.dbs?.[k] || ''}" target="_blank" rel="noopener">${DB_TITLES[k].replace('GTD · ', '')}</a>`).join(' · ')}</dd></dl>
     <div class="actions"><a class="btn" href="#/settings">Token, databases, contexts…</a></div>`);
}

function googleCard() {
  const g = gcfg();
  const origin = location.origin;
  const setup = `<details class="setup-details" ${googleConfigured() ? '' : 'open'}><summary>How to get a client ID and API key</summary>
    <ol class="steps">
      <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, create a project (any name).</li>
      <li><em>APIs &amp; Services → Library</em>: enable <strong>Google Calendar API</strong>, <strong>Google Drive API</strong> and <strong>Google Picker API</strong>.</li>
      <li><em>OAuth consent screen</em>: External, add yourself as a test user. It can stay in testing — this app is yours.</li>
      <li><em>Credentials → Create credentials → OAuth client ID → Web application</em>. Authorised JavaScript origin: <code>${esc(origin)}</code>. Copy the client ID.</li>
      <li><em>Credentials → Create credentials → API key</em>. Restrict it to the Picker API and to the origin above. Copy it.</li>
    </ol></details>`;
  const form = `<form id="google-form">
      <div class="row2">${field('OAuth client ID', `<input name="clientId" value="${attr(g.clientId || '')}" placeholder="…apps.googleusercontent.com" autocomplete="off">`)}
      ${field('API key (for Drive picker)', `<input name="apiKey" value="${attr(g.apiKey || '')}" placeholder="AIza…" autocomplete="off">`)}</div>
      <div class="actions"><button type="submit" class="btn">Save keys</button>
        ${googleConfigured() ? `<button type="button" class="btn primary" data-act="g-connect" ${busy ? 'disabled' : ''}>${busy || (googleConnected() ? 'Reconnect' : 'Connect Google')}</button>` : ''}
        ${googleConnected() ? '<button type="button" class="btn danger" data-act="g-disconnect">Disconnect</button>' : ''}</div></form>`;
  let opts = '';
  if (googleConnected()) {
    const cals = googleCalendars(), wr = writableCalendars();
    opts = `<dl class="kv"><dt>Account</dt><dd>${esc(g.email)}</dd><dt>Events</dt><dd>${googleError() ? `<span class="bad">${esc(googleError())}</span>` : googleFetchedAt() ? `fetched ${ago(new Date(googleFetchedAt()).toISOString())}` : 'not fetched yet'}</dd></dl>
      <div class="opt"><h4>Calendar — show in the app</h4>
        <p>Events from these calendars appear in the Calendar alongside your items, and can be edited there.</p>
        ${cals.length ? cals.map(c => `<label class="check-row" style="margin-bottom:6px;padding:9px 12px"><input type="checkbox" data-act-change="g-show" data-id="${attr(c.id)}" ${c.on !== false ? 'checked' : ''}><span><i class="feed-dot" style="--fc:${c.color}"></i><strong style="display:inline">${esc(c.name)}</strong>${c.primary ? ' · primary' : ''}${c.writable ? '' : ' · read only'}</span></label>`).join('')
          : '<p class="note">No calendars loaded yet.</p>'}
        <div class="actions"><button class="btn small" data-act="g-reload" ${busy ? 'disabled' : ''}>Reload calendar list</button><button class="btn small" data-act="g-refresh">Refresh events</button></div></div>
      <div class="opt"><h4>Calendar — mirror your items</h4>
        <p>Every item on your Calendar list becomes an event in one Google calendar, kept in step when the item changes and removed when it leaves the list. Events you create in Google stay in Google.</p>
        ${field('Into calendar', `<select data-act-change="g-write">${options(wr.map(c => [c.id, c.name]), g.writeCalendar || '', 'Choose a calendar')}</select>`)}
        <label class="check-row"><input type="checkbox" data-act-change="g-sync" ${g.syncItems ? 'checked' : ''} ${g.writeCalendar ? '' : 'disabled'}><span><strong>Mirror Calendar items into Google</strong>${g.writeCalendar ? 'Switching on copies every current Calendar item across.' : 'Choose a calendar first.'}</span></label></div>
      <div class="opt"><h4>Drive — attachments</h4>
        <p>${driveReady() ? 'Ready: any item or project can attach files from Google Drive. The app only receives the file name and link.' : 'Add the API key above to attach files from Google Drive.'}</p></div>`;
  }
  return card('google', { cls: 'google', glyph: 'G' }, 'Google Calendar & Drive',
    'Two-way calendar: see and edit Google events here, and mirror your Calendar items into Google. Attach Drive files to items.',
    googleConnected() ? ON : OFF, setup + form + opts);
}

function dropboxCard() {
  const d = dcfg();
  return card('dropbox', { cls: 'dropbox', glyph: '⬡' }, 'Dropbox', 'Attach Dropbox files to items and projects with the Dropbox chooser. The app only receives names and links.',
    dropboxReady() ? ON : OFF,
    `<details class="setup-details" ${dropboxReady() ? '' : 'open'}><summary>How to get an app key</summary>
      <ol class="steps"><li>Open the <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">Dropbox App Console</a> → Create app → Scoped access → Full Dropbox (or App folder) → any name.</li>
      <li>On the app's Settings tab, under <em>Chooser / Saver / Embedder domains</em>, add <code>${esc(location.hostname)}</code>.</li>
      <li>Copy the <strong>App key</strong> and paste it here.</li></ol></details>
     <form id="dropbox-form">${field('App key', `<input name="appKey" value="${attr(d.appKey || '')}" autocomplete="off">`)}
      <div class="actions"><button type="submit" class="btn">Save</button>${dropboxReady() ? '<button type="button" class="btn danger" data-act="d-disconnect">Remove</button>' : ''}</div></form>`);
}

export function render() {
  return `<p class="hint">Connect the services the app works with. Keys and tokens stay in this browser.</p>
    ${notionCard()}${googleCard()}${dropboxCard()}`;
}

async function loadCals() {
  const fresh = await listCalendars();
  const prev = googleCalendars();
  setCalendars(fresh.map(c => ({ ...c, on: prev.find(p => p.id === c.id)?.on ?? true })));
  if (gcfg().writeCalendar && !fresh.some(c => c.id === gcfg().writeCalendar && c.writable)) saveGoogle({ writeCalendar: null, syncItems: false });
}

export async function act(name, el) {
  const id = el.dataset.id;
  try {
    switch (name) {
      case 'g-connect': {
        busy = 'Connecting…'; document.dispatchEvent(new CustomEvent('gtd:render'));
        try { await connectGoogle(); await loadCals(); toast('Google connected ✓'); document.dispatchEvent(new CustomEvent('gtd:google')); }
        finally { busy = ''; }
        return 'render';
      }
      case 'g-disconnect': await disconnectGoogle(); clearGoogleEvents(); toast('Google disconnected'); return 'render';
      case 'g-reload': busy = 'Loading…'; document.dispatchEvent(new CustomEvent('gtd:render')); try { await loadCals(); } finally { busy = ''; } return 'render';
      case 'g-refresh': document.dispatchEvent(new CustomEvent('gtd:google')); toast('Refreshing events…'); return true;
      case 'd-disconnect': saveDropbox({ appKey: '' }); toast('Dropbox removed'); return 'render';
    }
  } catch (e) { busy = ''; toast(e.message, 6000); return 'render'; }
  return false;
}

export async function change(el) {
  const what = el.dataset.actChange, id = el.dataset.id;
  try {
    if (what === 'g-show') { setCalendars(googleCalendars().map(c => c.id === id ? { ...c, on: el.checked } : c)); document.dispatchEvent(new CustomEvent('gtd:google')); return 'render'; }
    if (what === 'g-write') { saveGoogle({ writeCalendar: el.value || null, ...(el.value ? {} : { syncItems: false }) }); return 'render'; }
    if (what === 'g-sync') {
      saveGoogle({ syncItems: el.checked });
      if (el.checked) { toast('Copying your Calendar items to Google…', 4000); const n = await syncAllItemsToGoogle(); toast(`${n} item${n === 1 ? '' : 's'} mirrored ✓`); document.dispatchEvent(new CustomEvent('gtd:google')); }
      return 'render';
    }
  } catch (e) { toast(e.message, 6000); return 'render'; }
  return false;
}

export async function submit(form) {
  const f = Object.fromEntries(new FormData(form));
  if (form.id === 'google-form') {
    const clientId = f.clientId.trim(), apiKey = f.apiKey.trim();
    const changedClient = clientId !== (gcfg().clientId || '');
    saveGoogle({ clientId, apiKey, ...(changedClient ? { token: null, tokenExp: 0, email: null, calendars: [] } : {}) });
    toast(clientId ? 'Saved — now press Connect Google' : 'Saved');
    document.dispatchEvent(new CustomEvent('gtd:render'));
    return true;
  }
  if (form.id === 'dropbox-form') { saveDropbox({ appKey: f.appKey.trim() }); toast(f.appKey.trim() ? 'Dropbox ready ✓' : 'Saved'); document.dispatchEvent(new CustomEvent('gtd:render')); return true; }
  return false;
}

/* Integrations — one card per service, its state, a Connect / Disconnect
   and its options. Notion is the store; Google and Microsoft give two-way
   calendars (and Google gives Drive); Dropbox gives attachments; one
   mirror card decides where your Calendar items are copied. */
'use strict';
import { cfg } from '../store.js';
import { esc, attr, toast, field, options } from '../ui.js';
import { DB_TITLES } from '../notion.js';
import { ago } from '../model.js';
import { gcfg, saveGoogle, googleConfigured, googleConnected, connectGoogle, disconnectGoogle } from '../google.js';
import { mcfg, saveMicrosoft, msConfigured, msConnected, connectMicrosoft, disconnectMicrosoft } from '../microsoft.js';
import { PROVIDERS, writableTargets, mirrorCfg, setMirror, syncAllMirror, parseTarget } from '../calendars.js';
import { dcfg, saveDropbox, dropboxReady, driveReady } from '../files.js';

export const title = () => 'Integrations';
let busy = {};

const ON = '<span class="status on">Connected</span>', OFF = '<span class="status">Not connected</span>';
const card = (id, logo, name, blurb, status, body) => `<section class="svc" id="svc-${id}">
  <div class="svc-head"><span class="svc-logo ${logo.cls}">${logo.glyph}</span>
    <div class="svc-title"><h3>${name}</h3><p>${blurb}</p></div>${status}</div>
  <div class="svc-body">${body}</div></section>`;

const refresh = provider => document.dispatchEvent(new CustomEvent('gtd:calendar', { detail: provider ? { provider } : {} }));
const redraw = () => document.dispatchEvent(new CustomEvent('gtd:render'));

function notionCard() {
  const c = cfg() || {};
  return card('notion', { cls: 'notion', glyph: 'N' }, 'Notion', 'Where everything lives: seven databases under a page you chose. Any Notion page can also be attached to an item.', ON,
    `<dl class="kv"><dt>Integration</dt><dd>${esc(c.bot || '—')}</dd><dt>Workspace</dt><dd>${esc(c.workspace || '—')}</dd><dt>Parent page</dt><dd>${esc(c.parentTitle || '—')}</dd>
      <dt>Databases</dt><dd>${Object.keys(DB_TITLES).map(k => `<a href="https://www.notion.so/${c.dbs?.[k] || ''}" target="_blank" rel="noopener">${DB_TITLES[k].replace('GTD · ', '')}</a>`).join(' · ')}</dd></dl>
     <div class="actions"><a class="btn" href="#/settings">Token, databases, contexts…</a></div>`);
}

/* The calendar list shared by both providers. */
function calendarList(key) {
  const p = PROVIDERS[key], cals = p.calendars();
  return `<div class="opt"><h4>Calendars shown in the app</h4>
    <p>Events from these calendars appear in the Calendar beside your items, and can be edited there.</p>
    ${cals.length ? cals.map(c => `<label class="check-row" style="margin-bottom:6px;padding:9px 12px"><input type="checkbox" data-act-change="cal-show" data-provider="${key}" data-id="${attr(c.id)}" ${c.on !== false ? 'checked' : ''}><span><i class="feed-dot" style="--fc:${c.color}"></i><strong style="display:inline">${esc(c.name)}</strong>${c.primary ? ' · default' : ''}${c.writable ? '' : ' · read only'}</span></label>`).join('')
      : '<p class="note">No calendars loaded yet.</p>'}
    <div class="actions"><button class="btn small" data-act="p-reload" data-provider="${key}" ${busy[key] ? 'disabled' : ''}>Reload calendar list</button><button class="btn small" data-act="p-refresh" data-provider="${key}">Refresh events</button></div></div>`;
}
const status = key => { const p = PROVIDERS[key]; return p.error() ? `<span class="bad">${esc(p.error())}</span>` : p.fetchedAt() ? `events fetched ${ago(new Date(p.fetchedAt()).toISOString())}` : 'events not fetched yet'; };

function googleCard() {
  const g = gcfg();
  const setup = `<details class="setup-details" ${googleConfigured() ? '' : 'open'}><summary>How to get a client ID and API key</summary>
    <ol class="steps">
      <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, create a project (any name).</li>
      <li><em>APIs &amp; Services → Library</em>: enable <strong>Google Calendar API</strong>, <strong>Google Drive API</strong> and <strong>Google Picker API</strong>.</li>
      <li><em>OAuth consent screen</em>: External, add yourself as a test user. It can stay in testing — this app is yours.</li>
      <li><em>Credentials → Create credentials → OAuth client ID → Web application</em>. Authorised JavaScript origin: <code>${esc(location.origin)}</code>. Copy the client ID.</li>
      <li><em>Credentials → Create credentials → API key</em>. Restrict it to the Picker API and to the origin above. Copy it.</li>
    </ol></details>`;
  const form = `<form id="google-form">
      <div class="row2">${field('OAuth client ID', `<input name="clientId" value="${attr(g.clientId || '')}" placeholder="…apps.googleusercontent.com" autocomplete="off">`)}
      ${field('API key (for Drive picker)', `<input name="apiKey" value="${attr(g.apiKey || '')}" placeholder="AIza…" autocomplete="off">`)}</div>
      <div class="actions"><button type="submit" class="btn">Save keys</button>
        ${googleConfigured() ? `<button type="button" class="btn primary" data-act="p-connect" data-provider="google" ${busy.google ? 'disabled' : ''}>${busy.google || (googleConnected() ? 'Reconnect' : 'Connect Google')}</button>` : ''}
        ${googleConnected() ? '<button type="button" class="btn danger" data-act="p-disconnect" data-provider="google">Disconnect</button>' : ''}</div></form>`;
  const opts = googleConnected() ? `<dl class="kv"><dt>Account</dt><dd>${esc(g.email)}</dd><dt>Status</dt><dd>${status('google')}</dd></dl>${calendarList('google')}
      <div class="opt"><h4>Drive — attachments</h4><p>${driveReady() ? 'Ready: any item or project can attach files from Google Drive. The app only receives the file name and link.' : 'Add the API key above to attach files from Google Drive.'}</p></div>` : '';
  return card('google', { cls: 'google', glyph: 'G' }, 'Google Calendar & Drive',
    'Two-way calendar: see and edit Google events here, mirror your Calendar items into Google. Attach Drive files to items.',
    googleConnected() ? ON : OFF, setup + form + opts);
}

function microsoftCard() {
  const m = mcfg();
  const setup = `<details class="setup-details" ${msConfigured() ? '' : 'open'}><summary>How to register the app in your Microsoft 365 tenant</summary>
    <ol class="steps">
      <li>Open <a href="https://entra.microsoft.com/" target="_blank" rel="noopener">Microsoft Entra admin centre</a> → <em>App registrations → New registration</em>. Any name; supported accounts: your organisation only (or any, for a personal account too).</li>
      <li>Under <em>Redirect URI</em> choose <strong>Single-page application</strong> and enter <code>${esc(location.origin + location.pathname)}</code>.</li>
      <li>Copy the <strong>Application (client) ID</strong> and the <strong>Directory (tenant) ID</strong> from the overview.</li>
      <li><em>API permissions → Add → Microsoft Graph → Delegated</em>: <code>User.Read</code> and <code>Calendars.ReadWrite</code>.</li>
      <li>A work tenant may need an administrator to press <em>Grant admin consent</em>, or to approve the app when you first sign in. If sign-in fails with a consent error, that is the step to ask for.</li>
    </ol></details>`;
  const form = `<form id="microsoft-form">
      <div class="row2">${field('Application (client) ID', `<input name="clientId" value="${attr(m.clientId || '')}" autocomplete="off">`)}
      ${field('Directory (tenant) ID', `<input name="tenant" value="${attr(m.tenant || '')}" placeholder="tenant id, or common" autocomplete="off">`)}</div>
      <div class="actions"><button type="submit" class="btn">Save</button>
        ${msConfigured() ? `<button type="button" class="btn primary" data-act="p-connect" data-provider="outlook" ${busy.outlook ? 'disabled' : ''}>${busy.outlook || (msConnected() ? 'Reconnect' : 'Connect Microsoft')}</button>` : ''}
        ${msConnected() ? '<button type="button" class="btn danger" data-act="p-disconnect" data-provider="outlook">Disconnect</button>' : ''}</div></form>`;
  const opts = msConnected() ? `<dl class="kv"><dt>Account</dt><dd>${esc(m.account)}${m.name ? ` · ${esc(m.name)}` : ''}</dd><dt>Status</dt><dd>${status('outlook')}</dd></dl>${calendarList('outlook')}` : '';
  return card('microsoft', { cls: 'microsoft', glyph: 'M' }, 'Outlook calendar (Microsoft 365)',
    'Your work calendar, two-way: see and edit Outlook events here, and mirror your Calendar items into Outlook.',
    msConnected() ? ON : OFF, setup + form + opts);
}

function mirrorCard() {
  const targets = writableTargets(), m = mirrorCfg();
  if (!Object.values(PROVIDERS).some(p => p.connected())) return '';
  const valid = !!parseTarget(m.target) && targets.some(x => x.value === m.target);
  return card('mirror', { cls: 'cal', glyph: '⇄' }, 'Calendar mirror', 'Every item on your Calendar list becomes an event in one calendar of your choosing, kept in step as the item changes and removed when it leaves the list.',
    m.on && valid ? ON : '<span class="status">Off</span>',
    `${field('Into calendar', `<select data-act-change="mirror-target">${options(targets.map(x => [x.value, x.label]), valid ? m.target : '', 'Choose a calendar')}</select>`)}
     <label class="check-row"><input type="checkbox" data-act-change="mirror-on" ${m.on && valid ? 'checked' : ''} ${valid ? '' : 'disabled'}><span><strong>Mirror Calendar items</strong>${valid ? 'Switching on copies every current Calendar item across. Events that came from Google or Outlook are updated in place and never deleted.' : 'Choose a calendar first.'}</span></label>`);
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
    ${notionCard()}${googleCard()}${microsoftCard()}${mirrorCard()}${dropboxCard()}`;
}

async function loadCals(key) {
  const p = PROVIDERS[key];
  const fresh = await p.listCalendars();
  const prev = p.calendars();
  p.setCalendars(fresh.map(c => ({ ...c, on: prev.find(x => x.id === c.id)?.on ?? true })));
  const t = parseTarget(mirrorCfg().target);
  if (t?.kind === key && !fresh.some(c => c.id === t.calendarId && c.writable)) setMirror({ target: null, on: false });
}

export async function act(name, el) {
  const key = el.dataset.provider;
  try {
    switch (name) {
      case 'p-connect': {
        busy[key] = 'Connecting…'; redraw();
        try {
          if (key === 'google') await connectGoogle(); else await connectMicrosoft();
          await loadCals(key); toast(`${PROVIDERS[key].label} connected ✓`); refresh(key);
        } finally { busy[key] = ''; }
        return 'render';
      }
      case 'p-disconnect': {
        if (key === 'google') await disconnectGoogle(); else await disconnectMicrosoft();
        PROVIDERS[key].clear();
        const t = parseTarget(mirrorCfg().target); if (t?.kind === key) setMirror({ target: null, on: false });
        toast(`${PROVIDERS[key].label} disconnected`); return 'render';
      }
      case 'p-reload': busy[key] = 'Loading…'; redraw(); try { await loadCals(key); } finally { busy[key] = ''; } return 'render';
      case 'p-refresh': refresh(key); toast('Refreshing events…'); return true;
      case 'd-disconnect': saveDropbox({ appKey: '' }); toast('Dropbox removed'); return 'render';
    }
  } catch (e) { busy[key] = ''; toast(e.message, 7000); return 'render'; }
  return false;
}

export async function change(el) {
  const what = el.dataset.actChange, id = el.dataset.id, key = el.dataset.provider;
  try {
    if (what === 'cal-show') { const p = PROVIDERS[key]; p.setCalendars(p.calendars().map(c => c.id === id ? { ...c, on: el.checked } : c)); refresh(key); return 'render'; }
    if (what === 'mirror-target') { setMirror({ target: el.value || null, ...(el.value ? {} : { on: false }) }); return 'render'; }
    if (what === 'mirror-on') {
      setMirror({ on: el.checked });
      if (el.checked) { toast('Copying your Calendar items across…', 4000); const n = await syncAllMirror(); toast(`${n} item${n === 1 ? '' : 's'} mirrored ✓`); refresh(); }
      return 'render';
    }
  } catch (e) { toast(e.message, 7000); return 'render'; }
  return false;
}

export async function submit(form) {
  const f = Object.fromEntries(new FormData(form));
  if (form.id === 'google-form') {
    const clientId = f.clientId.trim(), apiKey = f.apiKey.trim();
    const changed = clientId !== (gcfg().clientId || '');
    saveGoogle({ clientId, apiKey, ...(changed ? { token: null, tokenExp: 0, email: null, calendars: [] } : {}) });
    toast(clientId ? 'Saved — now press Connect Google' : 'Saved'); redraw(); return true;
  }
  if (form.id === 'microsoft-form') {
    const clientId = f.clientId.trim(), tenant = f.tenant.trim();
    const changed = clientId !== (mcfg().clientId || '') || tenant !== (mcfg().tenant || '');
    saveMicrosoft({ clientId, tenant, ...(changed ? { account: null, homeId: null, calendars: [] } : {}) });
    toast(clientId ? 'Saved — now press Connect Microsoft' : 'Saved'); redraw(); return true;
  }
  if (form.id === 'dropbox-form') { saveDropbox({ appKey: f.appKey.trim() }); toast(f.appKey.trim() ? 'Dropbox ready ✓' : 'Saved'); redraw(); return true; }
  return false;
}

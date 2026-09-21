/* First run: connect an integration, pick the page the databases live
   under, create (or adopt) them, verify, go. */
'use strict';
import { cfg, saveCfg } from '../store.js';
import { esc, attr, field } from '../ui.js';
import { whoami, searchPages, createDatabases, adoptDatabases, verifyDatabases, DB_TITLES } from '../notion.js';

let S = { step: 1, token: '', pages: null, err: '', busy: '', problems: [], adoptable: null };
const el = () => document.getElementById('setup');

export function showSetup(problems = []) {
  const c = cfg();
  S = { step: c?.token ? 2 : 1, token: c?.token || '', pages: null, err: '', busy: '', problems, adoptable: null };
  el().hidden = false; document.getElementById('app').hidden = true;
  draw();
  if (S.step === 2) loadPages();
}

const nav = () => `<div class="steps-nav">${[1, 2, 3].map(n => `<span class="${n <= S.step ? 'on' : ''}"></span>`).join('')}</div>`;

function draw() {
  let body;
  if (S.step === 1) body = `
    <h3>Connect Notion</h3>
    <p class="lead">This app keeps everything in seven Notion databases it creates for you — items, projects, horizons, habits, a habit log, perspectives and the weekly-review checklist. It talks to them through an integration you own.</p>
    <ol class="steps">
      <li>Open <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">notion.so/profile/integrations</a> (this page is <em>not</em> reachable from Settings → Connections, which only lists existing connections) and click <strong>New integration</strong>. Pick your workspace, type <strong>Internal</strong>, and give it read, update and insert content capabilities. You need to be a workspace owner if the workspace limits who can create internal connections.</li>
      <li>On the integration's Configuration tab, click <strong>Show</strong> next to <strong>Internal Integration Secret</strong>, copy it and paste it here.</li>
      <li>Create or pick a Notion page to hold the databases, and share it with the integration: open the page → <code>•••</code> → Connections → add it.</li>
    </ol>
    <form id="setup-token">
      ${field('Internal integration secret', `<input name="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ntn_… or secret_…" value="${attr(S.token)}" autofocus required>`)}
      <button class="btn primary wide" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy || 'Connect'}</button>
      ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}
      <p class="note" style="margin-top:12px">The secret is saved in this browser only. Notion's API refuses calls from a browser, so requests pass through a relay on this domain that forwards them and keeps nothing.</p>
    </form>`;
  else if (S.step === 2) body = `
    <h3>Where should the databases live?</h3>
    <p class="lead">Pick a page shared with the integration. The seven databases are created inside it. If you set this up before, adopt the existing ones instead.</p>
    ${S.problems.length ? `<div class="panel warn"><strong>The configured databases need attention</strong>${S.problems.map(esc).join('<br>')}</div>` : ''}
    ${S.pages === null ? '<div class="spinner"></div>' : S.pages.length ? `
      <form id="setup-parent">
        ${S.pages.slice(0, 40).map((p, k) => `<label class="check-row"><input type="radio" name="parent" value="${p.id}" data-title="${attr(p.title)}" ${k === 0 ? 'checked' : ''}><span><strong>${esc(p.icon)} ${esc(p.title)}</strong></span></label>`).join('')}
        <button class="btn primary wide" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy || 'Create the databases here'}</button>
      </form>` : `<div class="panel warn"><strong>No pages are shared with the integration yet</strong>In Notion, open the page you want to use → <code>•••</code> → Connections → add the integration. Then reload this list.</div>`}
    <div class="actions">
      <button class="btn" data-act="setup-reload" ${S.busy ? 'disabled' : ''}>Reload pages</button>
      <button class="btn" data-act="setup-adopt" ${S.busy ? 'disabled' : ''}>Adopt existing databases</button>
      <button class="btn" data-act="setup-back">Change token</button>
    </div>
    ${S.adoptable ? `<div class="panel ${S.adoptable.missing.length ? 'warn' : 'good'}" style="margin-top:12px"><strong>${S.adoptable.missing.length ? 'Not all databases were found' : 'Found them all'}</strong>${
      S.adoptable.missing.length ? `Missing: ${S.adoptable.missing.map(esc).join(', ')}. Share them with the integration, or create a fresh set above.` : 'Adopting them now…'}</div>` : ''}
    ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}`;
  else body = `
    <h3>Setting up</h3>
    <p class="lead">${esc(S.busy || 'Done.')}</p>
    <div class="spinner"></div>
    ${S.err ? `<p class="err">${esc(S.err)}</p><div class="actions"><button class="btn" data-act="setup-back2">Back</button></div>` : ''}`;

  el().innerHTML = `<div class="setup-inner">
    <div class="brand"><span class="brand-mark"></span><h1>GTD for Notion</h1></div>
    <p class="tagline">Getting Things Done, the FacileThings way, with your data in Notion.</p>
    ${nav()}${body}</div>`;
}

async function loadPages() {
  S.pages = null; S.err = ''; draw();
  try { S.pages = await searchPages(S.token); }
  catch (e) { S.pages = []; S.err = e.message; }
  draw();
}

async function finish(ids, parent) {
  S.step = 3; S.busy = 'Checking the databases…'; S.err = ''; draw();
  const problems = await verifyDatabases(ids, S.token, parent?.parentId || null);
  if (problems.length) { S.err = problems.join(' '); S.busy = ''; draw(); return; }
  saveCfg({ dbs: ids, ...(parent || {}) });
  S.busy = 'Ready.'; draw();
  document.dispatchEvent(new CustomEvent('gtd:setup-done'));
}

export async function act(name) {
  switch (name) {
    case 'setup-reload': loadPages(); return true;
    case 'setup-back': S.step = 1; S.err = ''; draw(); return true;
    case 'setup-back2': S.step = 2; S.err = ''; S.busy = ''; draw(); loadPages(); return true;
    case 'setup-adopt': {
      S.busy = 'Looking…'; S.err = ''; draw();
      try {
        S.adoptable = await adoptDatabases(S.token);
        S.busy = ''; draw();
        if (!S.adoptable.missing.length) await finish(S.adoptable.ids, null);
      } catch (e) { S.err = e.message; S.busy = ''; draw(); }
      return true;
    }
  }
  return false;
}

export async function submit(form) {
  if (form.id === 'setup-token') {
    S.token = new FormData(form).get('token').trim(); S.err = ''; S.busy = 'Checking…'; draw();
    try {
      const me = await whoami(S.token);
      saveCfg({ token: S.token, bot: me.bot, workspace: me.workspace, dbs: null });
      S.step = 2; S.busy = ''; draw(); loadPages();
    } catch (e) { S.err = e.message; S.busy = ''; draw(); }
    return true;
  }
  if (form.id === 'setup-parent') {
    const input = form.querySelector('input[name=parent]:checked');
    if (!input) return true;
    S.step = 3; S.busy = 'Creating databases…'; S.err = ''; draw();
    try {
      const ids = await createDatabases(input.value, S.token, msg => { S.busy = msg; draw(); });
      await finish(ids, { parentId: input.value, parentTitle: input.dataset.title });
    } catch (e) { S.err = e.message; S.busy = ''; draw(); }
    return true;
  }
  return false;
}

/* Microsoft sign-in for a work (Microsoft 365) or personal account,
   entirely in the browser with MSAL. Tokens live in MSAL's own cache in
   localStorage and are renewed silently. No server, no client secret: a
   single-page-app registration in Entra ID is public by design.

   Register the app once (see the Integrations page). A work tenant may
   require an administrator to grant consent for the Calendars.ReadWrite
   permission before the first sign-in succeeds. */
'use strict';
import { cfg, saveCfg } from './store.js';
import { loadScript } from './google.js';

const MSAL_URL = 'https://alcdn.msauth.net/browser/2.38.1/js/msal-browser.min.js';
export const MS_SCOPES = ['User.Read', 'Calendars.ReadWrite'];

export const mcfg = () => cfg()?.microsoft || {};
export const saveMicrosoft = patch => saveCfg({ microsoft: { ...mcfg(), ...patch } });
export const msConfigured = () => !!mcfg().clientId;
export const msConnected  = () => !!(mcfg().clientId && mcfg().account);

export class NeedsMicrosoft extends Error { constructor() { super('Microsoft needs you to sign in again — open Integrations and press Connect.'); } }

let app = null, appFor = '';
async function getApp() {
  const { clientId, tenant } = mcfg();
  if (!clientId) throw new NeedsMicrosoft();
  await loadScript(MSAL_URL);
  if (!window.msal?.PublicClientApplication) throw new Error('Microsoft sign-in did not load.');
  const key = `${clientId}|${tenant || 'common'}`;
  if (!app || appFor !== key) {
    app = new msal.PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenant || 'common'}`, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' },
    });
    if (typeof app.initialize === 'function') await app.initialize();
    appFor = key;
  }
  return app;
}

function activeAccount(a) {
  const want = mcfg().homeId;
  const acc = a.getActiveAccount() || a.getAllAccounts().find(x => x.homeAccountId === want) || a.getAllAccounts()[0] || null;
  if (acc) a.setActiveAccount(acc);
  return acc;
}

export async function connectMicrosoft() {
  const a = await getApp();
  const r = await a.loginPopup({ scopes: MS_SCOPES, prompt: 'select_account' });
  a.setActiveAccount(r.account);
  saveMicrosoft({ account: r.account.username, homeId: r.account.homeAccountId, name: r.account.name || '', connectedAt: Date.now() });
  return r.account;
}

export async function msToken() {
  const a = await getApp();
  const acc = activeAccount(a);
  if (!acc) throw new NeedsMicrosoft();
  try { return (await a.acquireTokenSilent({ scopes: MS_SCOPES, account: acc })).accessToken; }
  catch { throw new NeedsMicrosoft(); }
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/* Authenticated fetch against Microsoft Graph. Dates come back in this
   device's time zone thanks to the Prefer header. */
export async function mfetch(url, opts = {}) {
  const token = await msToken();
  const res = await fetch(url, { ...opts,
    headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${tz()}"`,
               ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Microsoft returned ${res.status}.`);
  return j;
}

export async function disconnectMicrosoft() {
  try { const a = await getApp(); const acc = activeAccount(a); if (acc && a.logoutPopup) await a.logoutPopup({ account: acc, mainWindowRedirectUri: location.href }); } catch {}
  saveMicrosoft({ account: null, homeId: null, name: '', calendars: [] });
}

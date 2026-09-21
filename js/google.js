/* Google sign-in, entirely in the browser. Google Identity Services hands
   the page a short-lived access token for the scopes below; the app keeps
   it in localStorage for its hour and asks again silently when it runs
   out. Nothing goes through a server, and no client secret exists: a web
   OAuth client ID is public by design.

   You create the client ID once in Google Cloud (see the Integrations
   page); it is stored on this device with the rest of the config. */
'use strict';
import { cfg, saveCfg } from './store.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'openid', 'email',
].join(' ');

export const gcfg = () => cfg()?.google || {};
export const saveGoogle = patch => saveCfg({ google: { ...gcfg(), ...patch } });
export const googleConfigured = () => !!gcfg().clientId;
export const googleConnected  = () => !!(gcfg().clientId && gcfg().email);

export class NeedsGoogle extends Error { constructor() { super('Google needs you to sign in again — open Integrations and press Connect.'); } }

const loaded = {};
export function loadScript(src, attrs = {}) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve();
    s.onerror = () => { delete loaded[src]; reject(new Error(`Could not load ${src}`)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

let tokenClient = null, clientFor = null;
const tokenValid = () => { const g = gcfg(); return !!(g.token && g.tokenExp && g.tokenExp > Date.now() + 60e3); };

/* Ask Google for a token. Interactive shows the account chooser and
   consent; silent (prompt '') succeeds only when the browser already has a
   Google session that consented before, which is the everyday case. */
async function requestToken({ interactive }) {
  const { clientId } = gcfg();
  if (!clientId) throw new NeedsGoogle();
  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in did not load.');
  if (!tokenClient || clientFor !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
    clientFor = clientId;
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = r => {
      if (r.error) return reject(new Error(r.error_description || r.error));
      saveGoogle({ token: r.access_token, tokenExp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      resolve(r.access_token);
    };
    tokenClient.error_callback = e => reject(new Error(e?.message || e?.type || 'Google sign-in was cancelled'));
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

export async function ensureToken() {
  if (tokenValid()) return gcfg().token;
  try { return await requestToken({ interactive: false }); }
  catch { throw new NeedsGoogle(); }
}

/* Authenticated fetch against googleapis; one silent retry on 401. */
export async function gfetch(url, opts = {}, retry = true) {
  const token = await ensureToken();
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
                                 body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (res.status === 401 && retry) {
    saveGoogle({ token: null, tokenExp: 0 });
    return gfetch(url, opts, false);
  }
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Google returned ${res.status}.`);
  return j;
}

export async function connectGoogle() {
  await requestToken({ interactive: true });
  const me = await gfetch('https://www.googleapis.com/oauth2/v3/userinfo');
  saveGoogle({ email: me.email || 'connected', connectedAt: Date.now() });
  return me;
}

export async function disconnectGoogle() {
  const t = gcfg().token;
  if (t) {
    try { await loadScript('https://accounts.google.com/gsi/client'); window.google?.accounts?.oauth2?.revoke(t, () => {}); } catch {}
  }
  saveGoogle({ token: null, tokenExp: 0, email: null, calendars: [], writeCalendar: null, syncItems: false });
}

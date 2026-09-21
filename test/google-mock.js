/* Google and Dropbox, stubbed inside the browser for the end-to-end run:
   the sign-in script, the Picker script and the Dropbox chooser are served
   as tiny stand-ins, and googleapis.com is answered from memory here. */
'use strict';

const pad2 = n => String(n).padStart(2, '0');
const localISO = (d, h, m) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  const off = -x.getTimezoneOffset(), sg = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}T${pad2(h)}:${pad2(m)}:00${sg}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
};
const dayStr = (d, n = 0) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };

const GIS = `window.google = window.google || {};
window.google.accounts = { oauth2: {
  initTokenClient: c => { const tc = { callback: c.callback, requestAccessToken: o => { window.__gisPrompt = o && o.prompt; setTimeout(() => tc.callback({ access_token: 'tok_' + c.client_id, expires_in: 3599 }), 5); } }; return tc; },
  revoke: (t, cb) => { window.__revoked = t; cb && cb(); } } };`;

const PICKER = `window.gapi = { load: (n, o) => setTimeout(() => (o.callback || o)(), 0) };
window.google = window.google || {};
window.google.picker = {
  Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' },
  Document: { NAME: 'name', URL: 'url', ICON_URL: 'iconUrl' }, Feature: { MULTISELECT_ENABLED: 'multi' },
  DocsView: class { setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } },
  PickerBuilder: class {
    addView() { return this; } setOAuthToken(t) { this.t = t; return this; } setDeveloperKey(k) { this.k = k; return this; }
    enableFeature() { return this; } setTitle() { return this; } setCallback(cb) { this.cb = cb; return this; }
    build() { const self = this; return { setVisible(v) { if (v) { window.__picker = { token: self.t, key: self.k };
      setTimeout(() => self.cb({ action: 'picked', docs: [{ name: 'Q3 plan.gdoc', url: 'https://docs.google.com/document/d/abc/edit', iconUrl: '' }] }), 5); } } }; }
  } };`;

const DROPBOX = `window.__dropboxKey = document.getElementById('dropboxjs') && document.getElementById('dropboxjs').dataset.appKey;
window.Dropbox = { choose: o => setTimeout(() => o.success([{ name: 'brief.pdf', link: 'https://www.dropbox.com/s/abc/brief.pdf?dl=0', icon: '' }]), 5) };`;

async function install(page, { clientId = 'client-123' } = {}) {
  const now = new Date();
  const G = {
    log: [],
    calendars: [
      { id: 'james@example.com', summary: 'James', primary: true, accessRole: 'owner', backgroundColor: '#9a9cff' },
      { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays', accessRole: 'reader', backgroundColor: '#33b679' },
    ],
    events: {
      'james@example.com': [{ id: 'ev_standup', status: 'confirmed', summary: 'Standup (Google)', location: 'Meet',
        start: { dateTime: localISO(now, 9, 0) }, end: { dateTime: localISO(now, 9, 15) }, htmlLink: 'https://calendar.google.com/event?eid=1' }],
      'holidays@group.v.calendar.google.com': [{ id: 'ev_hol', status: 'confirmed', summary: 'Bank holiday',
        start: { date: dayStr(now, 1) }, end: { date: dayStr(now, 2) }, htmlLink: 'https://calendar.google.com/event?eid=2' }],
    },
    seq: 0,
  };
  const js = body => ({ contentType: 'application/javascript', body });
  await page.route('https://accounts.google.com/gsi/client', r => r.fulfill(js(GIS)));
  await page.route('https://apis.google.com/js/api.js', r => r.fulfill(js(PICKER)));
  await page.route('https://www.dropbox.com/static/api/2/dropins.js', r => r.fulfill(js(DROPBOX)));
  await page.route('https://www.googleapis.com/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const auth = req.headers().authorization || '';
    G.log.push({ method: req.method(), path: u.pathname, auth });
    if (auth !== `Bearer tok_${clientId}`) return json(401, { error: { message: 'Invalid Credentials' } });
    const p = u.pathname;
    if (p === '/oauth2/v3/userinfo') return json(200, { email: 'james@example.com', sub: '1' });
    if (p === '/calendar/v3/users/me/calendarList') return json(200, { items: G.calendars });
    let m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
    if (m) {
      const cal = decodeURIComponent(m[1]);
      if (!G.events[cal]) return json(404, { error: { message: 'Not Found' } });
      if (req.method() === 'GET') return json(200, { items: G.events[cal] });
      if (req.method() === 'POST') {
        const b = req.postDataJSON(); const ev = { id: `ev_${++G.seq}`, status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${G.seq}`, ...b };
        G.events[cal].push(ev); return json(200, ev);
      }
    }
    m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/);
    if (m) {
      const cal = decodeURIComponent(m[1]), id = decodeURIComponent(m[2]);
      const list = G.events[cal] || []; const ev = list.find(e => e.id === id);
      if (!ev) return json(404, { error: { message: 'Not Found' } });
      if (req.method() === 'GET') return json(200, ev);
      if (req.method() === 'PATCH') { Object.assign(ev, req.postDataJSON()); return json(200, ev); }
      if (req.method() === 'DELETE') { G.events[cal] = list.filter(e => e.id !== id); return route.fulfill({ status: 204, body: '' }); }
    }
    return json(404, { error: { message: `No ${req.method()} ${p}` } });
  });
  return G;
}

module.exports = { install };

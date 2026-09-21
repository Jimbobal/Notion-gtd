/* Outlook calendar through Microsoft Graph, both ways: read the calendars
   you pick, create and edit events, and serve as a mirror target. Same
   shape as gcal.js so the Calendar view does not care which is which. */
'use strict';
import { store } from './store.js';
import { mfetch, mcfg, saveMicrosoft, msConnected, NeedsMicrosoft } from './microsoft.js';

const API = 'https://graph.microsoft.com/v1.0';
const LS_EVENTS = 'gtd.mevents';
const WINDOW_BACK = 35, WINDOW_FWD = 180;
const enc = encodeURIComponent;
/* Where the mirrored item's id is kept on an Outlook event. */
const EXT_ID = 'String {66f5a359-4659-4830-9070-00040ec6ac6e} Name gtdItem';
const EXPAND = `$expand=singleValueExtendedProperties($filter=id eq '${EXT_ID}')`;

const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoMin = d => `${isoDay(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const addDaysStr = (s, n) => { const [y, m, d] = s.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const COLORS = { auto: '#0078d4', lightBlue: '#0078d4', lightGreen: '#38d39f', lightOrange: '#ffb340', lightGray: '#8a8a9a', lightYellow: '#ffd60a', lightTeal: '#5ac8fa', lightPink: '#ff7ab6', lightBrown: '#a2845e', lightRed: '#ff5f6d' };

/* ═══ CALENDARS ═════════════════════════════════════════════════ */
export async function listCalendars() {
  const out = []; let url = `${API}/me/calendars?$select=id,name,color,hexColor,canEdit,isDefaultCalendar&$top=100`;
  while (url) {
    const d = await mfetch(url);
    for (const c of d.value || []) out.push({ id: c.id, name: c.name, color: c.hexColor || COLORS[c.color] || '#0078d4', primary: !!c.isDefaultCalendar, writable: c.canEdit !== false });
    url = d['@odata.nextLink'] || null;
  }
  return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
}
export const calendars = () => (mcfg().calendars || []);
export function setCalendars(list) { saveMicrosoft({ calendars: list }); }
export function toggleCalendar(id) { setCalendars(calendars().map(c => c.id === id ? { ...c, on: !c.on } : c)); }

/* ═══ EVENTS IN ═════════════════════════════════════════════════ */
const cache = () => store.get(LS_EVENTS, { fetchedAt: 0, byCal: {}, error: null });
export const events = () => {
  const c = cache(), on = new Set(calendars().filter(x => x.on !== false).map(x => x.id));
  return Object.entries(c.byCal).filter(([id]) => on.has(id)).flatMap(([, evs]) => evs);
};
export const fetchedAt = () => cache().fetchedAt || 0;
export const error = () => cache().error || null;
export const clear = () => store.set(LS_EVENTS, { fetchedAt: 0, byCal: {}, error: null });

/* Graph gives wall-clock times in the zone we asked for, no offset. */
const wall = s => new Date(String(s).slice(0, 19));
function normalise(e, calId) {
  const allDay = !!e.isAllDay;
  const s = wall(e.start.dateTime), en = wall(e.end.dateTime);
  const ext = (e.singleValueExtendedProperties || []).find(p => p.id === EXT_ID)?.value || null;
  return {
    id: `outlook:${calId}:${e.id}`, feedId: `outlook:${calId}`, kind: 'outlook', calendarId: calId, eventId: e.id,
    title: e.subject || '(untitled)', location: e.location?.displayName || '', description: e.bodyPreview || '',
    allDay, start: allDay ? isoDay(s) : isoMin(s), end: allDay ? isoDay(en) : isoMin(en),
    day: isoDay(s), days: allDay ? Math.max(1, Math.round((en - s) / 86400000)) : 1,
    transparent: e.showAs === 'free', htmlLink: e.webLink || '', gtdItem: ext,
  };
}

export async function refresh({ force = false, maxAge = 10 * 60e3 } = {}) {
  if (!msConnected() || !calendars().length) return false;
  const c = cache();
  if (!force && Date.now() - c.fetchedAt < maxAge) return false;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WINDOW_BACK).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_FWD).toISOString();
  try {
    const byCal = {};
    for (const cal of calendars().filter(x => x.on !== false)) {
      const evs = [];
      let url = `${API}/me/calendars/${enc(cal.id)}/calendarView?startDateTime=${enc(from)}&endDateTime=${enc(to)}&$top=500&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,bodyPreview,webLink,showAs,isCancelled&${EXPAND}`;
      while (url) {
        const d = await mfetch(url);
        for (const e of d.value || []) if (!e.isCancelled && e.start?.dateTime) evs.push(normalise(e, cal.id));
        url = d['@odata.nextLink'] || null;
      }
      byCal[cal.id] = evs;
    }
    store.set(LS_EVENTS, { fetchedAt: Date.now(), byCal, error: null });
  } catch (e) {
    store.set(LS_EVENTS, { ...c, error: e.message });
    if (!(e instanceof NeedsMicrosoft)) throw e;
  }
  return true;
}

/* ═══ EVENTS OUT ════════════════════════════════════════════════ */
export function body(f) {
  const b = { subject: f.title, location: { displayName: f.location || '' }, body: { contentType: 'text', content: f.description || '' } };
  if (f.allDay || !f.time) {
    b.isAllDay = true;
    b.start = { dateTime: `${f.day}T00:00:00`, timeZone: tz() };
    b.end = { dateTime: `${addDaysStr(f.day, Math.max(1, f.days || 1))}T00:00:00`, timeZone: tz() };
  } else {
    const start = `${f.day}T${f.time.length === 5 ? f.time + ':00' : f.time}`;
    let end = f.endTime ? `${f.day}T${f.endTime.length === 5 ? f.endTime + ':00' : f.endTime}` : null;
    if (!end || end <= start) { const d = new Date(start); d.setMinutes(d.getMinutes() + (f.minutes || 30)); end = isoMin(d) + ':00'; }
    b.isAllDay = false;
    b.start = { dateTime: start, timeZone: tz() }; b.end = { dateTime: end, timeZone: tz() };
  }
  if (f.itemId) b.singleValueExtendedProperties = [{ id: EXT_ID, value: f.itemId }];
  return b;
}
export const create = (calId, b) => mfetch(`${API}/me/calendars/${enc(calId)}/events`, { method: 'POST', body: b });
export const update = (calId, eventId, b) => mfetch(`${API}/me/events/${enc(eventId)}`, { method: 'PATCH', body: b });
export async function remove(calId, eventId) {
  try { await mfetch(`${API}/me/events/${enc(eventId)}`, { method: 'DELETE' }); }
  catch (e) { if (!/404|not found|ErrorItemNotFound/i.test(e.message)) throw e; }
}
export async function get(calId, eventId) {
  const e = await mfetch(`${API}/me/events/${enc(eventId)}?${EXPAND}`);
  return { ...e, gtdItem: (e.singleValueExtendedProperties || []).find(p => p.id === EXT_ID)?.value || null };
}

export const provider = {
  key: 'outlook', label: 'Outlook', connected: msConnected, calendars, setCalendars, toggle: toggleCalendar,
  events, refresh, fetchedAt, error, clear, listCalendars, body, create, update, remove, get,
};

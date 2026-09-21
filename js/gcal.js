/* Google Calendar, both ways. Events from the calendars you pick are read
   into the Calendar view; Google events can be created and edited from the
   app; and, if you switch it on, every GTD item on the Calendar list is
   mirrored as an event in one Google calendar of your choosing, kept in
   step as the item changes, and removed when it leaves the list. */
'use strict';
import { store } from './store.js';
import { gfetch, gcfg, saveGoogle, googleConnected, NeedsGoogle } from './google.js';
import * as N from './notion.js';
import { state } from './store.js';

const API = 'https://www.googleapis.com/calendar/v3';
const LS_EVENTS = 'gtd.gevents';
const WINDOW_BACK = 35, WINDOW_FWD = 180;
const enc = encodeURIComponent;

const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoMin = d => `${isoDay(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const addDaysStr = (s, n) => { const [y, m, d] = s.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ═══ CALENDARS ═════════════════════════════════════════════════ */
export async function listCalendars() {
  const out = []; let pageToken = null;
  do {
    const d = await gfetch(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=250${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`);
    for (const c of d.items || []) out.push({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#5ac8fa',
      primary: !!c.primary, writable: ['owner', 'writer'].includes(c.accessRole) });
    pageToken = d.nextPageToken || null;
  } while (pageToken);
  return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
}

/* The calendars chosen for display, with their on/off state. */
export const googleCalendars = () => (gcfg().calendars || []);
export const writableCalendars = () => googleCalendars().filter(c => c.writable);
export function setCalendars(list) { saveGoogle({ calendars: list }); }
export function toggleCalendar(id) { setCalendars(googleCalendars().map(c => c.id === id ? { ...c, on: !c.on } : c)); }

/* ═══ EVENTS IN ═════════════════════════════════════════════════ */
const cache = () => store.get(LS_EVENTS, { fetchedAt: 0, byCal: {}, error: null });
export const googleEvents = () => {
  const c = cache(), on = new Set(googleCalendars().filter(x => x.on).map(x => x.id));
  return Object.entries(c.byCal).filter(([id]) => on.has(id)).flatMap(([, evs]) => evs);
};
export const googleFetchedAt = () => cache().fetchedAt || 0;
export const googleError = () => cache().error || null;

function normalise(e, calId) {
  const allDay = !!e.start?.date;
  const s = allDay ? new Date(e.start.date + 'T00:00') : new Date(e.start.dateTime);
  const en = allDay ? new Date(e.end.date + 'T00:00') : new Date(e.end.dateTime);
  return {
    id: `g:${calId}:${e.id}`, feedId: `g:${calId}`, kind: 'google', calendarId: calId, eventId: e.id,
    title: e.summary || '(untitled)', location: e.location || '', description: e.description || '',
    allDay, start: allDay ? isoDay(s) : isoMin(s), end: allDay ? isoDay(en) : isoMin(en),
    day: isoDay(s), days: allDay ? Math.max(1, Math.round((en - s) / 86400000)) : 1,
    transparent: e.transparency === 'transparent', htmlLink: e.htmlLink || '',
    gtdItem: e.extendedProperties?.private?.gtdItem || null,
  };
}

export async function refreshGoogleEvents({ force = false, maxAge = 10 * 60e3 } = {}) {
  if (!googleConnected() || !googleCalendars().length) return false;
  const c = cache();
  if (!force && Date.now() - c.fetchedAt < maxAge) return false;
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WINDOW_BACK).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_FWD).toISOString();
  try {
    const byCal = {};
    for (const cal of googleCalendars().filter(x => x.on)) {
      const evs = []; let pageToken = null;
      do {
        const d = await gfetch(`${API}/calendars/${enc(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${enc(timeMin)}&timeMax=${enc(timeMax)}${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`);
        for (const e of d.items || []) if (e.status !== 'cancelled' && (e.start?.date || e.start?.dateTime)) evs.push(normalise(e, cal.id));
        pageToken = d.nextPageToken || null;
      } while (pageToken);
      byCal[cal.id] = evs;
    }
    store.set(LS_EVENTS, { fetchedAt: Date.now(), byCal, error: null });
  } catch (e) {
    store.set(LS_EVENTS, { ...c, error: e.message });
    if (!(e instanceof NeedsGoogle)) throw e;
  }
  return true;
}
export const clearGoogleEvents = () => store.set(LS_EVENTS, { fetchedAt: 0, byCal: {}, error: null });

/* ═══ EVENTS OUT ════════════════════════════════════════════════ */
/* { title, day, time, endTime, allDay, location, description, itemId } → API body */
export function eventBody(f) {
  const body = { summary: f.title, location: f.location || '', description: f.description || '' };
  if (f.allDay || !f.time) {
    body.start = { date: f.day }; body.end = { date: addDaysStr(f.day, Math.max(1, f.days || 1)) };
  } else {
    const start = `${f.day}T${f.time.length === 5 ? f.time + ':00' : f.time}`;
    let end = f.endTime ? `${f.day}T${f.endTime.length === 5 ? f.endTime + ':00' : f.endTime}` : null;
    if (!end || end <= start) { const d = new Date(start); d.setMinutes(d.getMinutes() + (f.minutes || 30)); end = isoMin(d) + ':00'; }
    body.start = { dateTime: start, timeZone: tz() }; body.end = { dateTime: end, timeZone: tz() };
  }
  if (f.itemId) body.extendedProperties = { private: { gtdItem: f.itemId } };
  return body;
}

export const createEvent = (calId, body) => gfetch(`${API}/calendars/${enc(calId)}/events`, { method: 'POST', body });
export const updateEvent = (calId, eventId, body) => gfetch(`${API}/calendars/${enc(calId)}/events/${enc(eventId)}`, { method: 'PATCH', body });
export async function deleteEvent(calId, eventId) {
  try { await gfetch(`${API}/calendars/${enc(calId)}/events/${enc(eventId)}`, { method: 'DELETE' }); }
  catch (e) { if (!/404|410|deleted|not found/i.test(e.message)) throw e; }
}

export const getEvent = (calId, eventId) => gfetch(`${API}/calendars/${enc(calId)}/events/${enc(eventId)}`);
const isWritable = calId => googleCalendars().some(c => c.id === calId && c.writable);

/* Mirror one GTD item into the chosen Google calendar. Called after every
   write to an item; decides for itself whether an event should exist.
   An event the item was made from (a Google-native event) is updated in
   place where that calendar is writable and never deleted; only events
   this app created are removed when the item leaves the Calendar list. */
export async function syncItemToGoogle(item) {
  const g = gcfg();
  if (!g.syncItems || !g.writeCalendar || !googleConnected() || !item) return null;
  const [calId, evId] = (item.eventId || '').split('/');
  const wants = item.status === 'Calendar' && !!item.date;
  const ours = async () => { try { const e = await getEvent(calId, evId); return e?.extendedProperties?.private?.gtdItem === item.id; } catch { return false; } };
  if (wants) {
    const hasTime = item.date.length > 10;
    const d = new Date(item.date);
    const f = { title: item.name, day: item.date.slice(0, 10), time: hasTime ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '',
                allDay: !hasTime, minutes: item.time || 30, location: '', itemId: item.id,
                description: [item.notes, item.url ? `Notion: ${item.url}` : ''].filter(Boolean).join('\n\n') };
    let ev = null;
    if (evId && isWritable(calId)) {
      ev = await updateEvent(calId, evId, eventBody(f)).catch(e => /404|410/i.test(e.message) ? null : Promise.reject(e));
      if (ev) return ev;
    } else if (evId) return null;   // linked to a read-only calendar: leave it be
    ev = await createEvent(g.writeCalendar, eventBody(f));
    await N.updateItem(item.id, { eventId: `${g.writeCalendar}/${ev.id}` });
    return ev;
  }
  if (evId) {
    if (isWritable(calId) && await ours()) await deleteEvent(calId, evId);
    if (state.items.some(i => i.id === item.id)) await N.updateItem(item.id, { eventId: '' });
  }
  return null;
}

/* Bring every Calendar item across at once (when the mirror is switched on). */
export async function syncAllItemsToGoogle() {
  let n = 0;
  for (const i of state.items) if ((i.status === 'Calendar' && i.date) || i.eventId) { await syncItemToGoogle(i); n++; }
  return n;
}

/* Google Calendar, both ways: read the calendars you pick, create and
   edit events, and serve as a mirror target (see calendars.js). */
'use strict';
import { store } from './store.js';
import { gfetch, gcfg, saveGoogle, googleConnected, NeedsGoogle } from './google.js';

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
    id: `google:${calId}:${e.id}`, feedId: `google:${calId}`, kind: 'google', calendarId: calId, eventId: e.id,
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

export async function getEvent(calId, eventId) {
  const e = await gfetch(`${API}/calendars/${enc(calId)}/events/${enc(eventId)}`);
  return { ...e, gtdItem: e?.extendedProperties?.private?.gtdItem || null };
}

export const provider = {
  key: 'google', label: 'Google', connected: googleConnected, calendars: googleCalendars, setCalendars, toggle: toggleCalendar,
  events: googleEvents, refresh: refreshGoogleEvents, fetchedAt: googleFetchedAt, error: googleError, clear: clearGoogleEvents,
  listCalendars, body: eventBody, create: createEvent, update: updateEvent, remove: deleteEvent, get: getEvent,
};

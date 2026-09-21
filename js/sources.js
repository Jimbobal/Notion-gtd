/* Calendar sources for the Calendar view: the Google calendars you chose,
   with their colours and on/off state, and their events. */
'use strict';
import { googleCalendars, toggleCalendar, googleEvents, refreshGoogleEvents } from './gcal.js';

export function sources() {
  return googleCalendars().map(c => ({ id: `g:${c.id}`, kind: 'google', name: c.name, color: c.color, on: c.on !== false, writable: c.writable }));
}
export const sourceById = id => sources().find(s => s.id === id) || null;
export function toggleSource(id) { if (id.startsWith('g:')) toggleCalendar(id.slice(2)); }

export function events() {
  return [...googleEvents()].sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}
export const eventById = id => events().find(e => e.id === id) || null;

export async function refreshAll({ force = false } = {}) {
  try { return await refreshGoogleEvents({ force }); } catch { return false; }
}

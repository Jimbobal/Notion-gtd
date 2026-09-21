/* External calendars: subscription addresses (.ics) that Google, Outlook
   and iCloud publish. Fetched through api/ics, expanded here, cached per
   device, and drawn into the Calendar next to the app's own items. */
'use strict';
import { store, cfg, saveCfg } from './store.js';
import { expandICS } from './ics.js';

const LS_EVENTS = 'gtd.events';
const WINDOW_BACK = 35, WINDOW_FWD = 180;
export const FEED_COLORS = ['#5ac8fa', '#ff7ab6', '#ffb340', '#38d39f', '#c08cff', '#ff5f6d'];

export const feeds = () => (cfg()?.feeds || []);
export function saveFeeds(list) { saveCfg({ feeds: list }); }
export function addFeed({ name, url }) {
  const list = feeds();
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  list.push({ id, name: name || 'Calendar', url: url.trim(), color: FEED_COLORS[list.length % FEED_COLORS.length], on: true });
  saveFeeds(list);
  return list[list.length - 1];
}
export function removeFeed(id) {
  saveFeeds(feeds().filter(f => f.id !== id));
  const c = cache(); delete c.byFeed[id]; store.set(LS_EVENTS, c);
}
export function toggleFeed(id) { saveFeeds(feeds().map(f => f.id === id ? { ...f, on: !f.on } : f)); }

const cache = () => store.get(LS_EVENTS, { fetchedAt: {}, byFeed: {}, errors: {} });
export const feedError = id => cache().errors?.[id] || null;
export const feedFetchedAt = id => cache().fetchedAt?.[id] || null;

/* Every event from every switched-on feed, sorted by start. */
export function events() {
  const c = cache(), on = new Set(feeds().filter(f => f.on).map(f => f.id));
  return Object.entries(c.byFeed).filter(([id]) => on.has(id)).flatMap(([, evs]) => evs).sort((a, b) => a.start < b.start ? -1 : 1);
}
export const feedById = id => feeds().find(f => f.id === id) || null;

export async function fetchFeed(f) {
  const res = await fetch(`api/ics?url=${encodeURIComponent(f.url)}`);
  if (!res.ok) {
    let msg = `The calendar relay returned ${res.status}.`;
    try { msg = (await res.json()).message || msg; } catch {}
    throw new Error(msg);
  }
  const text = await res.text();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WINDOW_BACK);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_FWD);
  return expandICS(text, { from, to, feedId: f.id });
}

/* Refresh feeds older than maxAge (ms), or all of them when forced. */
export async function refreshFeeds({ force = false, maxAge = 30 * 60e3 } = {}) {
  const c = cache();
  let changed = false;
  for (const f of feeds()) {
    const age = Date.now() - (c.fetchedAt[f.id] || 0);
    if (!force && age < maxAge) continue;
    try {
      c.byFeed[f.id] = await fetchFeed(f);
      c.fetchedAt[f.id] = Date.now();
      delete c.errors[f.id];
    } catch (e) {
      c.errors[f.id] = e.message;
    }
    changed = true;
  }
  if (changed) store.set(LS_EVENTS, c);
  return changed;
}

/* Prefilled "add to calendar" links for one item, as Lens does it. */
const pad2 = n => String(n).padStart(2, '0');
const stampUTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function calendarLinks(item) {
  if (!item.date) return null;
  const hasTime = item.date.length > 10;
  const start = new Date(item.date);
  const end = new Date(start.getTime() + (hasTime ? (item.time || 30) : 1440) * 60000);
  const title = encodeURIComponent(item.name), notes = encodeURIComponent(item.notes || '');
  const g = hasTime
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${stampUTC(start)}/${stampUTC(end)}&details=${notes}`
    : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${item.date.replace(/-/g, '')}/${`${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}`}&details=${notes}`;
  const o = `https://outlook.live.com/calendar/0/action/compose?subject=${title}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${notes}${hasTime ? '' : '&allday=true'}`;
  return { google: g, outlook: o };
}

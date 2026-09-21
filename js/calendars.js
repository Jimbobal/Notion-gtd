/* The calendar layer the views talk to: Google and Outlook behind one
   interface — sources for the legend, one merged list of events, event
   writes routed to the right provider, and the mirror that keeps your
   Calendar-list items as events in one calendar of your choosing. */
'use strict';
import { state, cfg, saveCfg } from './store.js';
import * as N from './notion.js';
import { provider as google } from './gcal.js';
import { provider as outlook } from './mscal.js';

export const PROVIDERS = { google, outlook };
const pad2 = n => String(n).padStart(2, '0');

/* ── sources and events ───────────────────────────────── */
export function sources() {
  return Object.values(PROVIDERS).filter(p => p.connected()).flatMap(p =>
    p.calendars().map(c => ({ id: `${p.key}:${c.id}`, kind: p.key, provider: p.label, calendarId: c.id, name: c.name, color: c.color, on: c.on !== false, writable: c.writable })));
}
export const sourceById = id => sources().find(s => s.id === id) || null;
export function toggleSource(id) { const s = sourceById(id); if (s) PROVIDERS[s.kind].toggle(s.calendarId); }

export function events() {
  return Object.values(PROVIDERS).filter(p => p.connected()).flatMap(p => p.events())
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}
export const eventById = id => events().find(e => e.id === id) || null;

export async function refreshAll({ force = false } = {}) {
  let changed = false;
  for (const p of Object.values(PROVIDERS)) { try { if (await p.refresh({ force })) changed = true; } catch {} }
  return changed;
}
export async function refreshProvider(key, o = {}) { return PROVIDERS[key]?.refresh({ force: true, ...o }); }

/* Calendars an event can be written into, across providers. */
export const writableTargets = () => sources().filter(s => s.writable).map(s => ({ value: `${s.kind}|${s.calendarId}`, label: `${s.provider} · ${s.name}` }));
export const parseTarget = v => { const [kind, calendarId] = String(v || '').split('|'); return kind && calendarId ? { kind, calendarId } : null; };

/* ── the mirror ───────────────────────────────────────── */
export const mirrorCfg = () => cfg()?.mirror || {};
export const setMirror = patch => saveCfg({ mirror: { ...mirrorCfg(), ...patch } });
export const mirrorOn = () => { const m = mirrorCfg(); return !!(m.on && m.target && parseTarget(m.target) && PROVIDERS[parseTarget(m.target).kind]?.connected()); };

/* An item's link to its event: "provider|calendarId|eventId". */
export const parseRef = ref => {
  const parts = String(ref || '').split('|');
  if (parts.length === 3) return { kind: parts[0], calendarId: parts[1], eventId: parts[2] };
  if (parts.length === 1 && ref && ref.includes('/')) { const [c, e] = ref.split('/'); return { kind: 'google', calendarId: c, eventId: e }; }
  return null;
};
const makeRef = (kind, calendarId, eventId) => `${kind}|${calendarId}|${eventId}`;
const isWritable = (kind, calId) => sources().some(s => s.kind === kind && s.calendarId === calId && s.writable);

function fieldsOf(item) {
  const hasTime = item.date.length > 10;
  const d = new Date(item.date);
  return { title: item.name, day: item.date.slice(0, 10), time: hasTime ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '',
           allDay: !hasTime, minutes: item.time || 30, location: '', itemId: item.id,
           description: [item.notes, item.url ? `Notion: ${item.url}` : ''].filter(Boolean).join('\n\n') };
}

/* Called after every write to an item; decides whether an event should
   exist. An event the item was made from is updated in place where its
   calendar is writable and never deleted; only events this app created
   are removed when the item leaves the Calendar list. */
export async function syncItemMirror(item) {
  if (!mirrorOn() || !item) return null;
  const target = parseTarget(mirrorCfg().target);
  const ref = parseRef(item.eventId);
  const wants = item.status === 'Calendar' && !!item.date;
  if (wants) {
    const f = fieldsOf(item);
    if (ref) {
      const p = PROVIDERS[ref.kind];
      if (p?.connected() && isWritable(ref.kind, ref.calendarId)) {
        const ev = await p.update(ref.calendarId, ref.eventId, p.body(f)).catch(e => /404|410|not found/i.test(e.message) ? null : Promise.reject(e));
        if (ev) return ev;
      } else return null;           // linked elsewhere, or read only: leave it be
    }
    const p = PROVIDERS[target.kind];
    const ev = await p.create(target.calendarId, p.body(f));
    await N.updateItem(item.id, { eventId: makeRef(target.kind, target.calendarId, ev.id) });
    return ev;
  }
  if (ref) {
    const p = PROVIDERS[ref.kind];
    if (p?.connected() && isWritable(ref.kind, ref.calendarId)) {
      let ours = false;
      try { const e = await p.get(ref.calendarId, ref.eventId); ours = (e?.gtdItem || e?.extendedProperties?.private?.gtdItem) === item.id; } catch {}
      if (ours) await p.remove(ref.calendarId, ref.eventId);
    }
    if (state.items.some(i => i.id === item.id)) await N.updateItem(item.id, { eventId: '' });
  }
  return null;
}

export async function syncAllMirror() {
  let n = 0;
  for (const i of state.items) if ((i.status === 'Calendar' && i.date) || i.eventId) { await syncItemMirror(i); n++; }
  return n;
}

/* Delete an item's mirrored event outright (the item itself is going). */
export async function dropMirror(item) {
  const ref = parseRef(item?.eventId); if (!ref) return;
  const p = PROVIDERS[ref.kind]; if (!p?.connected()) return;
  try { await p.remove(ref.calendarId, ref.eventId); } catch {}
}

/* State and persistence. localStorage holds the Notion config, a cache of
   every record (so the app opens instantly and works through a flaky
   connection), and per-device preferences. Nothing else stores anything. */
'use strict';

export const LS = {
  cfg: 'gtd.cfg', cache: 'gtd.cache', prefs: 'gtd.prefs',
  review: 'gtd.review', folded: 'gtd.folded', filters: 'gtd.filters',
};

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k)    { try { localStorage.removeItem(k); } catch {} },
};

/* Config: { token, bot, workspace, parentId, parentTitle,
             dbs: { items, projects, horizons, habits, habitLog, perspectives } } */
export const cfg     = () => store.get(LS.cfg, null);
export const saveCfg = patch => store.set(LS.cfg, { ...(cfg() || {}), ...patch });
export const ready   = () => { const c = cfg(); return !!(c?.token && c.dbs?.items); };

export const DEFAULT_PREFS = {
  theme: 'auto',          // auto | dark | light
  reviewDay: 5,           // 0 = Sunday … 5 = Friday
  weekStart: 1,           // 1 = Monday
  showDoneInProjects: false,
  autoTickler: true,      // move due tickler items into the Inbox on sync
  engage: { context: null, energy: null, time: null, focusOnly: false },
};
export const prefs     = () => ({ ...DEFAULT_PREFS, ...store.get(LS.prefs, {}) });
export const savePrefs = patch => store.set(LS.prefs, { ...prefs(), ...patch });

export const state = {
  items: [], projects: [], horizons: [], habits: [], habitLog: [], perspectives: [], review: [],
  contexts: [],       // select options on Items.Context, in Notion's order
  tags: [],           // multi_select options on Items.Tags
  syncedAt: null,     // last successful sync, ms
  lastFullSync: null, // last sync that replaced everything, ms
  loading: false,
  error: null,
  route: { name: 'inbox', id: null, q: '' },
  query: '',
};

export function loadCache() {
  const c = store.get(LS.cache, null);
  if (!c) return false;
  for (const k of ['items','projects','horizons','habits','habitLog','perspectives','review','contexts','tags'])
    state[k] = c[k] || [];
  state.syncedAt = c.syncedAt || null;
  state.lastFullSync = c.lastFullSync || null;
  return true;
}

export function saveCache() {
  const { items, projects, horizons, habits, habitLog, perspectives, review, contexts, tags, syncedAt, lastFullSync } = state;
  store.set(LS.cache, { items, projects, horizons, habits, habitLog, perspectives, review, contexts, tags, syncedAt, lastFullSync });
}

export function clearAll() {
  for (const k of Object.values(LS)) store.del(k);
}

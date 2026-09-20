/* Notion: the client, the schema this app owns, first-run setup, sync, and
   every write. All calls go through api/notion/ on this origin, because
   Notion's API sends no CORS headers; the relay forwards and keeps nothing.

   The app owns six databases under one parent page of your choosing:
     Items       — every "thing": inbox entries, next actions, calendar
                   entries, waiting-fors, someday/maybe, tickler, reference
     Projects    — outcomes needing more than one action
     Horizons    — areas of responsibility, goals, vision, purpose
     Habits      — repeating commitments, and
     Habit Log   — one row per completed check-in
     Perspectives— saved filters
   Everything is plain Notion: edit it there and the app follows. */
'use strict';
import { state, cfg, saveCfg, saveCache } from './store.js';

export class NotionError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code; }
}

export async function relay(path, opts = {}, token = cfg()?.token) {
  const res = await fetch(`api/notion/${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    throw new NotionError(res.status === 404
      ? 'The Notion relay is not running on this server. Locally: node dev-server.js.'
      : `The Notion relay returned ${res.status}.`, res.status, 'relay');
  }
  const j = await res.json();
  if (!res.ok) {
    if (res.status === 401) throw new NotionError('Notion rejected the token (401). Check it, and that the integration still exists.', 401, j.code);
    if (res.status === 429) throw new NotionError('Notion rate limit — wait a moment and try again.', 429, j.code);
    if (res.status === 404) throw new NotionError((j.message || 'Not found.') + ' Is it shared with the integration?', 404, j.code);
    throw new NotionError(j.message || `Notion returned ${res.status}.`, res.status, j.code);
  }
  return j;
}

/* ═══ SCHEMA ════════════════════════════════════════════════════ */
export const DB_TITLES = {
  items: 'GTD · Items', projects: 'GTD · Projects', horizons: 'GTD · Horizons',
  habits: 'GTD · Habits', habitLog: 'GTD · Habit Log', perspectives: 'GTD · Perspectives',
};
export const ITEM_STATUSES = ['Inbox','Next','Calendar','Waiting','Someday','Tickler','Reference','Done','Trash'];
export const PROJECT_STATUSES = ['Active','Someday','Done','Trash'];
export const HORIZON_LEVELS = ['Area','Goal','Vision','Purpose'];
export const HORIZON_STATUSES = ['Active','Achieved','Dropped'];
export const HABIT_FREQ = ['Daily','Weekdays','Weekly','Monthly'];
export const HABIT_STATUSES = ['Active','Paused','Trash'];
export const ENERGY = ['Low','Medium','High'];
export const REPEATS = ['None','Daily','Weekdays','Weekly','Fortnightly','Monthly','Yearly'];
export const DEFAULT_CONTEXTS = ['@Quick','@Deep','@Comms','@Consume','@Agenda','@Admin','@Errands-Online','@Home','@Errand','@Studio','@Call'];

const sel = (names, colors) => ({ select: { options: names.map((n, i) => ({ name: n, color: colors?.[i] || 'default' })) } });
const rel = database_id => ({ relation: { database_id, single_property: {} } });

const SCHEMA = {
  horizons: () => ({
    Name:   { title: {} },
    Level:  sel(HORIZON_LEVELS, ['pink','purple','blue','yellow']),
    Status: sel(HORIZON_STATUSES, ['green','blue','gray']),
    Target: { date: {} },
    Notes:  { rich_text: {} },
  }),
  projects: ids => ({
    Name:      { title: {} },
    Status:    sel(PROJECT_STATUSES, ['green','purple','gray','red']),
    Area:      rel(ids.horizons),
    Goal:      rel(ids.horizons),
    Outcome:   { rich_text: {} },
    Due:       { date: {} },
    Focus:     { checkbox: {} },
    Completed: { date: {} },
    Notes:     { rich_text: {} },
  }),
  items: ids => ({
    Name:         { title: {} },
    Status:       sel(ITEM_STATUSES, ['default','blue','orange','yellow','purple','pink','gray','green','red']),
    Context:      sel(DEFAULT_CONTEXTS),
    Tags:         { multi_select: { options: [] } },
    Project:      rel(ids.projects),
    Area:         rel(ids.horizons),
    Date:         { date: {} },
    Time:         { number: { format: 'number' } },
    Energy:       sel(ENERGY, ['green','yellow','red']),
    'Waiting on': { rich_text: {} },
    Focus:        { checkbox: {} },
    Repeat:       sel(REPEATS),
    Completed:    { date: {} },
    Notes:        { rich_text: {} },
  }),
  habits: () => ({
    Name:      { title: {} },
    Frequency: sel(HABIT_FREQ, ['blue','blue','purple','pink']),
    Target:    { number: { format: 'number' } },
    Status:    sel(HABIT_STATUSES, ['green','yellow','red']),
    Notes:     { rich_text: {} },
  }),
  habitLog: ids => ({
    Name:  { title: {} },
    Habit: rel(ids.habits),
    Date:  { date: {} },
  }),
  perspectives: () => ({
    Name:   { title: {} },
    Filter: { rich_text: {} },
    Order:  { number: { format: 'number' } },
  }),
};

/* What each database must have for the app to work. Extra columns the user
   adds in Notion are fine and ignored. */
const REQUIRED = {
  items:    { Name:'title', Status:'select', Context:'select', Tags:'multi_select', Project:'relation', Area:'relation',
              Date:'date', Time:'number', Energy:'select', 'Waiting on':'rich_text', Focus:'checkbox',
              Repeat:'select', Completed:'date', Notes:'rich_text' },
  projects: { Name:'title', Status:'select', Area:'relation', Goal:'relation', Outcome:'rich_text', Due:'date',
              Focus:'checkbox', Completed:'date', Notes:'rich_text' },
  horizons: { Name:'title', Level:'select', Status:'select', Parent:'relation', Target:'date', Notes:'rich_text' },
  habits:   { Name:'title', Frequency:'select', Target:'number', Status:'select', Notes:'rich_text' },
  habitLog: { Name:'title', Habit:'relation', Date:'date' },
  perspectives: { Name:'title', Filter:'rich_text', Order:'number' },
};

const text = s => [{ type:'text', text:{ content: String(s).slice(0, 2000) } }];
const plain = rt => (rt || []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
export const bare = id => String(id || '').replace(/-/g, '');
export const dbTitle = db => plain(db.title) || 'Untitled';

/* ═══ SETUP ═════════════════════════════════════════════════════ */
export async function whoami(token) {
  const me = await relay('users/me', {}, token);
  return { bot: me.name || 'Integration', workspace: me.bot?.workspace_name || '' };
}

export async function searchPages(token) {
  const out = []; let cursor = null;
  do {
    const d = await relay('search', { method:'POST', body:{
      filter:{ property:'object', value:'page' }, page_size:100,
      sort:{ direction:'descending', timestamp:'last_edited_time' },
      ...(cursor ? { start_cursor: cursor } : {}) } }, token);
    for (const p of d.results || []) {
      if (p.object !== 'page' || p.archived) continue;
      const tp = Object.values(p.properties || {}).find(x => x.type === 'title');
      out.push({ id: bare(p.id), title: plain(tp?.title) || 'Untitled', icon: p.icon?.emoji || '',
                 parentIsDb: p.parent?.type === 'database_id' });
    }
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor && out.length < 300);
  return out.filter(p => !p.parentIsDb);   // a database row is a poor home for six databases
}

export async function searchDatabases(token) {
  const out = []; let cursor = null;
  do {
    const d = await relay('search', { method:'POST', body:{
      filter:{ property:'object', value:'database' }, page_size:100,
      ...(cursor ? { start_cursor: cursor } : {}) } }, token);
    out.push(...(d.results || []).filter(r => r.object === 'database' && !r.archived));
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return out;
}

/* Create the six databases under a page, in dependency order. Progress is
   reported so the setup screen can show which one it is on. */
export async function createDatabases(parentId, token, onProgress = () => {}) {
  const ids = {};
  const make = async (key) => {
    onProgress(`Creating ${DB_TITLES[key]}…`);
    const db = await relay('databases', { method:'POST', body:{
      parent: { type:'page_id', page_id: parentId },
      title: text(DB_TITLES[key]),
      properties: SCHEMA[key](ids),
    } }, token);
    ids[key] = bare(db.id);
  };
  await make('horizons');
  /* A self-relation needs the database's own id, which only exists now. */
  await relay(`databases/${ids.horizons}`, { method:'PATCH', body:{
    properties: { Parent: rel(ids.horizons) } } }, token);
  await make('projects');
  await make('items');
  await make('habits');
  await make('habitLog');
  await make('perspectives');
  return ids;
}

/* Find databases already created by a previous device or setup. */
export async function adoptDatabases(token) {
  const all = await searchDatabases(token);
  const ids = {}, missing = [];
  for (const [key, title] of Object.entries(DB_TITLES)) {
    const hit = all.find(d => dbTitle(d) === title);
    if (hit) ids[key] = bare(hit.id); else missing.push(title);
  }
  return { ids, missing };
}

/* Check the schema of each database and pull the option lists the app
   needs (contexts, tags). Returns a list of problems, empty when fine. */
export async function verifyDatabases(ids, token = cfg()?.token) {
  const problems = [];
  for (const [key, req] of Object.entries(REQUIRED)) {
    if (!ids[key]) { problems.push(`${DB_TITLES[key]} is not configured.`); continue; }
    let db;
    try { db = await relay(`databases/${ids[key]}`, {}, token); }
    catch (e) { problems.push(`${DB_TITLES[key]}: ${e.message}`); continue; }
    for (const [name, type] of Object.entries(req)) {
      const p = db.properties?.[name];
      if (!p) problems.push(`${DB_TITLES[key]} has no "${name}" property.`);
      else if (p.type !== type) problems.push(`${DB_TITLES[key]}: "${name}" is ${p.type}, expected ${type}.`);
    }
    if (key === 'items' && db.properties?.Context?.select) {
      state.contexts = db.properties.Context.select.options.map(o => ({ id:o.id, name:o.name, color:o.color }));
      state.tags = (db.properties.Tags?.multi_select?.options || []).map(o => ({ id:o.id, name:o.name, color:o.color }));
    }
  }
  return problems;
}

/* ═══ NORMALISE ═════════════════════════════════════════════════ */
const P = (page, name) => page.properties?.[name];
const getSel   = (page, n) => P(page, n)?.select?.name ?? null;
const getText  = (page, n) => plain(P(page, n)?.rich_text);
const getDate  = (page, n) => P(page, n)?.date?.start ?? null;
const getNum   = (page, n) => P(page, n)?.number ?? null;
const getBool  = (page, n) => !!P(page, n)?.checkbox;
const getRel   = (page, n) => bare(P(page, n)?.relation?.[0]?.id) || null;
const getTitle = page => plain(Object.values(page.properties || {}).find(x => x.type === 'title')?.title);

export const toItem = pg => ({
  id: bare(pg.id), name: getTitle(pg), status: getSel(pg, 'Status') || 'Inbox',
  context: getSel(pg, 'Context'), tags: (P(pg, 'Tags')?.multi_select || []).map(t => t.name),
  projectId: getRel(pg, 'Project'), areaId: getRel(pg, 'Area'),
  date: getDate(pg, 'Date'), time: getNum(pg, 'Time'), energy: getSel(pg, 'Energy'),
  waitingOn: getText(pg, 'Waiting on'), focus: getBool(pg, 'Focus'),
  repeat: getSel(pg, 'Repeat') || 'None', completed: getDate(pg, 'Completed'),
  notes: getText(pg, 'Notes'), created: pg.created_time, edited: pg.last_edited_time, url: pg.url,
});
export const toProject = pg => ({
  id: bare(pg.id), name: getTitle(pg), status: getSel(pg, 'Status') || 'Active',
  areaId: getRel(pg, 'Area'), goalId: getRel(pg, 'Goal'), outcome: getText(pg, 'Outcome'),
  due: getDate(pg, 'Due'), focus: getBool(pg, 'Focus'), completed: getDate(pg, 'Completed'),
  notes: getText(pg, 'Notes'), created: pg.created_time, edited: pg.last_edited_time, url: pg.url,
});
export const toHorizon = pg => ({
  id: bare(pg.id), name: getTitle(pg), level: getSel(pg, 'Level') || 'Area',
  status: getSel(pg, 'Status') || 'Active', parentId: getRel(pg, 'Parent'),
  target: getDate(pg, 'Target'), notes: getText(pg, 'Notes'),
  created: pg.created_time, edited: pg.last_edited_time, url: pg.url,
});
export const toHabit = pg => ({
  id: bare(pg.id), name: getTitle(pg), frequency: getSel(pg, 'Frequency') || 'Daily',
  target: getNum(pg, 'Target') || 1, status: getSel(pg, 'Status') || 'Active',
  notes: getText(pg, 'Notes'), created: pg.created_time, edited: pg.last_edited_time, url: pg.url,
});
export const toLog = pg => ({
  id: bare(pg.id), habitId: getRel(pg, 'Habit'), date: (getDate(pg, 'Date') || '').slice(0, 10),
  edited: pg.last_edited_time,
});
export const toPerspective = pg => {
  let filter = {};
  try { filter = JSON.parse(getText(pg, 'Filter') || '{}'); } catch {}
  return { id: bare(pg.id), name: getTitle(pg), filter, order: getNum(pg, 'Order') ?? 0,
           edited: pg.last_edited_time, url: pg.url };
};

/* Field → Notion property. Only keys present in the patch are written, so a
   partial update touches nothing else. null clears. */
const S  = v => ({ select: v ? { name: v } : null });
const RT = v => ({ rich_text: v ? text(v) : [] });
const D  = v => ({ date: v ? { start: v } : null });
const R  = v => ({ relation: v ? [{ id: v }] : [] });
const NM = v => ({ number: (v === '' || v === null || v === undefined) ? null : Number(v) });
const CB = v => ({ checkbox: !!v });

const ITEM_PROPS = {
  name: v => ({ Name: { title: text(v) } }), status: v => ({ Status: S(v) }),
  context: v => ({ Context: S(v) }), tags: v => ({ Tags: { multi_select: (v || []).map(name => ({ name })) } }),
  projectId: v => ({ Project: R(v) }), areaId: v => ({ Area: R(v) }), date: v => ({ Date: D(v) }),
  time: v => ({ Time: NM(v) }), energy: v => ({ Energy: S(v) }), waitingOn: v => ({ 'Waiting on': RT(v) }),
  focus: v => ({ Focus: CB(v) }), repeat: v => ({ Repeat: S(v && v !== 'None' ? v : 'None') }),
  completed: v => ({ Completed: D(v) }), notes: v => ({ Notes: RT(v) }),
};
const PROJECT_PROPS = {
  name: v => ({ Name: { title: text(v) } }), status: v => ({ Status: S(v) }),
  areaId: v => ({ Area: R(v) }), goalId: v => ({ Goal: R(v) }), outcome: v => ({ Outcome: RT(v) }),
  due: v => ({ Due: D(v) }), focus: v => ({ Focus: CB(v) }), completed: v => ({ Completed: D(v) }),
  notes: v => ({ Notes: RT(v) }),
};
const HORIZON_PROPS = {
  name: v => ({ Name: { title: text(v) } }), level: v => ({ Level: S(v) }), status: v => ({ Status: S(v) }),
  parentId: v => ({ Parent: R(v) }), target: v => ({ Target: D(v) }), notes: v => ({ Notes: RT(v) }),
};
const HABIT_PROPS = {
  name: v => ({ Name: { title: text(v) } }), frequency: v => ({ Frequency: S(v) }),
  target: v => ({ Target: NM(v) }), status: v => ({ Status: S(v) }), notes: v => ({ Notes: RT(v) }),
};
const PERSPECTIVE_PROPS = {
  name: v => ({ Name: { title: text(v) } }), filter: v => ({ Filter: RT(JSON.stringify(v || {})) }),
  order: v => ({ Order: NM(v) }),
};
const buildProps = (map, patch) => Object.entries(patch).reduce((acc, [k, v]) =>
  map[k] ? Object.assign(acc, map[k](v)) : acc, {});

/* ═══ SYNC ══════════════════════════════════════════════════════ */
async function queryAll(dbId, body = {}, onPage) {
  const out = []; let cursor = null, pages = 0;
  do {
    const d = await relay(`databases/${dbId}/query`, { method:'POST', body:{
      page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) } });
    out.push(...(d.results || []).filter(r => r.object === 'page' && !r.archived));
    cursor = d.has_more ? d.next_cursor : null;
    onPage?.(out.length);
    if (++pages > 200) break;
  } while (cursor);
  return out;
}

const KINDS = [
  ['items', toItem], ['projects', toProject], ['horizons', toHorizon],
  ['habits', toHabit], ['habitLog', toLog], ['perspectives', toPerspective],
];

/* Full sync replaces everything. Incremental asks each database only for
   pages edited since the last sync and merges them — but a page deleted or
   archived in Notion is invisible to that query, so a full sync is run on
   demand (the ⟳ button) and once an hour. */
export async function sync({ full = false, onProgress = () => {} } = {}) {
  const c = cfg();
  const since = !full && state.syncedAt ? new Date(state.syncedAt - 5 * 60e3).toISOString() : null;
  const startedAt = Date.now();
  const fresh = {};
  for (const [key, norm] of KINDS) {
    onProgress(`Syncing ${DB_TITLES[key].replace('GTD · ', '').toLowerCase()}…`);
    const body = since ? { filter: { timestamp:'last_edited_time', last_edited_time:{ on_or_after: since } } } : {};
    fresh[key] = (await queryAll(c.dbs[key], body)).map(norm);
  }
  for (const [key] of KINDS) {
    if (since) {
      const byId = new Map(state[key].map(x => [x.id, x]));
      for (const x of fresh[key]) byId.set(x.id, x);
      state[key] = [...byId.values()];
    } else state[key] = fresh[key];
  }
  state.syncedAt = startedAt;
  state.lastFullSync = full || !since ? startedAt : state.lastFullSync;
  saveCache();
}

/* Option lists live on the Items database itself. */
export async function refreshOptions() {
  const db = await relay(`databases/${cfg().dbs.items}`);
  state.contexts = (db.properties?.Context?.select?.options || []).map(o => ({ id:o.id, name:o.name, color:o.color }));
  state.tags = (db.properties?.Tags?.multi_select?.options || []).map(o => ({ id:o.id, name:o.name, color:o.color }));
  saveCache();
}

/* Replace the whole option list of a select. Notion keeps an option's id
   when it is sent back, so renames preserve the values on existing pages;
   an option left out is removed and its values cleared. */
export async function setOptions(prop, options) {
  const kind = prop === 'Tags' ? 'multi_select' : 'select';
  await relay(`databases/${cfg().dbs.items}`, { method:'PATCH', body:{
    properties: { [prop]: { [kind]: { options: options.map(o => o.id ? { id:o.id, name:o.name, color:o.color } : { name:o.name, color:o.color || 'default' }) } } } } });
  await refreshOptions();
}

/* ═══ WRITES ════════════════════════════════════════════════════
   Optimistic: the local record changes first, the page is written, and
   the server's copy replaces the local one. On failure the local change
   is rolled back and the error surfaces to the caller. */
async function createIn(key, map, norm, fields) {
  const page = await relay('pages', { method:'POST', body:{
    parent: { database_id: cfg().dbs[key] }, properties: buildProps(map, fields) } });
  const rec = norm(page);
  state[key] = [rec, ...state[key].filter(x => x.id !== rec.id)];
  saveCache();
  return rec;
}

async function updateIn(key, map, norm, id, patch) {
  const list = state[key];
  const i = list.findIndex(x => x.id === id);
  const before = i >= 0 ? list[i] : null;
  if (before) list[i] = { ...before, ...patch, edited: new Date().toISOString() };
  saveCache();
  try {
    const page = await relay(`pages/${id}`, { method:'PATCH', body:{ properties: buildProps(map, patch) } });
    const rec = norm(page);
    const j = state[key].findIndex(x => x.id === id);
    if (j >= 0) state[key][j] = rec;
    saveCache();
    return rec;
  } catch (e) {
    if (before) { const j = state[key].findIndex(x => x.id === id); if (j >= 0) state[key][j] = before; saveCache(); }
    throw e;
  }
}

export const createItem        = f => createIn('items', ITEM_PROPS, toItem, { status:'Inbox', repeat:'None', ...f });
export const updateItem        = (id, p) => updateIn('items', ITEM_PROPS, toItem, id, p);
export const createProject     = f => createIn('projects', PROJECT_PROPS, toProject, { status:'Active', ...f });
export const updateProject     = (id, p) => updateIn('projects', PROJECT_PROPS, toProject, id, p);
export const createHorizon     = f => createIn('horizons', HORIZON_PROPS, toHorizon, { status:'Active', ...f });
export const updateHorizon     = (id, p) => updateIn('horizons', HORIZON_PROPS, toHorizon, id, p);
export const createHabit       = f => createIn('habits', HABIT_PROPS, toHabit, { status:'Active', target:1, ...f });
export const updateHabit       = (id, p) => updateIn('habits', HABIT_PROPS, toHabit, id, p);
export const createPerspective = f => createIn('perspectives', PERSPECTIVE_PROPS, toPerspective, f);
export const updatePerspective = (id, p) => updateIn('perspectives', PERSPECTIVE_PROPS, toPerspective, id, p);

export async function logHabit(habit, date) {
  const page = await relay('pages', { method:'POST', body:{
    parent: { database_id: cfg().dbs.habitLog },
    properties: { Name: { title: text(`${habit.name} · ${date}`) }, Habit: R(habit.id), Date: D(date) } } });
  const rec = toLog(page);
  state.habitLog = [rec, ...state.habitLog];
  saveCache();
  return rec;
}

/* Archiving is Notion's own trash: the page vanishes from queries and can
   be restored from Notion's Trash for 30 days. */
export async function archivePage(key, id) {
  await relay(`pages/${id}`, { method:'PATCH', body:{ archived: true } });
  state[key] = state[key].filter(x => x.id !== id);
  saveCache();
}

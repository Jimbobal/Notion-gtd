/* The GTD model: which list a thing belongs to, what a project needs, what
   the weekly review asks, how habits count, what the numbers say. Pure
   functions over state; nothing here talks to Notion. */
'use strict';
import { state, prefs, store, LS } from './store.js';

/* ═══ DATES ═════════════════════════════════════════════════════ */
const pad2 = n => String(n).padStart(2, '0');
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
export const today = () => isoDay();
export const dayOf = s => (s || '').slice(0, 10);
export const hasTime = s => !!s && s.length > 10;
export const parseDay = s => { const [y, m, d] = dayOf(s).split('-').map(Number); return new Date(y, m-1, d); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
export const addMonths = (s, n) => { const d = parseDay(s); d.setMonth(d.getMonth() + n); return isoDay(d); };
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
export const weekday = s => parseDay(s).getDay();   // 0 Sunday

export function startOfWeek(s = today()) {
  const ws = prefs().weekStart;
  const d = parseDay(s);
  const diff = (d.getDay() - ws + 7) % 7;
  d.setDate(d.getDate() - diff);
  return isoDay(d);
}

export function fmtDay(s, { withYear = false } = {}) {
  if (!s) return '';
  const t = today(), d = dayOf(s);
  if (d === t) return 'Today';
  if (d === addDays(t, 1)) return 'Tomorrow';
  if (d === addDays(t, -1)) return 'Yesterday';
  const dt = parseDay(s);
  const opts = { weekday:'short', day:'numeric', month:'short' };
  if (withYear || dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString('en-GB', opts);
}
export function fmtTime(s) {
  if (!hasTime(s)) return '';
  const d = new Date(s);
  return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}
export const fmtWhen = s => !s ? '' : hasTime(s) ? `${fmtDay(s)} ${fmtTime(s)}` : fmtDay(s);
export function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
}
export const ageDays = iso => iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : 0;

/* ═══ LISTS ═════════════════════════════════════════════════════ */
export const STATUS_LABEL = {
  Inbox:'Inbox', Next:'Next Actions', Calendar:'Calendar', Waiting:'Waiting For',
  Someday:'Someday/Maybe', Tickler:'Tickler', Reference:'Reference', Done:'Done', Trash:'Trash',
};
export const STATUS_ROUTE = {
  Inbox:'inbox', Next:'next', Calendar:'calendar', Waiting:'waiting', Someday:'someday',
  Tickler:'tickler', Reference:'reference', Done:'stats', Trash:'trash',
};

const live = () => state.items.filter(i => i.status !== 'Trash');
export const byStatus = s => live().filter(i => i.status === s);
export const inboxItems     = () => byStatus('Inbox').sort((a, b) => a.created < b.created ? -1 : 1);
export const nextItems      = () => byStatus('Next');
export const waitingItems   = () => byStatus('Waiting');
export const somedayItems   = () => byStatus('Someday');
export const ticklerItems   = () => byStatus('Tickler').sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
export const referenceItems = () => byStatus('Reference');
export const doneItems      = () => byStatus('Done');
export const trashItems     = () => state.items.filter(i => i.status === 'Trash');
export const openItems      = () => live().filter(i => !['Done','Reference'].includes(i.status));

/* Anything with a date that still has to happen: calendar entries, and
   next actions or waiting-fors that carry a deadline. */
export const datedItems = () => live().filter(i => i.date && ['Calendar','Next','Waiting'].includes(i.status));
export const dueTickler = () => byStatus('Tickler').filter(i => i.date && dayOf(i.date) <= today());

export const isOverdue = i => !!i.date && dayOf(i.date) < today() && !['Done','Trash','Tickler','Someday','Reference'].includes(i.status);
export const isToday   = i => !!i.date && dayOf(i.date) === today();

export const focusItems = () => openItems().filter(i => i.focus);

/* ═══ SORTING ═══════════════════════════════════════════════════ */
const ENERGY_RANK = { High: 3, Medium: 2, Low: 1 };
export function sortNext(list) {
  return [...list].sort((a, b) =>
    (b.focus - a.focus) ||
    ((isOverdue(b) || isToday(b)) - (isOverdue(a) || isToday(a))) ||
    ((a.date || '9') < (b.date || '9') ? -1 : (a.date || '9') > (b.date || '9') ? 1 : 0) ||
    (a.created < b.created ? -1 : 1));
}

/* ═══ FILTERS (Engage and Perspectives) ═════════════════════════
   A filter is a plain object so a perspective can be saved as JSON:
   { statuses:[], contexts:[], tags:[], energy:null|'Low'|…, maxTime:null|n,
     projectId, areaId, focus:bool, text:'' } */
export function matches(i, f = {}) {
  if (f.statuses?.length && !f.statuses.includes(i.status)) return false;
  if (f.contexts?.length && !f.contexts.includes(i.context)) return false;
  if (f.tags?.length && !f.tags.some(t => i.tags.includes(t))) return false;
  if (f.energy && i.energy && ENERGY_RANK[i.energy] > ENERGY_RANK[f.energy]) return false;
  if (f.maxTime && i.time && i.time > f.maxTime) return false;
  if (f.projectId && i.projectId !== f.projectId) return false;
  if (f.areaId && areaOf(i) !== f.areaId) return false;
  if (f.focus && !i.focus) return false;
  if (f.dueWithin != null && (!i.date || daysBetween(today(), dayOf(i.date)) > f.dueWithin)) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (!`${i.name} ${i.notes} ${i.waitingOn} ${i.tags.join(' ')}`.toLowerCase().includes(q)) return false;
  }
  return true;
}
export const filterItems = (list, f) => list.filter(i => matches(i, f));

export function groupBy(list, keyFn, label = k => k || '—') {
  const m = new Map();
  for (const i of list) { const k = keyFn(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  return [...m.entries()].map(([k, items]) => ({ key: k, label: label(k), items }));
}

/* ═══ PROJECTS AND HORIZONS ═════════════════════════════════════ */
export const projectById = id => state.projects.find(p => p.id === id) || null;
export const horizonById = id => state.horizons.find(h => h.id === id) || null;
export const projectItems = pid => live().filter(i => i.projectId === pid);
export const activeProjects  = () => state.projects.filter(p => p.status === 'Active');
export const somedayProjects = () => state.projects.filter(p => p.status === 'Someday');
export const doneProjects    = () => state.projects.filter(p => p.status === 'Done');
export const trashProjects   = () => state.projects.filter(p => p.status === 'Trash');

export const areaOf = i => i.areaId || projectById(i.projectId)?.areaId || null;

/* A project moves when it has a next action, a calendar entry, or someone
   is on the hook. Otherwise it is stalled — the weekly review's first job. */
export function projectState(p) {
  const its = projectItems(p.id).filter(i => i.status !== 'Done');
  if (its.some(i => ['Next','Calendar','Waiting'].includes(i.status))) return 'moving';
  if (!its.length) return 'empty';
  return 'stalled';
}
export const stalledProjects = () => activeProjects().filter(p => projectState(p) !== 'moving');

export function projectProgress(p) {
  const its = projectItems(p.id);
  const done = its.filter(i => i.status === 'Done').length;
  return { done, total: its.length, pct: its.length ? Math.round(done / its.length * 100) : 0 };
}

export const horizonsAt = level => state.horizons.filter(h => h.level === level && h.status !== 'Dropped');
export const childrenOf = id => state.horizons.filter(h => h.parentId === id);
export const projectsUnder = h => state.projects.filter(p => p.status === 'Active' &&
  (h.level === 'Area' ? p.areaId === h.id : h.level === 'Goal' ? p.goalId === h.id : false));

/* ═══ RECURRENCE ════════════════════════════════════════════════ */
export function nextOccurrence(item) {
  const base = dayOf(item.date) || today();
  const from = base < today() ? today() : base;
  const time = hasTime(item.date) ? item.date.slice(10) : '';
  let next;
  switch (item.repeat) {
    case 'Daily':       next = addDays(from, 1); break;
    case 'Weekdays':    { next = addDays(from, 1); while ([0, 6].includes(weekday(next))) next = addDays(next, 1); break; }
    case 'Weekly':      next = addDays(from, 7); break;
    case 'Fortnightly': next = addDays(from, 14); break;
    case 'Monthly':     next = addMonths(from, 1); break;
    case 'Yearly':      next = addMonths(from, 12); break;
    default: return null;
  }
  return next + time;
}

/* ═══ HABITS ════════════════════════════════════════════════════ */
export const activeHabits = () => state.habits.filter(h => h.status === 'Active');
export const habitLogs = h => state.habitLog.filter(l => l.habitId === h.id);

/* Is this habit expected today? A weekly or monthly habit is "due" every
   day of its period until its target count is met. */
export function habitDue(h, day = today()) {
  if (h.frequency === 'Weekdays') return ![0, 6].includes(weekday(day));
  return true;
}
export function periodOf(h, day = today()) {
  if (h.frequency === 'Weekly') { const s = startOfWeek(day); return [s, addDays(s, 6)]; }
  if (h.frequency === 'Monthly') { const s = day.slice(0, 8) + '01'; return [s, addDays(addMonths(s, 1), -1)]; }
  return [day, day];
}
export function habitCount(h, day = today()) {
  const [a, b] = periodOf(h, day);
  return habitLogs(h).filter(l => l.date >= a && l.date <= b).length;
}
export const habitDoneToday = (h, day = today()) => habitCount(h, day) >= (h.target || 1);
export const habitLoggedOn = (h, day) => habitLogs(h).some(l => l.date === day);

/* Streak: consecutive periods, ending with the current one, that met the
   target. Today does not break a streak until it is over. */
export function habitStreak(h) {
  let n = 0, day = today();
  const met = d => habitCount(h, d) >= (h.target || 1);
  if (!met(day)) day = h.frequency === 'Weekly' ? addDays(day, -7) : h.frequency === 'Monthly' ? addMonths(day, -1) : addDays(day, -1);
  for (let guard = 0; guard < 400; guard++) {
    if (h.frequency === 'Weekdays' && [0, 6].includes(weekday(day))) { day = addDays(day, -1); continue; }
    if (!met(day)) break;
    n++;
    day = h.frequency === 'Weekly' ? addDays(day, -7) : h.frequency === 'Monthly' ? addMonths(day, -1) : addDays(day, -1);
  }
  return n;
}
export function habitLastDays(h, n = 14) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = addDays(today(), -k);
    out.push({ day: d, due: habitDue(h, d), done: habitLoggedOn(h, d) });
  }
  return out;
}
export function habitRate(h, days = 30) {
  const ds = habitLastDays(h, days).filter(x => x.due && x.day >= dayOf(h.created));
  if (!ds.length) return null;
  if (h.frequency === 'Daily' || h.frequency === 'Weekdays') return Math.round(ds.filter(x => x.done).length / ds.length * 100);
  const logs = habitLogs(h).filter(l => l.date >= addDays(today(), -days)).length;
  const periods = h.frequency === 'Weekly' ? Math.max(1, Math.round(days / 7)) : 1;
  return Math.min(100, Math.round(logs / (periods * (h.target || 1)) * 100));
}

/* ═══ WEEKLY REVIEW ═════════════════════════════════════════════ */
export const REVIEW_STEPS = [
  { phase:'Get clear', key:'collect', title:'Collect loose ends',
    text:'Papers, receipts, notes, photos, the thing you keep meaning to write down. Capture each one into the Inbox.' },
  { phase:'Get clear', key:'inbox', title:'Empty the Inbox', route:'inbox',
    text:'Clarify every item to zero. Decide what it is, what the next action is, and where it goes.' },
  { phase:'Get clear', key:'head', title:'Empty your head',
    text:'Anything nagging? New projects, ideas, commitments made this week? Capture them now.' },
  { phase:'Get current', key:'next', title:'Review Next Actions', route:'next',
    text:'Mark off what is done. Trash what no longer matters. Fix anything filed under the wrong context.' },
  { phase:'Get current', key:'calendar', title:'Review the calendar', route:'calendar',
    text:'Last week: any follow-ups owed? Coming weeks: anything to prepare for?' },
  { phase:'Get current', key:'waiting', title:'Review Waiting For', route:'waiting',
    text:'Anything overdue for a chase? Anything that has arrived and can be closed?' },
  { phase:'Get current', key:'projects', title:'Review every project', route:'projects',
    text:'Each active project needs at least one next action. Stalled ones are listed first.' },
  { phase:'Get current', key:'someday', title:'Review Someday/Maybe', route:'someday',
    text:'Anything ready to become active? Anything you can now let go of?' },
  { phase:'Get creative', key:'horizons', title:'Look up: areas and goals', route:'horizons',
    text:'Is every area of responsibility getting attention? Do the goals still point where you want to go?' },
  { phase:'Get creative', key:'ideas', title:'Be creative',
    text:'What bold, new or improving ideas could you add to the system? Capture a few, even the daft ones.' },
];
export const reviewState = () => store.get(LS.review, { done: {}, startedAt: null, lastCompleted: null, history: [] });
export const saveReview = r => store.set(LS.review, r);
export function reviewDueIn() {
  const r = reviewState();
  if (!r.lastCompleted) return -Infinity;
  return 7 - daysBetween(dayOf(r.lastCompleted), today());
}

/* ═══ SEARCH ════════════════════════════════════════════════════ */
export function search(q) {
  const s = q.trim().toLowerCase();
  if (!s) return { items: [], projects: [], horizons: [] };
  const hit = t => (t || '').toLowerCase().includes(s);
  return {
    items: state.items.filter(i => hit(i.name) || hit(i.notes) || hit(i.waitingOn) || i.tags.some(hit)),
    projects: state.projects.filter(p => hit(p.name) || hit(p.outcome) || hit(p.notes)),
    horizons: state.horizons.filter(h => hit(h.name) || hit(h.notes)),
  };
}

/* ═══ STATISTICS ════════════════════════════════════════════════ */
export function stats() {
  const t = today();
  const weeks = [];
  const w0 = startOfWeek(t);
  for (let k = 7; k >= 0; k--) {
    const start = addDays(w0, -7 * k), end = addDays(start, 6);
    const done = state.items.filter(i => i.completed && dayOf(i.completed) >= start && dayOf(i.completed) <= end).length;
    const added = state.items.filter(i => dayOf(i.created) >= start && dayOf(i.created) <= end).length;
    weeks.push({ start, end, done, added });
  }
  const perContext = groupBy(nextItems(), i => i.context).map(g => ({ label: g.label, n: g.items.length }))
    .sort((a, b) => b.n - a.n);
  const doneByContext = groupBy(state.items.filter(i => i.completed && dayOf(i.completed) >= addDays(t, -30)), i => i.context)
    .map(g => ({ label: g.label, n: g.items.length })).sort((a, b) => b.n - a.n);
  const waiting = waitingItems();
  const oldest = waiting.reduce((m, i) => Math.max(m, ageDays(i.created)), 0);
  const habits = activeHabits().map(h => ({ name: h.name, rate: habitRate(h), streak: habitStreak(h) }));
  const inboxAges = inboxItems().map(i => ageDays(i.created));
  return {
    weeks, perContext, doneByContext,
    inbox: inboxItems().length, inboxOldest: Math.max(0, ...inboxAges),
    next: nextItems().length, waiting: waiting.length, waitingOldest: oldest,
    someday: somedayItems().length, tickler: ticklerItems().length,
    projects: { active: activeProjects().length, stalled: stalledProjects().length,
                someday: somedayProjects().length, done: doneProjects().length },
    done30: state.items.filter(i => i.completed && dayOf(i.completed) >= addDays(t, -30)).length,
    habits,
    review: reviewState(),
  };
}

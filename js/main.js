/* The shell: routing, navigation, sync, and one event dispatcher that
   hands data-act clicks to whichever module claims them. */
'use strict';
import { state, cfg, prefs, ready, loadCache, saveCache } from './store.js';
import { sync, refreshOptions, NotionError } from './notion.js';
import { esc, toast, closeSheet, sheetOpen, toggleFold } from './ui.js';
import { inboxItems, nextItems, waitingItems, stalledProjects, dueTickler, reviewDueIn, activeHabits, habitDue, habitDoneToday } from './model.js';
import * as A from './actions.js';
import { refreshAll, refreshProvider } from './calendars.js';
import * as attach from './views/attach.js';
import * as integrations from './views/integrations.js';
import * as item from './views/item.js';
import * as clarify from './views/clarify.js';
import * as setup from './views/setup.js';
import * as inbox from './views/inbox.js';
import * as next from './views/next.js';
import * as calendar from './views/calendar.js';
import * as waiting from './views/waiting.js';
import * as projects from './views/projects.js';
import { someday, tickler, reference } from './views/lists.js';
import * as horizons from './views/horizons.js';
import * as habits from './views/habits.js';
import * as review from './views/review.js';
import * as perspectives from './views/perspectives.js';
import * as statsView from './views/stats.js';
import * as trash from './views/trash.js';
import * as settings from './views/settings.js';
import * as search from './views/search.js';

const VIEWS = { inbox, next, calendar, waiting, projects, someday, tickler, reference, horizons, habits,
                review, perspectives, stats: statsView, trash, settings, search, integrations };

const NAV = [
  { links: [['inbox', 'Inbox', '◉']] },
  { label: 'Engage', links: [['next', 'Next Actions', '▶'], ['calendar', 'Calendar', '▦'], ['waiting', 'Waiting For', '⚑']] },
  { label: 'Lists', links: [['projects', 'Projects', '▤'], ['someday', 'Someday / Maybe', '☁'], ['tickler', 'Tickler', '↻'], ['reference', 'Reference', '▣']] },
  { label: 'Reflect', links: [['horizons', 'Horizons', '◎'], ['habits', 'Habits', '✓'], ['review', 'Weekly Review', '◈'], ['perspectives', 'Perspectives', '⊞'], ['stats', 'Statistics', '≣']] },
  { links: [['trash', 'Trash', '✕'], ['integrations', 'Integrations', '⇄'], ['settings', 'Settings', '⚙']] },
];
const TABS = [['inbox', 'Inbox', '◉'], ['next', 'Next', '▶'], ['calendar', 'Calendar', '▦'], ['projects', 'Projects', '▤']];

/* ═══ ROUTING ═══════════════════════════════════════════════════ */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name, id] = path.split('/');
  return { name: VIEWS[name] ? name : 'inbox', id: id || null, q: qs || '' };
}
const $ = id => document.getElementById(id);

function counts() {
  const stalled = stalledProjects().length;
  const due = reviewDueIn();
  const habitsDue = activeHabits().filter(h => habitDue(h) && !habitDoneToday(h)).length;
  return {
    inbox: inboxItems().length, next: nextItems().length, waiting: waitingItems().length,
    projects: stalled, review: due <= 0 ? 'due' : '', habits: habitsDue, tickler: dueTickler().length,
    perspectives: state.perspectives.length,
  };
}

function sidebar() {
  const r = state.route, n = counts();
  const link = ([name, label, icon]) => {
    const c = n[name];
    const warn = (name === 'inbox' && c > 0) || (name === 'projects' && c > 0) || (name === 'review' && c) || (name === 'tickler' && c > 0);
    return `<a class="side-link ${r.name === name ? 'is-active' : ''} ${warn ? 'warn' : ''}" href="#/${name}" data-act="nav"><i>${icon}</i>${label}${c ? `<span class="n">${c}</span>` : ''}</a>`;
  };
  const persp = state.perspectives.length ? state.perspectives.slice(0, 6).map(p =>
    `<a class="side-link ${r.name === 'perspectives' && r.id === p.id ? 'is-active' : ''}" href="#/perspectives/${p.id}" data-act="nav"><i>·</i>${esc(p.name)}</a>`).join('') : '';
  return `<div class="side-brand"><span class="brand-mark"></span><b>GTD for Notion</b></div>
    <button class="btn primary side-capture" data-act="capture">＋ Capture</button>
    ${NAV.map(g => `${g.label ? `<div class="side-group">${g.label}</div>` : ''}${g.links.map(link).join('')}${g.label === 'Reflect' ? persp : ''}`).join('')}`;
}

function tabbar() {
  const r = state.route, n = counts();
  return TABS.map(([name, label, icon]) => `<a class="tab ${r.name === name ? 'is-active' : ''}" href="#/${name}" data-act="nav"><i>${icon}</i><span>${label}</span>${
    (name === 'inbox' && n.inbox) || (name === 'projects' && n.projects) ? `<span class="n">${n[name]}</span>` : ''}</a>`).join('')
    + `<button class="tab ${['inbox','next','calendar','projects'].includes(r.name) ? '' : 'is-active'}" data-act="menu"><i>☰</i><span>More</span></button>`;
}

let renderSoft = false;
export function render() {
  if (!ready()) return;
  const r = state.route;
  const v = VIEWS[r.name];
  $('sidebar').innerHTML = sidebar();
  $('tabbar').innerHTML = tabbar();
  const title = typeof v.title === 'function' ? v.title(r) : v.title;
  $('view-title').textContent = title;
  document.title = `${title} · GTD`;
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  $('view').innerHTML = state.loading && !state.items.length && !state.syncedAt ? '<div class="spinner"></div>' : v.render(r);
  if (renderSoft && focused) { const el = $(focused); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} } }
  renderSoft = false;
  syncLine();
}
function syncLine(msg) {
  const el = $('sync-line');
  if (msg) { el.textContent = msg; return; }
  if (state.error) { el.innerHTML = `<span class="bad">${esc(state.error)}</span>`; return; }
  const n = counts();
  const m = state.syncedAt ? Math.round((Date.now() - state.syncedAt) / 6e4) : null;
  el.textContent = `${n.next} next · ${n.waiting} waiting · ${n.inbox} to clarify · ${m === null ? 'not synced' : m < 1 ? 'synced just now' : m < 60 ? `synced ${m}m ago` : `synced ${Math.round(m / 60)}h ago`}`;
}

function onRoute() {
  state.route = parseRoute();
  if (state.route.name !== 'search') state.query = '';
  closeSheet(); closeMenu();
  window.scrollTo(0, 0);
  render();
}
const openMenu = () => { $('sidebar').classList.add('open'); $('sidebar-backdrop').hidden = false; };
const closeMenu = () => { $('sidebar').classList.remove('open'); $('sidebar-backdrop').hidden = true; };

/* ═══ SYNC ══════════════════════════════════════════════════════ */
let syncing = false;
async function doSync({ full = false, quiet = false } = {}) {
  if (syncing || !ready()) return;
  syncing = true; state.loading = true; state.error = null;
  $('btn-sync').classList.add('spin');
  const needFull = full || !state.lastFullSync || Date.now() - state.lastFullSync > 3600e3;
  try {
    await sync({ full: needFull, onProgress: syncLine });
    if (needFull) await refreshOptions();
    if (!state.review.length) { try { await A.seedReviewSteps(); } catch {} }
    state.loading = false;
    render();
    let surfaced = 0;
    if (prefs().autoTickler) { const due = dueTickler(); if (due.length) { await A.surfaceTickler(due); surfaced = due.length; } }
    if (surfaced) toast(`Synced · ${surfaced} tickler item${surfaced > 1 ? 's' : ''} back in the Inbox`, 3500);
    else if (!quiet && needFull) toast('Synced with Notion');
    if (await refreshAll({ force: full })) render();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    if (e instanceof NotionError && (e.status === 401 || e.status === 404)) {
      toast(e.message, 6000);
      setup.showSetup([e.message]);
    } else toast(e.message, 5000);
    render();
  } finally {
    syncing = false; $('btn-sync').classList.remove('spin');
  }
}

/* ═══ EVENTS ════════════════════════════════════════════════════ */
async function dispatch(name, el, ev) {
  /* Global acts first, then modules in a fixed order; the first to claim it wins. */
  switch (name) {
    case 'nav':     closeMenu(); return true;      // the anchor itself navigates
    case 'menu':    $('sidebar').classList.contains('open') ? closeMenu() : openMenu(); return true;
    case 'close':   closeSheet(); return true;
    case 'capture': closeSheet(); item.openCapture(); return true;
    case 'sync':    doSync({ full: true }); return true;
    case 'fold':    toggleFold(el.dataset.key); render(); return true;
    case 'done':    ev.stopPropagation(); await A.completeItem(el.dataset.id); return true;
  }
  const v = VIEWS[state.route.name];
  for (const mod of [item, clarify, attach, v, setup]) {
    const r = await mod.act?.(name, el, ev);
    if (r === 'render') render();
    if (r) return true;
  }
  return false;
}

document.addEventListener('click', async e => {
  const t = e.target;
  const actEl = t.closest('[data-act]');
  if (actEl) {
    if (actEl.tagName === 'A' && actEl.dataset.act === 'nav') { closeMenu(); return; }
    e.preventDefault();
    try { await dispatch(actEl.dataset.act, actEl, e); } catch (err) { console.error(err); toast(err.message, 5000); }
    return;
  }
  if (t.closest('#sheet-backdrop')) return closeSheet();
  if (t.closest('#sidebar-backdrop')) return closeMenu();
  if (t.closest('#btn-menu')) return openMenu();
  if (t.closest('#btn-sync')) return doSync({ full: true });
  if (t.closest('#btn-add')) return item.openCapture();
  if (t.closest('#btn-search')) { location.hash = '#/search'; return; }
  if (t.closest('#sheet a[href^="#/"]')) { closeSheet(); return; }
  if (t.closest('label.pill') && sheetOpen()) { perspectives.pillToggle(t.closest('label.pill')); return; }
  const row = t.closest('.item[data-item]');
  if (row && !t.closest('a, button')) return item.openItem(row.dataset.item);
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target; form._submitter = e.submitter;
  const v = VIEWS[state.route.name];
  try {
    for (const mod of [item, clarify, attach, v, setup]) { if (await mod.submit?.(form)) return; }
  } catch (err) { console.error(err); toast(err.message, 5000); }
});

document.addEventListener('input', e => {
  const v = VIEWS[state.route.name];
  const r = v.input?.(e.target);
  if (r === 'render-soft') { renderSoft = true; render(); }
  else if (r === 'render') { renderSoft = true; render(); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.actChange) {
    const v = VIEWS[state.route.name];
    try { const r = await v.change?.(el); if (r === 'render') render(); } catch (err) { toast(err.message, 5000); }
  }
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') { if (sheetOpen()) closeSheet(); else closeMenu(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !ready()) return;
  if (e.key === 'n' || e.key === 'c') { e.preventDefault(); item.openCapture(); }
  if (e.key === '/') { e.preventDefault(); location.hash = '#/search'; }
  if (e.key === 'i') location.hash = '#/inbox';
  if (e.key === 'a') location.hash = '#/next';
});

document.addEventListener('gtd:render', () => render());
document.addEventListener('gtd:sync', e => doSync(e.detail || {}));
document.addEventListener('gtd:calendar', async e => {
  try { if (e.detail?.provider) await refreshProvider(e.detail.provider); else await refreshAll({ force: true }); }
  catch (err) { toast(`Calendar: ${err.message}`, 6000); }
  render();
});
/* A sheet asks to be redrawn after an attachment changed. */
document.addEventListener('gtd:reopen', e => {
  const { kind, id } = e.detail;
  if (kind === 'items') item.openItem(id); else render();
});
document.addEventListener('gtd:theme', applyTheme);
document.addEventListener('gtd:setup-done', () => bootApp());
window.addEventListener('hashchange', onRoute);
window.addEventListener('focus', () => { if (ready() && state.syncedAt && Date.now() - state.syncedAt > 5 * 60e3) doSync({ quiet: true }); });

/* ═══ BOOT ══════════════════════════════════════════════════════ */
function applyTheme() {
  const t = prefs().theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function bootApp() {
  $('setup').hidden = true; $('app').hidden = false;
  loadCache();
  state.route = parseRoute();
  render();
  doSync({ quiet: true });
}

applyTheme();
if (ready()) bootApp();
else setup.showSetup();

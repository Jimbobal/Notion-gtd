/* Statistics: is the system healthy, and what is getting done. One hue per
   chart (magnitude), values in text ink, a table under each chart. */
'use strict';
import { esc, head, section, plural } from '../ui.js';
import { stats, fmtDay } from '../model.js';

export const title = () => 'Statistics';

/* Vertical bars: thin, rounded at the data end, recessive baseline, a
   native tooltip per bar, and the numbers only where they matter. */
function bars(rows, { key = 'done', label = r => r.label, w = 640, h = 180 } = {}) {
  const max = Math.max(1, ...rows.map(r => r[key]));
  const pad = { l: 8, r: 8, t: 18, b: 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const bw = Math.min(28, iw / rows.length - 6);
  const step = iw / rows.length;
  const y = v => pad.t + ih - (v / max) * ih;
  const b = rows.map((r, k) => {
    const x = pad.l + step * k + (step - bw) / 2;
    const top = y(r[key]), hgt = Math.max(0, pad.t + ih - top);
    const isMax = r[key] === max && max > 0;
    return `<g><title>${esc(label(r))}: ${r[key]}</title>
      <rect class="bar-c ${r[key] ? '' : 'dim'}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="4"/>
      ${isMax || k === rows.length - 1 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle">${r[key]}</text>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle">${esc(r.short || label(r))}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart">
    <line class="axis" x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke-width="1"/>${b}</svg>`;
}

/* Horizontal bars for a ranked list: label, bar, value. */
function hbars(rows, { key = 'n' } = {}) {
  const max = Math.max(1, ...rows.map(r => r[key]));
  return rows.map(r => `<div class="opt-row" style="padding:8px 12px"><div class="grow" style="font-size:13px">${esc(r.label)}</div>
    <div style="flex:2;height:8px;border-radius:4px;background:var(--bg-sunken);overflow:hidden"><span style="display:block;height:100%;width:${Math.round(r[key] / max * 100)}%;background:var(--accent);border-radius:4px"></span></div>
    <div style="width:28px;text-align:right;font-size:12.5px;color:var(--text-2);font-variant-numeric:tabular-nums">${r[key]}</div></div>`).join('');
}

const table = (rows, cols) => `<details style="margin:0 0 10px"><summary class="hint" style="cursor:pointer">Table</summary>
  <table style="width:100%;font-size:12.5px;border-collapse:collapse">${rows.map(r => `<tr>${cols.map(c => `<td style="padding:3px 6px;border-bottom:1px solid var(--border)">${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table></details>`;

export function render() {
  const s = stats();
  const weeks = s.weeks.map(w => ({ ...w, label: `w/c ${fmtDay(w.start)}`, short: fmtDay(w.start).replace(/^\w+ /, '') }));
  const lastWeek = weeks[weeks.length - 2]?.done ?? 0, thisWeek = weeks[weeks.length - 1].done;
  const health = [
    { v: s.inbox, k: 'in the Inbox', cls: s.inbox > 20 ? 'bad' : s.inbox > 5 ? 'warn' : 'good' },
    { v: s.projects.stalled, k: 'projects without a next action', cls: s.projects.stalled ? 'warn' : 'good' },
    { v: s.waitingOldest, k: 'days: oldest waiting-for', cls: s.waitingOldest > 30 ? 'bad' : s.waitingOldest > 14 ? 'warn' : 'good' },
    { v: s.review.lastCompleted ? Math.max(0, 7 - Math.round((Date.now() - new Date(s.review.lastCompleted)) / 864e5)) : '—', k: 'days to the next review', cls: '' },
  ];
  return `${head('System health')}
    <div class="stats">${health.map(x => `<div class="stat ${x.cls}"><div class="v">${x.v}</div><div class="k">${x.k}</div></div>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="v">${s.next}</div><div class="k">next actions</div></div>
      <div class="stat"><div class="v">${s.projects.active}</div><div class="k">active projects</div></div>
      <div class="stat"><div class="v">${s.waiting}</div><div class="k">waiting for</div></div>
      <div class="stat"><div class="v">${s.someday}</div><div class="k">someday / maybe</div></div>
    </div>

    ${head('Completed per week', `${thisWeek} this week · ${lastWeek} last week`)}
    ${bars(weeks, { key: 'done' })}
    ${table(weeks, ['label', 'done', 'added'])}
    <p class="hint">${s.done30} done in the last 30 days; ${s.projects.done} projects completed in total.</p>

    ${s.perContext.length ? head('Next actions by context') + hbars(s.perContext) : ''}
    ${s.doneByContext.length ? head('Done by context, last 30 days') + hbars(s.doneByContext) : ''}

    ${s.habits.length ? head('Habits, last 30 days') + s.habits.map(h => `<div class="opt-row" style="padding:8px 12px"><div class="grow" style="font-size:13px">${esc(h.name)}<div class="sub">${h.streak ? `🔥 ${h.streak} streak` : 'no streak yet'}</div></div>
        <div style="flex:2;height:8px;border-radius:4px;background:var(--bg-sunken);overflow:hidden"><span style="display:block;height:100%;width:${h.rate ?? 0}%;background:var(--green);border-radius:4px"></span></div>
        <div style="width:40px;text-align:right;font-size:12.5px;color:var(--text-2)">${h.rate == null ? '—' : h.rate + '%'}</div></div>`).join('') : ''}

    ${s.review.history?.length ? head('Weekly reviews', s.review.history.length) + `<p class="hint">${s.review.history.slice(-8).map(d => fmtDay(d, { withYear: true })).join(' · ')}</p>` : ''}`;
}
export const act = async () => false;

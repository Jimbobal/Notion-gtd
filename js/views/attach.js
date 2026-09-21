/* The attachments block shared by the item sheet and the project page:
   Google Drive, Dropbox, or any link (a Notion page, say). */
'use strict';
import { esc, attr, toast, field } from '../ui.js';
import { pickDrive, pickDropbox, driveReady, dropboxReady, sourceOf, sourceIcon } from '../files.js';
import * as A from '../actions.js';

export function attachSection(kind, rec) {
  const list = (rec.attachments || []).map((a, k) => `<span class="attach" title="${attr(a.url)}">
      <a href="${attr(a.url)}" target="_blank" rel="noopener"><i>${sourceIcon(sourceOf(a.url))}</i>${esc(a.name)}</a>
      <button data-act="att-remove" data-kind="${kind}" data-id="${rec.id}" data-k="${k}" aria-label="Remove">×</button></span>`).join('');
  return `<div class="section-head" style="margin-top:14px"><h3>Attachments</h3></div>
    ${list ? `<div class="attach-list">${list}</div>` : ''}
    <div class="pills wrap" id="attach-buttons">
      ${driveReady() ? `<button class="pill small" data-act="att-drive" data-kind="${kind}" data-id="${rec.id}">▲ Google Drive</button>` : ''}
      ${dropboxReady() ? `<button class="pill small" data-act="att-dropbox" data-kind="${kind}" data-id="${rec.id}">⬡ Dropbox</button>` : ''}
      <button class="pill small" data-act="att-link" data-kind="${kind}" data-id="${rec.id}">⛓ Link</button>
      ${!driveReady() && !dropboxReady() ? '<a class="pill small" href="#/integrations">Set up Drive / Dropbox</a>' : ''}
    </div>
    <div id="attach-link-slot"></div>`;
}

export async function act(name, el) {
  const { kind, id, k } = el.dataset;
  const reopen = () => document.dispatchEvent(new CustomEvent('gtd:reopen', { detail: { kind, id } }));
  switch (name) {
    case 'att-drive': {
      let files = [];
      try { files = await pickDrive(); } catch (e) { toast(e.message, 6000); return true; }
      if (files.length) { await A.attach(kind, id, files); reopen(); }
      return true;
    }
    case 'att-dropbox': {
      let files = [];
      try { files = await pickDropbox(); } catch (e) { toast(e.message, 6000); return true; }
      if (files.length) { await A.attach(kind, id, files); reopen(); }
      return true;
    }
    case 'att-link': {
      const slot = document.getElementById('attach-link-slot');
      if (slot) slot.innerHTML = `<form id="attach-link-form" data-kind="${kind}" data-id="${id}" style="margin-top:8px">
        <div class="row2">${field('Link', `<input name="url" placeholder="https://www.notion.so/… or any address" required autofocus>`)}${field('Name', `<input name="name" placeholder="Optional">`)}</div>
        <div class="actions" style="margin-top:0"><button type="submit" class="btn small primary">Attach</button></div></form>`;
      slot?.querySelector('input')?.focus();
      return true;
    }
    case 'att-remove': await A.detach(kind, id, Number(k)); reopen(); return true;
  }
  return false;
}

export async function submit(form) {
  if (form.id !== 'attach-link-form') return false;
  const f = Object.fromEntries(new FormData(form));
  let url = f.url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { toast('That is not a valid link.'); return true; }
  let name = f.name.trim();
  if (!name) { try { const u = new URL(url); name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname).replace(/-[0-9a-f]{32}$/, '').replace(/[-_]+/g, ' '); } catch { name = url; } }
  await A.attach(form.dataset.kind, form.dataset.id, [{ name, url }]);
  document.dispatchEvent(new CustomEvent('gtd:reopen', { detail: { kind: form.dataset.kind, id: form.dataset.id } }));
  return true;
}

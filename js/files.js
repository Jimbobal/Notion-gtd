/* Attachments: pick a file from Google Drive or Dropbox, or paste a link
   (a Notion page, anything). Both pickers run in the browser with the
   vendor's own widget; the app only ever receives a name and a link,
   which it stores on the Notion page as an external file. */
'use strict';
import { cfg, saveCfg } from './store.js';
import { loadScript, ensureToken, gcfg, googleConnected } from './google.js';

/* ── Google Drive (Picker) ────────────────────────────── */
export const driveReady = () => googleConnected() && !!gcfg().apiKey;

export async function pickDrive() {
  const token = await ensureToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((res, rej) => window.gapi.load('picker', { callback: res, onerror: rej }));
  return new Promise(resolve => {
    const P = window.google.picker;
    const view = new P.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false);
    const picker = new P.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(gcfg().apiKey)
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .setTitle('Attach from Google Drive')
      .setCallback(data => {
        if (data[P.Response.ACTION] === P.Action.PICKED) {
          resolve((data[P.Response.DOCUMENTS] || []).map(d => ({
            name: d[P.Document.NAME], url: d[P.Document.URL], source: 'drive', icon: d[P.Document.ICON_URL] || '' })));
        } else if (data[P.Response.ACTION] === P.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}

/* ── Dropbox (Chooser) ────────────────────────────────── */
export const dcfg = () => cfg()?.dropbox || {};
export const saveDropbox = patch => saveCfg({ dropbox: { ...dcfg(), ...patch } });
export const dropboxReady = () => !!dcfg().appKey;

export async function pickDropbox() {
  if (!dropboxReady()) throw new Error('Add your Dropbox app key on the Integrations page first.');
  await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': dcfg().appKey });
  if (!window.Dropbox?.choose) throw new Error('The Dropbox chooser did not load.');
  return new Promise(resolve => {
    window.Dropbox.choose({
      linkType: 'preview', multiselect: true,
      success: files => resolve(files.map(f => ({ name: f.name, url: f.link, source: 'dropbox', icon: f.icon || '' }))),
      cancel: () => resolve([]),
    });
  });
}

/* ── Any link ─────────────────────────────────────────── */
export function sourceOf(url) {
  try {
    const h = new URL(url).hostname;
    if (/dropbox\.com$/.test(h)) return 'dropbox';
    if (/docs\.google\.com$|drive\.google\.com$/.test(h)) return 'drive';
    if (/notion\.(so|site)$/.test(h)) return 'notion';
  } catch {}
  return 'link';
}
export const sourceIcon = s => ({ drive: '▲', dropbox: '⬡', notion: 'N', link: '⛓' }[s] || '⛓');

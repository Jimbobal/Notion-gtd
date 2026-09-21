/* An in-memory stand-in for api.notion.com covering what the app uses:
   users/me, search, database create/read/update/query, page
   create/read/update (including archive). Records every request. */
'use strict';
const http = require('http');
const crypto = require('crypto');

const TOKEN = 'ntn_test_token';
const PARENT_PAGE = '11111111-2222-3333-4444-555555555555';

const rt = s => [{ type: 'text', text: { content: s }, plain_text: s }];
const uuid = () => crypto.randomUUID();
const dash = id => id.includes('-') ? id : id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

function start(port) {
  const log = [];
  const dbs = {};      // id → { id, title, properties, parent, created_time }
  const pages = {};    // id → page object
  const PAGES = [{ object: 'page', id: PARENT_PAGE, archived: false, parent: { type: 'workspace', workspace: true },
                   icon: { type: 'emoji', emoji: '🗂' }, properties: { title: { id: 'title', type: 'title', title: rt('GTD Home') } },
                   created_time: '2026-01-01T00:00:00.000Z', last_edited_time: '2026-01-01T00:00:00.000Z', url: 'https://www.notion.so/GTD-Home' },
                 { object: 'page', id: uuid(), archived: false, parent: { type: 'workspace', workspace: true },
                   properties: { title: { id: 'title', type: 'title', title: rt('Reading notes') } },
                   created_time: '2026-01-01T00:00:00.000Z', last_edited_time: '2026-02-01T00:00:00.000Z', url: 'https://www.notion.so/Reading' }];

  /* Give select options ids like Notion does; keep existing ids on rename. */
  const normaliseSchema = (props, prev = {}) => {
    const out = {};
    for (const [name, def] of Object.entries(props)) {
      const type = Object.keys(def).find(k => !['id', 'name', 'type'].includes(k));
      const p = { id: name.toLowerCase().replace(/\W/g, '') || uuid().slice(0, 4), name, type, [type]: def[type] };
      if (type === 'select' || type === 'multi_select') {
        p[type] = { options: (def[type].options || []).map(o => ({ id: o.id || uuid(), name: o.name, color: o.color || 'default' })) };
      }
      out[name] = p;
    }
    return out;
  };

  /* Write-shape → read-shape for one property value. */
  const readValue = (schema, value) => {
    const type = schema.type;
    switch (type) {
      case 'title': return { type, title: (value.title || []).map(t => ({ ...t, plain_text: t.text?.content ?? t.plain_text ?? '' })) };
      case 'rich_text': return { type, rich_text: (value.rich_text || []).map(t => ({ ...t, plain_text: t.text?.content ?? t.plain_text ?? '' })) };
      case 'select': {
        const v = value.select;
        if (!v) return { type, select: null };
        let opt = schema.select.options.find(o => o.name === v.name);
        if (!opt) { opt = { id: uuid(), name: v.name, color: 'default' }; schema.select.options.push(opt); }
        return { type, select: { ...opt } };
      }
      case 'multi_select': return { type, multi_select: (value.multi_select || []).map(v => {
        let opt = schema.multi_select.options.find(o => o.name === v.name);
        if (!opt) { opt = { id: uuid(), name: v.name, color: 'default' }; schema.multi_select.options.push(opt); }
        return { ...opt };
      }) };
      case 'relation': return { type, relation: (value.relation || []).map(r => ({ id: dash(r.id) })), has_more: false };
      case 'date': return { type, date: value.date ? { start: value.date.start, end: value.date.end || null, time_zone: null } : null };
      case 'number': return { type, number: value.number ?? null };
      case 'checkbox': return { type, checkbox: !!value.checkbox };
      case 'url': return { type, url: value.url || null };
      case 'files': return { type, files: (value.files || []).map(f => ({ name: f.name, type: 'external', external: { url: f.external?.url || f.url } })) };
      default: return { type, [type]: value[type] };
    }
  };
  const emptyValue = schema => readValue(schema, {});

  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const err = (res, status, code, message) => send(res, status, { object: 'error', status, code, message });

  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      if (url.pathname === '/__log') return send(res, 200, log);
      if (url.pathname === '/__reset') { log.length = 0; return send(res, 200, {}); }
      if (url.pathname === '/__state') return send(res, 200, { dbs, pages });
      const body = data ? JSON.parse(data) : null;
      log.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return err(res, 401, 'unauthorized', 'API token is invalid.');
      if (req.headers['notion-version'] !== '2022-06-28') return err(res, 400, 'invalid_request', 'Bad Notion-Version');
      const p = url.pathname, m = req.method;
      let x;

      if (m === 'GET' && p === '/v1/users/me')
        return send(res, 200, { object: 'user', type: 'bot', id: 'bot-1', name: 'GTD app', bot: { workspace_name: 'James Garner Command Centre' } });

      if (m === 'POST' && p === '/v1/search') {
        const want = body?.filter?.value;
        let results = [];
        if (want === 'page' || !want) results.push(...PAGES);
        if (want === 'database' || !want) results.push(...Object.values(dbs).map(readDb));
        return send(res, 200, { object: 'list', results, has_more: false, next_cursor: null });
      }

      if (m === 'POST' && p === '/v1/databases') {
        if (dash(body.parent.page_id) !== PARENT_PAGE) return err(res, 404, 'object_not_found', 'Could not find page');
        const id = uuid();
        dbs[id] = { id, title: body.title, properties: normaliseSchema(body.properties), parent: body.parent, created_time: new Date().toISOString() };
        return send(res, 200, readDb(dbs[id]));
      }
      if ((x = p.match(/^\/v1\/databases\/([\w-]+)$/))) {
        const db = dbs[dash(x[1])];
        if (!db) return err(res, 404, 'object_not_found', 'Could not find database');
        if (m === 'GET') return send(res, 200, readDb(db));
        if (m === 'PATCH') {
          for (const [name, def] of Object.entries(body.properties || {})) {
            if (def === null) { delete db.properties[name]; continue; }
            const prev = db.properties[name];
            const type = Object.keys(def).find(k => !['id', 'name', 'type'].includes(k));
            if ((type === 'select' || type === 'multi_select') && prev) {
              const nextOpts = def[type].options.map(o => o.id ? { ...prev[type].options.find(q => q.id === o.id), name: o.name, color: o.color || 'default' } : { id: uuid(), name: o.name, color: o.color || 'default' });
              const removed = prev[type].options.filter(o => !nextOpts.some(n => n.id === o.id)).map(o => o.name);
              const renamed = new Map(prev[type].options.map(o => [o.name, nextOpts.find(n => n.id === o.id)?.name]));
              prev[type].options = nextOpts;
              for (const pg of Object.values(pages)) {
                const v = pg.properties[name]; if (!v) continue;
                if (type === 'select' && v.select) { if (removed.includes(v.select.name)) v.select = null; else v.select = { ...nextOpts.find(o => o.name === renamed.get(v.select.name)) }; }
                if (type === 'multi_select') v.multi_select = v.multi_select.filter(o => !removed.includes(o.name)).map(o => ({ ...nextOpts.find(n => n.name === renamed.get(o.name)) }));
              }
            } else db.properties[name] = normaliseSchema({ [name]: def })[name];
          }
          return send(res, 200, readDb(db));
        }
      }
      if ((x = p.match(/^\/v1\/databases\/([\w-]+)\/query$/)) && m === 'POST') {
        const db = dbs[dash(x[1])];
        if (!db) return err(res, 404, 'object_not_found', 'Could not find database');
        let rows = Object.values(pages).filter(pg => pg.parent.database_id === db.id && !pg.archived);
        const f = body?.filter;
        if (f?.timestamp === 'last_edited_time' && f.last_edited_time?.on_or_after) rows = rows.filter(pg => pg.last_edited_time >= f.last_edited_time.on_or_after);
        else if (f?.property && f.rich_text?.is_not_empty) rows = rows.filter(pg => (pg.properties[f.property]?.rich_text || []).length);
        rows.sort((a, b) => a.created_time < b.created_time ? 1 : -1);
        const size = body?.page_size || 100;
        const start = Number(body?.start_cursor || 0);
        return send(res, 200, { object: 'list', results: rows.slice(start, start + size), has_more: start + size < rows.length, next_cursor: start + size < rows.length ? String(start + size) : null });
      }

      if (m === 'POST' && p === '/v1/pages') {
        const db = dbs[dash(body.parent.database_id)];
        if (!db) return err(res, 404, 'object_not_found', 'Could not find database');
        for (const name of Object.keys(body.properties || {})) if (!db.properties[name]) return err(res, 400, 'validation_error', `${name} is not a property that exists.`);
        const id = uuid(), now = new Date().toISOString();
        const props = {};
        for (const [name, schema] of Object.entries(db.properties)) props[name] = body.properties[name] ? readValue(schema, body.properties[name]) : emptyValue(schema);
        pages[id] = { object: 'page', id, archived: false, parent: { type: 'database_id', database_id: db.id }, properties: props,
                      created_time: now, last_edited_time: now, url: `https://www.notion.so/${id.replace(/-/g, '')}` };
        return send(res, 200, pages[id]);
      }
      if ((x = p.match(/^\/v1\/pages\/([\w-]+)$/))) {
        const pg = pages[dash(x[1])];
        if (!pg) return err(res, 404, 'object_not_found', 'Could not find page');
        if (m === 'GET') return send(res, 200, pg);
        if (m === 'PATCH') {
          const db = dbs[pg.parent.database_id];
          for (const [name, v] of Object.entries(body.properties || {})) {
            if (!db.properties[name]) return err(res, 400, 'validation_error', `${name} is not a property that exists.`);
            pg.properties[name] = readValue(db.properties[name], v);
          }
          if (typeof body.archived === 'boolean') pg.archived = body.archived;
          pg.last_edited_time = new Date(Date.now() + 1).toISOString();
          return send(res, 200, pg);
        }
      }
      err(res, 404, 'object_not_found', `No ${m} ${p}`);
    });
  });
  const readDb = db => ({ object: 'database', id: db.id, title: db.title, archived: false, parent: db.parent, properties: db.properties,
                          created_time: db.created_time, last_edited_time: db.created_time, url: `https://www.notion.so/${db.id.replace(/-/g, '')}` });
  return new Promise(r => server.listen(port, () => r({ server, log, dbs, pages })));
}

module.exports = { start, TOKEN, PARENT_PAGE };
if (require.main === module) start(Number(process.env.PORT || 4999)).then(() => console.log('mock notion up'));

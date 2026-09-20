/*
 * Notion relay — the one piece of server this app has, and it holds nothing.
 *
 * Notion's API sends no CORS headers, so a browser cannot call it directly.
 * This function forwards the request and the reply, byte for byte, and keeps
 * nothing: the token arrives in the caller's Authorization header, goes
 * straight to Notion, and is never logged or stored. There is no state, no
 * database, no environment secret.
 *
 *   /api/notion/users/me            →  https://api.notion.com/v1/users/me
 *   /api/notion/databases/:id/query →  …/v1/databases/:id/query
 *
 * Deployed by Vercel as a Node function (this file's [...path] name is its
 * catch-all route). dev-server.js mounts the same handler locally, so what
 * runs on a laptop is what runs in production.
 */
'use strict';

const UPSTREAM = process.env.NOTION_UPSTREAM || 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';   // databases/:id/query still lives here

/* Only what the app needs. A relay that forwards anything is a relay for
   anyone; this one is a relay for this app. */
const ALLOW = [
  [/^GET$/,   /^users\/me$/],
  [/^POST$/,  /^search$/],
  [/^POST$/,  /^databases$/],
  [/^GET$/,   /^databases\/[\w-]+$/],
  [/^PATCH$/, /^databases\/[\w-]+$/],
  [/^POST$/,  /^databases\/[\w-]+\/query$/],
  [/^POST$/,  /^pages$/],
  [/^GET$/,   /^pages\/[\w-]+$/],
  [/^PATCH$/, /^pages\/[\w-]+$/],
];

const readBody = req => new Promise((resolve, reject) => {
  /* Vercel parses a JSON body before the handler runs; a plain Node server
     hands over the raw stream. Accept either. */
  if (req.body !== undefined) {
    return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  let data = '';
  req.on('data', c => { data += c; if (data.length > 1e6) reject(new Error('Body too large')); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const reply = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

module.exports = async function handler(req, res) {
  const url   = new URL(req.url, 'http://lens.local');
  const path  = url.pathname.replace(/^\/api\/notion\/?/, '').replace(/\/+$/, '');
  const method = (req.method || 'GET').toUpperCase();

  if (!ALLOW.some(([m, p]) => m.test(method) && p.test(path))) {
    return reply(res, 404, { object: 'error', status: 404, code: 'lens_relay',
      message: `This relay does not forward ${method} /${path}.` });
  }

  const auth = req.headers.authorization || '';
  if (!/^Bearer \S+$/.test(auth)) {
    return reply(res, 401, { object: 'error', status: 401, code: 'lens_relay',
      message: 'Send the Notion token as "Authorization: Bearer …". Nothing is stored here.' });
  }

  let body;
  try { body = method === 'GET' ? undefined : await readBody(req); }
  catch (e) { return reply(res, 413, { object: 'error', status: 413, code: 'lens_relay', message: e.message }); }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${path}${url.search}`, {
      method,
      headers: {
        Authorization: auth,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    });
  } catch (e) {
    return reply(res, 502, { object: 'error', status: 502, code: 'lens_relay',
      message: `Could not reach Notion: ${e.message}` });
  }

  const text = await upstream.text();
  /* Pass rate-limit guidance through so the page can say "wait a moment"
     with a real number rather than a guess. */
  const retry = upstream.headers.get('retry-after');
  if (retry) res.setHeader('Retry-After', retry);
  reply(res, upstream.status, text || '{}');
};

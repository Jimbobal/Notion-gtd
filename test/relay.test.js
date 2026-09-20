/* Relay behaviour: allowlist, auth, version header, body and status passthrough.
   node test/relay.test.js */
'use strict';
const assert = require('assert');
const http = require('http');
const mock = require('./mock-notion.js');

(async () => {
  const { log } = await mock.start(4998);
  process.env.NOTION_UPSTREAM = 'http://127.0.0.1:4998/v1';
  const relay = require('../api/notion/[...path].js');
  const srv = http.createServer(relay);
  await new Promise(r => srv.listen(4997, r));
  const R = 'http://127.0.0.1:4997/api/notion';
  const auth = { Authorization: `Bearer ${mock.TOKEN}`, 'Content-Type': 'application/json' };

  let r = await fetch(`${R}/users/me`);
  assert.equal(r.status, 401, 'no token → 401 from the relay itself');
  assert.equal(log.length, 0, 'nothing reached upstream without a token');

  for (const [method, path] of [['GET', 'blocks/abc'], ['DELETE', 'pages/abc'], ['GET', 'users'], ['POST', 'databases/abc']]) {
    r = await fetch(`${R}/${path}`, { method, headers: auth });
    assert.equal(r.status, 404, `${method} ${path} is refused`);
  }
  assert.equal(log.length, 0, 'refused calls never reach upstream');

  r = await fetch(`${R}/users/me`, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).bot.workspace_name, 'James Garner Command Centre');
  assert.equal(log[0].headers['notion-version'], '2022-06-28', 'version header added');
  assert.equal(log[0].headers.authorization, `Bearer ${mock.TOKEN}`, 'token forwarded untouched');
  assert.equal(r.headers.get('cache-control'), 'no-store');

  r = await fetch(`${R}/databases`, { method: 'POST', headers: auth, body: JSON.stringify({
    parent: { type: 'page_id', page_id: mock.PARENT_PAGE }, title: [{ type: 'text', text: { content: 'T' } }], properties: { Name: { title: {} } } }) });
  assert.equal(r.status, 200, 'database create passes through');
  const db = await r.json();
  assert.deepEqual(log.at(-1).body.properties, { Name: { title: {} } }, 'JSON body forwarded');

  r = await fetch(`${R}/databases/${db.id.replace(/-/g, '')}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ properties: { X: { number: {} } } }) });
  assert.equal(r.status, 200);
  r = await fetch(`${R}/pages`, { method: 'POST', headers: auth, body: JSON.stringify({ parent: { database_id: db.id }, properties: { Name: { title: [{ text: { content: 'hi' } }] } } }) });
  const page = await r.json();
  assert.equal(page.properties.Name.title[0].plain_text, 'hi');
  r = await fetch(`${R}/pages/${page.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ archived: true }) });
  assert.equal((await r.json()).archived, true);

  r = await fetch(`${R}/users/me`, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(r.status, 401, 'upstream status passes through');
  assert.equal((await r.json()).message, 'API token is invalid.');

  console.log('relay tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

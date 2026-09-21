#!/usr/bin/env node
/*
 * Local server: the static files plus the Notion relay from api/, so the app
 * works on a laptop exactly as it does on Vercel.
 *
 *   node dev-server.js            → http://localhost:4180
 *   PORT=5000 node dev-server.js
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const relay = require('./api/notion/[...path].js');
const ROOT  = __dirname;
const PORT  = Number(process.env.PORT || 4180);

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon',
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/notion')) return relay(req, res);

  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.statusCode = 403; return res.end('Forbidden'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
}).listen(PORT, () => console.log(`GTD → http://localhost:${PORT}  (Notion relay at /api/notion)`));

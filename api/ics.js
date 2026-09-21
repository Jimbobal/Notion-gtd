/*
 * Calendar feed relay. Google, Outlook and iCloud all publish a calendar as a
 * private .ics address, but none of them send CORS headers, so a browser
 * cannot read one directly. This fetches the feed and hands the text back.
 * It keeps nothing: the address arrives in the query string, the text goes
 * straight back, and nothing is logged.
 *
 *   /api/ics?url=https://calendar.google.com/calendar/ical/…/basic.ics
 */
'use strict';

const MAX_BYTES = 4 * 1024 * 1024;
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|fc|fd)/i;

const reply = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

module.exports = async function handler(req, res) {
  if ((req.method || 'GET').toUpperCase() !== 'GET') return reply(res, 405, { message: 'GET only.' });
  const url = new URL(req.url, 'http://gtd.local');
  const target = url.searchParams.get('url') || '';
  let t;
  try { t = new URL(target.replace(/^webcal:/i, 'https:')); } catch { return reply(res, 400, { message: 'Not a valid address.' }); }
  const allowHttp = process.env.ICS_ALLOW_HTTP === '1';
  if (t.protocol !== 'https:' && !(allowHttp && t.protocol === 'http:'))
    return reply(res, 400, { message: 'Only https calendar addresses are fetched.' });
  if (!allowHttp && PRIVATE.test(t.hostname)) return reply(res, 400, { message: 'That address is not reachable from here.' });

  let upstream;
  try {
    upstream = await fetch(t.href, { headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' }, redirect: 'follow',
                                     signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return reply(res, 502, { message: `Could not fetch the calendar: ${e.message}` });
  }
  if (!upstream.ok) return reply(res, 502, { message: `The calendar server answered ${upstream.status}.` });
  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return reply(res, 413, { message: 'That calendar is too large to read.' });
  const text = await upstream.text();
  if (text.length > MAX_BYTES) return reply(res, 413, { message: 'That calendar is too large to read.' });
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return reply(res, 422, { message: 'That address did not return a calendar (.ics).' });
  reply(res, 200, text, 'text/calendar; charset=utf-8');
};

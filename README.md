# GTD for Notion

Getting Things Done, the FacileThings way, with every record living in your
own Notion workspace. A single-page web app with no build step and no backend
of its own beyond a stateless relay.

## What it does

The FacileThings model, end to end:

| Screen | What it is |
|---|---|
| **Inbox** | Everything captured and not yet decided. `n` or ＋ captures from anywhere. |
| **Clarify** | The processing questions, one at a time: what is it, is it actionable, one step or a project, under two minutes, am I the right person, when. Every answer files the item; *Clarify all* walks the whole Inbox. |
| **Next Actions** | Engage: filter by context, energy and time; focus items first; the rest grouped by context. |
| **Calendar** | The hard landscape — calendar entries, deadlines on next actions, chase-by dates — as a rolling week, a month grid, and an agenda (overdue, today, tomorrow, this week, later). |
| **Waiting For** | Grouped by person, with a *Chase* section for anything past its date or older than two weeks. |
| **Projects** | Stalled projects (no next action) listed first, because that is what GTD exists to catch. A project page shows its outcome, every action by list, and completes with its open actions. |
| **Someday / Maybe**, **Tickler**, **Reference** | The three parking lists. Tickler items return to the Inbox on their day. |
| **Horizons** | Areas of responsibility, goals, vision, purpose. Goals hang off areas; projects hang off both. |
| **Habits** | Daily, weekday, weekly or monthly commitments, with streaks and a fortnight strip. |
| **Weekly Review** | Guided: get clear, get current, get creative. Each step opens the list it is about and shows what it found (Inbox count, stalled projects, things to chase). |
| **Perspectives** | Saved filters across every list, stored in Notion so they follow you between devices. |
| **Statistics** | System health tiles, completed-per-week, by-context breakdowns, habit rates. |
| **Trash** | Restore, or empty into Notion's own trash (recoverable there for 30 days). |
| **Settings** | The Notion connection, contexts and tags, theme, week start, review day. |

Items carry a status (which list), a context, tags, project, area, date, time,
energy, who you are waiting on, focus, repeat and notes. Repeating items spawn
their next occurrence when completed.

## Where the data lives

On first run the app creates six databases inside a Notion page you choose:

| Database | Holds |
|---|---|
| `GTD · Items` | every thing, with a `Status` select for which list it is on |
| `GTD · Projects` | outcomes, with relations to an area and a goal |
| `GTD · Horizons` | areas, goals, vision, purpose (a `Level` select, and a `Parent` self-relation) |
| `GTD · Habits` | the habits |
| `GTD · Habit Log` | one row per check-in |
| `GTD · Perspectives` | saved filters, as JSON in a text property |

They are ordinary Notion databases: edit in Notion and the app follows on the
next sync; add your own columns and the app ignores them. A second device
adopts the existing set rather than creating a new one. Contexts and tags are
the select options on the Items database, managed from Settings.

Sync is incremental (pages edited since the last sync) with a full pass on
demand and once an hour, because a page deleted in Notion is invisible to an
incremental query. A cache in localStorage means the app opens instantly and
keeps working through a flaky connection; writes are optimistic and roll back
on failure.

## The relay

Notion's API sends no CORS headers, so a browser cannot call it. The one piece
of server here is `api/notion/[...path].js`, a Vercel function that forwards a
request to `api.notion.com` and the reply back, byte for byte. It holds no
token, no database and no log: the token arrives in the caller's
`Authorization` header and goes straight through. It forwards only the
endpoints the app uses (`users/me`, `search`, `databases`, `databases/:id`,
`databases/:id/query`, `pages`, `pages/:id`) and refuses everything else.

## Setup

1. In Notion: *Settings → Connections → Develop or manage integrations → New
   integration* (internal). Give it read, update and insert capabilities and
   copy the secret.
2. Create or pick a page to hold the databases and share it with the
   integration (open the page → ••• → Connections).
3. Open the app, paste the secret, pick the page. The databases are created
   and verified, and you land in the Inbox.

The secret stays in that browser's localStorage. *Disconnect* in Settings
deletes it and the cache; nothing in Notion changes.

## Deploy

Push to a Vercel project with no framework preset. The static files are served
as they are and `api/notion/[...path].js` becomes the relay function. No
environment variables are needed.

## Development

```bash
node dev-server.js               # http://localhost:4180, relay included
bash test/run.sh                 # relay tests + browser end-to-end against a mock Notion
node test/check-imports.js       # every named import resolves
```

The end-to-end test needs Playwright's Chromium; point `NODE_PATH` at a
`node_modules` that has `playwright` (for example `$(npm root -g)`). The mock
in `test/mock-notion.js` implements enough of Notion — search, database
create/read/update/query, page create/read/update/archive — for the whole
setup and every screen to run without a real workspace; set
`NOTION_UPSTREAM` to point the relay at it.

## Layout

```
index.html, app.css          shell and styles (dark and light)
js/main.js                   routing, navigation, sync, event dispatch
js/store.js                  state, localStorage cache, preferences
js/notion.js                 relay client, schema, setup, sync, writes
js/model.js                  the GTD model: lists, projects, habits, review, stats
js/actions.js                every write, with toasts and rollback
js/ui.js                     rows, chips, sections, the sheet
js/views/*.js                one module per screen; the clarify wizard; item sheet
api/notion/[...path].js      the relay
dev-server.js                static files + relay, locally
test/                        mock Notion, relay tests, end-to-end, import check
```

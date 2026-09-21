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
| **Calendar** | The unified calendar: your own dated items (calendar entries, deadlines on next actions, chase-by dates) together with your Google and Outlook calendars. A **week grid** (seven days across, hours down) where you tap a block to open it, tap an empty slot to add an item or an event there, drag a block to move it and drag its edge to change its length; plus an agenda and a month grid. Events can be edited, deleted and created here, and turned into GTD items. |
| **Waiting For** | Grouped by person, with a *Chase* section for anything past its date or older than two weeks. |
| **Projects** | Stalled projects (no next action) listed first, because that is what GTD exists to catch. A project page shows its outcome, every action by list, and completes with its open actions. |
| **Someday / Maybe**, **Tickler**, **Reference** | The three parking lists. Tickler items return to the Inbox on their day. |
| **Horizons** | Areas of responsibility, goals, vision, purpose. Goals hang off areas; projects hang off both. |
| **Habits** | Daily, weekday, weekly or monthly commitments, with streaks and a fortnight strip. |
| **Weekly Review** | Guided and yours to edit: get clear, get current, get creative. Each step opens the screen it is about and shows what it found there (items to clarify, stalled projects, people to chase, quiet areas). Rename, reorder, regroup, add and remove steps in the app or in Notion. |
| **Perspectives** | Saved filters across every list, stored in Notion so they follow you between devices. |
| **Statistics** | System health tiles, completed-per-week, by-context breakdowns, habit rates. |
| **Trash** | Restore, or empty into Notion's own trash (recoverable there for 30 days). |
| **Integrations** | One card per service: Notion, Google Calendar & Drive, Outlook (Microsoft 365), the calendar mirror, Dropbox. |
| **Settings** | The Notion connection, contexts and tags, theme, week start, review day. |

Items carry a status (which list), a context, tags, project, area, date, time,
energy, who you are waiting on, focus, repeat, notes and attachments. Repeating
items spawn their next occurrence when completed.

## Where the data lives

On first run the app creates seven databases inside a Notion page you choose:

| Database | Holds |
|---|---|
| `GTD · Items` | every thing, with a `Status` select for which list it is on, `Attachments`, and the `Event ID` of its Google mirror |
| `GTD · Projects` | outcomes, with relations to an area and a goal, and `Attachments` |
| `GTD · Horizons` | areas, goals, vision, purpose (a `Level` select, and a `Parent` self-relation) |
| `GTD · Habits` | the habits |
| `GTD · Habit Log` | one row per check-in |
| `GTD · Perspectives` | saved filters, as JSON in a text property |
| `GTD · Weekly Review` | the review checklist: one row per step with its phase, order, guidance and the screen it opens |

They are ordinary Notion databases: edit in Notion and the app follows on the
next sync; add your own columns and the app ignores them. A column a newer
version of the app needs is added on the next start. A second device
adopts the existing set rather than creating a new one. Contexts and tags are
the select options on the Items database, managed from Settings.

Sync is incremental (pages edited since the last sync) with a full pass on
demand and once an hour, because a page deleted in Notion is invisible to an
incremental query. A cache in localStorage means the app opens instantly and
keeps working through a flaky connection; writes are optimistic and roll back
on failure.

## Google Calendar and Outlook, both ways

Connect Google and/or your Microsoft 365 account on the Integrations page.
Sign-in happens in the browser (Google Identity Services, MSAL); there is no
server and no client secret. Then:

- **See and edit.** Events from the calendars you tick appear in the Calendar
  beside your items, colour-coded per calendar. In the week grid, drag a
  block to another slot or day and it moves in Google or Outlook; drag its
  bottom edge to change its length. Tap one to change its title, day, times,
  location or notes, delete it, or make a GTD item from it. Tapping an empty
  slot creates an item or an event there, in any calendar you can write to.
- **Mirror your items.** Switch on the calendar mirror and pick one calendar,
  Google or Outlook: every item on your Calendar list becomes an event there,
  kept in step as the item changes and removed when it leaves the list. The
  event carries a link back to the Notion page. Events that came from Google
  or Outlook are updated in place and never deleted by the mirror.

Google is asked for `calendar.events`, `calendar.calendarlist.readonly`,
`drive.file` and your email. Microsoft is asked for `User.Read` and
`Calendars.ReadWrite`; a work tenant may need an administrator to grant
consent to the app registration before the first sign-in succeeds.

## Attachments: Google Drive, Dropbox, any link

Any item or project can carry attachments: pick files with the Google Drive
picker or the Dropbox chooser, or paste a link (a Notion page, say). The app
only ever receives a name and a link, stored on the Notion page as an
external file, so they show in Notion too.

## Not Google?

The Calendar can export every dated item as one `.ics` file for import into
any other calendar. That is the only non-Google calendar path; there are no
subscription links.

## Credentials you create once

| Service | What | Where |
|---|---|---|
| Google | an OAuth client ID (Web application, authorised origin = the app's address) and an API key for the Drive picker; enable the Calendar, Drive and Picker APIs | Google Cloud Console |
| Microsoft | an app registration (single-page application, redirect URI = the app's address) with delegated `User.Read` and `Calendars.ReadWrite`; its client ID and tenant ID | Microsoft Entra admin centre |
| Dropbox | an app key, with the app's domain added under Chooser domains | Dropbox App Console |

The Integrations page shows the exact steps and the origin to paste. Both are
public identifiers, stored on the device with the rest of the config.

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
node dev-server.js               # http://localhost:4180, relays included
bash test/run.sh                 # relay and import checks, then the browser end-to-end
```

The end-to-end test needs Playwright's Chromium; point `NODE_PATH` at a
`node_modules` that has `playwright` (for example `$(npm root -g)`). The mock
in `test/mock-notion.js` implements enough of Notion — search, database
create/read/update/query, page create/read/update/archive — for the whole
setup and every screen to run without a real workspace; `test/google-mock.js`
stands in for Google and Microsoft sign-in, the Calendar and Graph APIs, the
Drive picker and the Dropbox chooser inside the browser. Set `NOTION_UPSTREAM` to point the relay
at the mock.

## Layout

```
index.html, app.css          shell and styles (dark and light)
js/main.js                   routing, navigation, sync, event dispatch
js/store.js                  state, localStorage cache, preferences
js/notion.js                 relay client, schema, setup, sync, writes
js/model.js                  the GTD model: lists, projects, habits, review, stats
js/actions.js                every write, with toasts and rollback
js/ui.js                     rows, chips, sections, the sheet
js/views/*.js                one module per screen; the clarify wizard; item sheet; the week grid
js/google.js, js/gcal.js     Google sign-in; Google Calendar read and write
js/microsoft.js, js/mscal.js Microsoft sign-in; Outlook calendar read and write
js/calendars.js              both providers behind one interface; the mirror
js/files.js                  Drive picker, Dropbox chooser, links
js/ics.js                    .ics export
api/notion/[...path].js      the Notion relay
dev-server.js                static files + relay, locally
test/                        mock Notion, Google/Microsoft/Dropbox stubs, relay tests, end-to-end
```

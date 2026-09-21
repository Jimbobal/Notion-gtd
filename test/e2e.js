/* End to end in Chromium: dev-server.js on 4180 with the Notion mock as its
   upstream on 4999. Walks first-run setup and every screen.
     PORT=4999 node test/mock-notion.js &
     NOTION_UPSTREAM=http://127.0.0.1:4999/v1 PORT=4180 node dev-server.js &
     NODE_PATH=$(npm root -g) node test/e2e.js */
'use strict';
const assert = require('assert');
const { chromium } = require('playwright');
const mock = require('./mock-notion.js');
const gmock = require('./google-mock.js');

const APP = 'http://localhost:4180';
const SHOTS = __dirname + '/shots';
const M = 'http://127.0.0.1:4999';
const mockState = async () => (await fetch(`${M}/__state`)).json();
const mockLog = async () => (await fetch(`${M}/__log`)).json();
const resetLog = () => fetch(`${M}/__reset`);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m-1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/401|404|400 \(/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const G = await gmock.install(page);
  const toastIs = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: 8000 });
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(150); };
  const textOf = sel => page.textContent(sel);

  /* ── 1. First run ─────────────────────────────────────────── */
  await page.goto(APP + '/');
  await page.waitForSelector('#setup-token');
  await page.screenshot({ path: `${SHOTS}/01-setup.png`, fullPage: true });
  await page.fill('#setup-token input[name=token]', 'ntn_wrong');
  await page.click('#setup-token button[type=submit]');
  await page.waitForSelector('#setup .err');
  assert.match(await textOf('#setup .err'), /401/);
  await page.fill('#setup-token input[name=token]', mock.TOKEN);
  await page.click('#setup-token button[type=submit]');
  await page.waitForSelector('#setup-parent');
  assert.match(await textOf('#setup-parent'), /GTD Home/);
  await page.screenshot({ path: `${SHOTS}/02-setup-parent.png`, fullPage: true });
  await page.click('#setup-parent button[type=submit]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => /synced/.test(document.querySelector('#sync-line')?.textContent || ''));
  let st = await mockState();
  const titles = Object.values(st.dbs).map(d => d.title[0].text.content).sort();
  assert.deepEqual(titles, ['GTD · Habit Log','GTD · Habits','GTD · Horizons','GTD · Items','GTD · Perspectives','GTD · Projects']);
  const hz = Object.values(st.dbs).find(d => d.title[0].text.content === 'GTD · Horizons');
  assert.equal(hz.properties.Parent.type, 'relation', 'self-relation added after creation');
  const itemsDb = Object.values(st.dbs).find(d => d.title[0].text.content === 'GTD · Items');
  assert.equal(itemsDb.properties.Project.relation.database_id.replace(/-/g, ''), Object.values(st.dbs).find(d => d.title[0].text.content === 'GTD · Projects').id.replace(/-/g, ''));
  assert.match(await textOf('#view'), /Inbox zero/);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('gtd.cfg')));
  assert.equal(cfg.parentTitle, 'GTD Home');
  assert.equal(Object.keys(cfg.dbs).length, 6);

  /* ── 2. Capture ───────────────────────────────────────────── */
  const capture = async (name, notes = '') => {
    await page.click('#btn-add');
    await page.fill('#capture-form input[name=name]', name);
    if (notes) await page.fill('#capture-form textarea[name=notes]', notes);
    await page.click('#capture-form button[type=submit]:not([data-clarify])');
    await toastIs(/Captured/);
  };
  await capture('Call the dentist', 'about the crown');
  await capture('Plan the garden');
  await capture('Buy milk');
  await capture('Read the paper');
  await page.waitForFunction(() => document.querySelectorAll('#view .item').length === 4);
  assert.match(await textOf('#sidebar'), /Inbox4/);
  await page.screenshot({ path: `${SHOTS}/03-inbox.png`, fullPage: true });

  /* Keyboard capture, then cancel with Escape */
  await page.keyboard.press('n');
  await page.waitForSelector('#capture-form');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('sheet').hidden);

  /* ── 3. Clarify the whole inbox ───────────────────────────── */
  await page.click('[data-act=clarify-all]');
  await page.waitForSelector('#wiz-what');
  assert.equal(await page.inputValue('#wiz-what input[name=name]'), 'Call the dentist');
  await page.click('#wiz-what button[type=submit]');
  await page.click('[data-act=wiz-yes]');
  await page.click('[data-act=wiz-single]');
  await page.click('[data-act=wiz-longer]');
  await page.click('[data-act=wiz-me]');
  await page.waitForSelector('#wiz-next');
  await page.selectOption('#wiz-next select[name=context]', '@Call');
  await page.selectOption('#wiz-next select[name=energy]', 'Low');
  await page.fill('#wiz-next input[name=time_mins]', '10');
  await page.click('#wiz-next button[type=submit]');
  await toastIs(/Next action/);
  /* queue moves on: Plan the garden → project */
  await page.waitForFunction(() => document.querySelector('#wiz-what input[name=name]')?.value === 'Plan the garden');
  await page.click('#wiz-what button[type=submit]');
  await page.click('[data-act=wiz-yes]');
  await page.click('[data-act=wiz-project]');
  await page.waitForSelector('#wiz-project');
  await page.fill('#wiz-project input[name=pname]', 'Garden overhaul');
  await page.fill('#wiz-project textarea[name=outcome]', 'Beds planted, lawn gone');
  await page.fill('#wiz-project input[name=name]', 'Sketch the beds');
  await page.click('#wiz-project button[type=submit]');
  await toastIs(/Project created/);
  await page.waitForSelector('[data-act=wiz-longer]');
  await page.click('[data-act=wiz-longer]');
  await page.click('[data-act=wiz-me]');
  await page.waitForSelector('#wiz-next');
  assert.ok(!(await page.$('#wiz-next select[name=projectId]')), 'project already chosen, no project field');
  await page.selectOption('#wiz-next select[name=context]', '@Home');
  await page.click('#wiz-next button[type=submit]');
  await toastIs(/Next action/);
  /* Buy milk → two minutes → done */
  await page.waitForFunction(() => document.querySelector('#wiz-what input[name=name]')?.value === 'Buy milk');
  await page.click('#wiz-what button[type=submit]');
  await page.click('[data-act=wiz-yes]');
  await page.click('[data-act=wiz-single]');
  await page.click('[data-act=wiz-donow]');
  await toastIs(/Done/);
  /* Read the paper → not actionable → reference */
  await page.waitForFunction(() => document.querySelector('#wiz-what input[name=name]')?.value === 'Read the paper');
  await page.click('#wiz-what button[type=submit]');
  await page.click('[data-act=wiz-no]');
  await page.waitForSelector('[data-act=wiz-reference]');
  await page.screenshot({ path: `${SHOTS}/04-clarify.png` });
  await page.click('[data-act=wiz-reference]');
  await toastIs(/Inbox zero/);
  await page.waitForFunction(() => /Inbox zero/.test(document.querySelector('#view')?.textContent || ''));

  st = await mockState();
  const itemPages = Object.values(st.pages).filter(p => p.parent.database_id === itemsDb.id);
  const byName = n => itemPages.find(p => p.properties.Name.title[0].plain_text === n);
  assert.equal(byName('Call the dentist').properties.Status.select.name, 'Next');
  assert.equal(byName('Call the dentist').properties.Context.select.name, '@Call');
  assert.equal(byName('Call the dentist').properties.Time.number, 10);
  assert.equal(byName('Call the dentist').properties.Energy.select.name, 'Low');
  assert.equal(byName('Call the dentist').properties.Notes.rich_text[0].plain_text, 'about the crown');
  assert.ok(!byName('Plan the garden'), 'the inbox item became the project’s first next action');
  assert.equal(byName('Sketch the beds').properties.Status.select.name, 'Next');
  assert.equal(byName('Sketch the beds').properties.Context.select.name, '@Home');
  assert.equal(byName('Buy milk').properties.Status.select.name, 'Done');
  assert.ok(byName('Buy milk').properties.Completed.date.start);
  assert.equal(byName('Read the paper').properties.Status.select.name, 'Reference');
  const projPage = Object.values(st.pages).find(p => p.properties['Project Name'] === undefined && p.properties.Outcome);
  assert.equal(projPage.properties.Name.title[0].plain_text, 'Garden overhaul');
  assert.equal(byName('Sketch the beds').properties.Project.relation[0].id, projPage.id);

  /* ── 4. Next actions, filters ─────────────────────────────── */
  await go('#/next');
  await page.waitForFunction(() => document.querySelectorAll('#view .item').length === 2);
  assert.match(await textOf('#view'), /@Call/);
  await page.click('[data-act=eng-ctx][data-v="@Call"]');
  await page.waitForFunction(() => document.querySelectorAll('#view .item').length === 1);
  await page.click('[data-act=eng-ctx][data-v=""]');
  await page.click('[data-act=eng-time][data-v="15"]');
  await page.waitForFunction(() => document.querySelectorAll('#view .item').length === 2, null, { timeout: 3000 }).catch(() => {});
  await page.click('[data-act=eng-time][data-v=""]');
  await page.screenshot({ path: `${SHOTS}/05-next.png`, fullPage: true });

  /* Focus, and done from the row tick */
  await page.click('#view .item:has-text("Call the dentist")');
  await page.waitForSelector('#sheet:not([hidden])');
  await page.click('[data-act=item-focus]');
  await toastIs(/In focus/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /Focus/.test(document.querySelector('#view')?.textContent || ''));

  /* Edit into a Waiting For */
  await page.click('#view .item:has-text("Call the dentist")');
  await page.click('[data-act=item-edit]');
  await page.waitForSelector('#item-form');
  await page.selectOption('#item-form select[name=status]', 'Waiting');
  await page.fill('#item-form input[name=waitingOn]', 'Dr Patel');
  await page.fill('#item-form input[name=day]', addDays(todayISO(), -20));
  await page.fill('#item-form input[name=tags]', 'health, admin');
  await page.click('#item-form button[type=submit]');
  await toastIs(/Saved/);
  await go('#/waiting');
  await page.waitForFunction(() => /Dr Patel/.test(document.querySelector('#view')?.textContent || ''));
  assert.match(await textOf('#view'), /Chase/);
  st = await mockState();
  assert.deepEqual(Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Call the dentist').properties.Tags.multi_select.map(t => t.name), ['health', 'admin']);

  /* ── 5. Calendar ──────────────────────────────────────────── */
  await go('#/calendar');
  await page.waitForSelector('.week-strip');
  await page.click(`[data-act=cal-day][data-v="${addDays(todayISO(), 1)}"]`);
  await page.click('[data-act=cal-add]');
  await page.waitForSelector('#item-form');
  assert.equal(await page.inputValue('#item-form select[name=status]'), 'Calendar');
  assert.equal(await page.inputValue('#item-form input[name=day]'), addDays(todayISO(), 1));
  await page.fill('#item-form input[name=name]', 'Dentist appointment');
  await page.fill('#item-form input[name=time]', '09:30');
  await page.click('#item-form button[type=submit]');
  await toastIs(/Added to Calendar/);
  await page.waitForFunction(() => /Dentist appointment/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('[data-act=cal-clear]');
  await page.waitForFunction(() => /Tomorrow/.test(document.querySelector('#view')?.textContent || ''));
  st = await mockState();
  const appt = Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Dentist appointment');
  assert.match(appt.properties.Date.date.start, /^\d{4}-\d{2}-\d{2}T09:30:00[+-]\d{2}:\d{2}$/, 'time carries the local offset');
  await page.click('[data-act=cal-month][data-v="0"]');
  await page.waitForSelector('.month');
  await page.screenshot({ path: `${SHOTS}/06-calendar.png`, fullPage: true });
  await page.click('[data-act=cal-week]');

  /* ── 6. Tickler comes back on its day ─────────────────────── */
  await go('#/tickler');
  await page.click('[data-act=add-tickler]');
  await page.waitForSelector('#item-form');
  await page.fill('#item-form input[name=name]', 'Renew passport');
  await page.fill('#item-form input[name=day]', todayISO());
  await page.click('#item-form button[type=submit]');
  await toastIs(/Added to Tickler/);
  await page.click('#btn-sync');
  await toastIs(/tickler item.*back in the Inbox/);
  await go('#/inbox');
  await page.waitForFunction(() => /Renew passport/.test(document.querySelector('#view')?.textContent || ''));
  /* park it as someday from the sheet */
  await page.click('#view .item:has-text("Renew passport")');
  await page.click('[data-act=item-move][data-v=Someday]');
  await toastIs(/Someday/);

  /* ── 7. Projects ──────────────────────────────────────────── */
  await go('#/projects');
  await page.waitForFunction(() => /Garden overhaul/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('#view a.card:has-text("Garden overhaul")');
  await page.waitForFunction(() => /Beds planted/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('[data-act=proj-add-action]');
  await page.waitForSelector('#item-form');
  await page.fill('#item-form input[name=name]', 'Order compost');
  await page.selectOption('#item-form select[name=context]', '@Errands-Online');
  await page.click('#item-form button[type=submit]');
  await toastIs(/Added to Next/);
  await page.waitForFunction(() => document.querySelectorAll('#view .item').length === 2);
  await page.screenshot({ path: `${SHOTS}/07-project.png`, fullPage: true });
  /* a project with its next actions is "moving" */
  await go('#/projects');
  await page.waitForSelector('#view .card');
  assert.match(await textOf('#view'), /Moving/);
  /* new project via form, stalled */
  await page.click('[data-act=proj-new]');
  await page.fill('#project-form input[name=name]', 'Learn the cello');
  await page.click('#project-form button[type=submit]');
  await toastIs(/Project created/);
  await page.waitForFunction(() => location.hash.startsWith('#/projects/'));
  await go('#/projects');
  await page.waitForFunction(() => /Needs a next action/.test(document.querySelector('#view')?.textContent || ''));
  assert.match(await textOf('#sidebar'), /Projects1/, 'stalled count in the sidebar');
  /* complete the garden project: closes its open actions */
  await page.click('#view a.card:has-text("Garden overhaul")');
  await page.waitForSelector('[data-act=proj-complete]');
  await page.click('[data-act=proj-complete]');
  await toastIs(/Project done/);
  st = await mockState();
  assert.equal(Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Order compost').properties.Status.select.name, 'Done');

  /* ── 8. Horizons ──────────────────────────────────────────── */
  await go('#/horizons');
  await page.click('[data-act=hz-new]');
  await page.fill('#horizon-form input[name=name]', 'Health');
  await page.fill('#horizon-form textarea[name=notes]', 'Sleep, food, movement');
  await page.click('#horizon-form button[type=submit]');
  await toastIs(/Added/);
  await page.waitForFunction(() => /Health/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('#view .card:has-text("Health")');
  await page.click('[data-act=hz-add-goal]');
  await page.waitForSelector('#horizon-form');
  assert.equal(await page.inputValue('#horizon-form select[name=level]'), 'Goal');
  await page.fill('#horizon-form input[name=name]', 'Run 10k by spring');
  await page.click('#horizon-form button[type=submit]');
  await toastIs(/Added/);
  await page.waitForFunction(() => /Run 10k/.test(document.querySelector('#view')?.textContent || ''));
  assert.match(await textOf('#view'), /in Health/);
  await page.screenshot({ path: `${SHOTS}/08-horizons.png`, fullPage: true });

  /* ── 9. Habits ────────────────────────────────────────────── */
  await go('#/habits');
  await page.click('[data-act=habit-new]');
  await page.fill('#habit-form input[name=name]', 'Meditate');
  await page.click('#habit-form button[type=submit]');
  await toastIs(/Habit added/);
  await page.waitForSelector('[data-act=habit-tick]');
  await page.click('[data-act=habit-tick]');
  await toastIs(/Meditate ✓/);
  await page.waitForFunction(() => document.querySelector('[data-act=habit-tick]')?.classList.contains('done'));
  assert.match(await textOf('#view'), /🔥 1/);
  st = await mockState();
  assert.equal(Object.values(st.pages).filter(p => p.properties.Habit && !p.archived).length, 1, 'one log row');
  await page.click('[data-act=habit-tick]');
  await toastIs(/Unticked/);
  st = await mockState();
  assert.equal(Object.values(st.pages).filter(p => p.properties.Habit && !p.archived).length, 0, 'log row archived');
  await page.click('[data-act=habit-tick]');
  await toastIs(/Meditate ✓/);
  await page.screenshot({ path: `${SHOTS}/09-habits.png`, fullPage: true });

  /* ── 10. Weekly review ────────────────────────────────────── */
  await go('#/review');
  await page.waitForSelector('.review-step');
  assert.match(await textOf('#view'), /No review recorded/);
  const n = await page.$$eval('[data-act=rev-toggle]', els => els.length);
  for (let k = 0; k < n; k++) { await page.click('.review-step:not(.is-done) [data-act=rev-toggle]'); await page.waitForTimeout(40); }
  await page.waitForSelector('[data-act=rev-complete]:not([disabled])');
  await page.screenshot({ path: `${SHOTS}/10-review.png`, fullPage: true });
  await page.click('[data-act=rev-complete]');
  await toastIs(/review complete/);
  assert.match(await textOf('#view'), /Last review Today/);

  /* ── 11. Perspectives ─────────────────────────────────────── */
  await go('#/perspectives');
  await page.click('[data-act=persp-new]');
  await page.fill('#persp-form input[name=name]', 'Waiting on people');
  await page.click('#persp-form label.pill:has-text("Waiting For")');
  await page.click('#persp-form button[type=submit]');
  await toastIs(/Perspective saved/);
  await page.waitForFunction(() => location.hash.startsWith('#/perspectives/'));
  await page.waitForFunction(() => /Dr Patel/.test(document.querySelector('#view')?.textContent || ''));
  assert.match(await textOf('#sidebar'), /Waiting on people/);

  /* ── 12. Statistics ───────────────────────────────────────── */
  await go('#/stats');
  await page.waitForSelector('svg.chart');
  assert.match(await textOf('#view'), /Completed per week/);
  await page.screenshot({ path: `${SHOTS}/11-stats.png`, fullPage: true });

  /* ── 13. Trash ────────────────────────────────────────────── */
  await go('#/reference');
  await page.click('#view .item:has-text("Read the paper")');
  await page.click('[data-act=item-trash]');
  await toastIs(/Trash/);
  await go('#/trash');
  await page.waitForFunction(() => /Read the paper/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('#view .item:has-text("Read the paper")');
  await page.click('[data-act=item-restore]');
  await toastIs(/Restored/);
  await go('#/inbox');
  await page.waitForFunction(() => /Read the paper/.test(document.querySelector('#view')?.textContent || ''));
  await page.click('#view .item:has-text("Read the paper")');
  await page.click('[data-act=item-trash]');
  await toastIs(/Trash/);
  await go('#/trash');
  await page.click('[data-act=trash-empty]');
  await toastIs(/Trash emptied/);
  st = await mockState();
  assert.equal(Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Read the paper').archived, true);

  /* ── 14. Settings: contexts ───────────────────────────────── */
  await go('#/settings');
  await page.waitForSelector('#ctx-add-form');
  await page.fill('input[data-act-change=ctx-rename][value="@Call"]', '@Phone');
  await page.dispatchEvent('input[data-act-change=ctx-rename][value="@Call"]', 'change');
  await toastIs(/Renamed to @Phone/);
  st = await mockState();
  assert.equal(Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Call the dentist').properties.Context.select.name, '@Phone', 'rename keeps values');
  await page.fill('#ctx-add-form input[name=name]', '@Garden');
  await page.click('#ctx-add-form button[type=submit]');
  await toastIs(/@Garden added/);
  await page.click('[data-act=pref-theme][data-v=light]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.screenshot({ path: `${SHOTS}/12-settings-light.png`, fullPage: true });
  await page.click('[data-act=pref-theme][data-v=auto]');

  /* ── 14c. Integrations: Google Calendar, Drive, Dropbox ───── */
  await go('#/integrations');
  await page.waitForSelector('#google-form');
  assert.match(await textOf('#svc-notion'), /Connected/);
  await page.fill('#google-form input[name=clientId]', 'client-123');
  await page.fill('#google-form input[name=apiKey]', 'AIzaTest');
  await page.click('#google-form button[type=submit]');
  await page.waitForSelector('[data-act=g-connect]');
  await page.click('[data-act=g-connect]');
  await toastIs(/Google connected/);
  await page.waitForFunction(() => /james@example\.com/.test(document.querySelector('#svc-google')?.textContent || ''));
  const gtext = await textOf('#svc-google');
  assert.match(gtext, /James/); assert.match(gtext, /Holidays/); assert.match(gtext, /read only/);
  assert.equal(await page.evaluate(() => window.__gisPrompt), 'consent', 'first sign-in asks for consent');
  /* mirror items into the primary calendar */
  await page.selectOption('select[data-act-change=g-write]', 'james@example.com');
  await page.waitForSelector('input[data-act-change=g-sync]:not([disabled])');
  await page.check('input[data-act-change=g-sync]');
  await toastIs(/mirrored/);
  const mirrored = G.events['james@example.com'].find(e => e.summary === 'Dentist appointment');
  assert.ok(mirrored, 'the Calendar item was mirrored to Google');
  assert.ok(mirrored.start.dateTime && /T09:30/.test(mirrored.start.dateTime), 'with its time');
  st = await mockState();
  const dentistAppt = Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Dentist appointment');
  assert.equal(dentistAppt.properties['Event ID'].rich_text[0].plain_text, `james@example.com/${mirrored.id}`);
  assert.equal(mirrored.extendedProperties.private.gtdItem, dentistAppt.id.replace(/-/g, ''));
  /* dropbox */
  await page.fill('#dropbox-form input[name=appKey]', 'dbx-key');
  await page.click('#dropbox-form button[type=submit]');
  await toastIs(/Dropbox ready/);
  await page.waitForFunction(() => /Connected/.test(document.querySelector('#svc-dropbox .status')?.textContent || ''));
  await page.screenshot({ path: `${SHOTS}/16-integrations.png`, fullPage: true });

  /* ── 14d. Google events in the calendar, both ways ────────── */
  await go('#/calendar');
  await page.waitForFunction(() => /Standup \(Google\)/.test(document.querySelector('#view')?.textContent || ''));
  assert.match(await textOf('.feed-legend'), /James/);
  assert.match(await textOf('#view'), /Bank holiday/);
  assert.equal(await page.$$eval('.event', els => els.filter(e => /Dentist appointment/.test(e.textContent)).length), 0, 'a mirrored item is not shown twice');
  /* edit a Google event */
  await page.click('.event:has-text("Standup (Google)")');
  await page.waitForSelector('#gevent-form');
  await page.fill('#gevent-form input[name=title]', 'Standup (moved)');
  await page.click('#gevent-form button[type=submit]');
  await toastIs(/Event saved/);
  assert.equal(G.events['james@example.com'].find(e => e.id === 'ev_standup').summary, 'Standup (moved)');
  await page.waitForFunction(() => /Standup \(moved\)/.test(document.querySelector('#view')?.textContent || ''));
  /* create a Google event */
  await page.click('[data-act=cal-add-google]');
  await page.waitForSelector('#gevent-form');
  await page.fill('#gevent-form input[name=title]', 'Lunch with Sam');
  await page.uncheck('#gevent-form input[name=allDay]');
  await page.fill('#gevent-form input[name=time]', '12:30');
  await page.fill('#gevent-form input[name=endTime]', '13:15');
  await page.click('#gevent-form button[type=submit]');
  await toastIs(/Event created/);
  const lunch = G.events['james@example.com'].find(e => e.summary === 'Lunch with Sam');
  assert.ok(lunch && /T12:30:00$/.test(lunch.start.dateTime) && /T13:15:00$/.test(lunch.end.dateTime), 'timed event created');
  await page.waitForFunction(() => /Lunch with Sam/.test(document.querySelector('#view')?.textContent || ''));
  await page.screenshot({ path: `${SHOTS}/17-calendar-google.png`, fullPage: true });
  /* export the app's own items as .ics */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=cal-export]')]);
  assert.equal(dl.suggestedFilename(), 'gtd-calendar.ics');
  const icsText = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.match(icsText, /BEGIN:VCALENDAR/); assert.match(icsText, /SUMMARY:Dentist appointment/);
  /* a Google event becomes a GTD item, linked, and the read-only original is left alone */
  await page.click('.event:has-text("Bank holiday")');
  await page.waitForSelector('[data-act=ev-to-item]');
  await page.click('[data-act=ev-to-item]');
  await toastIs(/Added to Calendar/);
  st = await mockState();
  const hol = Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Bank holiday');
  assert.equal(hol.properties['Event ID'].rich_text[0].plain_text, 'holidays@group.v.calendar.google.com/ev_hol');
  assert.ok(G.events['holidays@group.v.calendar.google.com'].some(e => e.id === 'ev_hol'), 'read-only event untouched');
  /* delete a Google event from the app */
  await page.click('.event:has-text("Lunch with Sam")');
  await page.waitForSelector('[data-act=ev-delete]');
  await page.click('[data-act=ev-delete]');
  await toastIs(/Event deleted/);
  assert.ok(!G.events['james@example.com'].some(e => e.summary === 'Lunch with Sam'));
  /* moving the mirrored item off the Calendar list removes its Google copy */
  await page.click(`[data-act=cal-day][data-v="${addDays(todayISO(), 1)}"]`);
  await page.click('#view .item:has-text("Dentist appointment")');
  await page.click('[data-act=item-move][data-v=Someday]');
  await toastIs(/Someday/);
  await page.waitForFunction(() => !/Dentist appointment/.test(document.querySelector('#view')?.textContent || ''));
  await page.waitForTimeout(300);
  assert.ok(!G.events['james@example.com'].some(e => e.summary === 'Dentist appointment'), 'mirror removed');
  st = await mockState();
  assert.equal(Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Dentist appointment').properties['Event ID'].rich_text.length, 0);
  await page.click('[data-act=cal-clear]');

  /* ── 14e. Attachments: Drive, Dropbox, a Notion link ──────── */
  await go('#/waiting');
  await page.click('#view .item:has-text("Call the dentist")');
  await page.waitForSelector('[data-act=att-drive]');
  await page.click('[data-act=att-drive]');
  await toastIs(/Attached/);
  await page.waitForFunction(() => /Q3 plan\.gdoc/.test(document.querySelector('#sheet')?.textContent || ''));
  assert.deepEqual(await page.evaluate(() => window.__picker), { token: 'tok_client-123', key: 'AIzaTest' }, 'picker got the token and key');
  await page.click('[data-act=att-dropbox]');
  await toastIs(/Attached/);
  await page.waitForFunction(() => /brief\.pdf/.test(document.querySelector('#sheet')?.textContent || ''));
  assert.equal(await page.evaluate(() => window.__dropboxKey), 'dbx-key');
  await page.click('[data-act=att-link]');
  await page.fill('#attach-link-form input[name=url]', 'https://www.notion.so/Meeting-notes-0123456789abcdef0123456789abcdef');
  await page.click('#attach-link-form button[type=submit]');
  await toastIs(/Attached/);
  await page.waitForFunction(() => document.querySelectorAll('#sheet .attach').length === 3);
  assert.match(await textOf('#sheet .attach-list'), /Meeting notes/);
  st = await mockState();
  const withFiles = Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Call the dentist');
  assert.deepEqual(withFiles.properties.Attachments.files.map(f => f.external.url),
    ['https://docs.google.com/document/d/abc/edit', 'https://www.dropbox.com/s/abc/brief.pdf?dl=0', 'https://www.notion.so/Meeting-notes-0123456789abcdef0123456789abcdef']);
  await page.click('#sheet .attach [data-act=att-remove][data-k="1"]');
  await toastIs(/Removed/);
  await page.waitForFunction(() => document.querySelectorAll('#sheet .attach').length === 2);
  await page.keyboard.press('Escape');
  /* and on a project page */
  await go('#/projects');
  await page.click('#view a.card:has-text("Learn the cello")');
  await page.waitForSelector('[data-act=att-link][data-kind=projects]');
  await page.click('[data-act=att-link][data-kind=projects]');
  await page.fill('#attach-link-form input[name=url]', 'https://www.dropbox.com/scl/fo/cello-scores');
  await page.fill('#attach-link-form input[name=name]', 'Scores');
  await page.click('#attach-link-form button[type=submit]');
  await toastIs(/Attached/);
  await page.waitForFunction(() => /Scores/.test(document.querySelector('#view .attach-list')?.textContent || ''));

  /* ── 15. Search ───────────────────────────────────────────── */
  await page.click('#btn-search');
  await page.waitForSelector('#search-q');
  await page.type('#search-q', 'garden');
  await page.waitForFunction(() => /Garden overhaul/.test(document.querySelector('#view')?.textContent || ''));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-q', 'typing keeps focus');

  /* ── 16. Cache and incremental sync ───────────────────────── */
  await resetLog();
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('gtd.cache')).items.length);
  assert.ok(cached >= 5, 'cache holds the items');
  await page.waitForFunction(() => /synced/.test(document.querySelector('#sync-line')?.textContent || ''));
  await page.waitForTimeout(300);
  const bootQueries = (await mockLog()).filter(l => /\/query$/.test(l.path));
  assert.ok(bootQueries.length && bootQueries.every(l => l.body.filter?.timestamp === 'last_edited_time'), 'a reload syncs incrementally, not fully');
  /* edit a page "in Notion" and sync incrementally */
  await resetLog();
  const dentist = Object.values(st.pages).find(p => p.properties.Name?.title[0].plain_text === 'Call the dentist');
  await fetch(`http://127.0.0.1:4999/v1/pages/${dentist.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${mock.TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { Name: { title: [{ text: { content: 'Call the dentist about the crown' } }] } } }) });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('gtd:sync', { detail: { quiet: true } })));
  await page.waitForTimeout(600);
  await go('#/waiting');
  await page.waitForFunction(() => /about the crown/.test(document.querySelector('#view')?.textContent || ''));
  const q = (await mockLog()).filter(l => /\/query$/.test(l.path));
  assert.ok(q.every(l => l.body.filter?.timestamp === 'last_edited_time'), 'incremental sync filters by last_edited_time');

  /* ── 17. Desktop layout ───────────────────────────────────── */
  await page.setViewportSize({ width: 1280, height: 900 });
  await go('#/next');
  await page.waitForSelector('#view .item, #view .empty');
  await page.screenshot({ path: `${SHOTS}/13-desktop-next.png` });
  await go('#/review');
  await page.screenshot({ path: `${SHOTS}/14-desktop-review.png`, fullPage: true });

  /* Disconnect Google: calendars drop out of the legend */
  await go('#/integrations');
  await page.click('[data-act=g-disconnect]');
  await toastIs(/Google disconnected/);
  assert.equal(await page.evaluate(() => window.__revoked), 'tok_client-123', 'token revoked');
  await go('#/calendar');
  await page.waitForFunction(() => !/Standup \(moved\)/.test(document.querySelector('#view')?.textContent || ''));
  assert.ok(!(await page.$('.feed-legend')), 'no calendar legend once Google is disconnected');

  /* ── 18. Adopt on a second device ─────────────────────────── */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('dialog', d => d.accept());
  await p2.goto(APP + '/');
  await p2.fill('#setup-token input[name=token]', mock.TOKEN);
  await p2.click('#setup-token button[type=submit]');
  await p2.waitForSelector('[data-act=setup-adopt]');
  await p2.click('[data-act=setup-adopt]');
  await p2.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await p2.waitForFunction(() => /synced/.test(document.querySelector('#sync-line')?.textContent || ''));
  await p2.evaluate(() => { location.hash = '#/projects'; });
  await p2.waitForFunction(() => /Learn the cello/.test(document.querySelector('#view')?.textContent || ''));
  const dbCount = Object.keys((await mockState()).dbs).length;
  assert.equal(dbCount, 6, 'adopting created no new databases');

  console.log('console errors:', JSON.stringify(errors));
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('e2e passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

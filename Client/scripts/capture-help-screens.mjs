// Capture the Help Center / PDF manual screenshots.
//
// Logs into the running app and, for every entry in src/components/help/helpScreens.json, opens the
// screen, performs the entry's clicks (opening a tab, form, dialog or row menu), and saves
// public/help/screens/<id>.png. The Help Center and the downloaded PDF manual pick the files up
// automatically; an entry without a file just shows no screenshot.
//
//   modules  one overview screenshot per help module
//   actions  one screenshot per action, shown inside the article it belongs to
//
// Nothing is ever saved: steps only open things, every shot starts from a fresh page load, and any
// step that looks like it would act (Save, Submit, Approve, Delete, Sync, Notify, Clock In…) is
// refused before it is clicked.
//
// Usage (app + API running, from Client/):
//   HELP_USER=... HELP_PASS=... npm run help:screens                     # everything
//   HELP_USER=... HELP_PASS=... npm run help:screens -- run-payroll apply-leave   # only these ids
//   HELP_USER=... HELP_PASS=... npm run help:screens -- --actions         # only action shots
//   HELP_USER=... HELP_PASS=... npm run help:screens -- --missing         # only shots with no file yet
//
// Options (env):
//   HELP_APP_URL   app URL (default http://localhost:3099)
//   HELP_BLUR=0    don't blur data. By default table cells, avatars and figures are blurred (and, for
//                  entries marked "sensitive", form values and panel text too) because the manual is
//                  shared with every user and a live system would otherwise publish real personal data.
//   HELP_HEADED=1  show the browser while capturing
//
// Needs Playwright, which is already a dependency of the repo root package.json.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root     = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'src/components/help/helpScreens.json'), 'utf8'));
const outDir   = join(root, 'public/help/screens');

const appUrl = (process.env.HELP_APP_URL || 'http://localhost:3099').replace(/\/$/, '');
const user   = process.env.HELP_USER;
const pass   = process.env.HELP_PASS;
const blur   = process.env.HELP_BLUR !== '0';
const args   = process.argv.slice(2);
const flags  = new Set(args.filter(a => a.startsWith('--')));
const only   = args.filter(a => !a.startsWith('--'));

if (!user || !pass) {
  console.error('Set HELP_USER and HELP_PASS (an account that can open every screen, e.g. an admin).');
  process.exit(1);
}

const all = [
  ...(flags.has('--actions') ? [] : Object.entries(manifest.modules ?? {}).map(([id, v]) => ({ id, steps: [], ...v }))),
  ...(flags.has('--modules') ? [] : (manifest.actions ?? [])),
].filter(t => t.view);
const targets = all
  .filter(t => !only.length || only.includes(t.id))
  .filter(t => !flags.has('--missing') || !existsSync(join(outDir, `${t.id}.png`)));
if (!targets.length) { console.error(`Nothing to capture. Known ids: ${all.map(t => t.id).join(', ')}`); process.exit(1); }

// A step may only OPEN something. Refuse anything that reads like it would change data.
const UNSAFE = /^(save|submit|approve|reject|delete|remove|sync|notify|clock|reset|post|pay|mark|confirm|send|finali[sz]e|cancel|deactivate|activate|run|process|import|upload|generate payslip)\b/i;

// Blur data, not chrome: headers, buttons, tabs and labels stay readable so the screen still teaches.
const NO_MOTION = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
const BLUR_CSS = `
  tbody td, tbody th, .avatar, img[alt*="avatar" i], img[src^="data:image"],
  [class*="stat-card"] [class*="text-2xl"], [class*="stat-card"] [class*="text-3xl"] { filter: blur(8px) !important; }
`;
// For Edit/View shots of real records: also blur field values and the text inside overlays/panels.
const SENSITIVE_CSS = `
  input:not([type=checkbox]):not([type=radio]), select, textarea,
  .fixed :is(p, dd, td, h1, h2, h3, h4):not(:has(label)) { filter: blur(7px) !important; }
`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HELP_HEADED !== '1' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(30000);

// Track in-flight API calls ourselves. Against a remote database some lists take 10s+, and the
// realtime socket means the browser's own 'networkidle' is unreliable.
let pending = 0;
let lastChange = Date.now();
const isApi = (r) => r.url().includes('/v1/api/') && !['websocket', 'eventsource'].includes(r.resourceType());
page.on('request',         r => { if (isApi(r)) { pending++; lastChange = Date.now(); } });
page.on('requestfinished', r => { if (isApi(r)) { pending = Math.max(0, pending - 1); lastChange = Date.now(); } });
page.on('requestfailed',   r => { if (isApi(r)) { pending = Math.max(0, pending - 1); lastChange = Date.now(); } });

/** Resolve once no API call has been in flight for `quietMs`, or after `maxMs` (some screens poll). */
async function apiQuiet(quietMs = 1500, maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (pending === 0 && Date.now() - lastChange >= quietMs) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/**
 * Find a visible control in the content area (right of the sidebar, below the top bar) whose label
 * equals `text`, or failing that starts with it (case-insensitive), and tag it for clicking.
 * Returns the visible labels when nothing matches, so a failing manifest entry is easy to fix.
 */
async function tagControl(text, selector = 'button, [role=tab], [role=menuitem], a') {
  return page.evaluate(({ text, selector }) => {
    document.querySelectorAll('[data-help-target]').forEach(el => el.removeAttribute('data-help-target'));
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(text);
    const els = [...document.querySelectorAll(selector)].filter(el => {
      const r = el.getBoundingClientRect();
      return el.offsetParent && r.width && r.left > 235 && r.top > 62 && r.top < 900;
    });
    const label = el => norm(el.innerText || el.getAttribute('aria-label') || el.title);
    const hit = els.find(el => label(el) === want) || els.find(el => label(el).startsWith(want));
    if (hit) { hit.setAttribute('data-help-target', '1'); return { ok: true, label: label(hit) }; }
    return { ok: false, labels: [...new Set(els.map(label).filter(l => l && l.length < 40))] };
  }, { text, selector });
}

async function clickControl(text, selector) {
  const found = await tagControl(text, selector);
  if (!found.ok) throw new Error(`no control "${text}". On screen: ${found.labels.slice(0, 25).join(' | ')}`);
  if (UNSAFE.test(found.label)) throw new Error(`refused to click "${found.label}" — it looks like it would change data`);
  await page.click('[data-help-target="1"]');
  await page.waitForTimeout(700);
  await apiQuiet(1000, 20000);
}

async function runStep(step) {
  if (UNSAFE.test(step.replace(/^row:/, ''))) throw new Error(`refused unsafe step "${step}"`);
  if (step.startsWith('row:')) {
    // Open the first table row's actions menu, then pick the item.
    const opened = await page.evaluate(() => {
      document.querySelectorAll('[data-help-target]').forEach(el => el.removeAttribute('data-help-target'));
      const btn = [...document.querySelectorAll('tbody button, tbody [role=button]')]
        .find(el => el.offsetParent && /actions|more|menu|options/i.test(el.getAttribute('aria-label') || el.title || el.innerText || ''))
        || document.querySelector('tbody tr td:last-child button');
      if (!btn) return false;
      btn.setAttribute('data-help-target', '1');
      return true;
    });
    if (!opened) throw new Error('no row actions menu found (is the table empty?)');
    await page.click('[data-help-target="1"]');
    await page.waitForTimeout(500);
    await clickControl(step.slice(4), 'button, [role=menuitem], a, li');
    return;
  }
  await clickControl(step);
}

try {
  // ── Log in ──
  console.log(`Opening ${appUrl} …`);
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.fill('input[autocomplete="username"]', user);
  await page.fill('input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await page.waitForSelector('input[autocomplete="current-password"]', { state: 'detached', timeout: 30000 })
    .catch(() => { throw new Error('Login did not complete — check HELP_USER / HELP_PASS and that the API is running.'); });
  await apiQuiet(1500, 20000);
  console.log(`Logged in. Capturing ${targets.length} screenshot(s)…\n`);

  let ok = 0;
  const failed = [];
  for (const t of targets) {
    try {
      // App.tsx restores the active view from sessionStorage on load — every shot starts clean.
      await page.evaluate(v => sessionStorage.setItem('activeView', v), t.view);
      await page.reload({ waitUntil: 'load' });
      if (await page.locator('input[autocomplete="current-password"]').count()) throw new Error('session expired');
      await page.waitForTimeout(800);
      await apiQuiet();
      await page.evaluate(() => document.documentElement.classList.remove('dark')); // light theme in print
      await page.addStyleTag({ content: NO_MOTION + (blur ? BLUR_CSS + (t.sensitive ? SENSITIVE_CSS : '') : '') });

      for (const step of t.steps ?? []) await runStep(step);
      await page.waitForTimeout(900); // render after the last response / open animation

      // An account without a linked employee name renders as "null null" — show a neutral label instead.
      await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) if (/^\s*null null\s*$/i.test(n.nodeValue)) n.nodeValue = 'HR Administrator';
      });
      // Sensitive shots (a real record open for View/Edit): CSS alone can't reach values rendered as
      // plain divs/spans, so blur every piece of text in the content area except the "chrome" that
      // teaches the screen — field labels, uppercase section/field captions, buttons, tabs, headers.
      if (blur && t.sensitive) {
        await page.evaluate(() => {
          const keep = el => el.closest('button, [role=tab], label, th, thead, option') ||
            getComputedStyle(el).textTransform === 'uppercase';
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const hits = new Set();
          for (let n; (n = w.nextNode());) {
            const el = n.parentElement;
            if (!el || !n.nodeValue.trim() || keep(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.left < 235 || r.top < 62) continue; // sidebar and top bar
            hits.add(el);
          }
          hits.forEach(el => { el.style.filter = 'blur(7px)'; });
        });
        await page.waitForTimeout(200);
      }
      await page.screenshot({ path: join(outDir, `${t.id}.png`) });
      console.log(`✓ ${t.id.padEnd(24)} ${t.view}${t.steps?.length ? ' → ' + t.steps.join(' → ') : ''}`);
      ok++;
    } catch (err) {
      failed.push(t.id);
      console.error(`✗ ${t.id.padEnd(24)} ${t.view}: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${ok}/${targets.length} screenshots saved to public/help/screens/${blur ? ' (data blurred)' : ''}`);
  if (failed.length) console.log(`Failed: ${failed.join(' ')}`);
} finally {
  await browser.close();
}

// Capture the Help Center / PDF manual screenshots.
//
// Logs into the running app, opens each screen listed in src/components/help/helpScreens.json and
// saves it to public/help/screens/<module id>.png. The Help Center and the downloaded PDF manual
// pick the files up automatically; a module without a file just shows no screenshot.
//
// Usage (app + API running, from Client/):
//   HELP_USER=admin@usg.com HELP_PASS=secret node scripts/capture-help-screens.mjs
//   HELP_USER=... HELP_PASS=... node scripts/capture-help-screens.mjs payroll medical   # only these
//
// Options (env):
//   HELP_APP_URL   app URL (default http://localhost:3099)
//   HELP_BLUR=0    don't blur table data. By default, table cells, list values and avatars are
//                  blurred, because the manual is shared with every user and screenshots of a live
//                  system would otherwise publish real names, salaries and account numbers.
//   HELP_HEADED=1  show the browser while capturing
//
// Needs Playwright, which is already a dependency of the repo root package.json.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root     = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'src/components/help/helpScreens.json'), 'utf8'));
const outDir   = join(root, 'public/help/screens');

const appUrl = (process.env.HELP_APP_URL || 'http://localhost:3099').replace(/\/$/, '');
const user   = process.env.HELP_USER;
const pass   = process.env.HELP_PASS;
const blur   = process.env.HELP_BLUR !== '0';
const only   = process.argv.slice(2);

if (!user || !pass) {
  console.error('Set HELP_USER and HELP_PASS (an account that can open every screen, e.g. an admin).');
  process.exit(1);
}

const targets = Object.entries(manifest)
  .filter(([id, v]) => !id.startsWith('_') && v?.view)
  .filter(([id]) => !only.length || only.includes(id));
if (!targets.length) { console.error(`No matching modules. Known: ${Object.keys(manifest).filter(k => !k.startsWith('_')).join(', ')}`); process.exit(1); }

// Blur data, not chrome: headers, buttons, tabs and labels stay readable so the screen still teaches.
const BLUR_CSS = `
  tbody td, tbody th, .avatar, img[alt*="avatar" i], img[src^="data:image"],
  [class*="stat-card"] [class*="text-2xl"], [class*="stat-card"] [class*="text-3xl"] {
    filter: blur(8px) !important;
  }
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
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

/** Resolve once no API call has been in flight for `quietMs`, or after `maxMs`. */
async function apiQuiet(quietMs = 1500, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (pending === 0 && Date.now() - lastChange >= quietMs) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

// The app holds a live realtime connection, so 'networkidle' may never fire. Wait for load, give the
// network a short chance to go quiet, then a fixed settle for data and charts.
async function settle(ms = 2500) {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(ms);
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
  await settle(1500);
  console.log('Logged in.');

  // ── Capture each screen ──
  let ok = 0;
  for (const [id, { view }] of targets) {
    try {
      // App.tsx restores the active view from sessionStorage on load.
      await page.evaluate(v => sessionStorage.setItem('activeView', v), view);
      await page.reload({ waitUntil: 'load' });
      await settle();
      // Wait for the screen's data calls to finish so tables show real rows, not "Loading…".
      if (!(await apiQuiet())) console.warn(`  (${id}: API still busy after 60s — screenshot may show loading)`);
      await page.waitForTimeout(1000); // render after the last response
      // An account without a linked employee name renders as "null null" — show a neutral label instead.
      await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) if (/^\s*null null\s*$/i.test(n.nodeValue)) n.nodeValue = 'HR Administrator';
      });
      await page.evaluate(() => document.documentElement.classList.remove('dark')); // light theme in print
      await page.addStyleTag({ content: blur ? BLUR_CSS : BLUR_CSS.split('\n').filter(l => l.includes('animation')).join('\n') });
      await page.waitForTimeout(300);
      const file = join(outDir, `${id}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${id.padEnd(16)} ${view}`);
      ok++;
    } catch (err) {
      console.error(`✗ ${id.padEnd(16)} ${view}: ${err.message}`);
    }
  }
  console.log(`\n${ok}/${targets.length} screenshots saved to public/help/screens/${blur ? ' (data blurred)' : ''}`);
} finally {
  await browser.close();
}

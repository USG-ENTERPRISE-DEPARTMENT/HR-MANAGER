#!/usr/bin/env node
/**
 * Smoke-suite runner.
 *
 *   npm run smoke                 # run every module
 *   node smoke/run.js salary      # run one module (or several: `node smoke/run.js salary leave`)
 *   node smoke/run.js --list      # list available modules
 *
 * Exit code is non-zero if any check fails (CI-friendly). Each module's cleanup runs even on failure.
 */
const fs = require('fs');
const path = require('path');
const { preflight, login, Suite, paint, colors: c, BASE, EMAIL } = require('./harness');

const MODULES_DIR = path.join(__dirname, 'modules');

function availableModules() {
  if (!fs.existsSync(MODULES_DIR)) return [];
  return fs.readdirSync(MODULES_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
    .sort();
}

async function main() {
  const args = process.argv.slice(2);
  const all = availableModules();

  if (args.includes('--list')) {
    console.log('Available modules:\n  ' + all.join('\n  '));
    process.exit(0);
  }

  let selected = args.filter(a => !a.startsWith('-'));
  if (selected.length === 0) selected = all;

  const unknown = selected.filter(m => !all.includes(m));
  if (unknown.length) {
    console.error(paint(`Unknown module(s): ${unknown.join(', ')}`, c.red));
    console.error('Available: ' + all.join(', '));
    process.exit(2);
  }

  console.log(paint(`\nHR API smoke suite`, c.bold) + paint(`  →  ${BASE}  (as ${EMAIL})`, c.gray));

  if (!(await preflight())) process.exit(3);
  if (!(await login())) process.exit(3);

  const results = [];
  for (const name of selected) {
    const mod = require(path.join(MODULES_DIR, `${name}.js`));
    const t = new Suite(name);
    console.log(paint(`\n▶ ${name}`, c.cyan + c.bold));
    try {
      await mod.run(t);
    } catch (e) {
      t.failed++;
      t.failures.push(`unhandled error: ${e.message}`);
      console.log('  ' + paint('FAIL', c.red) + ' unhandled error: ' + e.message);
    } finally {
      await t.cleanup();
    }
    results.push(t);
    const tag = t.failed === 0 ? paint('ok', c.green) : paint(`${t.failed} failed`, c.red);
    console.log(paint(`  └ ${t.passed} passed, ${t.failed} failed — ${tag}`, c.gray));
  }

  // Summary table
  const totalPass = results.reduce((s, t) => s + t.passed, 0);
  const totalFail = results.reduce((s, t) => s + t.failed, 0);
  const width = Math.max(...results.map(t => t.name.length), 8);
  console.log(paint('\n──────── summary ────────', c.bold));
  for (const t of results) {
    const status = t.failed === 0 ? paint('PASS', c.green) : paint('FAIL', c.red);
    console.log(`  ${t.name.padEnd(width)}  ${status}  ${t.passed}/${t.passed + t.failed}`);
  }
  const overall = totalFail === 0 ? paint('ALL PASSED', c.green + c.bold) : paint(`${totalFail} CHECK(S) FAILED`, c.red + c.bold);
  console.log(`\n  ${overall}  (${totalPass} passed, ${totalFail} failed across ${results.length} module(s))\n`);

  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch(e => { console.error(paint('Fatal: ' + e.stack, c.red)); process.exit(1); });

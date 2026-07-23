// One-off: scan controllers for response-message string literals and build the seed message catalog
// (static entries). Dynamic (backtick / interpolated) messages are listed for manual conversion to
// templates — they are NOT added to the static catalog.
//
//   node src/scripts/harvestMessages.js
//
// Writes Server/src/data/messageCatalog.static.json and prints the dynamic-message list.
const fs = require('fs');
const path = require('path');

const CTRL_DIR = path.join(__dirname, '../controllers');
// Files that emit messages via inline res.json (bypass the respond helper).
const INLINE_FILES = new Set(['userController.js', 'rolePermissionController.js', 'payslipController.js']);

const RESPOND_METHODS = 'ok|created|badReq|forbidden|notFound|conflict|error';
const respondStatic = new RegExp(`\\brespond\\.(?:${RESPOND_METHODS})\\s*\\(\\s*res\\s*,\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`, 'g');
const respondDynamic = new RegExp(`\\brespond\\.(?:${RESPOND_METHODS})\\s*\\(\\s*res\\s*,\\s*\``, 'g');
const inlineStatic = /message\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const inlineDynamic = /message\s*:\s*`/g;

function unescape(s) { return s.replace(/\\(['"\\])/g, '$1'); }
function categoryOf(file) {
  const base = file.replace(/Controller\.js$/, '').replace(/\.js$/, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

const catalog = new Map();  // text -> { key, category, kind, default }
const dynamic = [];         // { file, line, snippet }

for (const file of fs.readdirSync(CTRL_DIR)) {
  if (!file.endsWith('.js')) continue;
  const full = path.join(CTRL_DIR, file);
  const src = fs.readFileSync(full, 'utf8');
  const cat = categoryOf(file);

  for (const m of src.matchAll(respondStatic)) {
    const text = unescape(m[2]).trim();
    if (text && !catalog.has(text)) catalog.set(text, { key: text, category: cat, kind: 'static', default: text });
  }
  for (const m of src.matchAll(respondDynamic)) {
    dynamic.push({ file, line: lineOf(src, m.index), snippet: src.slice(m.index, m.index + 90).split('\n')[0] });
  }
  if (INLINE_FILES.has(file)) {
    for (const m of src.matchAll(inlineStatic)) {
      const text = unescape(m[2]).trim();
      if (text && !/^\d+$/.test(text) && !catalog.has(text)) catalog.set(text, { key: text, category: cat, kind: 'static', default: text });
    }
    for (const m of src.matchAll(inlineDynamic)) {
      dynamic.push({ file, line: lineOf(src, m.index), snippet: src.slice(m.index, m.index + 90).split('\n')[0] });
    }
  }
}

const entries = [...catalog.values()].sort((a, b) => (a.category + a.default).localeCompare(b.category + b.default));
const out = path.join(__dirname, '../data/messageCatalog.static.json');
fs.writeFileSync(out, JSON.stringify(entries, null, 2));
console.log(`Static messages: ${entries.length} -> ${path.relative(process.cwd(), out)}`);
console.log(`Dynamic (template) messages to convert manually: ${dynamic.length}`);
for (const d of dynamic) console.log(`  ${d.file}:${d.line}  ${d.snippet}`);

// Central store for admin-editable response messages.
//
//  • Static messages keep their literal text in code; the text itself is the catalog key. The
//    response interceptor (app.js) calls applyOverride() on every outgoing res.json `message`.
//  • Dynamic messages are built via tmsg(key, params) — a template with {tokens} that admins can edit.
//
// Overrides live in the `message_overrides` table; only edited messages are stored. The catalog seed
// (messageCatalog.static.json + messageCatalog.templates.json) is the browsable list for the UI.
const fs = require('fs');
const path = require('path');
const { prisma } = require('./dbQueryHelper');

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../data', file), 'utf8')); }
  catch { return []; }
}
const STATIC_ENTRIES   = loadJson('messageCatalog.static.json');
const TEMPLATE_ENTRIES = loadJson('messageCatalog.templates.json');
const CATALOG = [...STATIC_ENTRIES, ...TEMPLATE_ENTRIES];
const TEMPLATE_DEFAULT = new Map(TEMPLATE_ENTRIES.map(e => [e.key, e.default]));

// message_key -> { text, enabled } (enabled overrides only affect output; disabled = use default)
let _overrides = new Map();

/** Re-load overrides from the DB into memory. Call after any write. */
async function reload() {
  try {
    const rows = await prisma.$queryRaw`SELECT message_key, override_text, enabled FROM message_overrides`;
    const m = new Map();
    for (const r of rows) m.set(String(r.message_key), { text: r.override_text, enabled: r.enabled === 1 || r.enabled === true });
    _overrides = m;
  } catch { /* table not ready / offline — keep current (defaults) */ }
}

/** Swap a static message for its enabled override, if one exists. Used by the response interceptor. */
function applyOverride(text) {
  const o = _overrides.get(text);
  return o && o.enabled ? o.text : text;
}

/** Render a dynamic message template by key, substituting {tokens} from params. */
function tmsg(key, params = {}) {
  const o = _overrides.get(key);
  const template = (o && o.enabled ? o.text : undefined) ?? TEMPLATE_DEFAULT.get(key) ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

/** The browsable catalog merged with current overrides (for the admin API). */
function catalog() {
  return CATALOG.map(e => {
    const o = _overrides.get(e.key);
    return {
      key: e.key, category: e.category, kind: e.kind, default: e.default,
      placeholders: e.placeholders ?? [],
      override: o ? o.text : null,
      enabled: o ? o.enabled : true,
    };
  });
}

module.exports = { reload, applyOverride, tmsg, catalog };

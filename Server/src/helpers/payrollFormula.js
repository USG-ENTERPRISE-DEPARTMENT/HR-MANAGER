// Payroll column formula tokenization.
//
// A column's `calculation_function` is stored in TOKEN form so it survives renames:
//   salary components -> {comp:<salarycomponent.id>}
//   payroll columns   -> {col:<payrollcolumns.id>}
// Numbers and operators are kept verbatim. The client always exchanges the human-readable NAME form;
// the server tokenizes on write and detokenizes (to current names) on read, and the calc engine
// resolves tokens straight to values by id.

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Convert a name-form formula into token form.
 * @param {string} text          formula as typed (names)
 * @param {Array<{id:any,name:string}>} components  salary components
 * @param {Array<{id:any,name:string}>} columns     payroll columns
 * @returns {{ formula: string, unresolved: string[] }}
 *   `unresolved` lists identifier-like fragments that matched no component/column (for warnings).
 */
function tokenizeFormula(text, components, columns) {
  if (text == null || String(text).trim() === '') return { formula: '', unresolved: [] };

  // On a name clash, prefer COLUMN over component — this mirrors the engine's eval precedence
  // (a cached column value overrides a component value of the same name). Longest name first so
  // partial names (e.g. "Basic") don't clobber longer ones (e.g. "Basic Salary").
  const entries = [];
  for (const c of columns)    if (c && c.name) entries.push({ name: String(c.name), token: `{col:${c.id}}` });
  for (const c of components) if (c && c.name) entries.push({ name: String(c.name), token: `{comp:${c.id}}` });
  const seen = new Set();
  const ordered = [];
  for (const e of entries) {
    const k = e.name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); ordered.push(e); }
  }
  ordered.sort((a, b) => b.name.length - a.name.length);

  let out = String(text);
  for (const e of ordered) out = out.replace(new RegExp(`\\b${escapeRe(e.name)}\\b`, 'ig'), e.token);

  // Anything left that looks like an identifier (not a token, number, or operator) is unresolved.
  const stripped = out.replace(/\{(?:comp|col):\d+\}/g, ' ');
  const unresolved = [...new Set(
    (stripped.match(/[A-Za-z_][A-Za-z0-9_ ]*[A-Za-z0-9_]|[A-Za-z_]/g) || [])
      .map(s => s.trim()).filter(Boolean)
  )];
  return { formula: out, unresolved };
}

/**
 * Convert a token-form formula back to current names for display/editing.
 * @param {string} tokens
 * @param {Map<string,string>} compById  componentId(string) -> current name
 * @param {Map<string,string>} colById   columnId(string)    -> current name
 */
function detokenizeFormula(tokens, compById, colById) {
  if (tokens == null) return '';
  return String(tokens)
    .replace(/\{comp:(\d+)\}/g, (_, id) => (compById.get(String(id)) ?? `{comp:${id}}`))
    .replace(/\{col:(\d+)\}/g,  (_, id) => (colById.get(String(id))  ?? `{col:${id}}`));
}

module.exports = { tokenizeFormula, detokenizeFormula };

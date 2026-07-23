// aiRag — tiny offline retrieval layer. Embeds help knowledge + shared company documents
// into the ai_embeddings table and retrieves the most relevant chunks by cosine similarity,
// computed in Node (the corpus is small — hundreds of chunks, so no vector DB is needed).
const fs   = require('fs');
const path = require('path');
const { prisma } = require('./dbQueryHelper');
const aiClient = require('./aiClient');

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Split long text into ~600-char chunks on sentence boundaries.
function chunk(text, size = 600) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = []; let buf = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if ((buf + ' ' + sentence).length > size && buf) { out.push(buf.trim()); buf = sentence; }
    else buf += ' ' + sentence;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Gather the corpus: curated help knowledge + active shared company documents.
async function gatherCorpus() {
  const items = [];

  try {
    const file = path.join(__dirname, '../data/helpKnowledge.json');
    const help = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const h of help) {
      for (const [i, c] of chunk(`${h.title}. ${h.text}`).entries()) {
        items.push({ source_type: 'help', source_id: h.id, chunk_index: i, title: h.title, content: c });
      }
    }
  } catch { /* help file optional */ }

  try {
    const docs = await prisma.companydocuments.findMany({
      where: {
        status: 'Active',
        details: { not: '' },
      },
      select: { id: true, name: true, details: true },
    }).catch(() => []);
    for (const d of docs) {
      if (!d.details) continue;
      for (const [i, c] of chunk(`${d.name}. ${d.details}`).entries()) {
        items.push({ source_type: 'document', source_id: String(d.id), chunk_index: i, title: d.name, content: c });
      }
    }
  } catch { /* documents optional */ }

  // Files dropped into src/data/knowledge/ — .md/.txt (one source per file) or .json (array of
  // { id?, title, text }). README.md is skipped.
  try {
    const dir = path.join(__dirname, '../data/knowledge');
    for (const file of fs.readdirSync(dir)) {
      if (file.toLowerCase() === 'readme.md') continue;
      const ext = path.extname(file).toLowerCase();
      const base = file.slice(0, -ext.length) || file;
      const full = path.join(dir, file);
      try {
        if (ext === '.md' || ext === '.txt') {
          const text = fs.readFileSync(full, 'utf8');
          for (const [i, c] of chunk(`${base}. ${text}`).entries())
            items.push({ source_type: 'dataset', source_id: file, chunk_index: i, title: base, content: c });
        } else if (ext === '.json') {
          const entries = JSON.parse(fs.readFileSync(full, 'utf8'));
          for (const e of (Array.isArray(entries) ? entries : [])) {
            const title = e.title || base;
            for (const [i, c] of chunk(`${title}. ${e.text ?? ''}`).entries())
              items.push({ source_type: 'dataset', source_id: `${file}:${e.id ?? title}`, chunk_index: i, title, content: c });
          }
        }
      } catch { /* skip a single bad file */ }
    }
  } catch { /* folder optional */ }

  // Admin-managed in-app knowledge entries.
  try {
    const rows = await prisma.ai_knowledge.findMany({
      where: {
        enabled: true,
        content: { not: '' },
      },
      select: { id: true, title: true, content: true },
    }).catch(() => []);
    for (const r of rows) {
      if (!r.content) continue;
      for (const [i, c] of chunk(`${r.title}. ${r.content}`).entries())
        items.push({ source_type: 'knowledge', source_id: String(r.id), chunk_index: i, title: r.title, content: c });
    }
  } catch { /* knowledge optional */ }

  return items;
}

// Rebuild the whole embedding index. Returns the number of chunks indexed.
async function reindex() {
  const items = await gatherCorpus();
  if (!items.length) {
    await prisma.ai_embeddings.deleteMany().catch(() => {});
    return 0;
  }

  // Embed in batches to keep request sizes reasonable on CPU.
  const vectors = [];
  const BATCH = 16;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const vecs = await aiClient.embed(slice.map(s => s.content));
    vectors.push(...vecs);
  }

  await prisma.ai_embeddings.deleteMany().catch(() => {});
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await prisma.ai_embeddings.create({
      data: {
        source_type: it.source_type,
        source_id: it.source_id,
        chunk_index: it.chunk_index,
        title: it.title,
        content: it.content,
        embedding: JSON.stringify(vectors[i]),
      },
    });
  }
  return items.length;
}

// Retrieve the top-k most relevant chunks for a query. Returns [{ title, content, score }].
async function retrieve(query, k = 4) {
  const rows = await prisma.ai_embeddings.findMany({
    select: { title: true, content: true, embedding: true },
  }).catch(() => []);
  if (!rows.length) return [];

  let qvec;
  try { [qvec] = await aiClient.embed([query]); } catch { return []; }
  if (!qvec) return [];

  const scored = [];
  for (const r of rows) {
    let vec; try { vec = JSON.parse(r.embedding); } catch { continue; }
    scored.push({ title: r.title, content: r.content, score: cosine(qvec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter(s => s.score > 0.2);
}

// True when no embeddings have been built yet.
async function isEmpty() {
  const count = await prisma.ai_embeddings.count().catch(() => 0);
  return Number(count) === 0;
}

let indexing = false;

// Build the index if it isn't already built. Non-throwing and self-guarding: skips when AI is
// disabled, when Ollama is unreachable, or when the index already has content (unless force).
// Safe to call repeatedly (e.g. on startup and on a schedule).
async function ensureIndexed({ force = false } = {}) {
  if (indexing) return { skipped: 'busy' };
  try {
    const cfg = await aiClient.getConfig();
    if (!cfg.enabled) { console.log('[ai] auto-index skipped — AI disabled'); return { skipped: 'disabled' }; }

    const hp = await aiClient.health();
    if (!hp.ok) { console.log(`[ai] auto-index skipped — ${hp.reason || 'Ollama not ready'}, will retry`); return { skipped: 'unavailable' }; }

    if (!force && !(await isEmpty())) return { skipped: 'already-indexed' };

    indexing = true;
    console.log('[ai] building knowledge index…');
    const n = await reindex();
    console.log(`[ai] knowledge index built — ${n} chunk(s)`);
    return { indexed: n };
  } catch (e) {
    console.error('[ai] auto-index failed:', e.message);
    return { error: e.message };
  } finally {
    indexing = false;
  }
}

module.exports = { reindex, retrieve, cosine, chunk, isEmpty, ensureIndexed };

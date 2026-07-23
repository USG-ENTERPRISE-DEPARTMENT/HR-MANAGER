// aiClient — thin wrapper around a local, offline Ollama server.
// Uses the OpenAI-compatible endpoint (already-installed `openai` SDK) for chat + embeddings,
// and Ollama's native /api/tags for health. All config comes from .env with per-key DB overrides
// stored in the `settings` table (category 'ai'), so admins can change it from Settings → AI.
const OpenAI = require('openai');
const axios  = require('axios');
const { prisma } = require('./dbQueryHelper');

const SETTINGS_CAT = 'ai';

// Default feature flags — every AI capability can be toggled independently.
const DEFAULT_FEATURES = { assistant: true, drafting: true, ocr: true, insights: true };

function bool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return String(v).toLowerCase() === 'true' || v === '1' || v === true;
}

// Read the ai-category settings rows (name/value) as a plain map.
async function readAiSettings() {
  const rows = await prisma.settings.findMany({
    where: { category: SETTINGS_CAT },
    select: { name: true, value: true },
  }).catch(() => []);
  return Object.fromEntries((rows || []).map(r => [r.name, r.value]));
}

// Effective config: DB override → .env → built-in default.
async function getConfig() {
  const db = await readAiSettings();
  let features = { ...DEFAULT_FEATURES };
  try { if (db.features) features = { ...features, ...JSON.parse(db.features) }; } catch { /* ignore */ }
  return {
    enabled:    bool(db.enabled, bool(process.env.AI_ENABLED, true)),
    baseUrl:    (db.base_url   || process.env.OLLAMA_BASE_URL   || 'http://localhost:11434').replace(/\/+$/, ''),
    chatModel:   db.chat_model  || process.env.OLLAMA_CHAT_MODEL  || 'llama3.2:3b',
    embedModel:  db.embed_model || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    features,
  };
}

async function upsertSetting(name, value) {
  const existing = await prisma.settings.findFirst({
    where: { name, category: SETTINGS_CAT },
    select: { id: true },
  }).catch(() => null);

  if (existing) {
    await prisma.settings.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.settings.create({
      data: {
        id: BigInt(Date.now()),
        name,
        value,
        category: SETTINGS_CAT,
      },
    });
  }
}

function makeClient(cfg) {
  // Any non-empty apiKey works against Ollama's OpenAI-compatible endpoint.
  return new OpenAI({ baseURL: `${cfg.baseUrl}/v1`, apiKey: 'ollama' });
}

// Is the local model server reachable, and is AI enabled?
async function health() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { ok: false, enabled: false, reason: 'AI is disabled in settings' };
  try {
    const res = await axios.get(`${cfg.baseUrl}/api/tags`, { timeout: 4000 });
    const models = (res.data?.models || []).map(m => m.name);
    return {
      ok: true, enabled: true, baseUrl: cfg.baseUrl, models,
      chatModel: cfg.chatModel, embedModel: cfg.embedModel,
      chatReady:  models.some(m => m.startsWith(cfg.chatModel.split(':')[0])),
      embedReady: models.some(m => m.startsWith(cfg.embedModel.split(':')[0])),
      features: cfg.features,
    };
  } catch (e) {
    return { ok: false, enabled: true, reason: `Cannot reach Ollama at ${cfg.baseUrl} — is it running?` };
  }
}

// Non-streaming chat completion. `tools` is an optional OpenAI tool-schema array.
async function chat({ messages, tools, temperature = 0.2, cfg }) {
  cfg = cfg || await getConfig();
  const client = makeClient(cfg);
  const body = { model: cfg.chatModel, messages, temperature };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  return client.chat.completions.create(body);
}

// Streaming chat completion — returns the async iterable stream of chunks.
async function chatStream({ messages, temperature = 0.3, cfg }) {
  cfg = cfg || await getConfig();
  const client = makeClient(cfg);
  return client.chat.completions.create({
    model: cfg.chatModel, messages, temperature, stream: true,
  });
}

// Embed one or more strings → array of number[] vectors.
async function embed(texts, cfg) {
  cfg = cfg || await getConfig();
  const client = makeClient(cfg);
  const input = Array.isArray(texts) ? texts : [texts];
  const res = await client.embeddings.create({ model: cfg.embedModel, input });
  return res.data.map(d => d.embedding);
}

module.exports = {
  SETTINGS_CAT, DEFAULT_FEATURES,
  getConfig, readAiSettings, upsertSetting, health, chat, chatStream, embed,
};

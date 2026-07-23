const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { prisma }   = require('../helpers/dbQueryHelper');
const aiClient     = require('../helpers/aiClient');
const aiTools      = require('../helpers/aiTools');
const aiRag        = require('../helpers/aiRag');
const aiAttrition  = require('../helpers/aiAttrition');
const aiOcr        = require('../helpers/aiOcr');

// ── SSE helpers ────────────────────────────────────────────────────────────────
function sseInit(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}
const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const sseDone = (res) => { res.write('data: [DONE]\n\n'); res.end(); };

// Always-present description of what this HR system can do, so capability questions
// ("do you have payroll?", "what can you do?") never depend on RAG retrieval being ready.
const APP_OVERVIEW =
  'This HR system includes the following modules: ' +
  'Employees (records, onboarding, public self-onboarding, lifecycle); ' +
  'Leave (requests, approvals, calendar, types/periods/holidays/work-week setup); ' +
  'Payroll & Salary (payroll runs, payslips, salary structures, pay grades, notches, GL posting); ' +
  'Medical (staff & dependent claims, per-pay-grade limits, hospital claims, year-end utilization reset); ' +
  'Time & Attendance (clock in/out, kiosk, biometric sync, timesheets); ' +
  'Performance (appraisal cycles with self / supervisor / HR review stages, goals); ' +
  'Recruitment (jobs, applicants, interviews); Training (catalog, nominations, certificates); ' +
  'Documents (company & personal); Reports & Insights (including AI attrition-risk insights); ' +
  'in-app Notifications; and System administration (users, roles, permissions, settings). ' +
  'Yes — payroll is a built-in module. Whether a given user can open or act in each module depends on their permissions.';

// Stream an Ollama chat completion to the client over SSE; returns the assembled text.
async function streamCompletion(res, messages, cfg) {
  let full = '';
  const stream = await aiClient.chatStream({ messages, cfg });
  for await (const part of stream) {
    const tok = part?.choices?.[0]?.delta?.content || '';
    if (tok) { full += tok; sseSend(res, { token: tok }); }
  }
  return full;
}

// ── GET /ai/health ──────────────────────────────────────────────────────────────
exports.health = asyncHandler(async (req, res) => {
  respond.ok(res, 'AI health', await aiClient.health());
});

// ── GET /ai/config (admin) ────────────────────────────────────────────────────
exports.getConfig = asyncHandler(async (req, res) => {
  respond.ok(res, 'AI config', await aiClient.getConfig());
});

// ── PUT /ai/config (admin) ────────────────────────────────────────────────────
exports.updateConfig = asyncHandler(async (req, res) => {
  const { enabled, base_url, chat_model, embed_model, features } = req.body;
  if (enabled     !== undefined) await aiClient.upsertSetting('enabled',     String(!!enabled));
  if (base_url    !== undefined) await aiClient.upsertSetting('base_url',    String(base_url));
  if (chat_model  !== undefined) await aiClient.upsertSetting('chat_model',  String(chat_model));
  if (embed_model !== undefined) await aiClient.upsertSetting('embed_model', String(embed_model));
  if (features    !== undefined) await aiClient.upsertSetting('features',    JSON.stringify(features));
  respond.ok(res, 'AI config saved', await aiClient.getConfig());
});

// ── POST /ai/chat (SSE) ───────────────────────────────────────────────────────
exports.chat = asyncHandler(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return respond.badReq(res, 'message is required');

  const cfg = await aiClient.getConfig();
  if (!cfg.enabled || cfg.features.assistant === false) {
    return respond.badReq(res, 'The AI assistant is disabled.');
  }
  const hp = await aiClient.health();
  if (!hp.ok) {
    sseInit(res);
    sseSend(res, { token: `⚠️ ${hp.reason || 'The local AI service is unavailable.'}` });
    return sseDone(res);
  }

  // Grounding: permission-scoped facts + retrieved help/policy context.
  const toolNames = aiTools.routeIntents(message);
  const facts     = await aiTools.runTools(toolNames, req);
  const passages  = await aiRag.retrieve(message, 4).catch(() => []);

  const userName = req.user?.username || 'the user';
  const sys =
    `You are the in-app HR assistant for this company's HR system. You are talking to ${userName}.\n` +
    `You may describe the system's modules and capabilities (see "System capabilities" below) and explain how to use them. ` +
    `For specific data and numbers, use ONLY the "Data facts" and "Reference material" provided; if a figure isn't there, ` +
    `say you don't have it or that the user may lack permission to see it — never invent records or numbers. Answer concisely.\n` +
    `IMPORTANT: When explaining how to do something, only describe exact menu names, buttons, page names and step-by-step ` +
    `navigation if they appear in the "Reference material" below. Do NOT invent button labels, menu items, or navigation ` +
    `paths. If the reference material does not cover the exact steps, say you're not certain of the exact screen, point the ` +
    `user to the relevant module at a high level, and suggest the Help section — do not guess specific UI details.\n` +
    `\nSystem capabilities:\n${APP_OVERVIEW}\n` +
    (facts.length    ? `\nData facts (already scoped to what this user may see):\n- ${facts.join('\n- ')}\n` : '') +
    (passages.length ? `\nReference material:\n${passages.map(p => `• ${p.title}: ${p.content}`).join('\n')}\n` : '');

  // Short rolling history for context.
  const hist = await prisma.ai_messages.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: { id: 'desc' },
    take: 6,
    select: { role: true, content: true },
  }).catch(() => []);
  const historyMsgs = hist.reverse().map(h => ({ role: h.role, content: h.content }));

  const messages = [{ role: 'system', content: sys }, ...historyMsgs, { role: 'user', content: message }];

  sseInit(res);
  let aborted = false;
  req.on('close', () => { aborted = true; });
  try {
    const answer = await streamCompletion(res, messages, cfg);
    if (!aborted) {
      await prisma.ai_messages.createMany({
        data: [
          { user_id: BigInt(req.user.id), role: 'user', content: message },
          { user_id: BigInt(req.user.id), role: 'assistant', content: answer },
        ],
      }).catch(() => {});
    }
  } catch (e) {
    sseSend(res, { token: `\n\n⚠️ ${e.message || 'AI error'}` });
  }
  sseDone(res);
});

// ── POST /ai/draft (SSE) ──────────────────────────────────────────────────────
const DRAFT_PROMPTS = {
  job_description: 'Write a clear, professional job description (overview, key responsibilities, requirements).',
  review_feedback: 'Write balanced, constructive performance-review feedback (strengths and areas to improve), in a professional tone.',
  development_plan:'Write a practical employee development plan: training, mentoring, and growth objectives with concrete next steps, in a professional tone.',
  email:           'Write a concise, professional HR email.',
  policy:          'Write a clear HR policy paragraph in plain, professional language.',
};
exports.draft = asyncHandler(async (req, res) => {
  const kind    = String(req.body?.kind || '').trim();
  const context = String(req.body?.context || '').trim();
  const instruction = DRAFT_PROMPTS[kind];
  if (!instruction) return respond.badReq(res, 'Unknown draft kind');
  if (!context)     return respond.badReq(res, 'context is required');

  const cfg = await aiClient.getConfig();
  if (!cfg.enabled || cfg.features.drafting === false) return respond.badReq(res, 'AI drafting is disabled.');
  const hp = await aiClient.health();
  if (!hp.ok) { sseInit(res); sseSend(res, { token: `⚠️ ${hp.reason}` }); return sseDone(res); }

  // Honour the target field's character limit (the client also hard-stops, but instruct the
  // model so the text reads as a complete thought rather than being cut mid-sentence).
  const maxChars = Number(req.body?.maxChars);
  const limitNote = Number.isFinite(maxChars) && maxChars > 0
    ? ` Keep the entire response under ${maxChars} characters (roughly ${Math.max(1, Math.floor(maxChars / 6))} words); be concise and finish your sentences within that limit.`
    : '';

  const messages = [
    { role: 'system', content: `${instruction} Output only the requested text, no preamble.${limitNote}` },
    { role: 'user', content: context },
  ];
  sseInit(res);
  try { await streamCompletion(res, messages, cfg); }
  catch (e) { sseSend(res, { token: `\n\n⚠️ ${e.message}` }); }
  sseDone(res);
});

// ── POST /ai/ocr (multipart file) ─────────────────────────────────────────────
exports.ocr = asyncHandler(async (req, res) => {
  const cfg = await aiClient.getConfig();
  if (!cfg.enabled || cfg.features.ocr === false) return respond.badReq(res, 'AI document understanding is disabled.');
  if (!req.file?.path) return respond.badReq(res, 'No file uploaded');

  const text = await aiOcr.ocrFile(req.file.path).catch(() => '');
  if (!text) return respond.ok(res, 'OCR complete', { fields: {}, raw: '', note: 'No readable text found.' });
  const result = await aiOcr.extractClaimFields(text);
  respond.ok(res, 'OCR complete', result);
});

// ── GET /ai/insights/attrition ────────────────────────────────────────────────
exports.attritionInsights = asyncHandler(async (req, res) => {
  const cfg = await aiClient.getConfig();
  if (cfg.features.insights === false) return respond.badReq(res, 'AI insights are disabled.');
  const results = await aiAttrition.computeAttrition();
  aiAttrition.persist(results).catch(() => {}); // cache in background
  respond.ok(res, 'Attrition insights', {
    generated_at: new Date().toISOString(),
    total: results.length,
    high: results.filter(r => r.band === 'High').length,
    medium: results.filter(r => r.band === 'Medium').length,
    employees: results,
  });
});

// ── POST /ai/reindex (admin) ──────────────────────────────────────────────────
exports.reindex = asyncHandler(async (req, res) => {
  const hp = await aiClient.health();
  if (!hp.ok) return respond.badReq(res, hp.reason || 'AI service unavailable');
  const n = await aiRag.reindex();
  respond.ok(res, 'Knowledge reindexed', { chunks: n });
});

// ── Knowledge entries (admin-managed dataset) ─────────────────────────────────
exports.listKnowledge = asyncHandler(async (req, res) => {
  const rows = await prisma.ai_knowledge.findMany({
    orderBy: { title: 'asc' },
    select: { id: true, title: true, content: true, enabled: true, updated_at: true },
  }).catch(() => []);
  respond.ok(res, 'Knowledge entries', rows.map(r => ({
    id: String(r.id), title: r.title, content: r.content,
    enabled: !!r.enabled, updated_at: r.updated_at,
  })));
});

exports.createKnowledge = asyncHandler(async (req, res) => {
  const title   = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  const enabled = req.body?.enabled === false ? 0 : 1;
  if (!title)   return respond.badReq(res, 'Title is required');
  if (!content) return respond.badReq(res, 'Content is required');
  await prisma.ai_knowledge.create({
    data: { title, content, enabled: !!enabled },
  });
  respond.created(res, 'Knowledge entry added', {});
});

exports.updateKnowledge = asyncHandler(async (req, res) => {
  const id = (() => { try { return BigInt(req.params.id); } catch { return null; } })();
  if (id == null) return respond.badReq(res, 'Invalid id');
  const { title, content, enabled } = req.body || {};
  const data = {};
  if (title   !== undefined) data.title = String(title).trim();
  if (content !== undefined) data.content = String(content).trim();
  if (enabled !== undefined) data.enabled = !!enabled;
  if (!Object.keys(data).length) return respond.badReq(res, 'Nothing to update');
  await prisma.ai_knowledge.update({ where: { id }, data });
  respond.ok(res, 'Knowledge entry updated', {});
});

exports.deleteKnowledge = asyncHandler(async (req, res) => {
  const id = (() => { try { return BigInt(req.params.id); } catch { return null; } })();
  if (id == null) return respond.badReq(res, 'Invalid id');
  await prisma.ai_knowledge.delete({ where: { id } });
  respond.ok(res, 'Knowledge entry deleted', {});
});

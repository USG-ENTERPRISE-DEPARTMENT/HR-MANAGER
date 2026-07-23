/** AI assistant — config + knowledge reads. The AI backend (Ollama) may be disabled/offline, so we
 *  only require the endpoints to respond without a server error (not that AI is actually configured). */
module.exports.run = async (t) => {
  const { api } = t;
  const cfg = await api.get('/ai/config');
  t.check('GET /ai/config → 200', cfg.status === 200, { status: cfg.status });
  const health = await api.get('/ai/health');
  t.check('GET /ai/health responds (not 5xx)', health.status < 500, { status: health.status });
  const knowledge = await api.get('/ai/knowledge');
  t.check('GET /ai/knowledge responds (not 5xx)', knowledge.status < 500, { status: knowledge.status });
};

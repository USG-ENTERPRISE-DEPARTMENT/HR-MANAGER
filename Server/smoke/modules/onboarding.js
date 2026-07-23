/** Onboarding — read config + submissions, safe config re-save. */
module.exports.run = async (t) => {
  const { api } = t;
  const cfg = await api.get('/onboarding/config');
  t.check('GET /onboarding/config → 200', cfg.status === 200, { status: cfg.status, msg: cfg.body?.message });
  t.expectOk(await api.get('/onboarding/submissions'), 'GET /onboarding/submissions');

  // idempotent re-save of the current config
  const c = cfg.body?.data?.config || {};
  const save = await api.put('/onboarding/config', { enabledFields: c.enabledFields, requiredFields: c.requiredFields });
  t.check('PUT /onboarding/config (idempotent re-save)', save.status === 200, { status: save.status, msg: save.body?.message });
};

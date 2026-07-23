/** Audit logs — read-only. */
module.exports.run = async (t) => {
  const { api } = t;
  const list = await api.get('/audit-logs');
  t.check('GET /audit-logs → 200', list.status === 200, { status: list.status });
  t.expectOk(await api.get('/audit-logs/modules'), 'GET /audit-logs/modules');
};

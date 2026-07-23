/** Dashboard — read-only aggregates. */
module.exports.run = async (t) => {
  const { api } = t;
  t.expectOk(await api.get('/dashboard/summary'), 'GET /dashboard/summary');
  t.expectOk(await api.get('/dashboard/module-stats'), 'GET /dashboard/module-stats');
};

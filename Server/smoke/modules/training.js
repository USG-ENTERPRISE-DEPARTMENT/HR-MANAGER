/** Training — catalog CRUD + read nominations. */
module.exports.run = async (t) => {
  const { api } = t;
  t.expectOk(await api.get('/training/catalog'), 'GET /training/catalog');
  t.expectOk(await api.get('/training/nominations'), 'GET /training/nominations');

  let r = await api.post('/training/catalog', {
    code: t.uniq('TR').slice(-8), name: t.uniq('Course'), category: 'Technical', type: 'Internal', currency: 'USD', cost: '0',
  });
  t.check('POST /training/catalog → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const id = r.body?.data?.id;
  if (id) t.track(`/training/catalog/${id}`);
  if (id) {
    r = await api.put(`/training/catalog/${id}`, { name: t.uniq('Course2'), category: 'Technical', type: 'Internal', currency: 'USD' });
    t.check('PUT /training/catalog/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.del(`/training/catalog/${id}`);
    t.check('DELETE /training/catalog/:id → 200', r.status === 200, { status: r.status });
  }
};

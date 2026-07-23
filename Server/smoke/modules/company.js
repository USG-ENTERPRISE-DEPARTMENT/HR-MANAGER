/** Company structure — CRUD round-trip. */
module.exports.run = async (t) => {
  const { api } = t;
  t.expectOk(await api.get('/company/structures'), 'GET /company/structures');
  t.expectOk(await api.get('/company/structures/types'), 'GET /company/structures/types');

  let r = await api.post('/company/structures', { title: t.uniq('Dept'), type: 'Department' });
  t.check('POST /company/structures → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const id = r.body?.data?.id;
  if (id) t.track(`/company/structures/${id}`);

  if (id) {
    r = await api.get(`/company/structures/${id}`);
    t.check('GET /company/structures/:id', r.status === 200, { status: r.status });
    r = await api.put(`/company/structures/${id}`, { title: t.uniq('Dept2'), type: 'Department' });
    t.check('PUT /company/structures/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.del(`/company/structures/${id}`);
    t.check('DELETE /company/structures/:id → 200', r.status === 200, { status: r.status });
  }
};

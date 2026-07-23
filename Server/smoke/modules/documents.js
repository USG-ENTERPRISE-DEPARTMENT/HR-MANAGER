/** Documents — company document CRUD + read the document settings/personal lists. */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/documents/company', '/documents/employee', '/documents/settings', '/documents/my-shared', '/documents/my-personal']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  let r = await api.post('/documents/company', { name: t.uniq('Doc'), details: 'smoke' });
  t.check('POST /documents/company → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const id = r.body?.data?.id;
  if (id) t.track(`/documents/company/${id}`);
  if (id) {
    r = await api.put(`/documents/company/${id}`, { name: t.uniq('Doc2'), details: 'smoke2' });
    t.check('PUT /documents/company/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.del(`/documents/company/${id}`);
    t.check('DELETE /documents/company/:id → 200', r.status === 200, { status: r.status });
  }
};

/** Employees — read lists + create → approve → update → delete round-trip. */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/employees', '/employees/active', '/employees/paygrades', '/employees/notches']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // Employee-create required fields are driven by the admin form config (Settings → Controls →
  // Employee Form), so a portable smoke can only guarantee the locked core. createOrSkip treats a
  // config-driven 400 as a skip.
  const email = `${t.uniq('emp').toLowerCase()}@smoke.test`;
  let r = t.createOrSkip(await api.post('/employees', { firstName: 'ZZ', lastName: t.uniq('Emp'), email, work_email: email }), 'POST /employees');
  const id = r.body?.data?.id;
  if (id) t.track(`/employees/${id}`);

  if (id) {
    r = await api.get(`/employees/${id}`);
    t.check('GET /employees/:id', r.status === 200, { status: r.status });
    r = await api.put(`/employees/${id}/approve`, {});
    t.check('PUT /employees/:id/approve', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.put(`/employees/${id}`, { firstName: 'ZZ', lastName: t.uniq('Emp2'), email, work_email: email });
    t.check('PUT /employees/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.del(`/employees/${id}`);
    t.check('DELETE /employees/:id → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  }
};

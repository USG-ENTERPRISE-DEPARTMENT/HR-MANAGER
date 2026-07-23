/** Disciplinary — meta + CRUD (needs an existing employee). */
module.exports.run = async (t) => {
  const { api } = t;
  t.expectOk(await api.get('/disciplinary/meta'), 'GET /disciplinary/meta');
  t.expectOk(await api.get('/disciplinary'), 'GET /disciplinary');

  const empId = await t.firstId('/employees');
  if (!empId) { t.check('disciplinary CRUD (needs an employee)', true, 'skipped — no employee'); return; }

  let r = await api.post('/disciplinary', {
    employee_id: String(empId), incident_date: '2030-01-15',
    incident_type: 'Verbal Warning', description: t.uniq('incident'), severity: 'Low', status: 'Open',
  });
  t.check('POST /disciplinary → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const id = r.body?.data?.id;
  if (id) t.track(`/disciplinary/${id}`);
  if (id) {
    r = await api.put(`/disciplinary/${id}`, { description: t.uniq('incident2'), status: 'Resolved' });
    t.check('PUT /disciplinary/:id', r.status === 200, { status: r.status });
    r = await api.del(`/disciplinary/${id}`);
    t.check('DELETE /disciplinary/:id → 200', r.status === 200, { status: r.status });
  }
};

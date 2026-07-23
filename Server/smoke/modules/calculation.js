/** Calculation (payroll setup) — pay-frequencies, calc-groups, columns, saved-calcs, payslip-templates. */
module.exports.run = async (t) => {
  const { api } = t;

  for (const p of ['/payroll/columns', '/payroll/pay-frequencies', '/payroll/employees',
                   '/payroll/calc-groups', '/payroll/saved-calculations', '/payroll/payslip-templates']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // pay frequency CRUD (LAST_INSERT_ID → builder path)
  let r = await api.post('/payroll/pay-frequencies', { name: t.uniq('Freq'), description: 'smoke', sort_order: 50 });
  t.check('POST /payroll/pay-frequencies → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const freqId = r.body?.data?.id;
  if (freqId) t.track(`/payroll/pay-frequencies/${freqId}`);
  if (freqId) {
    r = await api.put(`/payroll/pay-frequencies/${freqId}`, { name: t.uniq('Freq2'), is_active: false, sort_order: 60 });
    t.check('PUT /payroll/pay-frequencies/:id', r.status === 200, { status: r.status });
  }

  // calc group CRUD
  r = await api.post('/payroll/calc-groups', { name: t.uniq('CalcGrp'), details: 'smoke' });
  t.check('POST /payroll/calc-groups → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const grpId = r.body?.data?.id;
  if (grpId) t.track(`/payroll/calc-groups/${grpId}`);

  // payroll column CRUD (nextId alias + boolean visible/include_in_net + junctions)
  r = await api.post('/payroll/columns', { name: t.uniq('Col'), payment_deduction: 'Payment', visible: 1, include_in_net: 1 });
  t.check('POST /payroll/columns → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const colId = r.body?.data?.id;
  if (colId) t.track(`/payroll/columns/${colId}`);
  if (colId) {
    r = await api.put(`/payroll/columns/${colId}`, { name: t.uniq('Col2'), visible: 0, include_in_net: 1 });
    t.check('PUT /payroll/columns/:id', r.status === 200, { status: r.status, msg: r.body?.message });
  }

  // saved calculation with bracket items (nextItemId alias + CONCAT limits)
  r = await api.post('/payroll/saved-calculations', {
    name: t.uniq('Saved'), target_type: 'component', target_name: 'X',
    calculation_group_id: grpId ? String(grpId) : null,
    items: [{ lower_limit_condition: 'NO_LOWER_LIMIT', lower_limit: '', upper_limit_condition: 'NO_UPPER_LIMIT', upper_limit: '', value: '100' }],
  });
  t.check('POST /payroll/saved-calculations → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const savedId = r.body?.data?.id;
  if (savedId) {
    t.track(`/payroll/saved-calculations/${savedId}`);
    r = await api.get(`/payroll/saved-calculations/${savedId}`);
    t.check('GET /payroll/saved-calculations/:id (CONCAT limits)', r.status === 200 && Array.isArray(r.body?.data?.items), { status: r.status });
  }

  // payslip template CRUD (show_* booleans)
  r = await api.post('/payroll/payslip-templates', { template_name: t.uniq('Tpl'), show_emp_id: true, show_bank_account: false });
  t.check('POST /payroll/payslip-templates → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const tplId = r.body?.data?.id;
  if (tplId) t.track(`/payroll/payslip-templates/${tplId}`);
};

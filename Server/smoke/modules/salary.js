/**
 * Salary module smoke test — component types, components, paygrades, notches, payment types.
 * CRUD round-trips on ZZ_-prefixed test data, cleaned up after.
 */
module.exports.run = async (t) => {
  const { api } = t;

  // ── reads ────────────────────────────────────────────────────────────────
  t.expectOk(await api.get('/salary/refs'), 'GET /salary/refs');
  t.expectOk(await api.get('/salary/paygrades'), 'GET /salary/paygrades');
  t.expectOk(await api.get('/salary/component-types'), 'GET /salary/component-types');
  t.expectOk(await api.get('/salary/components'), 'GET /salary/components');
  t.expectOk(await api.get('/salary/notches'), 'GET /salary/notches');
  t.expectOk(await api.get('/salary/payment-types'), 'GET /salary/payment-types');
  t.expectOk(await api.get('/salary/employee-components'), 'GET /salary/employee-components');

  // ── component type CRUD (unique code) ────────────────────────────────────
  const ctCode = t.uniq('CT').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12);
  let r = await api.post('/salary/component-types', { code: ctCode, name: t.uniq('CompType'), description: 'smoke' });
  t.check('createSalaryComponentType → 201', r.status === 201, { status: r.status, body: r.body?.message });
  const ctId = r.body?.data?.id;
  if (ctId) t.track(`/salary/component-types/${ctId}`);
  r = await api.put(`/salary/component-types/${ctId}`, { code: ctCode, name: t.uniq('CompType2'), description: 'smoke2' });
  t.check('updateSalaryComponentType', r.status === 200 && r.body?.data?.name?.includes('CompType2'), r.body?.data?.name);

  // ── salary component CRUD ────────────────────────────────────────────────
  r = await api.post('/salary/components', { name: t.uniq('Comp'), componentType: ctId ? String(ctId) : null });
  t.check('createSalaryComponent → 201', r.status === 201, { status: r.status, body: r.body?.message });
  const compId = r.body?.data?.id;
  if (compId) t.track(`/salary/components/${compId}`);
  r = await api.put(`/salary/components/${compId}`, { name: t.uniq('Comp2'), componentType: ctId ? String(ctId) : null });
  t.check('updateSalaryComponent', r.status === 200 && r.body?.data?.name?.includes('Comp2'), r.body?.data?.name);

  // ── paygrade CRUD ────────────────────────────────────────────────────────
  r = await api.post('/salary/paygrades', { name: t.uniq('PG'), currency: 'USD', min_salary: '100', max_salary: '10000' });
  t.check('createPaygrade → 201', r.status === 201, { status: r.status, body: r.body?.message });
  const pgId = r.body?.data?.id;
  if (pgId) t.track(`/salary/paygrades/${pgId}`);
  r = await api.put(`/salary/paygrades/${pgId}`, { name: t.uniq('PG2'), currency: 'USD', min_salary: '100', max_salary: '20000' });
  t.check('updatePaygrade', r.status === 200 && r.body?.data?.name?.includes('PG2'), r.body?.data?.name);

  // ── notch CRUD (numeric amount + band validation + dup 409) ──────────────
  if (pgId) {
    r = await api.post('/salary/notches', { name: t.uniq('Notch'), paygradeId: String(pgId), currency: 'USD', amount: '5000' });
    t.check('createNotch (in-band) → 201', r.status === 201, { status: r.status, body: r.body?.message });
    const notchId = r.body?.data?.id;
    if (notchId) t.track(`/salary/notches/${notchId}`);

    r = await api.post('/salary/notches', { name: t.uniq('NotchDup'), paygradeId: String(pgId), currency: 'USD', amount: '5000' });
    t.check('createNotch duplicate amount → 409', r.status === 409, { status: r.status });

    r = await api.post('/salary/notches', { name: t.uniq('NotchOOB'), paygradeId: String(pgId), currency: 'USD', amount: '999999' });
    t.check('createNotch out-of-band → 400', r.status === 400, { status: r.status });

    // paygrade component (dynamic table + numeric amount write)
    if (compId) {
      r = await api.post('/salary/paygrade-components', { target_id: String(pgId), component: String(compId), amount: '250', working_days: 30 });
      t.check('createPaygradeComponent → 201', r.status === 201, { status: r.status, body: r.body?.message });
      const pcId = r.body?.data?.id;
      if (pcId) t.track(`/salary/paygrade-components/${pcId}`);
    }
  }

  // ── payment type CRUD ────────────────────────────────────────────────────
  r = await api.post('/salary/payment-types', { name: t.uniq('PayType'), description: 'smoke', generate_payslip: true });
  t.check('createPaymentType → 201', r.status === 201, { status: r.status, body: r.body?.message });
  const ptId = r.body?.data?.id;
  if (ptId) t.track(`/salary/payment-types/${ptId}`);
  r = await api.put(`/salary/payment-types/${ptId}`, { name: t.uniq('PayType2'), description: 'x', generate_payslip: false });
  t.check('updatePaymentType', r.status === 200 && r.body?.data?.name?.includes('PayType2'), r.body?.data?.name);

  // ── delete round-trip verification on one resource (payment type) ────────
  if (ptId) {
    r = await api.del(`/salary/payment-types/${ptId}`);
    t.check('deletePaymentType → 200', r.status === 200, { status: r.status });
    // it was tracked; deleting again in cleanup is a harmless no-op
  }
};

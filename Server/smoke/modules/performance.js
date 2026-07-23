/** Performance — meta, cycle CRUD, competency CRUD (boolean is_active), goals need an employee. */
module.exports.run = async (t) => {
  const { api } = t;

  t.expectOk(await api.get('/performance/meta'), 'GET /performance/meta');
  t.expectOk(await api.get('/performance/cycles'), 'GET /performance/cycles');
  t.expectOk(await api.get('/performance/competencies'), 'GET /performance/competencies');
  t.expectOk(await api.get('/performance/goals'), 'GET /performance/goals');
  t.expectOk(await api.get('/performance/reviews'), 'GET /performance/reviews');

  // cycle CRUD
  let r = await api.post('/performance/cycles', { name: t.uniq('Cycle'), type: 'Annual', period_start: '2030-01-01', period_end: '2030-12-31' });
  t.check('POST /performance/cycles → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const cycleId = r.body?.data?.id;
  if (cycleId) t.track(`/performance/cycles/${cycleId}`);
  if (cycleId) {
    r = await api.get(`/performance/cycles/${cycleId}`);
    t.check('GET /performance/cycles/:id', r.status === 200, { status: r.status });
    r = await api.put(`/performance/cycles/${cycleId}`, { notes: t.uniq('note') });
    t.check('PUT /performance/cycles/:id', r.status === 200, { status: r.status });
  }

  // competency write path (create → update is_active) — no DELETE endpoint exists, so to keep the
  // suite clean we exercise create+update only when explicitly enabled (SMOKE_ALLOW_LEFTOVERS=1);
  // otherwise we cover competencies read-only above.
  if (process.env.SMOKE_ALLOW_LEFTOVERS === '1') {
    r = await api.post('/performance/competencies', { name: t.uniq('Comp'), category: 'ZZ', description: 'smoke' });
    t.check('POST /performance/competencies → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
    const compId = r.body?.data?.id;
    if (compId) {
      r = await api.put(`/performance/competencies/${compId}`, { is_active: false });
      t.check('PUT /performance/competencies/:id (is_active=false)', r.status === 200 && !r.body?.data?.is_active, { active: r.body?.data?.is_active });
    }
  }
};

/** Payroll runs — create → update → generate → read data → delete. GL posting stays off (we never
 *  finalize), so no external ledger call is made. */
module.exports.run = async (t) => {
  const { api } = t;
  t.expectOk(await api.get('/payroll/runs'), 'GET /payroll/runs');

  // pick a pay frequency that exists (reuse the seeded/real ones)
  const freqId = await t.firstId('/payroll/pay-frequencies');
  const freq = freqId != null ? Number(freqId) : 1;

  let r = await api.post('/payroll/runs', { name: t.uniq('Run'), pay_frequency: freq, date_start: '2030-01-01', date_end: '2030-01-31' });
  t.check('POST /payroll/runs → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const runId = r.body?.data?.id;
  if (runId) t.track(`/payroll/runs/${runId}`);

  if (runId) {
    r = await api.put(`/payroll/runs/${runId}`, { name: t.uniq('Run2'), pay_frequency: freq, date_start: '2030-01-01', date_end: '2030-01-31' });
    t.check('PUT /payroll/runs/:id', r.status === 200, { status: r.status, msg: r.body?.message });

    // generate (calc engine) — returns 200 whether or not employees exist for this frequency
    r = await api.post(`/payroll/runs/${runId}/generate`, {});
    t.check('POST /payroll/runs/:id/generate → 200', r.status === 200, { status: r.status, msg: r.body?.message });

    r = await api.get(`/payroll/runs/${runId}/data`);
    t.check('GET /payroll/runs/:id/data', r.status === 200, { status: r.status });
    // A just-generated run has cells for every currently-relevant column, so nothing is stale. (The count
    // is scoped to the run's report template, not every enabled column — new off-template columns don't nag.)
    t.check('fresh run reports no stale columns', r.body?.data?.staleColumnCount === 0, { stale: r.body?.data?.staleColumnCount });
    // Template column sets are exposed (null or array) so the approver review shows the run's report columns.
    const tv = r.body?.data?.templateVisibleCols;
    t.check('data carries template column sets', tv === null || Array.isArray(tv), { templateVisibleCols: tv });

    r = await api.get(`/payroll/runs/${runId}/audit`);
    t.check('GET /payroll/runs/:id/audit', r.status === 200, { status: r.status });

    r = await api.del(`/payroll/runs/${runId}`);
    t.check('DELETE /payroll/runs/:id → 200', r.status === 200, { status: r.status, msg: r.body?.message });
  }
};

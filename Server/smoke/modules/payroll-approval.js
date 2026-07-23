/** Payroll multi-stage approval flow — configure a flow, walk a run through the stages, and assert a
 *  wrong approver is blocked. Restores the flow config afterward. */
module.exports.run = async (t) => {
  const { api } = t;

  // remember the existing flow + self-approval control so we can restore them
  const before = await api.get('/payroll/approval-flow');
  const savedFlow = Array.isArray(before.body?.data) ? before.body.data : [];
  const ctl = await api.get('/settings/controls');
  const savedSelf = ctl.body?.data?.approval_payroll_self ?? '0';
  // the suite runs as one user (super-admin), so allow self-approval for the duration of this test
  await api.put('/settings/controls', { approval_payroll_self: '1' });
  const restore = async () => {
    await api.put('/payroll/approval-flow', { stages: savedFlow });
    await api.put('/settings/controls', { approval_payroll_self: savedSelf });
  };

  const freqId = await t.firstId('/payroll/pay-frequencies');
  const freq = freqId != null ? Number(freqId) : 1;
  const mkRun = async (name) => {
    const r = await api.post('/payroll/runs', { name: t.uniq(name), pay_frequency: freq, date_start: '2030-01-01', date_end: '2030-01-31' });
    const id = r.body?.data?.id;
    if (id) {
      t.track(`/payroll/runs/${id}`);
      const g = await api.post(`/payroll/runs/${id}/generate`, {});
      t.check(`  generate ${name} → 200`, g.status === 200, { status: g.status, msg: g.body?.message });
    }
    return id;
  };

  try {
    // ── validation ──
    let r = await api.put('/payroll/approval-flow', { stages: [{ name: '', approverType: 'role', approverId: '1' }] });
    t.check('PUT flow rejects a nameless stage → 400', r.status === 400, { status: r.status });

    // ── happy path: 2 super-admin-approvable stages ──
    r = await api.put('/payroll/approval-flow', { stages: [
      { name: 'Finance', approverType: 'role', approverId: '1', approverLabel: 'super-admin' },
      { name: 'Final',   approverType: 'role', approverId: '1', approverLabel: 'super-admin' },
    ]});
    t.check('PUT approval-flow (2 stages) → 200', r.status === 200 && r.body?.data?.length === 2, { status: r.status });

    // ── login carries the stage-approver flag when the user's role is named in the flow ──
    // (this is what surfaces Central Approval to a stage approver who lacks a blanket approve_* perm)
    const creds = { email: t.email, password: process.env.SMOKE_PASSWORD || 'pass1234' };
    let li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover true (role named in flow)', li.status === 200 && li.body?.data?.isStageApprover === true, { flag: li.body?.data?.isStageApprover });

    const runId = await mkRun('ApprRun');
    r = await api.post(`/payroll/runs/${runId}/submit`, {});
    t.check('submit → Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', r.body?.data?.status);

    r = await api.get(`/payroll/runs/${runId}/stages`);
    t.check('run has 2 snapshotted stages, first Pending', r.status === 200 && r.body?.data?.length === 2 && r.body.data[0].status === 'Pending', { n: r.body?.data?.length, s0: r.body?.data?.[0]?.status });

    // the runs list exposes the current pending stage so Central Approval can build a per-approver queue
    r = await api.get('/payroll/runs');
    const listed = (r.body?.data || []).find(x => String(x.id) === String(runId));
    t.check('runs list carries current-stage approver (Finance)', !!listed && listed.cur_stage_name === 'Finance' && String(listed.cur_approver_label) === 'super-admin', { stage: listed?.cur_stage_name, label: listed?.cur_approver_label });

    r = await api.post(`/payroll/runs/${runId}/approve`, {});
    t.check('approve stage 1 → still Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', { status: r.status, run: r.body?.data?.status });

    r = await api.get(`/payroll/runs/${runId}/stages`);
    t.check('  stage 1 Approved, stage 2 Pending', r.body?.data?.[0]?.status === 'Approved' && r.body?.data?.[1]?.status === 'Pending', r.body?.data?.map(s => s.status));

    r = await api.post(`/payroll/runs/${runId}/approve`, {});
    t.check('approve stage 2 (last) → Approved', r.status === 200 && r.body?.data?.status === 'Approved', { status: r.status, run: r.body?.data?.status });

    // ── authorization: a stage the signed-in user can't approve → 403 ──
    r = await api.put('/payroll/approval-flow', { stages: [{ name: 'Locked', approverType: 'role', approverId: '999', approverLabel: 'ZZ_nobody_role' }] });
    t.check('PUT single locked-stage flow → 200', r.status === 200, { status: r.status });

    // the flow now names only a role the smoke user lacks → login flag flips back to false
    li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover false (user not in flow)', li.status === 200 && li.body?.data?.isStageApprover === false, { flag: li.body?.data?.isStageApprover });

    const runId2 = await mkRun('LockedRun');
    r = await api.post(`/payroll/runs/${runId2}/submit`, {});
    t.check('submit locked run → Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', { runId2, status: r.status, body: JSON.stringify(r.body).slice(0, 160) });
    r = await api.post(`/payroll/runs/${runId2}/approve`, {});
    t.check('approve as non-approver → 403', r.status === 403, { status: r.status, msg: r.body?.message });
    r = await api.post(`/payroll/runs/${runId2}/reject`, { reason: 'x' });
    t.check('reject as non-approver → 403', r.status === 403, { status: r.status });
  } finally {
    await restore();
  }
};

/** Medical multi-stage approval flow — configure a flow, walk a staff medical request through the stages,
 *  and assert a wrong approver is blocked. Restores the flow + controls afterward. */
module.exports.run = async (t) => {
  const { api } = t;

  // remember existing flow + controls so we can restore them
  const before = await api.get('/medical/approval-flow');
  const savedFlow = Array.isArray(before.body?.data) ? before.body.data : [];
  const ctl = await api.get('/settings/controls');
  const savedApproval = ctl.body?.data?.approval_medical ?? '0';
  const savedSelf = ctl.body?.data?.approval_medical_self ?? '1';
  const savedPay = ctl.body?.data?.medical_payments_enabled ?? '1';
  // one-user suite (super-admin): enable the workflow + self-approval; disable GL posting so the test
  // exercises the approval flow in isolation (final approval won't attempt a real ledger post).
  await api.put('/settings/controls', { approval_medical: '1', approval_medical_self: '1', medical_payments_enabled: '0' });
  const restore = async () => {
    await api.put('/medical/approval-flow', { stages: savedFlow });
    await api.put('/settings/controls', { approval_medical: savedApproval, approval_medical_self: savedSelf, medical_payments_enabled: savedPay });
  };

  const empId = await t.firstId('/employees/active');
  const mkStaff = async (name) => {
    const r = await api.post('/medical/staff', {
      employee: String(empId), admission_date: '2030-01-01', illness_type: t.uniq(name), cost: '10',
    });
    const id = r.body?.data?.id;
    if (id) t.track(`/medical/staff/${id}`);
    return id;
  };

  try {
    // ── no-flow single-stage path still works (workflow on, zero stages → one blanket-permission approval) ──
    await api.put('/medical/approval-flow', { stages: [] });
    let r;
    const noFlowId = await mkStaff('NoFlowStaff');
    r = await api.post(`/medical/staff/${noFlowId}/submit`, {});
    t.check('no-flow submit → Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', r.body?.data?.status);
    r = await api.get(`/medical/requests/staff/${noFlowId}/stages`);
    t.check('no-flow record has zero stages', r.status === 200 && (r.body?.data?.length ?? 0) === 0, { n: r.body?.data?.length });
    r = await api.post(`/medical/staff/${noFlowId}/approve`, {});
    t.check('no-flow approve (blanket perm) → Approved', r.status === 200 && r.body?.data?.status === 'Approved', { status: r.status, rec: r.body?.data?.status });

    // ── validation ──
    r = await api.put('/medical/approval-flow', { stages: [{ name: '', approverType: 'role', approverId: '1' }] });
    t.check('PUT flow rejects a nameless stage → 400', r.status === 400, { status: r.status });

    // ── happy path: 2 super-admin-approvable stages ──
    r = await api.put('/medical/approval-flow', { stages: [
      { name: 'Officer', approverType: 'role', approverId: '1', approverLabel: 'super-admin' },
      { name: 'Final',   approverType: 'role', approverId: '1', approverLabel: 'super-admin' },
    ]});
    t.check('PUT medical approval-flow (2 stages) → 200', r.status === 200 && r.body?.data?.length === 2, { status: r.status });

    // login carries the stage-approver flag when the user's role is named in the flow
    const creds = { email: t.email, password: process.env.SMOKE_PASSWORD || 'pass1234' };
    let li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover true (role in medical flow)', li.status === 200 && li.body?.data?.isStageApprover === true, { flag: li.body?.data?.isStageApprover });

    const id = await mkStaff('ApprStaff');
    r = await api.post(`/medical/staff/${id}/submit`, {});
    t.check('submit → Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', r.body?.data?.status);

    r = await api.get(`/medical/requests/staff/${id}/stages`);
    t.check('record has 2 snapshotted stages, first Pending', r.status === 200 && r.body?.data?.length === 2 && r.body.data[0].status === 'Pending', { n: r.body?.data?.length, s0: r.body?.data?.[0]?.status });

    r = await api.post(`/medical/staff/${id}/approve`, {});
    t.check('approve stage 1 → still Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', { status: r.status, rec: r.body?.data?.status });

    r = await api.get(`/medical/requests/staff/${id}/stages`);
    t.check('  stage 1 Approved, stage 2 Pending', r.body?.data?.[0]?.status === 'Approved' && r.body?.data?.[1]?.status === 'Pending', r.body?.data?.map(s => s.status));

    r = await api.post(`/medical/staff/${id}/approve`, {});
    t.check('approve stage 2 (last) → Approved', r.status === 200 && r.body?.data?.status === 'Approved', { status: r.status, rec: r.body?.data?.status });

    // ── authorization: a stage the signed-in user can't approve → 403 ──
    r = await api.put('/medical/approval-flow', { stages: [{ name: 'Locked', approverType: 'role', approverId: '999', approverLabel: 'ZZ_nobody_role' }] });
    t.check('PUT single locked-stage flow → 200', r.status === 200, { status: r.status });

    li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover false (user not in flow)', li.status === 200 && li.body?.data?.isStageApprover === false, { flag: li.body?.data?.isStageApprover });

    const id2 = await mkStaff('LockedStaff');
    r = await api.post(`/medical/staff/${id2}/submit`, {});
    t.check('submit locked record → Pending Approval', r.status === 200 && r.body?.data?.status === 'Pending Approval', { id2, status: r.status });
    r = await api.post(`/medical/staff/${id2}/approve`, {});
    t.check('approve as non-approver → 403', r.status === 403, { status: r.status, msg: r.body?.message });
    r = await api.post(`/medical/staff/${id2}/reject`, { reason: 'x' });
    t.check('reject as non-approver → 403', r.status === 403, { status: r.status });
  } finally {
    await restore();
  }
};

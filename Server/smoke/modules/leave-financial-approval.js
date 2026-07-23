/** Leave allowance amount-range approval flow — config validation/persistence + the stage-approver login
 *  flag. (The full apply→approve→allowance stage walk needs heavy leave setup and is exercised separately.)
 *  Restores the flow config afterward. */
module.exports.run = async (t) => {
  const { api } = t;

  const before = await api.get('/leave/approval-flow');
  const savedFlow = Array.isArray(before.body?.data) ? before.body.data : [];
  const restore = async () => { await api.put('/leave/approval-flow', { stages: savedFlow }); };

  try {
    // ── validation ──
    let r = await api.put('/leave/approval-flow', { stages: [{ name: '', approverType: 'role', approverId: '1', minAmount: 0 }] });
    t.check('PUT flow rejects a nameless stage → 400', r.status === 400, { status: r.status });

    r = await api.put('/leave/approval-flow', { stages: [{ name: 'Bad', approverType: 'role', approverId: '1', minAmount: 5000, maxAmount: 1000 }] });
    t.check('PUT flow rejects max ≤ min → 400', r.status === 400, { status: r.status });

    // ── save a 2-stage ranged flow ──
    r = await api.put('/leave/approval-flow', { stages: [
      { name: 'Finance', approverType: 'role', approverId: '1', approverLabel: 'super-admin', minAmount: 0,    maxAmount: 5000 },
      { name: 'CFO',     approverType: 'role', approverId: '1', approverLabel: 'super-admin', minAmount: 5000, maxAmount: null },
    ]});
    t.check('PUT ranged approval-flow (2 stages) → 200', r.status === 200 && r.body?.data?.length === 2, { status: r.status });

    r = await api.get('/leave/approval-flow');
    const flow = r.body?.data || [];
    t.check('flow persists ranges', flow[0]?.minAmount === 0 && flow[0]?.maxAmount === 5000 && flow[1]?.maxAmount === null, { s0: flow[0], s1: flow[1] });

    // ── login carries the stage-approver flag when the user's role is named in the leave flow ──
    const creds = { email: t.email, password: process.env.SMOKE_PASSWORD || 'pass1234' };
    let li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover true (role in leave flow)', li.status === 200 && li.body?.data?.isStageApprover === true, { flag: li.body?.data?.isStageApprover });

    // clearing the flow flips the flag back (assuming the user isn't named in payroll/medical flows either)
    r = await api.put('/leave/approval-flow', { stages: [{ name: 'Locked', approverType: 'role', approverId: '999', approverLabel: 'ZZ_nobody_role', minAmount: 0, maxAmount: null }] });
    t.check('PUT single locked-stage flow → 200', r.status === 200, { status: r.status });
    li = await api.post('/login', creds, { auth: false });
    t.check('login → isStageApprover false (user not in flow)', li.status === 200 && li.body?.data?.isStageApprover === false, { flag: li.body?.data?.isStageApprover });
  } finally {
    await restore();
  }
};

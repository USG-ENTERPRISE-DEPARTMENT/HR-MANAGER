/** Attendance — read views + a safe settings re-save round-trip. */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/attendance/settings', '/attendance/today', '/attendance/punch-policy', '/attendance']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // settings save round-trip: re-save current values (upsert-per-key, no real change), confirm 200
  const cur = await api.get('/attendance/settings');
  const payload = cur.body?.data && typeof cur.body.data === 'object' ? cur.body.data : {};
  const save = await api.put('/attendance/settings', payload);
  t.check('PUT /attendance/settings (idempotent re-save)', save.status === 200, { status: save.status, msg: save.body?.message });
};

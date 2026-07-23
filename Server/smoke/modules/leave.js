/** Leave — read setup lists + CRUD on leave types, holidays, and groups. */
module.exports.run = async (t) => {
  const { api } = t;

  for (const p of ['/leave/types', '/leave/periods', '/leave/holidays', '/leave/workweek', '/leave/groups', '/leave/rules']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // leave type CRUD
  let r = await api.post('/leave/types', { name: t.uniq('LType'), code: t.uniq('LT').slice(-8), days_per_year: 10 });
  t.check('POST /leave/types → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const typeId = r.body?.data?.id;
  if (typeId) t.track(`/leave/types/${typeId}`);
  if (typeId) {
    r = await api.put(`/leave/types/${typeId}`, { name: t.uniq('LType2'), days_per_year: 12 });
    t.check('PUT /leave/types/:id', r.status === 200, { status: r.status, msg: r.body?.message });
  }

  // holiday CRUD
  r = await api.post('/leave/holidays', { name: t.uniq('Holiday'), dateh: '2030-12-25' });
  t.check('POST /leave/holidays → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const holId = r.body?.data?.id;
  if (holId) t.track(`/leave/holidays/${holId}`);

  // group CRUD
  r = await api.post('/leave/groups', { name: t.uniq('LGroup'), description: 'smoke' });
  t.check('POST /leave/groups → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const grpId = r.body?.data?.id;
  if (grpId) {
    t.track(`/leave/groups/${grpId}`);
    r = await api.put(`/leave/groups/${grpId}`, { name: t.uniq('LGroup2'), description: 'x' });
    t.check('PUT /leave/groups/:id', r.status === 200, { status: r.status });
  }
};

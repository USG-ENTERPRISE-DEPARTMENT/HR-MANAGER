/** Medical — read lists + hospital CRUD + limit CRUD (limit needs a paygrade). */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/medical/hospitals', '/medical/limits', '/medical/staff', '/medical/claims', '/medical/settings']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // hospital CRUD
  let r = await api.post('/medical/hospitals', { name: t.uniq('Hosp'), account: t.uniq('ACC').slice(-8), type: 'Hospital' });
  t.check('POST /medical/hospitals → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const hId = r.body?.data?.id;
  if (hId) t.track(`/medical/hospitals/${hId}`);
  if (hId) {
    r = await api.put(`/medical/hospitals/${hId}`, { name: t.uniq('Hosp2'), account: t.uniq('ACC2').slice(-8), type: 'Clinic' });
    t.check('PUT /medical/hospitals/:id', r.status === 200, { status: r.status });
  }

  // limit CRUD (needs a free paygrade — medical limit is unique per paygrade). Create a ZZ paygrade.
  const pg = await api.post('/salary/paygrades', { name: t.uniq('MedPG'), currency: 'USD', min_salary: '100', max_salary: '10000' });
  const pgId = pg.body?.data?.id;
  if (pgId) {
    t.track(`/salary/paygrades/${pgId}`);
    r = await api.post('/medical/limits', { paygrade: String(pgId), currency: 'USD', amount: '5000' });
    t.check('POST /medical/limits → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
    const limId = r.body?.data?.id;
    if (limId) {
      t.track(`/medical/limits/${limId}`);
      r = await api.put(`/medical/limits/${limId}`, { paygrade: String(pgId), currency: 'USD', amount: '6000' });
      t.check('PUT /medical/limits/:id', r.status === 200, { status: r.status });
    }
  }
};

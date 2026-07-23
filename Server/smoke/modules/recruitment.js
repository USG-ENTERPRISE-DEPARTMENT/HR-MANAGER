/** Recruitment — job CRUD + read candidates/applications/interviews. */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/recruitment/jobs', '/recruitment/candidates', '/recruitment/applications', '/recruitment/interviews']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  let r = await api.post('/recruitment/jobs', {
    title: t.uniq('Job'), shortDescription: 'smoke', description: 'smoke role', employementType: 'Full-time', status: 'Draft',
  });
  t.check('POST /recruitment/jobs → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const id = r.body?.data?.id;
  if (id) t.track(`/recruitment/jobs/${id}`);
  if (id) {
    r = await api.put(`/recruitment/jobs/${id}`, { title: t.uniq('Job2'), employementType: 'Full-time', status: 'Draft' });
    t.check('PUT /recruitment/jobs/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.del(`/recruitment/jobs/${id}`);
    t.check('DELETE /recruitment/jobs/:id → 200', r.status === 200, { status: r.status });
  }
};

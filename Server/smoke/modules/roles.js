/** Roles & permissions — RBAC read + role CRUD + status toggle. */
module.exports.run = async (t) => {
  const { api } = t;

  const roles = await api.get('/roles');
  t.check('GET /roles → 200', roles.status === 200, { status: roles.status });
  t.check('  roles carry permission arrays', Array.isArray(roles.body?.data) && roles.body.data.every(r => Array.isArray(r.permissions)), roles.body?.data?.[0] && Object.keys(roles.body.data[0]));
  const sa = (roles.body?.data || []).find(r => r.name === 'super-admin');
  t.check('  super-admin has permissions assigned', sa && sa.permissions.length > 0, { perms: sa?.permissions?.length });

  t.expectOk(await api.get('/permissions'), 'GET /permissions');

  // create → update → status → delete
  let r = await api.post('/roles', { name: t.uniq('Role'), guard_name: 'api', description: 'smoke', is_system: false });
  t.check('POST /roles → 2xx', r.status >= 200 && r.status < 300, { status: r.status, msg: r.body?.message });
  const roleId = r.body?.data?.id;
  if (roleId) t.track(`/roles/${roleId}`);

  if (roleId) {
    r = await api.put(`/roles/${roleId}`, { name: t.uniq('Role2'), description: 'smoke2' });
    t.check('PUT /roles/:id', r.status === 200, { status: r.status, msg: r.body?.message });
    r = await api.put(`/roles/${roleId}/status`, { status: '0' });
    t.check('PUT /roles/:id/status', r.status === 200, { status: r.status });
    r = await api.del(`/roles/${roleId}`);
    t.check('DELETE /roles/:id → 200', r.status === 200, { status: r.status });
  }
};

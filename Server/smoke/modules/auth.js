/** Auth module — the harness already logged in; verify /me, token refresh, and the token-expiry contract. */
module.exports.run = async (t) => {
  const { api } = t;
  const me = await api.get('/me');
  t.check('GET /me → 200', me.status === 200, { status: me.status, msg: me.body?.message });
  t.check('  /me returns a user + userType', !!me.body?.data && ('userType' in me.body.data), Object.keys(me.body?.data || {}).slice(0, 6));

  // refresh-token uses an httpOnly cookie; without it we expect a clean 401 (not a crash)
  const rt = await api.get('/user/refresh-token');
  t.check('GET /user/refresh-token responds (200 or 401)', [200, 401].includes(rt.status), { status: rt.status });

  // Core contract: an invalid/expired access token must return 401 (so the client can silent-refresh) —
  // NOT 500. jwt.verify throws for a malformed token; checkToken must map that to 401.
  const bad = await fetch(`${t.base}/me`, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not.a.jwt' },
  });
  t.check('invalid access token → 401 (not 500)', bad.status === 401, { status: bad.status });

  // Logout endpoint is wired and responds without a crash even when no refresh cookie is present.
  const lo = await api.post('/logout', {});
  t.check('POST /logout responds 200', lo.status === 200, { status: lo.status, msg: lo.body?.message });
};

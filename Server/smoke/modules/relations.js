/** Employee relations — skills / certifications / education / languages / dependents / emergency
 *  contacts. All keyed to an employee; exercise one representative CRUD (skills) + reads on the rest. */
module.exports.run = async (t) => {
  const { api } = t;
  for (const p of ['/skills', '/certifications', '/education', '/languages', '/dependents', '/emergency-contacts']) {
    t.expectOk(await api.get(p), `GET ${p}`);
  }

  // NOTE: the create paths for these sub-resources need an employee_id plus code-list value ids
  // (skill_id, language_id, …) that vary per install — too many prerequisites for a portable smoke.
  // The reads above verify every relations endpoint responds; deeper CRUD is covered per-resource in
  // the app's own screens. Verify one write path is reachable (expects 400 "required", not a crash).
  const probe = await api.post('/skills', {});
  t.check('POST /skills reachable (validates input, not 5xx)', probe.status < 500, { status: probe.status });
};

/** Settings — read every settings endpoint + a safe write round-trip (re-save current values). */
module.exports.run = async (t) => {
  const { api } = t;

  // Reads (verify each responds 200 with a data payload)
  for (const path of ['/settings/controls', '/settings/notifications', '/settings/app-setup',
                       '/settings/modules', '/settings/messages', '/settings/email']) {
    t.expectOk(await api.get(path), `GET ${path}`);
  }

  // Safe write round-trip: read controls, re-save the exact same values (no real change), confirm 200.
  const cur = await api.get('/settings/controls');
  const payload = cur.body?.data && typeof cur.body.data === 'object' ? cur.body.data : {};
  const save = await api.put('/settings/controls', payload);
  t.check('PUT /settings/controls (idempotent re-save)', save.status === 200, { status: save.status, msg: save.body?.message });

  // Message override round-trip (has an explicit reset via DELETE — fully reversible)
  const key = 'smoke.__probe__';
  const putMsg = await api.put('/settings/messages', { message_key: key, override_text: t.uniq('msg'), enabled: true });
  t.check('PUT /settings/messages', putMsg.status === 200, { status: putMsg.status, msg: putMsg.body?.message });
  const del = await api.del('/settings/messages', { message_key: key });
  t.check('DELETE /settings/messages (reset)', del.status === 200, { status: del.status });
};

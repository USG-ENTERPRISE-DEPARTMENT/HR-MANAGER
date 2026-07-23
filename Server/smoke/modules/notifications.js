/** Notifications — read the current user's notifications (list endpoint is GET /notifications). */
module.exports.run = async (t) => {
  const { api } = t;
  const list = await api.get('/notifications');
  t.check('GET /notifications → 200', list.status === 200, { status: list.status, msg: list.body?.message });
};

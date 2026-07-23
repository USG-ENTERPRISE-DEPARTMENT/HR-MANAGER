/** Reports — the report builder is a POST that renders a PDF; just verify it responds (2xx or a
 *  clean 4xx for a minimal payload) rather than downloading a document. */
module.exports.run = async (t) => {
  const { api } = t;
  const r = await api.post('/reports/table.pdf', { title: t.uniq('Report'), columns: [], rows: [] });
  t.check('POST /reports/table.pdf responds (not 5xx)', r.status < 500, { status: r.status });
};

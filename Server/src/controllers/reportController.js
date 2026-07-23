const PDFDocument  = require('pdfkit');
const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');

function hexToRgb(hex) {
  const m = String(hex ?? '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [37, 99, 235];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// POST /reports/table.pdf — render any tabular report as a branded PDF.
// Body: { title, subtitle?, headers: string[], rows: (string|number|null)[][], landscape? }
// Generic on purpose so every report (employee details, leave, attendance…) can reuse it.
exports.tablePdf = asyncHandler(async (req, res) => {
  const { title, subtitle, headers, rows, landscape = true } = req.body ?? {};
  if (!title || !Array.isArray(headers) || !headers.length) return respond.badReq(res, 'title and headers are required');
  if (!Array.isArray(rows)) return respond.badReq(res, 'rows must be an array');
  if (rows.length > 5000) return respond.badReq(res, 'Report too large — maximum 5000 rows');

  // Branding from payslip settings (same source the payslip PDF uses)
  const s = await prisma.payslip_settings.findFirst({
    select: { company_name: true, accent_color: true },
  }).catch(() => null);
  const company = s?.company_name || 'HR Report';
  const [acR, acG, acB] = hexToRgb(s?.accent_color || '#2563eb');

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 40,
    info: { Title: title },
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf"`);
  doc.pipe(res);

  const pageW = doc.page.width - 80;
  const cell  = v => v == null ? '' : String(v);

  // Column widths weighted by content length (header + sampled rows), min 45pt
  const sample = rows.slice(0, 50);
  const weights = headers.map((h, c) =>
    Math.max(cell(h).length, ...sample.map(r => Math.min(cell(r[c]).length, 40)), 4)
  );
  const totalW = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map(w => Math.max(45, (w / totalW) * pageW));
  const scale = pageW / colW.reduce((a, b) => a + b, 0);
  const widths = colW.map(w => w * scale);

  const drawPageHeader = () => {
    doc.rect(40, 40, pageW, 44).fill([acR, acG, acB]);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(13).text(company, 52, 50, { width: pageW * 0.6 });
    doc.fillColor('white').font('Helvetica').fontSize(9)
      .text(title, 52, 66, { width: pageW * 0.6 });
    doc.fillColor('white').font('Helvetica').fontSize(8)
      .text(new Date().toLocaleString(), doc.page.width - 220, 56, { align: 'right', width: 180 });
    let y = 94;
    if (subtitle) {
      doc.fillColor('#6b7280').font('Helvetica-Oblique').fontSize(8).text(subtitle, 40, y, { width: pageW });
      y = doc.y + 8;
    }
    return y;
  };

  const rowHeight = (vals, font, size) => {
    doc.font(font).fontSize(size);
    let h = 0;
    vals.forEach((v, c) => {
      h = Math.max(h, doc.heightOfString(cell(v), { width: widths[c] - 10 }));
    });
    return h + 10;
  };

  const drawRow = (vals, y, { header = false, zebra = false } = {}) => {
    const font = header ? 'Helvetica-Bold' : 'Helvetica';
    const size = header ? 7.5 : 8;
    const h = rowHeight(vals, font, size);
    if (header) doc.rect(40, y, pageW, h).fill('#f3f4f6');
    else if (zebra) doc.rect(40, y, pageW, h).fill('#fafafa');
    let x = 40;
    doc.fillColor(header ? '#374151' : '#1f2937').font(font).fontSize(size);
    vals.forEach((v, c) => {
      doc.text(cell(v), x + 5, y + 5, { width: widths[c] - 10 });
      x += widths[c];
    });
    doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + h).lineTo(40 + pageW, y + h).stroke();
    return y + h;
  };

  let y = drawPageHeader();
  y = drawRow(headers, y, { header: true });

  rows.forEach((r, i) => {
    const h = rowHeight(r, 'Helvetica', 8);
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      y = drawPageHeader();
      y = drawRow(headers, y, { header: true });
    }
    y = drawRow(r, y, { zebra: i % 2 === 1 });
  });

  // Footer summary
  doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
    .text(`${rows.length} record${rows.length === 1 ? '' : 's'}`, 40, y + 8);

  doc.end();
});

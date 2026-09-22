// ─────────────────────────────────────────────────────────────────────────────
// User-manual PDF generator for the Help Center.
//
// Built from the SAME `MODULES` array the Help screen renders, passed in by the caller. That is the
// whole point of generating this client-side rather than on the server: the manual content lives in
// Help.tsx as typed data, so a server-side generator would have to duplicate ~3,000 lines of it and
// would silently drift out of date the first time someone edited an article. Here, the PDF cannot
// disagree with what the user sees on screen — there is only one copy of the content.
//
// jsPDF is imported lazily by the caller (`await import(...)`) so it stays out of the main bundle;
// only someone who actually clicks Download pays for it.
// ─────────────────────────────────────────────────────────────────────────────
import type { jsPDF } from 'jspdf';

// Mirrors the Help.tsx types structurally. Declared locally rather than imported to keep this module
// free of Help.tsx's React/icon imports — the icon fields are irrelevant to the PDF.
type ContentBlock =
  | { type: 'text';    body: string }
  | { type: 'tip';     body: string }
  | { type: 'warning'; body: string }
  | { type: 'steps';   heading?: string; steps: { label: string; detail?: string }[] }
  | { type: 'table';   headers: string[]; rows: string[][] };

type ManualArticle = { id: string; title: string; summary: string; content: ContentBlock[] };
type ManualModule  = { id: string; title: string; description: string; color: string; articles: ManualArticle[] };

// ── Page geometry (A4 portrait, in points) ───────────────────────────────────
const PAGE_W  = 595.28;
const PAGE_H  = 841.89;
const MARGIN  = 56;
const BODY_W  = PAGE_W - MARGIN * 2;
const FOOTER_SAFE = 56;           // never write text below this from the bottom

const INK        = '#111827';
const INK_SOFT   = '#4b5563';
const INK_MUTED  = '#9ca3af';
const RULE       = '#e5e7eb';
const TIP_BG     = '#eff6ff';
const TIP_INK    = '#1d4ed8';
const WARN_BG    = '#fffbeb';
const WARN_INK   = '#b45309';
const TABLE_HEAD = '#f3f4f6';

// Convert '#rrggbb' to the [r,g,b] triples jsPDF wants.
const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

// jsPDF's standard fonts are WinAnsi-encoded: characters outside that set (the em dashes, curly
// quotes and arrows used liberally in the help copy) render as mojibake or vanish entirely. Folding
// them to ASCII equivalents keeps the prose readable rather than gambling on the encoding.
const ascii = (s: string): string =>
  String(s ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[→⇒]/g, '->')
    .replace(/[•●▪]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[✓✔]/g, 'Yes')
    .replace(/[✗✘]/g, 'No')
    // Anything still non-ASCII would render as a blank box; drop it rather than print a box.
    .replace(/[^\x20-\x7E\n]/g, '');

type Ctx = {
  doc: jsPDF;
  y: number;
  page: number;
  /** Table of contents entries collected during the render pass. */
  toc: { title: string; level: number; page: number }[];
};

/** Start a new page and reset the cursor. */
function newPage(ctx: Ctx) {
  ctx.doc.addPage();
  ctx.page += 1;
  ctx.y = MARGIN;
}

/** Ensure `needed` points of vertical space remain; break the page if not. */
function ensure(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE_H - FOOTER_SAFE) newPage(ctx);
}

/**
 * Write wrapped text and advance the cursor, breaking across pages line by line.
 *
 * jsPDF's own `text()` does not paginate — it will happily draw past the bottom edge, where the
 * content is simply invisible. Splitting first and placing each line individually is what keeps
 * long articles intact.
 */
function writeText(
  ctx: Ctx,
  text: string,
  opts: { size?: number; color?: string; style?: 'normal' | 'bold' | 'italic'; indent?: number; lineGap?: number; width?: number } = {},
) {
  const { size = 9.5, color = INK_SOFT, style = 'normal', indent = 0, lineGap = 3.4 } = opts;
  const width = opts.width ?? BODY_W - indent;

  ctx.doc.setFont('helvetica', style).setFontSize(size).setTextColor(...rgb(color));
  const lines: string[] = ctx.doc.splitTextToSize(ascii(text), width);
  const lh = size + lineGap;

  for (const line of lines) {
    ensure(ctx, lh);
    ctx.doc.text(line, MARGIN + indent, ctx.y + size);
    ctx.y += lh;
  }
}

/** Tip / warning callout: tinted band with a coloured spine, mirroring the on-screen treatment. */
function writeCallout(ctx: Ctx, body: string, kind: 'tip' | 'warning') {
  const bg    = kind === 'tip' ? TIP_BG   : WARN_BG;
  const ink   = kind === 'tip' ? TIP_INK  : WARN_INK;
  const label = kind === 'tip' ? 'TIP'    : 'IMPORTANT';
  const padX = 10, padY = 8, size = 9;

  ctx.doc.setFont('helvetica', 'normal').setFontSize(size);
  const lines: string[] = ctx.doc.splitTextToSize(ascii(body), BODY_W - padX * 2 - 6);
  const lh = size + 3.2;
  const boxH = padY * 2 + 11 + lines.length * lh;

  // Keep a callout whole: if it cannot fit, move it to the next page rather than split the band.
  ensure(ctx, boxH + 6);

  ctx.doc.setFillColor(...rgb(bg)).rect(MARGIN, ctx.y, BODY_W, boxH, 'F');
  ctx.doc.setFillColor(...rgb(ink)).rect(MARGIN, ctx.y, 2.5, boxH, 'F');

  ctx.doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...rgb(ink));
  ctx.doc.text(label, MARGIN + padX + 4, ctx.y + padY + 7);

  ctx.doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...rgb(ink));
  let ly = ctx.y + padY + 11 + size;
  for (const line of lines) {
    ctx.doc.text(line, MARGIN + padX + 4, ly);
    ly += lh;
  }

  ctx.y += boxH + 9;
}

/** Numbered steps, each with an optional detail line. */
function writeSteps(ctx: Ctx, block: Extract<ContentBlock, { type: 'steps' }>, accent: string) {
  if (block.heading) {
    ensure(ctx, 18);
    writeText(ctx, block.heading, { size: 8.5, style: 'bold', color: INK });
    ctx.y += 2;
  }

  block.steps.forEach((step, i) => {
    const size = 9.5;
    ctx.doc.setFont('helvetica', 'normal').setFontSize(size);
    const lines: string[] = ctx.doc.splitTextToSize(ascii(step.label), BODY_W - 22);
    ensure(ctx, size + 6);

    // Number bullet, vertically centred on the first line of the label.
    const cy = ctx.y + size / 2 + 1.5;
    ctx.doc.setFillColor(...rgb(accent)).circle(MARGIN + 6, cy, 6.5, 'F');
    ctx.doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(255, 255, 255);
    ctx.doc.text(String(i + 1), MARGIN + 6, cy + 2.4, { align: 'center' });

    // Label lines, indented past the bullet.
    ctx.doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...rgb(INK));
    for (const line of lines) {
      ensure(ctx, size + 3.4);
      ctx.doc.text(line, MARGIN + 22, ctx.y + size);
      ctx.y += size + 3.4;
    }

    if (step.detail) writeText(ctx, step.detail, { size: 8.5, color: INK_MUTED, indent: 22 });
    ctx.y += 3;
  });

  ctx.y += 3;
}

/**
 * Table with proportional columns, a shaded header and page-aware rows.
 *
 * The header is redrawn whenever a table spills onto a new page — without that, the continuation
 * reads as an unlabelled grid of text.
 */
function writeTable(ctx: Ctx, block: Extract<ContentBlock, { type: 'table' }>) {
  const cols = block.headers.length;
  if (!cols) return;

  // First column carries the label/key in nearly every table in this manual, so give it more room.
  const weights = cols === 1 ? [1]
    : cols === 2 ? [0.38, 0.62]
    : [0.3, ...Array(cols - 1).fill(0.7 / (cols - 1))];
  const widths = weights.map(w => w * BODY_W);
  // Left edge of each column: a running sum of the widths before it. Written as a plain loop
  // deliberately — a reduce that seeded an accumulator with [MARGIN] and appended per column
  // produced a leading duplicate ([56, 56, …]), so columns 0 and 1 shared an x and printed on top
  // of each other.
  const xs: number[] = [];
  let runX = MARGIN;
  for (const w of widths) { xs.push(runX); runX += w; }

  const padX = 6, padY = 5, size = 8.2, lh = size + 2.6;

  const drawHeader = () => {
    ctx.doc.setFont('helvetica', 'bold').setFontSize(size);
    const cells = block.headers.map((h, i) => ctx.doc.splitTextToSize(ascii(h), widths[i] - padX * 2) as string[]);
    const rowH = padY * 2 + Math.max(...cells.map(c => c.length)) * lh;

    ensure(ctx, rowH + 12);
    ctx.doc.setFillColor(...rgb(TABLE_HEAD)).rect(MARGIN, ctx.y, BODY_W, rowH, 'F');
    ctx.doc.setTextColor(...rgb(INK));
    cells.forEach((lines, i) => {
      lines.forEach((line, li) => ctx.doc.text(line, xs[i] + padX, ctx.y + padY + size + li * lh));
    });
    ctx.y += rowH;
  };

  drawHeader();

  for (const row of block.rows) {
    ctx.doc.setFontSize(size);
    const cells = row.map((cell, i) => {
      ctx.doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      return ctx.doc.splitTextToSize(ascii(cell ?? ''), (widths[i] ?? widths[widths.length - 1]) - padX * 2) as string[];
    });
    const rowH = padY * 2 + Math.max(1, ...cells.map(c => c.length)) * lh;

    // A row taller than a whole page cannot be kept whole; only break when it genuinely does not fit.
    if (ctx.y + rowH > PAGE_H - FOOTER_SAFE) {
      newPage(ctx);
      drawHeader();
    }

    cells.forEach((lines, i) => {
      ctx.doc.setFont('helvetica', i === 0 ? 'bold' : 'normal').setFontSize(size)
        .setTextColor(...rgb(i === 0 ? INK : INK_SOFT));
      lines.forEach((line, li) => ctx.doc.text(line, xs[i] + padX, ctx.y + padY + size + li * lh));
    });

    ctx.doc.setDrawColor(...rgb(RULE)).setLineWidth(0.4)
      .line(MARGIN, ctx.y + rowH, MARGIN + BODY_W, ctx.y + rowH);
    ctx.y += rowH;
  }

  ctx.y += 10;
}

/** Cover page. */
function drawCover(doc: jsPDF, title: string, subtitle: string, generatedOn: string) {
  doc.setFillColor(17, 24, 39).rect(0, 0, PAGE_W, 232, 'F');

  doc.setFont('helvetica', 'bold').setFontSize(27).setTextColor(255, 255, 255);
  doc.text(ascii(title), MARGIN, 118, { maxWidth: BODY_W });

  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(190, 197, 208);
  doc.text(ascii(subtitle), MARGIN, 146, { maxWidth: BODY_W });

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...rgb(INK_MUTED));
  doc.text(`Generated ${generatedOn}`, MARGIN, 286);
  doc.text('This manual is generated from the in-app Help Center and reflects it exactly.', MARGIN, 302, { maxWidth: BODY_W });
}

/** Running footer with page numbers, applied after all content is laid out. */
function drawFooters(doc: jsPDF, title: string) {
  const total = doc.getNumberOfPages();
  // Page 1 is the cover and page 2 the contents; numbering starts at the first content page so the
  // printed numbers line up with the table of contents.
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...rgb(RULE)).setLineWidth(0.5)
      .line(MARGIN, PAGE_H - 42, PAGE_W - MARGIN, PAGE_H - 42);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...rgb(INK_MUTED));
    doc.text(ascii(title), MARGIN, PAGE_H - 30);
    doc.text(`Page ${p - 1} of ${total - 1}`, PAGE_W - MARGIN, PAGE_H - 30, { align: 'right' });
  }
}

export type BuildManualOptions = {
  /** Company name for the cover, from App Setup. Falls back to a generic title. */
  companyName?: string;
  /** Restrict the export to one module; omit for the whole manual. */
  moduleId?: string;
};

/**
 * Build the manual and hand back a Blob.
 *
 * Returns rather than saves so the caller owns the download (and can report failures in the UI).
 */
export async function buildHelpManualPdf(
  modules: ManualModule[],
  opts: BuildManualOptions = {},
): Promise<{ blob: Blob; filename: string; pages: number }> {
  const { jsPDF: JsPDF } = await import('jspdf');

  const scope = opts.moduleId ? modules.filter(m => m.id === opts.moduleId) : modules;
  if (!scope.length) throw new Error('Nothing to export.');

  const title = opts.companyName
    ? `${opts.companyName} - HR System User Manual`
    : 'HR System User Manual';
  const subtitle = opts.moduleId ? `${scope[0].title} module` : 'Complete guide to every module';
  const generatedOn = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title, subject: 'HR System User Manual', creator: 'HR Manager' });

  // ── Cover ──
  drawCover(doc, title, subtitle, generatedOn);

  // ── Contents placeholder ──
  // Real page numbers are only known after laying out the body, so the contents page is reserved
  // here and filled in at the end.
  doc.addPage();
  const tocPageIndex = doc.getNumberOfPages();

  const ctx: Ctx = { doc, y: MARGIN, page: tocPageIndex, toc: [] };

  // ── Body ──
  scope.forEach((mod, mi) => {
    // Each module opens a page, so a module always starts at a predictable place in print.
    newPage(ctx);
    if (mi >= 0) ctx.toc.push({ title: mod.title, level: 0, page: ctx.page });

    // Module banner
    doc.setFillColor(...rgb(mod.color)).rect(MARGIN, ctx.y, BODY_W, 46, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(255, 255, 255);
    doc.text(ascii(mod.title), MARGIN + 14, ctx.y + 29);
    ctx.y += 46 + 12;

    writeText(ctx, mod.description, { size: 9.5, color: INK_SOFT });
    ctx.y += 10;

    mod.articles.forEach(article => {
      // Keep an article heading with at least a little of its body rather than stranding it.
      ensure(ctx, 76);
      ctx.toc.push({ title: article.title, level: 1, page: ctx.page });

      doc.setDrawColor(...rgb(mod.color)).setLineWidth(2)
        .line(MARGIN, ctx.y + 2, MARGIN, ctx.y + 15);

      writeText(ctx, article.title, { size: 12.5, style: 'bold', color: INK, indent: 9 });
      ctx.y += 1;
      writeText(ctx, article.summary, { size: 8.8, style: 'italic', color: INK_MUTED, indent: 9 });
      ctx.y += 8;

      article.content.forEach(block => {
        switch (block.type) {
          case 'text':    writeText(ctx, block.body); ctx.y += 6; break;
          case 'tip':     writeCallout(ctx, block.body, 'tip'); break;
          case 'warning': writeCallout(ctx, block.body, 'warning'); break;
          case 'steps':   writeSteps(ctx, block, mod.color); break;
          case 'table':   writeTable(ctx, block); break;
        }
      });

      ctx.y += 12;
    });
  });

  // ── Fill in the contents page ──
  doc.setPage(tocPageIndex);
  let ty = MARGIN;
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...rgb(INK));
  doc.text('Contents', MARGIN, ty + 16);
  ty += 38;

  for (const entry of ctx.toc) {
    // The contents itself can overflow with 97 articles; continue it onto inserted pages, keeping
    // those pages adjacent to the contents rather than appended at the end of the document.
    if (ty > PAGE_H - FOOTER_SAFE - 16) {
      doc.insertPage(doc.getCurrentPageInfo().pageNumber + 1);
      doc.setPage(doc.getCurrentPageInfo().pageNumber);
      ty = MARGIN;
    }

    const isModule = entry.level === 0;
    doc.setFont('helvetica', isModule ? 'bold' : 'normal')
      .setFontSize(isModule ? 10 : 9)
      .setTextColor(...rgb(isModule ? INK : INK_SOFT));

    if (isModule) ty += 8;

    const indent = isModule ? 0 : 14;
    const label = ascii(entry.title);
    const pageLabel = String(entry.page - 1);   // display number, matching the footer
    const maxLabelW = BODY_W - indent - 34;
    const shown = (doc.splitTextToSize(label, maxLabelW) as string[])[0];

    doc.text(shown, MARGIN + indent, ty);
    doc.text(pageLabel, MARGIN + BODY_W, ty, { align: 'right' });

    // Leader dots between the title and its page number.
    const labelW = doc.getTextWidth(shown);
    const dotsFrom = MARGIN + indent + labelW + 5;
    const dotsTo   = MARGIN + BODY_W - doc.getTextWidth(pageLabel) - 5;
    if (dotsTo > dotsFrom) {
      doc.setTextColor(...rgb('#d1d5db'));
      const dots = '.'.repeat(Math.max(0, Math.floor((dotsTo - dotsFrom) / doc.getTextWidth('.'))));
      doc.text(dots, dotsFrom, ty);
    }

    ty += isModule ? 15 : 13;
  }

  drawFooters(doc, title);

  const slug = opts.moduleId ? `-${scope[0].id}` : '';
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob: doc.output('blob'),
    filename: `HR-System-User-Manual${slug}-${stamp}.pdf`,
    pages: doc.getNumberOfPages(),
  };
}

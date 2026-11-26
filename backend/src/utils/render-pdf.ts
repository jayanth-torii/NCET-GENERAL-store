import { join } from 'path';
import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { formatCell, Report } from '../models/reports/model';

// pdfmake on the server with DM Sans embedded (the font the web app uses), so PDFs can print ₹.
// The static Regular/Bold files in assets/fonts were made from the variable DM Sans with fontTools'
// instancer (OFL licence alongside). No headless browser is needed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');
const FONT_DIR = join(__dirname, '..', 'assets', 'fonts');
const regular = join(FONT_DIR, 'DMSans-Regular.ttf');
const bold = join(FONT_DIR, 'DMSans-Bold.ttf');
const printer = new PdfPrinter({
  DMSans: { normal: regular, bold, italics: regular, bolditalics: bold },
});
export const PDF_FONT = 'DMSans';

/** Keep what DM Sans can draw (Latin, Latin Extended-A, common punctuation, ₹); anything else becomes '?'. */
export function pdfText(s: unknown): string {
  return String(s ?? '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\u017F\u2010-\u2027\u2030-\u203A\u20B9\u2122\u2190-\u2193\u2212]/g, '?');
}

export function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}

const RIGHT = new Set(['money', 'qty', 'int', 'pct']);

export function reportToPdf(r: Report, storeName: string): Promise<Buffer> {
  const content: Content[] = [
    { text: pdfText(storeName), style: 'store' },
    { text: pdfText(r.title), style: 'title' },
  ];
  if (r.subtitle) content.push({ text: pdfText(r.subtitle), style: 'subtitle' });
  content.push({ text: pdfText(`Generated ${r.generatedAt}${r.generatedBy ? ` by ${r.generatedBy}` : ''}`), style: 'meta' });

  if (r.summary?.length) {
    content.push({
      table: {
        widths: ['auto', 'auto'],
        body: r.summary.map((s) => [
          { text: pdfText(s.label), color: '#555555' },
          { text: pdfText(formatCell(s.value, s.type)), bold: true, alignment: s.type && RIGHT.has(s.type) ? 'right' : 'left' },
        ]),
      },
      layout: 'noBorders',
      margin: [0, 4, 0, 10],
    });
  }

  for (const sec of r.sections) {
    if (sec.title) content.push({ text: pdfText(sec.title), style: 'section' });
    if (sec.rows.length === 0) {
      content.push({ text: 'No records for this period.', italics: true, color: '#777777', margin: [0, 0, 0, 8] });
      continue;
    }
    const header: TableCell[] = sec.columns.map((c) => ({ text: pdfText(c.label), style: 'th', alignment: c.type && RIGHT.has(c.type) ? 'right' : 'left' }));
    const body: TableCell[][] = [header];
    for (const row of sec.rows) {
      body.push(sec.columns.map((c) => ({ text: pdfText(formatCell(row[c.key], c.type)), alignment: c.type && RIGHT.has(c.type) ? 'right' : 'left' })));
    }
    if (sec.totals) {
      body.push(sec.columns.map((c) => ({ text: pdfText(formatCell(sec.totals![c.key], c.type)), bold: true, alignment: c.type && RIGHT.has(c.type) ? 'right' : 'left', fillColor: '#FEF3E8' })));
    }
    content.push({
      table: { headerRows: 1, widths: sec.columns.map((c) => (c.type && RIGHT.has(c.type) ? 'auto' : '*')), body },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.8 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => '#BBBBBB',
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 10],
    });
    if (sec.note) content.push({ text: pdfText(sec.note), fontSize: 7.5, color: '#666666', margin: [0, -6, 0, 10] });
  }

  return renderPdf({
    pageSize: 'A4',
    pageOrientation: r.landscape ? 'landscape' : 'portrait',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: PDF_FONT, fontSize: 8.5 },
    footer: (page: number, pages: number) => ({ text: `${pdfText(r.title)}  -  page ${page} of ${pages}`, alignment: 'center', fontSize: 7, color: '#888888', margin: [0, 10, 0, 0] }),
    styles: {
      store: { fontSize: 9, bold: true, color: '#F6872A' },
      title: { fontSize: 15, bold: true, color: '#0E2455', margin: [0, 2, 0, 2] },
      subtitle: { fontSize: 10, color: '#333333' },
      meta: { fontSize: 7.5, color: '#777777', margin: [0, 2, 0, 8] },
      section: { fontSize: 10.5, bold: true, color: '#0E2455', margin: [0, 6, 0, 4] },
      th: { bold: true, fontSize: 8, color: '#FFFFFF', fillColor: '#0E2455' },
    },
    content,
    info: { title: pdfText(r.title), creator: 'NCET Store POS v2' },
  });
}

import ExcelJS from 'exceljs';
import { num, Report } from './report-model';

const NUM_FMT: Record<string, string> = {
  money: '"₹"#,##,##0.00;[Red]-"₹"#,##,##0.00',
  qty: '#,##,##0.###',
  int: '#,##,##0',
  pct: '0.00"%"',
};

/** Excel workbook: one sheet per section, title rows on top, styled and frozen header, number formats in ₹, totals row. */
export async function reportToXlsx(r: Report, storeName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NCET Store POS v2';
  wb.created = new Date();
  const used = new Set<string>();
  const sheetName = (t: string) => {
    let base = t.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'Sheet';
    let name = base;
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${i++}`;
    used.add(name.toLowerCase());
    return name;
  };

  const head = (ws: ExcelJS.Worksheet, sectionTitle?: string) => {
    ws.addRow([storeName]).font = { bold: true, color: { argb: 'FFF6872A' } };
    ws.addRow([r.title + (sectionTitle ? ` - ${sectionTitle}` : '')]).font = { bold: true, size: 14 };
    ws.addRow([[r.subtitle, `Generated ${r.generatedAt}${r.generatedBy ? ` by ${r.generatedBy}` : ''}`].filter(Boolean).join('   |   ')]).font = { size: 9, color: { argb: 'FF666666' } };
  };

  if (r.summary?.length) {
    const ws = wb.addWorksheet(sheetName('Summary'));
    head(ws);
    ws.addRow([]);
    for (const s of r.summary) {
      const row = ws.addRow([s.label, typeof s.value === 'number' || s.type === 'money' || s.type === 'qty' || s.type === 'int' ? num(s.value) : s.value]);
      row.getCell(1).font = { color: { argb: 'FF555555' } };
      row.getCell(2).font = { bold: true };
      if (s.type && NUM_FMT[s.type]) row.getCell(2).numFmt = NUM_FMT[s.type];
    }
    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 22;
  }

  for (const sec of r.sections) {
    const ws = wb.addWorksheet(sheetName(sec.title ?? r.title));
    head(ws, sec.title);
    ws.addRow([]);
    const headerRow = ws.addRow(sec.columns.map((c) => c.label));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E2455' } };
      cell.alignment = { vertical: 'middle' };
    });
    ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    for (const row of sec.rows) {
      ws.addRow(sec.columns.map((c) => (c.type && NUM_FMT[c.type] ? (row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? null : num(row[c.key])) : row[c.key] ?? '')));
    }
    if (sec.totals) {
      const t = ws.addRow(sec.columns.map((c) => (c.type && NUM_FMT[c.type] ? (sec.totals![c.key] === undefined || sec.totals![c.key] === '' ? null : num(sec.totals![c.key])) : sec.totals![c.key] ?? '')));
      t.font = { bold: true };
      t.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
    }
    sec.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.type && NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type];
      const longest = Math.max(c.label.length, ...sec.rows.slice(0, 500).map((row) => String(row[c.key] ?? '').length));
      col.width = Math.min(Math.max(longest + 2, c.type === 'money' ? 14 : 8), 50);
    });
    if (sec.rows.length) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: sec.columns.length } };
    if (sec.note) ws.addRow([sec.note]).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  }
  if (wb.worksheets.length === 0) wb.addWorksheet('Report');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

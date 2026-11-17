import { Prisma, StoreSetting } from '@prisma/client';
import type { Content, TableCell } from 'pdfmake/interfaces';
import { D, round2 } from '../common/money';
import { fmtDateTime } from '../common/time';
import { pdfText, renderPdf } from './render-pdf';
import { fmtMoney, fmtQty } from './report-model';

export type ReceiptSale = Prisma.SaleGetPayload<{
  include: { counter: true; user: { select: { fullName: true } }; items: true; payments: true };
}>;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function taxSummary(sale: ReceiptSale) {
  const byRate = new Map<string, { taxable: number; tax: number }>();
  for (const i of sale.items) {
    const tax = Number(i.taxAmount);
    if (tax <= 0) continue;
    const key = Number(i.gstRate).toFixed(2);
    const cur = byRate.get(key) ?? { taxable: 0, tax: 0 };
    cur.tax += tax;
    cur.taxable += Number(i.lineTotal) - tax;
    byRate.set(key, cur);
  }
  return [...byRate.entries()].map(([rate, v]) => ({
    rate,
    taxable: v.taxable,
    cgst: Number(round2(D(v.tax).div(2))),
    sgst: Number(D(v.tax).minus(round2(D(v.tax).div(2)))),
  }));
}

/** 80 mm receipt as a self-contained HTML page. Counter PCs print it silently with Chrome --kiosk-printing (UR-1). */
export function receiptHtml(sale: ReceiptSale, s: StoreSetting, opts: { stamp: string | null }): string {
  const registered = s.gstMode === 'REGISTERED';
  const lines = sale.items
    .map(
      (i) => `<tr><td colspan="3" class="n">${esc(i.nameSnapshot)}</td></tr>
      <tr><td class="q">${fmtQty(i.qty)} x ${fmtMoney(i.rate)}</td><td class="r">${Number(i.discount) > 0 ? `-${fmtMoney(i.discount)}` : ''}</td><td class="r">${fmtMoney(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const pays = sale.payments.map((p) => `<tr><td>${esc(p.mode)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${fmtMoney(p.amount)}</td></tr>`).join('');
  const taxes = registered
    ? taxSummary(sale)
        .map((t) => `<tr><td>GST ${t.rate}% on ${fmtMoney(t.taxable)}</td><td class="r">CGST ${fmtMoney(t.cgst)} SGST ${fmtMoney(t.sgst)}</td></tr>`)
        .join('')
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.billNo)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 12px/1.35 "Consolas", "Courier New", monospace; color: #000; }
.w { width: 72mm; margin: 0 auto; padding: 3mm 0 6mm; }
h1 { font-size: 15px; text-align: center; margin: 0; }
.c { text-align: center; }
.m { font-size: 11px; }
hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
table { width: 100%; border-collapse: collapse; }
td { vertical-align: top; padding: 0; }
.r { text-align: right; white-space: nowrap; }
.n { font-weight: bold; padding-top: 2px; }
.q { padding-left: 6px; }
.g td { font-size: 15px; font-weight: bold; padding: 2px 0; }
.stamp { border: 2px solid #000; text-align: center; font-weight: bold; margin: 4px 0; padding: 2px; }
</style></head><body><div class="w">
<h1>${esc(s.storeName)}</h1>
<div class="c m">${esc(s.addressLine)}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${registered && s.gstin ? `<br>GSTIN: ${esc(s.gstin)}` : ''}</div>
<div class="c" style="font-weight:bold;margin-top:3px">${registered ? 'TAX INVOICE' : 'BILL'}</div>
${sale.status === 'CANCELLED' ? '<div class="stamp">CANCELLED</div>' : ''}${opts.stamp ? `<div class="stamp">${esc(opts.stamp)}</div>` : ''}
<hr>
<table class="m"><tr><td>Bill ${esc(sale.billNo)}</td><td class="r">${esc(fmtDateTime(sale.billedAt))}</td></tr>
<tr><td>Counter ${esc(sale.counter.code)}</td><td class="r">Cashier ${esc(sale.user.fullName)}</td></tr>
${sale.customerName ? `<tr><td colspan="2">Customer: ${esc(sale.customerName)}</td></tr>` : ''}</table>
<hr><table>${lines}</table><hr>
<table>
<tr><td>Items total</td><td class="r">${fmtMoney(sale.itemsTotal)}</td></tr>
${Number(sale.discountTotal) > 0 ? `<tr><td>Discount</td><td class="r">-${fmtMoney(sale.discountTotal)}</td></tr>` : ''}
${Number(sale.roundOff) !== 0 ? `<tr><td>Round off</td><td class="r">${fmtMoney(sale.roundOff)}</td></tr>` : ''}
<tr class="g"><td>TOTAL</td><td class="r">Rs ${fmtMoney(sale.grandTotal)}</td></tr>
</table><hr>
<table class="m">${pays}
<tr><td>Tendered</td><td class="r">${fmtMoney(sale.tendered)}</td></tr>
<tr><td><b>Change</b></td><td class="r"><b>${fmtMoney(sale.changeDue)}</b></td></tr></table>
${taxes ? `<hr><table class="m">${taxes}</table>` : ''}
<hr><div class="c m">${esc(s.receiptFooter)}</div>
<div class="c m" style="margin-top:3px">Items: ${sale.items.length} · Qty: ${fmtQty(sale.items.reduce((a, i) => a + Number(i.qty), 0))}</div>
</div>
</body></html>`;
}

/** Same receipt as a PDF, in 80 mm roll width or A4 (UR-1). */
export function receiptPdf(sale: ReceiptSale, s: StoreSetting, size: '80mm' | 'a4', stamp: string | null): Promise<Buffer> {
  const registered = s.gstMode === 'REGISTERED';
  const narrow = size === '80mm';
  const body: TableCell[][] = [];
  for (const i of sale.items) {
    body.push([{ text: pdfText(i.nameSnapshot), bold: true, colSpan: 3 }, '', '']);
    body.push([
      { text: `${fmtQty(i.qty)} x ${fmtMoney(i.rate)}`, margin: [6, 0, 0, 0] },
      { text: Number(i.discount) > 0 ? `-${fmtMoney(i.discount)}` : '', alignment: 'right' },
      { text: fmtMoney(i.lineTotal), alignment: 'right' },
    ]);
  }
  const kv = (k: string, v: string, bold = false): TableCell[] => [{ text: pdfText(k), bold }, { text: pdfText(v), alignment: 'right', bold }];
  const totals: TableCell[][] = [kv('Items total', fmtMoney(sale.itemsTotal))];
  if (Number(sale.discountTotal) > 0) totals.push(kv('Discount', `-${fmtMoney(sale.discountTotal)}`));
  if (Number(sale.roundOff) !== 0) totals.push(kv('Round off', fmtMoney(sale.roundOff)));
  totals.push(kv('TOTAL', `Rs ${fmtMoney(sale.grandTotal)}`, true));
  for (const p of sale.payments) totals.push(kv(`${p.mode}${p.reference ? ` (${p.reference})` : ''}`, fmtMoney(p.amount)));
  totals.push(kv('Tendered', fmtMoney(sale.tendered)));
  totals.push(kv('Change', fmtMoney(sale.changeDue), true));
  if (registered) for (const t of taxSummary(sale)) totals.push(kv(`GST ${t.rate}% on ${fmtMoney(t.taxable)}`, `CGST ${fmtMoney(t.cgst)} SGST ${fmtMoney(t.sgst)}`));

  const rule: Content = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: narrow ? 204 : 515, y2: 0, dash: { length: 2 }, lineWidth: 0.6 }], margin: [0, 3, 0, 3] };
  const content: Content[] = [
    { text: pdfText(s.storeName), bold: true, fontSize: narrow ? 11 : 15, alignment: 'center' },
    { text: pdfText(`${s.addressLine}${s.phone ? `\nPh: ${s.phone}` : ''}${registered && s.gstin ? `\nGSTIN: ${s.gstin}` : ''}`), alignment: 'center' },
    { text: registered ? 'TAX INVOICE' : 'BILL', bold: true, alignment: 'center', margin: [0, 2, 0, 0] },
  ];
  if (sale.status === 'CANCELLED') content.push({ text: 'CANCELLED', bold: true, alignment: 'center', fontSize: 12 });
  if (stamp) content.push({ text: pdfText(stamp), bold: true, alignment: 'center' });
  content.push(rule);
  content.push({
    table: {
      widths: ['*', 'auto'],
      body: [kv(`Bill ${sale.billNo}`, fmtDateTime(sale.billedAt)), kv(`Counter ${sale.counter.code}`, `Cashier ${sale.user.fullName}`), ...(sale.customerName ? [kv(`Customer: ${sale.customerName}`, '')] : [])],
    },
    layout: 'noBorders',
  });
  content.push(rule);
  content.push({ table: { widths: ['*', 'auto', 'auto'], body }, layout: 'noBorders' });
  content.push(rule);
  content.push({ table: { widths: ['*', 'auto'], body: totals }, layout: 'noBorders' });
  content.push(rule);
  content.push({ text: pdfText(s.receiptFooter), alignment: 'center' });

  const lineCount = sale.items.length * 2 + totals.length + 16;
  return renderPdf({
    pageSize: narrow ? { width: 226.77, height: Math.max(300, lineCount * 11 + 60) } : 'A4',
    pageMargins: narrow ? [10, 10, 10, 14] : [40, 40, 40, 40],
    defaultStyle: { font: narrow ? 'Courier' : 'Helvetica', fontSize: narrow ? 7.5 : 10 },
    content,
    info: { title: pdfText(sale.billNo), creator: 'NCET Store POS v2' },
  });
}

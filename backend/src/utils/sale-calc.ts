import { allocate, D, Dec, Decimal, inclusiveTax, round2, sum } from './money';

/** Validation problem in a bill. The service turns it into a 400 reply. */
export class CalcError extends Error {}

export interface CalcLineInput {
  qty: Dec;
  rate: Dec;
  discount: Dec;
  /**
   * What the line is made of, for the tax breakdown. A product line has one part with weight 1.
   * A kit line has one part per component, weighted by that component's normal value.
   */
  parts: { weight: Dec; gstRate: Dec }[];
}

export interface CalcLineResult {
  gross: Dec;
  discount: Dec;
  lineTotal: Dec;
  tax: Dec;
}

export interface SaleTotals {
  lines: CalcLineResult[];
  itemsTotal: Dec;
  discountTotal: Dec;
  taxTotal: Dec;
  net: Dec;
  roundOff: Dec;
  grandTotal: Dec;
}

/**
 * Bill totals. Sale prices include GST (Indian retail), so tax is the part of each line total that is GST.
 * It is reported only when the store is GST-registered and never changes what the customer pays.
 */
export function calcSale(lines: CalcLineInput[], opts: { roundToRupee: boolean; gstRegistered: boolean }): SaleTotals {
  if (lines.length === 0) throw new CalcError('The bill has no items');
  const results = lines.map((l, i) => {
    if (l.qty.lte(0)) throw new CalcError(`Line ${i + 1}: quantity must be more than zero`);
    if (l.rate.lt(0)) throw new CalcError(`Line ${i + 1}: rate cannot be negative`);
    if (l.discount.lt(0)) throw new CalcError(`Line ${i + 1}: discount cannot be negative`);
    const gross = round2(l.qty.mul(l.rate));
    const discount = round2(l.discount);
    if (discount.gt(gross)) throw new CalcError(`Line ${i + 1}: discount is more than the line amount`);
    const lineTotal = gross.minus(discount);
    let tax = D(0);
    if (opts.gstRegistered && l.parts.length > 0) {
      const shares = l.parts.length === 1 ? [lineTotal] : allocate(lineTotal, l.parts.map((p) => p.weight));
      tax = sum(shares.map((s, j) => inclusiveTax(s, l.parts[j].gstRate)));
    }
    return { gross, discount, lineTotal, tax };
  });
  const itemsTotal = sum(results.map((r) => r.gross));
  const discountTotal = sum(results.map((r) => r.discount));
  const taxTotal = sum(results.map((r) => r.tax));
  const net = itemsTotal.minus(discountTotal);
  const grandTotal = opts.roundToRupee ? net.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : net;
  return { lines: results, itemsTotal, discountTotal, taxTotal, net, roundOff: grandTotal.minus(net), grandTotal };
}

export type Mode = 'CASH' | 'UPI' | 'CARD';
export interface PaymentInput {
  mode: Mode;
  amount: Dec;
  reference?: string | null;
}
export interface Settlement {
  applied: { mode: Mode; amount: Dec; reference: string | null }[];
  tendered: Dec;
  changeDue: Dec;
}

/**
 * Check the payments against the bill (FR-01).
 * - UPI and card together cannot exceed the bill: change is only ever given in cash.
 * - Everything paid together must cover the bill.
 * - Stored payment rows add up exactly to the grand total (cash is stored net of change),
 *   so collections by payment mode always reconcile with sales.
 */
export function settlePayments(grandTotal: Dec, payments: PaymentInput[]): Settlement {
  for (const p of payments) {
    if (p.amount.lte(0)) throw new CalcError('Each payment amount must be more than zero');
  }
  const cash = sum(payments.filter((p) => p.mode === 'CASH').map((p) => p.amount));
  const nonCash = payments.filter((p) => p.mode !== 'CASH');
  const nonCashTotal = sum(nonCash.map((p) => p.amount));
  if (nonCashTotal.gt(grandTotal)) throw new CalcError(`UPI and card payments (${nonCashTotal.toFixed(2)}) are more than the bill (${grandTotal.toFixed(2)})`);
  const tendered = cash.plus(nonCashTotal);
  if (tendered.lt(grandTotal)) throw new CalcError(`Payment is short by ${grandTotal.minus(tendered).toFixed(2)}`);
  const changeDue = tendered.minus(grandTotal);
  const cashApplied = cash.minus(changeDue);
  const applied: Settlement['applied'] = [];
  if (cashApplied.gt(0)) {
    const ref = payments.find((p) => p.mode === 'CASH' && p.reference)?.reference ?? null;
    applied.push({ mode: 'CASH', amount: cashApplied, reference: ref });
  }
  for (const p of nonCash) applied.push({ mode: p.mode, amount: p.amount, reference: p.reference ?? null });
  return { applied, tendered, changeDue };
}

import { allocate, D, Dec, inclusiveTax, round2, round4, sum } from '../common/money';

export class PurchaseCalcError extends Error {}

export interface PLineInput {
  enteredQty: Dec; // in the entry unit (packs or pieces)
  baseQty: Dec; // in selling units = enteredQty x packSize (rule R5)
  /** Either a unit rate per entered unit, or the line amount printed on the bill (rule R4). */
  rate?: Dec | null;
  amount?: Dec | null;
  discount: Dec;
  gstRate: Dec;
}

export interface PChargeInput {
  amount: Dec;
  addsToCost: boolean;
  allocation: 'BY_VALUE' | 'BY_QTY' | 'NONE';
}

export interface PLineResult {
  rate: Dec; // 4 dp, per entered unit
  grossAmount: Dec; // 2 dp
  discount: Dec;
  taxAmount: Dec;
  lineTotal: Dec;
  costBasis: Dec; // what the store really pays for the line before charges
  landedUnitCost: Dec; // 4 dp, per selling unit
}

export interface PurchaseTotals {
  lines: PLineResult[];
  itemsTotal: Dec;
  taxTotal: Dec;
  chargesTotal: Dec;
  discountTotal: Dec;
  computedTotal: Dec; // before round-off
  difference: Dec | null; // invoiceTotal - computedTotal
  roundOff: Dec;
  grandTotal: Dec;
  canPost: boolean;
  problem: string | null;
}

export const ROUND_OFF_LIMIT = D(1);

/**
 * Purchase totals and landed cost.
 *  grand_total = sum(line_total) + sum(charges) - bill_discount + round_off            (rule R2)
 *  post only if |invoice_total - computed| <= 1.00, the remainder is stored as round-off
 *  charge share per line by value (or by quantity), residue to the largest line          (rule R3)
 *  landed_unit_cost = (cost basis + charge shares - bill-discount share) / base_qty
 * When the store is GST-registered, GST paid on purchases is claimable, so it is left out of the cost.
 */
export function calcPurchase(input: {
  lines: PLineInput[];
  charges: PChargeInput[];
  billDiscount: Dec;
  invoiceTotal: Dec | null;
  taxInclusive: boolean;
  gstRegistered: boolean;
}): PurchaseTotals {
  const lines = input.lines.map((l, i) => {
    if (l.enteredQty.lte(0) || l.baseQty.lte(0)) throw new PurchaseCalcError(`Line ${i + 1}: quantity must be more than zero`);
    let rate: Dec;
    let gross: Dec;
    // A purchase line must cost something: a zero-rate line would set the item's cost to nothing.
    if (l.amount !== null && l.amount !== undefined) {
      if (l.amount.lte(0)) throw new PurchaseCalcError(`Line ${i + 1}: amount must be more than zero`);
      gross = round2(l.amount);
      rate = round4(gross.div(l.enteredQty));
    } else if (l.rate !== null && l.rate !== undefined) {
      if (l.rate.lte(0)) throw new PurchaseCalcError(`Line ${i + 1}: rate must be more than zero`);
      rate = round4(l.rate);
      gross = round2(l.enteredQty.mul(rate));
    } else {
      throw new PurchaseCalcError(`Line ${i + 1}: enter a rate or a line amount`);
    }
    const discount = round2(l.discount);
    if (discount.lt(0)) throw new PurchaseCalcError(`Line ${i + 1}: discount cannot be negative`);
    if (discount.gt(gross)) throw new PurchaseCalcError(`Line ${i + 1}: discount is more than the line amount`);
    const taxable = gross.minus(discount);
    let taxAmount: Dec;
    let lineTotal: Dec;
    if (input.taxInclusive) {
      lineTotal = taxable;
      taxAmount = inclusiveTax(taxable, l.gstRate);
    } else {
      taxAmount = round2(taxable.mul(l.gstRate).div(100));
      lineTotal = taxable.plus(taxAmount);
    }
    const costBasis = input.gstRegistered ? lineTotal.minus(taxAmount) : lineTotal;
    return { rate, grossAmount: gross, discount, taxAmount, lineTotal, costBasis, baseQty: l.baseQty };
  });

  const itemsTotal = sum(lines.map((l) => l.lineTotal));
  const taxTotal = sum(lines.map((l) => l.taxAmount));
  for (const c of input.charges) if (c.amount.lte(0)) throw new PurchaseCalcError('Each charge amount must be more than zero');
  const chargesTotal = round2(sum(input.charges.map((c) => c.amount)));
  const billDiscount = round2(input.billDiscount);
  if (billDiscount.lt(0)) throw new PurchaseCalcError('Bill discount cannot be negative');
  const computedTotal = itemsTotal.plus(chargesTotal).minus(billDiscount);

  // Landed cost: start from each line's cost basis, add charge shares, take off its share of the bill discount.
  const extra = lines.map(() => D(0));
  if (lines.length > 0) {
    for (const c of input.charges) {
      if (!c.addsToCost || c.allocation === 'NONE') continue;
      const weights = c.allocation === 'BY_QTY' ? lines.map((l) => l.baseQty) : lines.map((l) => l.costBasis);
      allocate(c.amount, weights).forEach((share, i) => (extra[i] = extra[i].plus(share)));
    }
    if (billDiscount.gt(0)) {
      allocate(billDiscount, lines.map((l) => l.costBasis)).forEach((share, i) => (extra[i] = extra[i].minus(share)));
    }
  }
  const results: PLineResult[] = lines.map((l, i) => ({
    rate: l.rate,
    grossAmount: l.grossAmount,
    discount: l.discount,
    taxAmount: l.taxAmount,
    lineTotal: l.lineTotal,
    costBasis: l.costBasis,
    landedUnitCost: round4(l.costBasis.plus(extra[i]).div(l.baseQty)),
  }));

  let difference: Dec | null = null;
  let roundOff = D(0);
  let canPost = false;
  let problem: string | null = null;
  if (lines.length === 0) problem = 'Add at least one item';
  else if (computedTotal.lt(0)) problem = 'The bill discount is more than the bill';
  else if (input.invoiceTotal === null) problem = 'Type the grand total printed on the supplier bill';
  else {
    difference = round2(input.invoiceTotal.minus(computedTotal));
    if (difference.abs().lte(ROUND_OFF_LIMIT)) {
      roundOff = difference;
      canPost = true;
    } else {
      problem = `Computed total ${computedTotal.toFixed(2)} does not match the supplier bill ${input.invoiceTotal.toFixed(2)} (difference ${difference.toFixed(2)})`;
    }
  }
  return {
    lines: results,
    itemsTotal,
    taxTotal,
    chargesTotal,
    discountTotal: billDiscount,
    computedTotal,
    difference,
    roundOff,
    grandTotal: computedTotal.plus(roundOff),
    canPost,
    problem,
  };
}

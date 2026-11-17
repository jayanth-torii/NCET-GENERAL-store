import { Prisma } from '@prisma/client';

/** Decimal type used for every money and quantity calculation. Money is never a float. */
export type Dec = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export const ZERO = new Decimal(0);

export function D(v: Prisma.Decimal.Value | null | undefined): Dec {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v);
}

export function round2(d: Dec): Dec {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function round3(d: Dec): Dec {
  return d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function round4(d: Dec): Dec {
  return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: Dec[]): Dec {
  return values.reduce((a, b) => a.plus(b), new Decimal(0));
}

/**
 * Split `amount` (rupees, 2 dp) across `weights` in proportion, working in whole paise.
 * The rounding residue goes to the line with the largest weight, so the parts always add up
 * exactly to `amount` (blueprint rule R3).
 */
export function allocate(amount: Dec, weights: Dec[]): Dec[] {
  if (weights.length === 0) return [];
  const totalPaise = amount.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const totalWeight = sum(weights);
  if (totalWeight.lte(0)) {
    // No usable weights: split evenly.
    const even = weights.map(() => new Decimal(1));
    return allocate(amount, even);
  }
  const parts = weights.map((w) => totalPaise.mul(w).div(totalWeight).toDecimalPlaces(0, Decimal.ROUND_DOWN));
  const residue = totalPaise.minus(sum(parts));
  let largest = 0;
  weights.forEach((w, i) => {
    if (w.gt(weights[largest])) largest = i;
  });
  parts[largest] = parts[largest].plus(residue);
  return parts.map((p) => p.div(100));
}

/** Tax contained in a tax-inclusive amount. */
export function inclusiveTax(amount: Dec, gstRate: Dec): Dec {
  if (gstRate.lte(0)) return new Decimal(0);
  return round2(amount.minus(amount.div(gstRate.div(100).plus(1))));
}

export function isMultipleOf(qty: Dec, step: Dec): boolean {
  return qty.mod(step).eq(0);
}

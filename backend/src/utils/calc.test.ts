import { describe, expect, it } from 'vitest';
import { allocate, D, sum } from './money';
import { fmtDate, fyCode, fyRange, istDate, istMonthRange } from './time';
import { calcPurchase } from './purchase-calc';
import { calcSale, CalcError, settlePayments } from './sale-calc';

const one = [{ weight: D(1), gstRate: D(0) }];

describe('sale totals (FR-01)', () => {
  it('matches the legacy bill: 5 x 35 + 5 x 10 = 225.00', () => {
    const t = calcSale(
      [
        { qty: D(5), rate: D(35), discount: D(0), parts: one },
        { qty: D(5), rate: D(10), discount: D(0), parts: one },
      ],
      { roundToRupee: true, gstRegistered: false },
    );
    expect(t.grandTotal.toFixed(2)).toBe('225.00');
    expect(t.roundOff.toFixed(2)).toBe('0.00');
  });

  it('rounds to the rupee and records the round-off', () => {
    const t = calcSale([{ qty: D(3), rate: D(12.85), discount: D(0), parts: one }], { roundToRupee: true, gstRegistered: false });
    expect(t.net.toFixed(2)).toBe('38.55');
    expect(t.grandTotal.toFixed(2)).toBe('39.00');
    expect(t.roundOff.toFixed(2)).toBe('0.45');
  });

  it('applies line discounts and rejects a discount bigger than the line', () => {
    const t = calcSale([{ qty: D(2), rate: D(50), discount: D(10), parts: one }], { roundToRupee: false, gstRegistered: false });
    expect(t.grandTotal.toFixed(2)).toBe('90.00');
    expect(() => calcSale([{ qty: D(1), rate: D(5), discount: D(6), parts: one }], { roundToRupee: false, gstRegistered: false })).toThrow(CalcError);
  });

  it('extracts inclusive GST only when registered', () => {
    const lines = [{ qty: D(1), rate: D(118), discount: D(0), parts: [{ weight: D(1), gstRate: D(18) }] }];
    expect(calcSale(lines, { roundToRupee: false, gstRegistered: true }).taxTotal.toFixed(2)).toBe('18.00');
    expect(calcSale(lines, { roundToRupee: false, gstRegistered: false }).taxTotal.toFixed(2)).toBe('0.00');
  });

  it('rejects an empty bill and zero quantity', () => {
    expect(() => calcSale([], { roundToRupee: true, gstRegistered: false })).toThrow(CalcError);
    expect(() => calcSale([{ qty: D(0), rate: D(5), discount: D(0), parts: one }], { roundToRupee: true, gstRegistered: false })).toThrow(CalcError);
  });
});

describe('payments', () => {
  it('gives change from cash and stores cash net of change', () => {
    const s = settlePayments(D(225), [{ mode: 'CASH', amount: D(250) }]);
    expect(s.changeDue.toFixed(2)).toBe('25.00');
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0].amount.toFixed(2)).toBe('225.00');
  });

  it('splits cash and UPI so stored rows add up to the bill', () => {
    const s = settlePayments(D(500), [
      { mode: 'UPI', amount: D(300) },
      { mode: 'CASH', amount: D(500) },
    ]);
    expect(s.changeDue.toFixed(2)).toBe('300.00');
    expect(sum(s.applied.map((a) => a.amount)).toFixed(2)).toBe('500.00');
  });

  it('refuses short payment and UPI/card above the bill', () => {
    expect(() => settlePayments(D(100), [{ mode: 'CASH', amount: D(90) }])).toThrow(/short by 10.00/);
    expect(() => settlePayments(D(100), [{ mode: 'UPI', amount: D(120) }])).toThrow(CalcError);
  });
});

describe('allocation (R3)', () => {
  it('shares always add up exactly to the amount', () => {
    for (let n = 0; n < 500; n++) {
      const amount = D(Math.floor(Math.random() * 1_000_000) / 100);
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 12) }, () => D(Math.floor(Math.random() * 100000) / 100));
      const parts = allocate(amount, weights);
      expect(sum(parts).toFixed(2)).toBe(amount.toFixed(2));
    }
  });
});

describe('purchase totals and landed cost (UR-2, R2-R5)', () => {
  const base = { billDiscount: D(0), taxInclusive: true, gstRegistered: false };

  it('Rs 500 transport on a Rs 20,000 bill raises the total by 500 and costs in proportion', () => {
    const t = calcPurchase({
      ...base,
      lines: [
        { enteredQty: D(10), baseQty: D(100), amount: D(15000), discount: D(0), gstRate: D(0) },
        { enteredQty: D(50), baseQty: D(50), rate: D(100), discount: D(0), gstRate: D(0) },
      ],
      charges: [{ amount: D(500), addsToCost: true, allocation: 'BY_VALUE' }],
      invoiceTotal: D(20500),
    });
    expect(t.grandTotal.toFixed(2)).toBe('20500.00');
    expect(t.canPost).toBe(true);
    // line 1: (15000 + 375) / 100 = 153.75 ; line 2: (5000 + 125) / 50 = 102.50
    expect(t.lines[0].landedUnitCost.toFixed(4)).toBe('153.7500');
    expect(t.lines[1].landedUnitCost.toFixed(4)).toBe('102.5000');
  });

  it('derives the rate from a typed line amount instead of hand-made rates (R4)', () => {
    const t = calcPurchase({ ...base, lines: [{ enteredQty: D(11), baseQty: D(11), amount: D(200), discount: D(0), gstRate: D(0) }], charges: [], invoiceTotal: D(200) });
    expect(t.lines[0].rate.toFixed(4)).toBe('18.1818');
    expect(t.lines[0].grossAmount.toFixed(2)).toBe('200.00');
    expect(t.grandTotal.toFixed(2)).toBe('200.00');
  });

  it('posts with a round-off up to Rs 1 and refuses above it (FR-06)', () => {
    const lines = [{ enteredQty: D(1), baseQty: D(1), rate: D(999.4), discount: D(0), gstRate: D(0) }];
    const ok = calcPurchase({ ...base, lines, charges: [], invoiceTotal: D(1000) });
    expect(ok.canPost).toBe(true);
    expect(ok.roundOff.toFixed(2)).toBe('0.60');
    expect(ok.grandTotal.toFixed(2)).toBe('1000.00');
    const bad = calcPurchase({ ...base, lines, charges: [], invoiceTotal: D(1001) });
    expect(bad.canPost).toBe(false);
    expect(bad.difference!.toFixed(2)).toBe('1.60');
    const missing = calcPurchase({ ...base, lines, charges: [], invoiceTotal: null });
    expect(missing.canPost).toBe(false);
  });

  it('adds GST on tax-exclusive bills and keeps it out of cost when registered', () => {
    const t = calcPurchase({
      lines: [{ enteredQty: D(2), baseQty: D(24), rate: D(500), discount: D(0), gstRate: D(18) }],
      charges: [],
      billDiscount: D(0),
      invoiceTotal: D(1180),
      taxInclusive: false,
      gstRegistered: true,
    });
    expect(t.itemsTotal.toFixed(2)).toBe('1180.00');
    expect(t.lines[0].landedUnitCost.toFixed(4)).toBe('41.6667'); // 1000 / 24
    expect(t.canPost).toBe(true);
  });

  it('spreads the bill discount and charges that do not add to cost are left out', () => {
    const t = calcPurchase({
      ...base,
      lines: [{ enteredQty: D(10), baseQty: D(10), rate: D(100), discount: D(0), gstRate: D(0) }],
      charges: [{ amount: D(50), addsToCost: false, allocation: 'BY_VALUE' }],
      billDiscount: D(100),
      invoiceTotal: D(950),
    });
    expect(t.grandTotal.toFixed(2)).toBe('950.00');
    expect(t.lines[0].landedUnitCost.toFixed(4)).toBe('90.0000');
  });
});

describe('dates (NFR-03)', () => {
  it('uses IST for the business date and the financial year', () => {
    // 2027-03-31 20:00 UTC is already 1 April in India.
    const d = new Date('2027-03-31T20:00:00Z');
    expect(istDate(d)).toBe('2027-04-01');
    expect(fyCode(d)).toBe('27-28');
    expect(fyCode(new Date('2026-10-12T06:00:00Z'))).toBe('26-27');
    expect(fmtDate('2026-10-12')).toBe('12-10-2026');
    expect(istMonthRange('2026-02').to).toBe('2026-02-28');
    expect(fyRange('2026-27').to).toBe('2027-03-31');
    expect(() => fyRange('2026-28')).toThrow();
  });
});

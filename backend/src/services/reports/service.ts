import type { Sale, SaleItem, SalePayment, SalesReturn } from '../../models/sales/model';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { SessionUser } from '../../middleware/auth.decorators';
import { D, Dec, r2n, r3n, sum } from '../../utils/money';
import { SettingsService } from '../settings/service';
import { fmtDate, fmtDateTime, fyRange, istDate, istMonthRange, istRange } from '../../utils/time';
import { DbService, JsonValue, Loaded } from '../../config/db';
import { StockService } from '../stock/service';
import { reportToPdf } from '../../utils/render-pdf';
import { reportToXlsx } from '../../utils/render-xlsx';
import { num, Report, ReportColumn } from '../../models/reports/model';

type Range = { start: Date; end: Date };
type SaleRow = Loaded<Sale>;
type SalesSet = {
  sales: SaleRow[];
  items: Loaded<SaleItem>[];
  payments: Loaded<SalePayment>[];
  returns: Loaded<SalesReturn>[];
  saleOf: (id: number | bigint) => SaleRow;
};
const n = (v: unknown) => num(v);
/** Hour of the day in IST (UTC+5:30) for a stored timestamp. */
const istHour = (d: Date) => Math.floor((((d.getTime() / 3_600_000 + 5.5) % 24) + 24) % 24);
/** Every YYYY-MM-DD from one date to another, inclusive. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly stock: StockService,
    private readonly settings: SettingsService,
  ) {}

  /** Send a report as JSON, PDF or XLSX. */
  async send(res: Response, report: Report, format: 'json' | 'pdf' | 'xlsx') {
    if (format === 'json') return res.json(report);
    const s = await this.settings.get();
    if (format === 'pdf') {
      const buf = await reportToPdf(report, s.storeName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}.pdf"`);
      return res.send(buf);
    }
    const buf = await reportToXlsx(report, s.storeName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}.xlsx"`);
    return res.send(buf);
  }

  private meta(user: SessionUser) {
    return { generatedAt: fmtDateTime(new Date()), generatedBy: user.fullName };
  }

  // ---------------- shared sales data (MongoDB) ----------------
  // The PostgreSQL edition used one SQL aggregate per figure. On MongoDB the bills of a range are read
  // once (with their lines, payments and returns) and every figure is worked out from that set in
  // Decimal, so all report sections of one request agree exactly. The set is reused for 5 s so the
  // sections of one report share a single read.

  private readonly cache = new Map<string, Promise<SalesSet>>();

  private salesSet(r: Range, userId?: number): Promise<SalesSet> {
    const key = `${r.start.toISOString()}|${r.end.toISOString()}|${userId ?? ''}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.loadSales(r, userId);
      this.cache.set(key, p);
      setTimeout(() => this.cache.delete(key), 5000).unref?.();
    }
    return p;
  }

  private async loadSales(r: Range, userId?: number): Promise<SalesSet> {
    const uf = userId ? { userId } : {};
    const sales = await this.db.sale.findMany({
      where: { billedAt: { gte: r.start, lt: r.end }, ...uf },
      orderBy: { billedAt: 'asc' },
      include: { counter: { select: { code: true } }, user: { select: { fullName: true } } },
    });
    const ids = sales.map((s) => s.id);
    const [items, payments, returns] = await Promise.all([
      ids.length ? this.db.saleItem.findMany({ where: { saleId: { in: ids } }, include: { product: { select: { category: { select: { name: true } } } } } }) : Promise.resolve([]),
      ids.length ? this.db.salePayment.findMany({ where: { saleId: { in: ids } } }) : Promise.resolve([]),
      this.db.salesReturn.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...uf } }),
    ]);
    const byId = new Map(sales.map((s) => [String(s.id), s]));
    return { sales, items, payments, returns, saleOf: (id: number | bigint) => byId.get(String(id))! };
  }

  private async salesHeadline(r: Range, userId?: number) {
    const { sales, items, returns, saleOf } = await this.salesSet(r, userId);
    const done = sales.filter((s) => s.status === 'COMPLETED');
    const cancelled = sales.filter((s) => s.status === 'CANCELLED');
    const total = (rows: typeof sales, k: 'itemsTotal' | 'discountTotal' | 'roundOff' | 'grandTotal' | 'taxTotal') => r2n(sum(rows.map((s) => D(s[k]))));
    const cost = sum(items.filter((i) => saleOf(i.saleId)?.status === 'COMPLETED').map((i) => D(i.qty).mul(i.costAtSale)));
    return {
      bills: done.length, gross: total(done, 'itemsTotal'), discount: total(done, 'discountTotal'), roundOff: total(done, 'roundOff'), net: total(done, 'grandTotal'), tax: total(done, 'taxTotal'),
      cancelled: cancelled.length, cancelledAmount: total(cancelled, 'grandTotal'), edited: sales.filter((s) => s.editCount > 0).length,
      returns: returns.length, returnsTotal: r2n(sum(returns.map((x) => D(x.total)))), cost: r2n(cost),
    };
  }

  private async byPaymentMode(r: Range, userId?: number) {
    const { payments, returns, saleOf } = await this.salesSet(r, userId);
    const paid = payments.filter((p) => saleOf(p.saleId)?.status === 'COMPLETED');
    return ['CASH', 'UPI', 'CARD'].map((mode) => {
      const mine = paid.filter((p) => p.mode === mode);
      const collected = r2n(sum(mine.map((p) => D(p.amount))));
      const refunded = r2n(sum(returns.filter((x) => x.refundMode === mode).map((x) => D(x.total))));
      return { mode, bills: new Set(mine.map((p) => String(p.saleId))).size, collected, refunded, net: r2n(D(collected).minus(refunded)) };
    });
  }

  private async byCategory(r: Range, userId?: number) {
    const { items, saleOf } = await this.salesSet(r, userId);
    const m = new Map<string, { category: string; lines: number; qty: Dec; amount: Dec }>();
    for (const i of items) {
      if (saleOf(i.saleId)?.status !== 'COMPLETED') continue;
      const category = i.product?.category.name ?? 'Kits';
      const c = m.get(category) ?? { category, lines: 0, qty: D(0), amount: D(0) };
      c.lines++;
      c.qty = c.qty.plus(i.qty);
      c.amount = c.amount.plus(i.lineTotal);
      m.set(category, c);
    }
    return [...m.values()].sort((a, b) => b.amount.cmp(a.amount)).map((c) => ({ category: c.category, lines: c.lines, qty: r3n(c.qty), amount: r2n(c.amount) }));
  }

  private async byItem(r: Range, limit: number | null, userId?: number) {
    const { items, saleOf } = await this.salesSet(r, userId);
    const m = new Map<string, { code: string; name: string; qty: Dec; amount: Dec; cost: Dec; bills: Set<string> }>();
    for (const i of items) {
      if (saleOf(i.saleId)?.status !== 'COMPLETED') continue;
      const key = `${i.codeSnapshot}|${i.kitId !== null}`;
      const c = m.get(key) ?? { code: i.codeSnapshot, name: i.nameSnapshot, qty: D(0), amount: D(0), cost: D(0), bills: new Set<string>() };
      if (i.nameSnapshot > c.name) c.name = i.nameSnapshot; // max(name_snapshot), as before
      c.qty = c.qty.plus(i.qty);
      c.amount = c.amount.plus(i.lineTotal);
      c.cost = c.cost.plus(D(i.qty).mul(i.costAtSale));
      c.bills.add(String(i.saleId));
      m.set(key, c);
    }
    const rows = [...m.values()].sort((a, b) => b.amount.cmp(a.amount));
    return (limit ? rows.slice(0, limit) : rows).map((x) => ({ code: x.code, name: x.name, bills: x.bills.size, qty: r3n(x.qty), amount: r2n(x.amount), margin: r2n(x.amount.minus(x.cost)) }));
  }

  /** Bills of a range grouped by a key (counter, cashier, hour): completed count, net, discount, cancelled. */
  private async groupSales(r: Range, userId: number | undefined, keyOf: (s: SaleRow) => string) {
    const { sales } = await this.salesSet(r, userId);
    const g = new Map<string, { key: string; bills: number; net: Dec; discount: Dec; cancelled: number }>();
    for (const x of sales) {
      const key = keyOf(x);
      const c = g.get(key) ?? { key, bills: 0, net: D(0), discount: D(0), cancelled: 0 };
      if (x.status === 'COMPLETED') {
        c.bills++;
        c.net = c.net.plus(x.grandTotal);
        c.discount = c.discount.plus(x.discountTotal);
      } else c.cancelled++;
      g.set(key, c);
    }
    return [...g.values()].sort((a, b) => a.key.localeCompare(b.key)).map((c) => ({ key: c.key, bills: c.bills, net: r2n(c.net), discount: r2n(c.discount), cancelled: c.cancelled }));
  }

  // ---------------- Daily (FR-10) ----------------

  async daily(date: string, user: SessionUser, ownOnly: boolean): Promise<Report> {
    const r = istRange(date, date);
    const uid = ownOnly ? user.id : undefined;
    const h = await this.salesHeadline(r, uid);
    const set = await this.salesSet(r, uid);
    const digital = set.payments
      .filter((p) => p.mode !== 'CASH')
      .map((p) => {
        const sl = set.saleOf(p.saleId);
        return { billed_at: sl.billedAt, bill_no: sl.billNo, mode: p.mode as string, reference: p.reference, amount: p.amount, status: sl.status as string };
      })
      .sort((a, b) => a.billed_at.getTime() - b.billed_at.getTime());
    // Things a manager should check: every action that moved money or stock outside a normal sale.
    const exceptions = ownOnly
      ? []
      : (
          await this.db.auditLog.findMany({
            where: {
              createdAt: { gte: r.start, lt: r.end },
              action: { in: ['SALE_EDIT', 'SALE_CANCEL', 'SALES_RETURN', 'PRICE_OVERRIDE', 'HOLD_DISCARD', 'RECEIPT_REPRINT', 'STOCK_ADJUST', 'STOCK_ADJUST_APPROVE', 'PURCHASE_CANCEL', 'PURCHASE_RETURN', 'PRICE_CHANGE'] },
            },
            orderBy: { createdAt: 'asc' },
            include: { user: { select: { fullName: true } } },
          })
        ).map((a) => ({ at: a.createdAt, who: a.user?.fullName ?? null, action: a.action, detail: (a.after ?? a.before) as JsonValue, entity_id: a.entityId }));
    const describe = (action: string, d: Record<string, unknown>) => {
      const money = (v: unknown) => `₹${n(v).toFixed(2)}`;
      switch (action) {
        case 'SALE_EDIT':
          return `Bill edited: total ${money((d.before as Record<string, unknown>)?.grandTotal)} → ${money((d.after as Record<string, unknown>)?.grandTotal)}`;
        case 'SALE_CANCEL':
          return `Bill cancelled: ${String(d.reason ?? '')}`;
        case 'SALES_RETURN':
          return `Return ${String(d.returnNo ?? '')} refunded ${money(d.total)}`;
        case 'PRICE_OVERRIDE':
          return `Bill ${String(d.billNo ?? '')} priced below master: ${(d.lines as { name: string; master: unknown; billed: unknown }[] | undefined)?.map((l) => `${l.name} ${money(l.master)}→${money(l.billed)}`).join(', ')} (${String(d.remarks ?? '')})`;
        case 'HOLD_DISCARD':
          return `Held bill discarded: ${n(d.lines)} lines worth ${money(d.total)}`;
        case 'RECEIPT_REPRINT':
          return `Bill ${String(d.billNo ?? '')} printed again (copy ${n(d.printNo) - 1})`;
        case 'STOCK_ADJUST':
        case 'STOCK_ADJUST_APPROVE':
          return `Stock adjusted by ${String(d.change ?? '')}: ${String(d.reason ?? d.note ?? '')}`;
        case 'PURCHASE_CANCEL':
          return `Purchase ${String(d.purchaseNo ?? '')} cancelled: ${String(d.reason ?? '')}`;
        case 'PURCHASE_RETURN':
          return `Purchase return ${String(d.returnNo ?? '')} of ${money(d.total)}`;
        case 'PRICE_CHANGE':
          return `Sale price changed ${money(d.salePrice)}`;
        default:
          return action;
      }
    };
    const exceptionRows = exceptions.map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      const full = e.action === 'SALE_EDIT' ? { before: (e.detail as Record<string, unknown>)?.before, after: (e.detail as Record<string, unknown>)?.after } : d;
      return { time: fmtDateTime(e.at).slice(11), who: e.who ?? '', what: describe(e.action, e.action === 'SALE_EDIT' ? full : d), action: e.action };
    });
    const [counters, cashiers, modes, cats, top, hours] = await Promise.all([
      this.groupSales(r, uid, (x) => x.counter.code).then((g) => g.map((x) => ({ code: x.key, bills: x.bills, net: x.net, cancelled: x.cancelled }))),
      this.groupSales(r, uid, (x) => x.user.fullName).then((g) => g.map((x) => ({ name: x.key, bills: x.bills, net: x.net, discount: x.discount }))),
      this.byPaymentMode(r, uid),
      this.byCategory(r, uid),
      this.byItem(r, 20, uid),
      this.groupSales(r, uid, (x) => String(istHour(x.billedAt)).padStart(2, '0')).then((g) =>
        g.filter((x) => x.bills > 0).map((x) => ({ hour: Number(x.key), bills: x.bills, net: x.net })),
      ),
    ]);
    const modeTotals = modes.reduce((a, m) => ({ collected: a.collected + m.collected, refunded: a.refunded + m.refunded, net: a.net + m.net, bills: a.bills + m.bills }), { collected: 0, refunded: 0, net: 0, bills: 0 });
    const isManager = !ownOnly;
    return {
      title: 'Daily sales report',
      subtitle: `${fmtDate(date)}${ownOnly ? ` - bills by ${user.fullName}` : ''}`,
      fileName: `daily_sales_${date}${ownOnly ? `_${user.username}` : ''}`,
      ...this.meta(user),
      summary: [
        { label: 'Bills', value: h.bills, type: 'int' },
        { label: 'Gross (before discount)', value: h.gross, type: 'money' },
        { label: 'Discount', value: h.discount, type: 'money' },
        { label: 'Round off', value: h.roundOff, type: 'money' },
        { label: 'Net sales', value: h.net, type: 'money' },
        { label: `Sales returns (${h.returns})`, value: h.returnsTotal, type: 'money' },
        { label: 'Net after returns', value: h.net - h.returnsTotal, type: 'money' },
        { label: 'Average bill', value: h.bills ? h.net / h.bills : 0, type: 'money' },
        { label: `Cancelled bills (${h.cancelled})`, value: h.cancelledAmount, type: 'money' },
        { label: 'Bills edited', value: h.edited, type: 'int' },
        ...(h.tax > 0 ? [{ label: 'GST included in sales', value: h.tax, type: 'money' as const }] : []),
        ...(isManager ? [{ label: 'Gross margin (net - tax - cost)', value: h.net - h.tax - h.cost, type: 'money' as const }] : []),
      ],
      sections: [
        {
          title: 'Collections by payment mode',
          columns: [
            { key: 'mode', label: 'Mode' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'collected', label: 'Collected', type: 'money' },
            { key: 'refunded', label: 'Refunded', type: 'money' }, { key: 'net', label: 'Net in hand', type: 'money' },
          ],
          rows: modes,
          totals: { mode: 'Total', ...modeTotals },
          note: 'Count the drawer against "Net in hand" for CASH.',
        },
        {
          title: 'By counter',
          columns: [{ key: 'code', label: 'Counter' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'net', label: 'Net', type: 'money' }, { key: 'cancelled', label: 'Cancelled', type: 'int' }],
          rows: counters.map((c) => ({ code: c.code, bills: n(c.bills), net: n(c.net), cancelled: n(c.cancelled) })),
          totals: { code: 'Total', bills: h.bills, net: h.net, cancelled: h.cancelled },
        },
        {
          title: 'By cashier',
          columns: [{ key: 'name', label: 'Cashier' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'discount', label: 'Discount', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }],
          rows: cashiers.map((c) => ({ name: c.name, bills: n(c.bills), discount: n(c.discount), net: n(c.net) })),
        },
        {
          title: 'By category',
          columns: [{ key: 'category', label: 'Category' }, { key: 'lines', label: 'Lines', type: 'int' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'amount', label: 'Amount', type: 'money' }],
          rows: cats,
          totals: { category: 'Total', amount: cats.reduce((a, c) => a + c.amount, 0) },
        },
        {
          title: 'Top 20 items',
          columns: [
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'amount', label: 'Amount', type: 'money' },
            ...(isManager ? [{ key: 'margin', label: 'Margin', type: 'money' as const }] : []),
          ],
          rows: top,
        },
        {
          title: 'By hour',
          columns: [{ key: 'slot', label: 'Time' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'net', label: 'Net', type: 'money' }],
          rows: hours.map((x) => ({ slot: `${String(x.hour).padStart(2, '0')}:00 - ${String(x.hour + 1).padStart(2, '0')}:00`, bills: n(x.bills), net: n(x.net) })),
        },
        {
          title: 'UPI and card transactions',
          columns: [
            { key: 'time', label: 'Time' }, { key: 'billNo', label: 'Bill no' }, { key: 'mode', label: 'Mode' }, { key: 'reference', label: 'Transaction ID' },
            { key: 'amount', label: 'Amount', type: 'money' }, { key: 'status', label: 'Bill status' },
          ],
          rows: digital.map((d) => ({ time: fmtDateTime(d.billed_at).slice(11), billNo: d.bill_no, mode: d.mode, reference: d.reference ?? '(not recorded)', amount: n(d.amount), status: d.status })),
          totals: { reference: 'Total (completed bills)', amount: digital.filter((d) => d.status === 'COMPLETED').reduce((a, d) => a + n(d.amount), 0) },
          note: 'Tick each line against the UPI app or bank statement. Every ID can back only one bill.',
        },
        ...(isManager
          ? [
              {
                title: 'Manager actions to check',
                columns: [{ key: 'time', label: 'Time' }, { key: 'who', label: 'Who' }, { key: 'action', label: 'Action' }, { key: 'what', label: 'Detail' }],
                rows: exceptionRows,
                note: 'Every edit, cancel, return, price override, reprint, discarded hold and stock adjustment of the day. Each should have a reason you recognise.',
              },
            ]
          : []),
      ],
    };
  }

  // ---------------- Monthly (FR-10) ----------------

  async monthly(month: string, user: SessionUser): Promise<Report> {
    const m = istMonthRange(month);
    const r = { start: m.start, end: m.end };
    const h = await this.salesHeadline(r);
    const [days, cats, items, modes] = await Promise.all([
      this.salesSet(r).then(({ sales, returns }) =>
        eachDay(m.from, m.to).map((day) => {
          const mine = sales.filter((x) => istDate(x.billedAt) === day);
          const done = mine.filter((x) => x.status === 'COMPLETED');
          const t = (k: 'itemsTotal' | 'discountTotal' | 'grandTotal') => r2n(sum(done.map((x) => D(x[k]))));
          return {
            day: new Date(`${day}T00:00:00Z`), bills: done.length, gross: t('itemsTotal'), discount: t('discountTotal'), net: t('grandTotal'),
            returns: r2n(sum(returns.filter((x) => istDate(x.createdAt) === day).map((x) => D(x.total)))), cancelled: mine.length - done.length,
          };
        }),
      ),
      this.byCategory(r),
      this.byItem(r, null),
      this.byPaymentMode(r),
    ]);
    const dayRows = days.map((d) => ({
      date: fmtDate(d.day.toISOString().slice(0, 10)), bills: n(d.bills), gross: n(d.gross), discount: n(d.discount), net: n(d.net),
      returns: n(d.returns), netAfter: n(d.net) - n(d.returns), cancelled: n(d.cancelled),
    }));
    const sumKey = (k: keyof (typeof dayRows)[number]) => dayRows.reduce((a, x) => a + (x[k] as number), 0);
    const [mn, yr] = [m.from.slice(5, 7), m.from.slice(0, 4)];
    return {
      title: 'Monthly sales report',
      subtitle: new Date(`${month}-15T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      fileName: `monthly_sales_${yr}-${mn}`,
      ...this.meta(user),
      summary: [
        { label: 'Bills', value: h.bills, type: 'int' },
        { label: 'Net sales', value: h.net, type: 'money' },
        { label: 'Discount given', value: h.discount, type: 'money' },
        { label: 'Sales returns', value: h.returnsTotal, type: 'money' },
        { label: 'Net after returns', value: h.net - h.returnsTotal, type: 'money' },
        { label: 'Average bill', value: h.bills ? h.net / h.bills : 0, type: 'money' },
        { label: 'Cancelled bills', value: h.cancelled, type: 'int' },
        ...(h.tax > 0 ? [{ label: 'GST included in sales', value: h.tax, type: 'money' as const }] : []),
        { label: 'Gross margin (net - tax - cost)', value: h.net - h.tax - h.cost, type: 'money' },
      ],
      sections: [
        {
          title: 'Day by day',
          columns: [
            { key: 'date', label: 'Date' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'gross', label: 'Gross', type: 'money' }, { key: 'discount', label: 'Discount', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' }, { key: 'returns', label: 'Returns', type: 'money' }, { key: 'netAfter', label: 'Net after returns', type: 'money' }, { key: 'cancelled', label: 'Cancelled', type: 'int' },
          ],
          rows: dayRows,
          totals: { date: 'Total', bills: sumKey('bills'), gross: sumKey('gross'), discount: sumKey('discount'), net: sumKey('net'), returns: sumKey('returns'), netAfter: sumKey('netAfter'), cancelled: sumKey('cancelled') },
        },
        {
          title: 'By payment mode',
          columns: [{ key: 'mode', label: 'Mode' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'collected', label: 'Collected', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }],
          rows: modes,
        },
        {
          title: 'By category',
          columns: [{ key: 'category', label: 'Category' }, { key: 'lines', label: 'Lines', type: 'int' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'amount', label: 'Amount', type: 'money' }],
          rows: cats,
          totals: { category: 'Total', amount: cats.reduce((a, c) => a + c.amount, 0) },
        },
        {
          title: 'By item',
          columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'bills', label: 'Bills', type: 'int' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'margin', label: 'Margin', type: 'money' }],
          rows: items,
          totals: { name: 'Total', amount: items.reduce((a, c) => a + c.amount, 0), margin: items.reduce((a, c) => a + c.margin, 0) },
        },
      ],
      landscape: false,
    };
  }

  // ---------------- Sales register (FR-03) ----------------

  async salesRegister(from: string, to: string, user: SessionUser, f: { counterId?: number; userId?: number }): Promise<Report> {
    const r = istRange(from, to);
    const bills = await this.db.sale.findMany({
      where: { billedAt: { gte: r.start, lt: r.end }, ...(f.counterId ? { counterId: f.counterId } : {}), ...(f.userId ? { userId: f.userId } : {}) },
      orderBy: { billedAt: 'asc' },
      include: { counter: true, user: { select: { fullName: true } }, payments: true, items: { orderBy: { lineNo: 'asc' } }, _count: { select: { returns: true } } },
      take: 20000,
    });
    const billRows = bills.map((b) => ({
      billNo: b.billNo, at: fmtDateTime(b.billedAt), counter: b.counter.code, cashier: b.user.fullName, status: b.status,
      flags: [b.editCount ? `edited x${b.editCount}` : '', b._count.returns ? 'returns' : '', b.cancelReason ? `cancel: ${b.cancelReason}` : ''].filter(Boolean).join('; '),
      items: b.items.length, gross: n(b.itemsTotal), discount: n(b.discountTotal), roundOff: n(b.roundOff), total: n(b.grandTotal),
      modes: b.payments.map((p) => `${p.mode} ${n(p.amount).toFixed(2)}`).join(', '),
    }));
    const lineRows = bills.flatMap((b) =>
      b.items.map((i) => ({ billNo: b.billNo, status: b.status, line: i.lineNo, code: i.codeSnapshot, name: i.nameSnapshot, qty: n(i.qty), rate: n(i.rate), discount: n(i.discount), amount: n(i.lineTotal) })),
    );
    const completed = billRows.filter((b) => b.status === 'COMPLETED');
    return {
      title: 'Sales register',
      subtitle: `${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `sales_register_${from}_to_${to}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Bills (completed)', value: completed.length, type: 'int' },
        { label: 'Total (completed)', value: completed.reduce((a, b) => a + b.total, 0), type: 'money' },
        { label: 'Cancelled bills', value: billRows.length - completed.length, type: 'int' },
      ],
      sections: [
        {
          title: 'Bills',
          columns: [
            { key: 'billNo', label: 'Bill no' }, { key: 'at', label: 'Date & time' }, { key: 'counter', label: 'Ctr' }, { key: 'cashier', label: 'Cashier' }, { key: 'status', label: 'Status' },
            { key: 'items', label: 'Lines', type: 'int' }, { key: 'gross', label: 'Gross', type: 'money' }, { key: 'discount', label: 'Disc', type: 'money' }, { key: 'roundOff', label: 'R/off', type: 'money' },
            { key: 'total', label: 'Total', type: 'money' }, { key: 'modes', label: 'Paid by' }, { key: 'flags', label: 'Audit flags' },
          ],
          rows: billRows,
          totals: { billNo: 'Completed total', total: completed.reduce((a, b) => a + b.total, 0) },
        },
        {
          title: 'Lines',
          columns: [
            { key: 'billNo', label: 'Bill no' }, { key: 'status', label: 'Status' }, { key: 'line', label: '#', type: 'int' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' },
            { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'rate', label: 'Rate', type: 'money' }, { key: 'discount', label: 'Disc', type: 'money' }, { key: 'amount', label: 'Amount', type: 'money' },
          ],
          rows: lineRows,
        },
      ],
    };
  }

  // ---------------- Section kits (FR-14) ----------------

  /** Kit sales by section. The section is the "Customer" typed on the bill (for example "II CSE A"). */
  async kitSales(from: string, to: string, user: SessionUser): Promise<Report> {
    const r = istRange(from, to);
    const set = await this.salesSet(r);
    const kitLines = set.items.filter((i) => i.kitId !== null && set.saleOf(i.saleId)?.status === 'COMPLETED');
    const [kits, retLines] = await Promise.all([
      this.db.kit.findMany({ where: { id: { in: [...new Set(kitLines.map((i) => i.kitId!))] } }, select: { id: true, code: true, name: true } }),
      this.db.salesReturnItem.findMany({ where: { saleItemId: { in: kitLines.map((i) => i.id) } }, select: { saleItemId: true, qty: true } }),
    ]);
    const kitOf = new Map(kits.map((k) => [k.id, k]));
    const g = new Map<string, { code: string; name: string; section: string; bills: Set<string>; qty: Dec; amount: Dec; returned: Dec }>();
    for (const i of kitLines) {
      const k = kitOf.get(i.kitId!)!;
      const section = set.saleOf(i.saleId).customerName?.trim() || '(no section given)';
      const key = `${k.code}|${section}`;
      const c = g.get(key) ?? { code: k.code, name: k.name, section, bills: new Set<string>(), qty: D(0), amount: D(0), returned: D(0) };
      c.bills.add(String(i.saleId));
      c.qty = c.qty.plus(i.qty);
      c.amount = c.amount.plus(i.lineTotal);
      c.returned = c.returned.plus(sum(retLines.filter((x) => x.saleItemId === i.id).map((x) => D(x.qty))));
      g.set(key, c);
    }
    const rows = [...g.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.section.localeCompare(b.section))
      .map((x) => ({ code: x.code, name: x.name, section: x.section, bills: x.bills.size, qty: r3n(x.qty), amount: r2n(x.amount), returned: r3n(x.returned) }));
    const data = rows.map((x) => ({ code: x.code, name: x.name, section: x.section, bills: n(x.bills), qty: n(x.qty), returned: n(x.returned), amount: n(x.amount) }));
    const kitTotal = (k: 'qty' | 'amount' | 'returned' | 'bills') => data.reduce((a, b) => a + b[k], 0);
    return {
      title: 'Section kit sales',
      subtitle: `${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `section_kits_${from}_to_${to}`,
      ...this.meta(user),
      summary: [
        { label: 'Kits sold', value: kitTotal('qty'), type: 'qty' },
        { label: 'Kits returned', value: kitTotal('returned'), type: 'qty' },
        { label: 'Amount', value: kitTotal('amount'), type: 'money' },
        { label: 'Sections', value: new Set(data.map((d) => d.section)).size, type: 'int' },
      ],
      sections: [
        {
          title: 'By kit and section',
          columns: [
            { key: 'code', label: 'Kit code' }, { key: 'name', label: 'Kit' }, { key: 'section', label: 'Section (customer on bill)' }, { key: 'bills', label: 'Bills', type: 'int' },
            { key: 'qty', label: 'Kits sold', type: 'qty' }, { key: 'returned', label: 'Returned', type: 'qty' }, { key: 'amount', label: 'Amount', type: 'money' },
          ],
          rows: data,
          totals: { code: 'Total', bills: kitTotal('bills'), qty: kitTotal('qty'), returned: kitTotal('returned'), amount: kitTotal('amount') },
          note: 'Type the section (for example "II CSE A") in the Customer box when billing a kit, so it is counted against that section.',
        },
      ],
    };
  }

  /** Printable class order sheet for one kit: what the kit contains, then one row per student to tick paid / issued. */
  async kitOrderSheet(kitId: number, section: string, students: number, user: SessionUser): Promise<Report> {
    const kit = await this.db.kit.findUnique({ where: { id: kitId }, include: { items: { include: { product: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } } } });
    if (!kit) throw new NotFoundException('Kit not found');
    const sec = section.trim() || '______________';
    return {
      title: `Order sheet · ${kit.name}`,
      subtitle: `Section: ${sec} · Kit price ₹${n(kit.price).toFixed(2)} · Kit code ${kit.code}`,
      fileName: `order_sheet_${kit.code}_${section.trim().replace(/[^A-Za-z0-9]+/g, '_') || 'section'}`,
      ...this.meta(user),
      summary: [
        { label: 'Kit price', value: n(kit.price), type: 'money' },
        { label: 'Students', value: students, type: 'int' },
        { label: 'Amount if all buy', value: n(kit.price) * students, type: 'money' },
      ],
      sections: [
        {
          title: 'The kit contains',
          columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty per kit', type: 'qty' }],
          rows: kit.items.map((i) => ({ code: i.product.code, name: i.product.name, qty: n(i.qty) })),
        },
        {
          title: 'Students',
          columns: [
            { key: 'sn', label: 'S.No', type: 'int' }, { key: 'roll', label: 'Roll no' }, { key: 'student', label: 'Student name' },
            { key: 'paid', label: 'Paid (₹)' }, { key: 'issued', label: 'Issued (tick)' }, { key: 'sign', label: 'Signature' },
          ],
          rows: Array.from({ length: students }, (_, i) => ({ sn: i + 1, roll: '', student: '', paid: '', issued: '', sign: '' })),
          note: 'Bill the kits at the counter as one line each with the section in the Customer box. The "Section kits" report then totals this section.',
        },
      ],
    };
  }

  // ---------------- Purchase register ----------------

  async purchaseRegister(from: string, to: string, user: SessionUser, supplierId?: number): Promise<Report> {
    const r = istRange(from, to);
    const purchases = await this.db.purchase.findMany({
      where: { status: { in: ['POSTED', 'CANCELLED'] }, postedAt: { gte: r.start, lt: r.end }, ...(supplierId ? { supplierId } : {}) },
      orderBy: { postedAt: 'asc' },
      include: { supplier: true, charges: { include: { chargeType: true } }, _count: { select: { items: true } } },
    });
    const rows = purchases.map((p) => ({
      purchaseNo: p.purchaseNo, posted: p.postedAt ? fmtDate(p.postedAt) : '', supplier: p.supplier.name, invoiceNo: p.supplierInvoiceNo,
      invoiceDate: fmtDate(p.invoiceDate.toISOString().slice(0, 10)), status: p.status, lines: p._count.items,
      items: n(p.itemsTotal), tax: n(p.taxTotal), charges: n(p.chargesTotal), discount: n(p.discountTotal), roundOff: n(p.roundOff), total: n(p.grandTotal),
    }));
    const posted = rows.filter((x) => x.status === 'POSTED');
    const chargeMap = new Map<string, { type: string; count: number; amount: number }>();
    for (const p of purchases.filter((x) => x.status === 'POSTED')) {
      for (const c of p.charges) {
        const cur = chargeMap.get(c.chargeType.name) ?? { type: c.chargeType.name, count: 0, amount: 0 };
        cur.count++;
        cur.amount += n(c.amount);
        chargeMap.set(c.chargeType.name, cur);
      }
    }
    const chargeDetail = purchases
      .filter((x) => x.status === 'POSTED')
      .flatMap((p) => p.charges.map((c) => ({ purchaseNo: p.purchaseNo, type: c.chargeType.name, paidTo: c.paidTo ?? '', ref: c.referenceNo ?? '', amount: n(c.amount) })));
    const returns = await this.db.purchaseReturn.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...(supplierId ? { supplierId } : {}) }, include: { supplier: true, purchase: true }, orderBy: { createdAt: 'asc' } });
    const s = (k: keyof (typeof posted)[number]) => posted.reduce((a, x) => a + (x[k] as number), 0);
    return {
      title: 'Purchase register',
      subtitle: `${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `purchase_register_${from}_to_${to}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Purchases posted', value: posted.length, type: 'int' },
        { label: 'Total purchases', value: s('total'), type: 'money' },
        { label: 'Charges included', value: s('charges'), type: 'money' },
        { label: 'Returns to suppliers', value: returns.reduce((a, x) => a + n(x.total), 0), type: 'money' },
      ],
      sections: [
        {
          title: 'Purchases',
          columns: [
            { key: 'purchaseNo', label: 'Purchase no' }, { key: 'posted', label: 'Posted' }, { key: 'supplier', label: 'Supplier' }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'invoiceDate', label: 'Inv. date' },
            { key: 'status', label: 'Status' }, { key: 'lines', label: 'Lines', type: 'int' }, { key: 'items', label: 'Items', type: 'money' }, { key: 'tax', label: 'GST', type: 'money' },
            { key: 'charges', label: 'Charges', type: 'money' }, { key: 'discount', label: 'Disc', type: 'money' }, { key: 'roundOff', label: 'R/off', type: 'money' }, { key: 'total', label: 'Total', type: 'money' },
          ],
          rows,
          totals: { purchaseNo: 'Posted total', items: s('items'), tax: s('tax'), charges: s('charges'), discount: s('discount'), roundOff: s('roundOff'), total: s('total') },
        },
        {
          title: 'Charges by type',
          columns: [{ key: 'type', label: 'Charge type' }, { key: 'count', label: 'Times', type: 'int' }, { key: 'amount', label: 'Amount', type: 'money' }],
          rows: [...chargeMap.values()],
        },
        {
          title: 'Charge details',
          columns: [{ key: 'purchaseNo', label: 'Purchase no' }, { key: 'type', label: 'Type' }, { key: 'paidTo', label: 'Paid to' }, { key: 'ref', label: 'LR / Ref no' }, { key: 'amount', label: 'Amount', type: 'money' }],
          rows: chargeDetail,
        },
        {
          title: 'Returns to suppliers',
          columns: [{ key: 'returnNo', label: 'Return no' }, { key: 'date', label: 'Date' }, { key: 'supplier', label: 'Supplier' }, { key: 'against', label: 'Against' }, { key: 'reason', label: 'Reason' }, { key: 'total', label: 'Amount', type: 'money' }],
          rows: returns.map((x) => ({ returnNo: x.returnNo, date: fmtDate(x.createdAt), supplier: x.supplier.name, against: x.purchase.purchaseNo, reason: x.reason, total: n(x.total) })),
        },
      ],
    };
  }

  // ---------------- Expiry (inventory) ----------------

  /** Batches received on posted GRNs that expire within `days` (or have already expired). */
  async expiry(days: number, inStockOnly: boolean, user: SessionUser): Promise<Report> {
    const today = istDate();
    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + days);
    const batches = await this.db.purchaseItem.findMany({
      where: { expiry: { not: null, lte: limit }, purchase: { is: { status: 'POSTED' } } },
      include: {
        purchase: { select: { purchaseNo: true, supplier: { select: { name: true } } } },
        product: { select: { id: true, code: true, name: true, unit: { select: { code: true } }, stock: { select: { onHand: true } } } },
        returnLines: { select: { baseQty: true } },
      },
    });
    const rows = batches
      .map((b) => ({
        product_id: b.product.id, code: b.product.code, name: b.product.name, unit: b.product.unit.code, batch: b.batch, expiry: b.expiry!,
        qty: r3n(D(b.baseQty).minus(sum(b.returnLines.map((x) => D(x.baseQty))))), grn: b.purchase.purchaseNo, supplier: b.purchase.supplier.name, on_hand: b.product.stock?.onHand ?? 0,
      }))
      .filter((x) => !inStockOnly || x.on_hand > 0)
      .sort((a, b) => a.expiry.getTime() - b.expiry.getTime() || a.name.localeCompare(b.name));
    const t0 = Date.parse(`${today}T00:00:00Z`);
    const out = rows.map((x) => {
      const left = Math.round((x.expiry.getTime() - t0) / 86_400_000);
      return {
        productId: x.product_id, code: x.code, name: x.name, batch: x.batch ?? '', expiry: fmtDate(x.expiry.toISOString().slice(0, 10)),
        daysLeft: left, status: left < 0 ? 'EXPIRED' : left <= 30 ? 'Within 30 days' : `Within ${days} days`,
        received: n(x.qty), onHand: n(x.on_hand), unit: x.unit, grn: x.grn ?? '', supplier: x.supplier,
      };
    });
    const expired = out.filter((x) => x.daysLeft < 0);
    return {
      title: 'Expiry report',
      subtitle: `Expired, or expiring within ${days} days of ${fmtDate(today)}${inStockOnly ? ' · items in stock only' : ''}`,
      fileName: `expiry_${today}_${days}d`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Batches listed', value: out.length, type: 'int' },
        { label: 'Already expired', value: expired.length, type: 'int' },
        { label: 'Expiring in 30 days', value: out.filter((x) => x.daysLeft >= 0 && x.daysLeft <= 30).length, type: 'int' },
      ],
      sections: [
        {
          columns: [
            { key: 'expiry', label: 'Expiry' }, { key: 'daysLeft', label: 'Days left', type: 'int' }, { key: 'status', label: 'Status' },
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'batch', label: 'Batch' },
            { key: 'received', label: 'Received', type: 'qty' }, { key: 'onHand', label: 'Stock now', type: 'qty' }, { key: 'unit', label: 'Unit' },
            { key: 'grn', label: 'GRN no' }, { key: 'supplier', label: 'Supplier' },
          ],
          rows: out,
          note: 'Expiry dates come from the batch / expiry entered on each GRN line. "Stock now" is the item\'s total stock, across all batches. Remove expired goods with a stock adjustment (reason: expired).',
        },
      ],
    };
  }

  // ---------------- GST registers ----------------

  private static splitTax(tax: number, interState: boolean) {
    const t = Math.round(tax * 100) / 100;
    if (interState) return { cgst: 0, sgst: 0, igst: t };
    const cgst = Math.round((t / 2) * 100) / 100;
    return { cgst, sgst: Math.round((t - cgst) * 100) / 100, igst: 0 };
  }

  private static rateSummary(rows: { rate: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number }[]) {
    const m = new Map<string, { rate: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number }>();
    for (const r of rows) {
      const c = m.get(r.rate) ?? { rate: r.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
      for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'tax', 'total'] as const) c[k] = Math.round((c[k] + r[k]) * 100) / 100;
      m.set(r.rate, c);
    }
    return [...m.values()].sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
  }

  private static gstCols(first: ReportColumn[]): ReportColumn[] {
    return [
      ...first,
      { key: 'rate', label: 'GST %' }, { key: 'taxable', label: 'Taxable', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' },
      { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' }, { key: 'tax', label: 'Total tax', type: 'money' }, { key: 'total', label: 'Value', type: 'money' },
    ];
  }

  private static sumGst<T extends { taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number }>(rows: T[]) {
    const s = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'tax' | 'total') => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
    return { taxable: s('taxable'), cgst: s('cgst'), sgst: s('sgst'), igst: s('igst'), tax: s('tax'), total: s('total') };
  }

  /** GST input register: tax paid on posted GRNs by supplier invoice date, less debit notes (returns to suppliers). */
  async gstInput(from: string, to: string, user: SessionUser): Promise<Report> {
    const settings = await this.settings.get();
    const storeState = settings.gstin?.slice(0, 2) ?? null;
    const posted = await this.db.purchase.findMany({
      where: { status: 'POSTED', invoiceDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      include: { supplier: { select: { name: true, gstin: true } }, items: { select: { gstRate: true, lineTotal: true, taxAmount: true } } },
    });
    const lines = posted
      .flatMap((pu) =>
        [...new Set(pu.items.map((i) => i.gstRate))].map((rate) => {
          const mine = pu.items.filter((i) => i.gstRate === rate);
          return {
            grn: pu.purchaseNo ?? '', invoice_date: pu.invoiceDate, invoice_no: pu.supplierInvoiceNo, supplier: pu.supplier.name, gstin: pu.supplier.gstin, rate,
            taxable: r2n(sum(mine.map((i) => D(i.lineTotal).minus(i.taxAmount)))), tax: r2n(sum(mine.map((i) => D(i.taxAmount)))),
          };
        }),
      )
      .sort((a, b) => a.invoice_date.getTime() - b.invoice_date.getTime() || a.grn.localeCompare(b.grn) || a.rate - b.rate);
    const inter = (gstin: string | null) => !!(storeState && gstin && gstin.slice(0, 2) !== storeState);
    const rows = lines.map((x) => {
      const taxable = n(x.taxable);
      const tax = n(x.tax);
      return {
        grn: x.grn, date: fmtDate(x.invoice_date.toISOString().slice(0, 10)), invoiceNo: x.invoice_no, supplier: x.supplier, gstin: x.gstin ?? 'Unregistered',
        rate: `${n(x.rate)}%`, taxable, ...ReportsService.splitTax(tax, inter(x.gstin)), tax, total: Math.round((taxable + tax) * 100) / 100,
      };
    });
    const r = istRange(from, to);
    const prs = await this.db.purchaseReturn.findMany({
      where: { createdAt: { gte: r.start, lt: r.end } },
      include: { purchase: { select: { purchaseNo: true } }, supplier: { select: { name: true, gstin: true } }, items: { include: { purchaseItem: { select: { gstRate: true, lineTotal: true, taxAmount: true } } } } },
    });
    const ret = prs
      .flatMap((pr) =>
        [...new Set(pr.items.map((i) => i.purchaseItem.gstRate))].map((rate) => {
          const mine = pr.items.filter((i) => i.purchaseItem.gstRate === rate);
          return {
            return_no: pr.returnNo, created_at: pr.createdAt, grn: pr.purchase.purchaseNo, supplier: pr.supplier.name, gstin: pr.supplier.gstin, rate,
            amount: r2n(sum(mine.map((i) => D(i.amount)))),
            tax: r2n(sum(mine.map((i) => (i.purchaseItem.lineTotal === 0 ? D(0) : D(i.amount).mul(i.purchaseItem.taxAmount).div(i.purchaseItem.lineTotal).toDecimalPlaces(2))))),
          };
        }),
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.rate - b.rate);
    const retRows = ret.map((x) => {
      const tax = n(x.tax);
      const total = n(x.amount);
      return {
        returnNo: x.return_no, date: fmtDate(x.created_at), grn: x.grn ?? '', supplier: x.supplier, rate: `${n(x.rate)}%`,
        taxable: Math.round((total - tax) * 100) / 100, ...ReportsService.splitTax(tax, inter(x.gstin)), tax, total,
      };
    });
    const tIn = ReportsService.sumGst(rows);
    const tRet = ReportsService.sumGst(retRows);
    return {
      title: 'GST input register',
      subtitle: `Purchases by supplier invoice date, ${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `gst_input_register_${from}_to_${to}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Taxable purchases', value: tIn.taxable, type: 'money' },
        { label: 'Input tax (GST paid)', value: tIn.tax, type: 'money' },
        { label: 'Less: debit notes', value: tRet.tax, type: 'money' },
        { label: 'Net input tax', value: Math.round((tIn.tax - tRet.tax) * 100) / 100, type: 'money' },
      ],
      sections: [
        {
          title: 'Purchase invoices',
          columns: ReportsService.gstCols([{ key: 'grn', label: 'GRN no' }, { key: 'date', label: 'Inv. date' }, { key: 'invoiceNo', label: 'Invoice no' }, { key: 'supplier', label: 'Supplier' }, { key: 'gstin', label: 'Supplier GSTIN' }]),
          rows,
          totals: { grn: 'Total', ...tIn },
          note:
            (settings.gstMode === 'REGISTERED' ? '' : 'The store is set as not GST registered, so this input tax cannot be claimed and is part of item cost. ') +
            'Freight and other bill charges are not included. IGST is used when the supplier GSTIN is from another state than the store GSTIN.',
        },
        { title: 'Rate-wise summary', columns: ReportsService.gstCols([]), rows: ReportsService.rateSummary(rows), totals: { rate: 'Total', ...tIn } },
        {
          title: 'Debit notes (returns to suppliers)',
          columns: ReportsService.gstCols([{ key: 'returnNo', label: 'Return no' }, { key: 'date', label: 'Date' }, { key: 'grn', label: 'Against GRN' }, { key: 'supplier', label: 'Supplier' }]),
          rows: retRows,
          totals: { returnNo: 'Total', ...tRet },
        },
      ],
    };
  }

  /** GST output register: tax collected on completed bills, less credit notes (sales returns). */
  async gstOutput(from: string, to: string, user: SessionUser): Promise<Report> {
    const settings = await this.settings.get();
    const r = istRange(from, to);
    const set = await this.salesSet(r);
    const rateLabel = (i: { kitId: number | null; gstRate: number }) => (i.kitId !== null ? 'Kit (mixed)' : `${Number(i.gstRate)}%`);
    const lines = set.sales
      .filter((x) => x.status === 'COMPLETED')
      .flatMap((sl) => {
        const mine = set.items.filter((i) => String(i.saleId) === String(sl.id));
        return [...new Set(mine.map(rateLabel))].sort().map((rate) => {
          const it = mine.filter((i) => rateLabel(i) === rate);
          return { bill_no: sl.billNo, billed_at: sl.billedAt, customer: sl.customerName, rate, total: r2n(sum(it.map((i) => D(i.lineTotal)))), tax: r2n(sum(it.map((i) => D(i.taxAmount)))) };
        });
      });
    const rows = lines.map((x) => {
      const total = n(x.total);
      const tax = n(x.tax);
      return { billNo: x.bill_no, date: fmtDate(x.billed_at), customer: x.customer ?? '', rate: x.rate, taxable: Math.round((total - tax) * 100) / 100, ...ReportsService.splitTax(tax, false), tax, total };
    });
    const srs = await this.db.salesReturn.findMany({
      where: { createdAt: { gte: r.start, lt: r.end } },
      orderBy: { createdAt: 'asc' },
      include: { sale: { select: { billNo: true } }, items: { include: { saleItem: { select: { kitId: true, gstRate: true, lineTotal: true, taxAmount: true } } } } },
    });
    const ret = srs.flatMap((sr) =>
      [...new Set(sr.items.map((i) => rateLabel(i.saleItem)))].sort().map((rate) => {
        const mine = sr.items.filter((i) => rateLabel(i.saleItem) === rate);
        return {
          return_no: sr.returnNo, created_at: sr.createdAt, bill_no: sr.sale.billNo, rate,
          amount: r2n(sum(mine.map((i) => D(i.amount)))),
          tax: r2n(sum(mine.map((i) => (i.saleItem.lineTotal === 0 ? D(0) : D(i.amount).mul(i.saleItem.taxAmount).div(i.saleItem.lineTotal).toDecimalPlaces(2))))),
        };
      }),
    );
    const retRows = ret.map((x) => {
      const total = n(x.amount);
      const tax = n(x.tax);
      return { returnNo: x.return_no, date: fmtDate(x.created_at), billNo: x.bill_no, rate: x.rate, taxable: Math.round((total - tax) * 100) / 100, ...ReportsService.splitTax(tax, false), tax, total };
    });
    const tOut = ReportsService.sumGst(rows);
    const tRet = ReportsService.sumGst(retRows);
    return {
      title: 'GST output register',
      subtitle: `Sales bills, ${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `gst_output_register_${from}_to_${to}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Taxable sales', value: tOut.taxable, type: 'money' },
        { label: 'Output tax (GST collected)', value: tOut.tax, type: 'money' },
        { label: 'Less: credit notes', value: tRet.tax, type: 'money' },
        { label: 'Net output tax', value: Math.round((tOut.tax - tRet.tax) * 100) / 100, type: 'money' },
      ],
      sections: [
        {
          title: 'Sales bills',
          columns: ReportsService.gstCols([{ key: 'billNo', label: 'Bill no' }, { key: 'date', label: 'Date' }, { key: 'customer', label: 'Customer / section' }]),
          rows,
          totals: { billNo: 'Total', ...tOut },
          note:
            (settings.gstMode === 'REGISTERED' ? '' : 'The store is set as not GST registered, so bills carry no GST and the tax columns are zero. The admin can change this in Utilities → Store settings. ') +
            'Prices include GST. Counter sales are within the state, so tax is split equally into CGST and SGST. Kit lines carry the tax of their contents. Bill round-off is not taxed.',
        },
        { title: 'Rate-wise summary', columns: ReportsService.gstCols([]), rows: ReportsService.rateSummary(rows), totals: { rate: 'Total', ...tOut } },
        {
          title: 'Credit notes (sales returns)',
          columns: ReportsService.gstCols([{ key: 'returnNo', label: 'Return no' }, { key: 'date', label: 'Date' }, { key: 'billNo', label: 'Against bill' }]),
          rows: retRows,
          totals: { returnNo: 'Total', ...tRet },
        },
      ],
    };
  }

  // ---------------- Stock (UR-4, FR-11, FR-12) ----------------

  private stockColumns(withValue = true): ReportColumn[] {
    return [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'unit', label: 'Unit' },
      { key: 'opening', label: 'Opening', type: 'qty' }, { key: 'purchased', label: 'Purchased', type: 'qty' }, { key: 'sold', label: 'Sold', type: 'qty' },
      { key: 'salesReturn', label: 'Sales ret.', type: 'qty' }, { key: 'purchaseReturn', label: 'Pur. ret.', type: 'qty' }, { key: 'adjustment', label: 'Adjust', type: 'qty' },
      { key: 'closing', label: 'Closing', type: 'qty' },
      ...(withValue ? [{ key: 'cost', label: 'Cost', type: 'money' as const }, { key: 'value', label: 'Value', type: 'money' as const }] : []),
    ];
  }

  async stockSummary(q: { from: string; to: string; categoryId?: number; q?: string; belowReorderOnly?: boolean }, user: SessionUser): Promise<Report> {
    const rows = await this.stock.summary(q);
    const value = rows.reduce((a, r) => a + r.value, 0);
    return {
      title: 'Stock summary',
      subtitle: `${fmtDate(q.from)} to ${fmtDate(q.to)}${q.belowReorderOnly ? ' - below reorder level only' : ''}`,
      fileName: `stock_summary_${q.from}_to_${q.to}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Items', value: rows.length, type: 'int' },
        { label: 'Stock value at cost (closing)', value, type: 'money' },
        { label: 'Items at or below reorder level', value: rows.filter((r) => r.belowReorder).length, type: 'int' },
        { label: 'Items below zero', value: rows.filter((r) => r.closing < 0).length, type: 'int' },
      ],
      sections: [
        {
          columns: [{ key: 'category', label: 'Category' }, ...this.stockColumns(), { key: 'flag', label: 'Flag' }],
          rows: rows.map((r) => ({ ...r, flag: r.closing < 0 ? 'NEGATIVE' : r.belowReorder ? 'REORDER' : '' })),
          totals: { name: 'Total', value },
          note: 'Closing = Opening + Purchased - Sold + Sales returns - Purchase returns + Adjustments. Value uses the latest landed cost.',
        },
      ],
    };
  }

  async yearlyStock(fy: string, user: SessionUser, categoryId?: number): Promise<Report> {
    const r = fyRange(fy);
    const rows = await this.stock.summary({ from: r.from, to: r.to, categoryId });
    const byCat = new Map<string, typeof rows>();
    for (const row of rows) byCat.set(row.category, [...(byCat.get(row.category) ?? []), row]);
    const catSummary = [...byCat.entries()].map(([category, list]) => ({
      category,
      items: list.length,
      opening: list.reduce((a, x) => a + x.opening, 0),
      inQty: list.reduce((a, x) => a + x.purchased + x.salesReturn + Math.max(0, x.adjustment), 0),
      outQty: list.reduce((a, x) => a + x.sold + x.purchaseReturn + Math.max(0, -x.adjustment), 0),
      closing: list.reduce((a, x) => a + x.closing, 0),
      value: list.reduce((a, x) => a + x.value, 0),
    }));
    const total = catSummary.reduce((a, c) => a + c.value, 0);
    return {
      title: 'Yearly stock report',
      subtitle: `${r.label} (${fmtDate(r.from)} to ${fmtDate(r.to)})`,
      fileName: `stock_FY${fy}`,
      ...this.meta(user),
      landscape: true,
      summary: [
        { label: 'Items', value: rows.length, type: 'int' },
        { label: 'Closing stock value at cost', value: total, type: 'money' },
      ],
      sections: [
        {
          title: 'Category subtotals',
          columns: [
            { key: 'category', label: 'Category' }, { key: 'items', label: 'Items', type: 'int' }, { key: 'opening', label: 'Opening', type: 'qty' }, { key: 'inQty', label: 'In', type: 'qty' },
            { key: 'outQty', label: 'Out', type: 'qty' }, { key: 'closing', label: 'Closing', type: 'qty' }, { key: 'value', label: 'Value', type: 'money' },
          ],
          rows: catSummary,
          totals: { category: 'Total', items: rows.length, value: total },
        },
        ...[...byCat.entries()].map(([category, list]) => ({
          title: category,
          columns: this.stockColumns(),
          rows: list,
          totals: { name: `Subtotal ${category}`, value: list.reduce((a, x) => a + x.value, 0) },
        })),
      ],
    };
  }

  async lowStock(user: SessionUser): Promise<Report> {
    const rows = await this.stock.lowAndNegative();
    return {
      title: 'Low and negative stock',
      subtitle: `As of ${fmtDateTime(new Date())}`,
      fileName: `low_stock_${new Date().toISOString().slice(0, 10)}`,
      ...this.meta(user),
      summary: [
        { label: 'Below zero', value: rows.filter((r) => r.status === 'NEGATIVE').length, type: 'int' },
        { label: 'At or below reorder level', value: rows.filter((r) => r.status === 'LOW').length, type: 'int' },
      ],
      sections: [
        {
          columns: [
            { key: 'status', label: 'Status' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'rackNo', label: 'Rack' },
            { key: 'onHand', label: 'On hand', type: 'qty' }, { key: 'reorderLevel', label: 'Reorder at', type: 'qty' }, { key: 'shortBy', label: 'Short by', type: 'qty' }, { key: 'unit', label: 'Unit' },
          ],
          rows,
          note: 'Negative stock means items were sold before their purchase was entered. Post the purchase or adjust the stock.',
        },
      ],
    };
  }

  async deadStock(days: number, user: SessionUser): Promise<Report> {
    const rows = await this.stock.deadStock(days);
    return {
      title: 'Dead stock',
      subtitle: `Items with stock and no sale in the last ${days} days`,
      fileName: `dead_stock_${days}d`,
      ...this.meta(user),
      summary: [{ label: 'Value held', value: rows.reduce((a, r) => a + r.value, 0), type: 'money' }],
      sections: [
        {
          columns: [
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'onHand', label: 'On hand', type: 'qty' },
            { key: 'value', label: 'Value', type: 'money' }, { key: 'lastSaleText', label: 'Last sold' },
          ],
          rows: rows.map((r) => ({ ...r, lastSaleText: r.lastSale ? fmtDate(r.lastSale) : 'Never' })),
        },
      ],
    };
  }

  async movements(productId: number, from: string, to: string, user: SessionUser): Promise<Report & { data: Awaited<ReturnType<StockService['movements']>> }> {
    const d = await this.stock.movements(productId, from, to);
    return {
      title: `Item ledger: ${d.product.name}`,
      subtitle: `Code ${d.product.code} - ${fmtDate(from)} to ${fmtDate(to)}`,
      fileName: `ledger_${d.product.code}_${from}_to_${to}`,
      ...this.meta(user),
      summary: [
        { label: `Opening (${d.product.unit})`, value: d.opening, type: 'qty' },
        { label: `Closing (${d.product.unit})`, value: d.closing, type: 'qty' },
        { label: 'On hand now', value: d.product.onHand, type: 'qty' },
      ],
      sections: [
        {
          columns: [
            { key: 'when', label: 'Date & time' }, { key: 'kind', label: 'Type' }, { key: 'docNo', label: 'Document' }, { key: 'inQty', label: 'In', type: 'qty' },
            { key: 'outQty', label: 'Out', type: 'qty' }, { key: 'balance', label: 'Balance', type: 'qty' }, { key: 'user', label: 'By' }, { key: 'note', label: 'Note' },
          ],
          rows: d.lines.map((l) => ({ ...l, when: fmtDateTime(l.at) })),
        },
      ],
      data: d,
    };
  }
}

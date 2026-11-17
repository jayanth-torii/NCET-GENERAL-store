import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { SessionUser } from '../auth/auth.decorators';
import { SettingsService } from '../common/settings.service';
import { fmtDate, fmtDateTime, fyRange, istMonthRange, istRange } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { reportToPdf } from './render-pdf';
import { reportToXlsx } from './render-xlsx';
import { num, Report, ReportColumn } from './report-model';

type Range = { start: Date; end: Date };
const n = (v: unknown) => num(v);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
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

  // ---------------- shared sales queries ----------------

  private userFilter(userId?: number) {
    return userId ? Prisma.sql`AND s.user_id = ${userId}` : Prisma.empty;
  }

  private async salesHeadline(r: Range, userId?: number) {
    const [row] = await this.prisma.$queryRaw<Record<string, Prisma.Decimal | bigint | null>[]>`
      SELECT count(*) FILTER (WHERE s.status = 'COMPLETED') AS bills,
             coalesce(sum(s.items_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS gross,
             coalesce(sum(s.discount_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS discount,
             coalesce(sum(s.round_off) FILTER (WHERE s.status = 'COMPLETED'), 0) AS round_off,
             coalesce(sum(s.grand_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS net,
             coalesce(sum(s.tax_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS tax,
             count(*) FILTER (WHERE s.status = 'CANCELLED') AS cancelled,
             coalesce(sum(s.grand_total) FILTER (WHERE s.status = 'CANCELLED'), 0) AS cancelled_amount,
             count(*) FILTER (WHERE s.edit_count > 0) AS edited
      FROM sale s WHERE s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(userId)}`;
    const [ret] = await this.prisma.$queryRaw<{ count: bigint; total: Prisma.Decimal | null }[]>`
      SELECT count(*) AS count, coalesce(sum(total), 0) AS total FROM sales_return s
      WHERE s.created_at >= ${r.start} AND s.created_at < ${r.end} ${this.userFilter(userId)}`;
    const [cost] = await this.prisma.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
      SELECT coalesce(sum(si.qty * si.cost_at_sale), 0) AS cost FROM sale_item si JOIN sale s ON s.id = si.sale_id
      WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(userId)}`;
    return {
      bills: n(row.bills), gross: n(row.gross), discount: n(row.discount), roundOff: n(row.round_off), net: n(row.net), tax: n(row.tax),
      cancelled: n(row.cancelled), cancelledAmount: n(row.cancelled_amount), edited: n(row.edited),
      returns: n(ret.count), returnsTotal: n(ret.total), cost: n(cost.cost),
    };
  }

  private async byPaymentMode(r: Range, userId?: number) {
    const rows = await this.prisma.$queryRaw<{ mode: string; collected: Prisma.Decimal; refunded: Prisma.Decimal; bills: bigint }[]>`
      WITH c AS (
        SELECT p.mode::text AS mode, sum(p.amount) AS amt, count(DISTINCT s.id) AS bills FROM sale_payment p JOIN sale s ON s.id = p.sale_id
        WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(userId)} GROUP BY p.mode
      ), rf AS (
        SELECT s.refund_mode::text AS mode, sum(s.total) AS amt FROM sales_return s
        WHERE s.created_at >= ${r.start} AND s.created_at < ${r.end} ${this.userFilter(userId)} GROUP BY s.refund_mode
      )
      SELECT m.mode, coalesce(c.amt, 0) AS collected, coalesce(rf.amt, 0) AS refunded, coalesce(c.bills, 0) AS bills
      FROM (VALUES ('CASH'), ('UPI'), ('CARD')) AS m(mode)
      LEFT JOIN c ON c.mode = m.mode LEFT JOIN rf ON rf.mode = m.mode`;
    return rows.map((x) => ({ mode: x.mode, bills: n(x.bills), collected: n(x.collected), refunded: n(x.refunded), net: n(x.collected) - n(x.refunded) }));
  }

  private async byCategory(r: Range, userId?: number) {
    const rows = await this.prisma.$queryRaw<{ category: string; qty: Prisma.Decimal; amount: Prisma.Decimal; lines: bigint }[]>`
      SELECT coalesce(c.name, 'Kits') AS category, sum(si.qty) AS qty, sum(si.line_total) AS amount, count(*) AS lines
      FROM sale_item si JOIN sale s ON s.id = si.sale_id
      LEFT JOIN product p ON p.id = si.product_id LEFT JOIN category c ON c.id = p.category_id
      WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(userId)}
      GROUP BY 1 ORDER BY amount DESC`;
    return rows.map((x) => ({ category: x.category, lines: n(x.lines), qty: n(x.qty), amount: n(x.amount) }));
  }

  private async byItem(r: Range, limit: number | null, userId?: number) {
    const rows = await this.prisma.$queryRaw<{ code: string; name: string; qty: Prisma.Decimal; amount: Prisma.Decimal; bills: bigint; cost: Prisma.Decimal }[]>`
      SELECT si.code_snapshot AS code, max(si.name_snapshot) AS name, sum(si.qty) AS qty, sum(si.line_total) AS amount,
             count(DISTINCT s.id) AS bills, sum(si.qty * si.cost_at_sale) AS cost
      FROM sale_item si JOIN sale s ON s.id = si.sale_id
      WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(userId)}
      GROUP BY si.code_snapshot, (si.kit_id IS NOT NULL)
      ORDER BY amount DESC ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`;
    return rows.map((x) => ({ code: x.code, name: x.name, bills: n(x.bills), qty: n(x.qty), amount: n(x.amount), margin: n(x.amount) - n(x.cost) }));
  }

  // ---------------- Daily (FR-10) ----------------

  async daily(date: string, user: SessionUser, ownOnly: boolean): Promise<Report> {
    const r = istRange(date, date);
    const uid = ownOnly ? user.id : undefined;
    const h = await this.salesHeadline(r, uid);
    const digital = await this.prisma.$queryRaw<{ billed_at: Date; bill_no: string; mode: string; reference: string | null; amount: Prisma.Decimal; status: string }[]>`
      SELECT s.billed_at, s.bill_no, p.mode::text AS mode, p.reference, p.amount, s.status::text AS status
      FROM sale_payment p JOIN sale s ON s.id = p.sale_id
      WHERE p.mode <> 'CASH' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(uid)}
      ORDER BY s.billed_at`;
    // Things a manager should check: every action that moved money or stock outside a normal sale.
    const exceptions = ownOnly
      ? []
      : await this.prisma.$queryRaw<{ at: Date; who: string | null; action: string; detail: Prisma.JsonValue; entity_id: string | null }[]>`
          SELECT a.created_at AS at, u.full_name AS who, a.action, coalesce(a.after, a.before) AS detail, a.entity_id
          FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id
          WHERE a.created_at >= ${r.start} AND a.created_at < ${r.end}
            AND a.action IN ('SALE_EDIT','SALE_CANCEL','SALES_RETURN','PRICE_OVERRIDE','HOLD_DISCARD','RECEIPT_REPRINT','STOCK_ADJUST','STOCK_ADJUST_APPROVE','PURCHASE_CANCEL','PURCHASE_RETURN','PRICE_CHANGE')
          ORDER BY a.created_at`;
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
      this.prisma.$queryRaw<{ code: string; bills: bigint; net: Prisma.Decimal; cancelled: bigint }[]>`
        SELECT c.code, count(*) FILTER (WHERE s.status = 'COMPLETED') AS bills, coalesce(sum(s.grand_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS net,
               count(*) FILTER (WHERE s.status = 'CANCELLED') AS cancelled
        FROM sale s JOIN counter c ON c.id = s.counter_id
        WHERE s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(uid)} GROUP BY c.code ORDER BY c.code`,
      this.prisma.$queryRaw<{ name: string; bills: bigint; net: Prisma.Decimal; discount: Prisma.Decimal }[]>`
        SELECT u.full_name AS name, count(*) FILTER (WHERE s.status = 'COMPLETED') AS bills, coalesce(sum(s.grand_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS net,
               coalesce(sum(s.discount_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS discount
        FROM sale s JOIN app_user u ON u.id = s.user_id
        WHERE s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(uid)} GROUP BY u.full_name ORDER BY u.full_name`,
      this.byPaymentMode(r, uid),
      this.byCategory(r, uid),
      this.byItem(r, 20, uid),
      this.prisma.$queryRaw<{ hour: number; bills: bigint; net: Prisma.Decimal }[]>`
        SELECT extract(hour FROM s.billed_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, count(*) AS bills, sum(s.grand_total) AS net
        FROM sale s WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${this.userFilter(uid)}
        GROUP BY 1 ORDER BY 1`,
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
      this.prisma.$queryRaw<{ day: Date; bills: bigint; gross: Prisma.Decimal; discount: Prisma.Decimal; net: Prisma.Decimal; returns: Prisma.Decimal; cancelled: bigint }[]>`
        WITH d AS (SELECT generate_series(${m.from}::date, ${m.to}::date, interval '1 day')::date AS day),
        s AS (
          SELECT (billed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                 count(*) FILTER (WHERE status = 'COMPLETED') AS bills,
                 sum(items_total) FILTER (WHERE status = 'COMPLETED') AS gross,
                 sum(discount_total) FILTER (WHERE status = 'COMPLETED') AS discount,
                 sum(grand_total) FILTER (WHERE status = 'COMPLETED') AS net,
                 count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
          FROM sale WHERE billed_at >= ${r.start} AND billed_at < ${r.end} GROUP BY 1
        ),
        rt AS (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(total) AS returns FROM sales_return
               WHERE created_at >= ${r.start} AND created_at < ${r.end} GROUP BY 1)
        SELECT d.day, coalesce(s.bills, 0) AS bills, coalesce(s.gross, 0) AS gross, coalesce(s.discount, 0) AS discount,
               coalesce(s.net, 0) AS net, coalesce(rt.returns, 0) AS returns, coalesce(s.cancelled, 0) AS cancelled
        FROM d LEFT JOIN s ON s.day = d.day LEFT JOIN rt ON rt.day = d.day ORDER BY d.day`,
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
    const bills = await this.prisma.sale.findMany({
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

  // ---------------- Purchase register ----------------

  async purchaseRegister(from: string, to: string, user: SessionUser, supplierId?: number): Promise<Report> {
    const r = istRange(from, to);
    const purchases = await this.prisma.purchase.findMany({
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
    const returns = await this.prisma.purchaseReturn.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...(supplierId ? { supplierId } : {}) }, include: { supplier: true, purchase: true }, orderBy: { createdAt: 'asc' } });
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

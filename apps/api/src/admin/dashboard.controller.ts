import { Controller, Get } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../auth/auth.decorators';
import { istDate, istDayStart, istRange } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

/** Dashboard: today's sales, last 7 days, stock warnings and things waiting for action. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: SessionUser) {
    const today = istDate();
    const r = istRange(today, today);
    const own = user.role === Role.CASHIER;
    const seesSales = user.role !== Role.STORE_KEEPER;
    const seesStock = user.role !== Role.CASHIER;
    const uf = own ? Prisma.sql`AND s.user_id = ${user.id}` : Prisma.empty;

    const out: Record<string, unknown> = { date: today, role: user.role };

    if (seesSales) {
      const [h] = await this.prisma.$queryRaw<{ bills: bigint; net: Prisma.Decimal | null; cancelled: bigint }[]>`
        SELECT count(*) FILTER (WHERE s.status = 'COMPLETED') AS bills, sum(s.grand_total) FILTER (WHERE s.status = 'COMPLETED') AS net,
               count(*) FILTER (WHERE s.status = 'CANCELLED') AS cancelled
        FROM sale s WHERE s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${uf}`;
      const [ret] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
        SELECT sum(total) AS total FROM sales_return s WHERE s.created_at >= ${r.start} AND s.created_at < ${r.end} ${uf}`;
      const modes = await this.prisma.$queryRaw<{ mode: string; amount: Prisma.Decimal }[]>`
        SELECT p.mode::text AS mode, sum(p.amount) AS amount FROM sale_payment p JOIN sale s ON s.id = p.sale_id
        WHERE s.status = 'COMPLETED' AND s.billed_at >= ${r.start} AND s.billed_at < ${r.end} ${uf} GROUP BY p.mode`;
      const weekStart = istDayStart(istDate(new Date(Date.now() - 6 * 86400000)));
      const week = own
        ? []
        : await this.prisma.$queryRaw<{ day: Date; net: Prisma.Decimal; bills: bigint }[]>`
            WITH d AS (SELECT generate_series(${istDate(new Date(Date.now() - 6 * 86400000))}::date, ${today}::date, interval '1 day')::date AS day)
            SELECT d.day, coalesce(sum(s.grand_total), 0) AS net, count(s.id) AS bills
            FROM d LEFT JOIN sale s ON (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date = d.day AND s.status = 'COMPLETED' AND s.billed_at >= ${weekStart}
            GROUP BY d.day ORDER BY d.day`;
      out.sales = {
        scope: own ? 'own' : 'store',
        bills: Number(h.bills),
        net: Number(h.net ?? 0),
        returns: Number(ret.total ?? 0),
        cancelled: Number(h.cancelled),
        byMode: Object.fromEntries(['CASH', 'UPI', 'CARD'].map((m) => [m, Number(modes.find((x) => x.mode === m)?.amount ?? 0)])),
        week: week.map((w) => ({ date: w.day.toISOString().slice(0, 10), net: Number(w.net), bills: Number(w.bills) })),
      };
    }

    if (seesStock) {
      const [s] = await this.prisma.$queryRaw<{ low: bigint; negative: bigint }[]>`
        SELECT count(*) FILTER (WHERE p.reorder_level > 0 AND coalesce(ps.on_hand, 0) <= p.reorder_level AND coalesce(ps.on_hand, 0) >= 0) AS low,
               count(*) FILTER (WHERE coalesce(ps.on_hand, 0) < 0) AS negative
        FROM product p LEFT JOIN product_stock ps ON ps.product_id = p.id WHERE p.is_active`;
      const [pendingAdjustments, draftPurchases, readyPurchases, alerts] = await Promise.all([
        this.prisma.stockAdjustment.count({ where: { status: 'PENDING' } }),
        this.prisma.purchase.count({ where: { status: 'DRAFT' } }),
        this.prisma.purchase.count({ where: { status: 'DRAFT', readyAt: { not: null } } }),
        user.role === Role.STORE_KEEPER ? Promise.resolve([]) : this.prisma.systemAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);
      out.stock = { low: Number(s.low), negative: Number(s.negative), pendingAdjustments, draftPurchases, readyPurchases };
      out.alerts = alerts;
    }
    return out;
  }
}

import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../auth/auth.decorators';
import { D, r2n, sum } from '../common/money';
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
    const uf = own ? { userId: user.id } : {};

    const out: Record<string, unknown> = { date: today, role: user.role };

    if (seesSales) {
      const todays = await this.prisma.sale.findMany({
        where: { billedAt: { gte: r.start, lt: r.end }, ...uf },
        select: { id: true, status: true, grandTotal: true },
      });
      const done = todays.filter((s) => s.status === 'COMPLETED');
      const ret = await this.prisma.salesReturn.aggregate({ where: { createdAt: { gte: r.start, lt: r.end }, ...uf }, _sum: { total: true } });
      const pays = done.length
        ? await this.prisma.salePayment.findMany({ where: { saleId: { in: done.map((s) => s.id) } }, select: { mode: true, amount: true } })
        : [];
      const weekFrom = istDate(new Date(Date.now() - 6 * 86400000));
      const days = Array.from({ length: 7 }, (_, i) => istDate(new Date(istDayStart(weekFrom).getTime() + i * 86400000 + 12 * 3600000)));
      const weekSales = own
        ? []
        : await this.prisma.sale.findMany({ where: { status: 'COMPLETED', billedAt: { gte: istDayStart(weekFrom), lt: r.end } }, select: { billedAt: true, grandTotal: true } });
      const byDay = new Map(days.map((d) => [d, { net: D(0), bills: 0 }]));
      for (const s of weekSales) {
        const b = byDay.get(istDate(s.billedAt));
        if (b) {
          b.net = b.net.plus(s.grandTotal);
          b.bills++;
        }
      }
      out.sales = {
        scope: own ? 'own' : 'store',
        bills: done.length,
        net: r2n(sum(done.map((s) => D(s.grandTotal)))),
        returns: r2n(ret._sum.total ?? 0),
        cancelled: todays.length - done.length,
        byMode: Object.fromEntries(['CASH', 'UPI', 'CARD'].map((m) => [m, r2n(sum(pays.filter((p) => p.mode === m).map((p) => D(p.amount))))])),
        week: own ? [] : days.map((d) => ({ date: d, net: r2n(byDay.get(d)!.net), bills: byDay.get(d)!.bills })),
      };
    }

    if (seesStock) {
      const prods = await this.prisma.product.findMany({ where: { isActive: true }, select: { reorderLevel: true, stock: { select: { onHand: true } } } });
      const s = { low: 0, negative: 0 };
      for (const p of prods) {
        const on = p.stock?.onHand ?? 0;
        if (on < 0) s.negative++;
        else if (p.reorderLevel > 0 && on <= p.reorderLevel) s.low++;
      }
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

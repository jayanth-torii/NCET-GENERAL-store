import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { r3n } from '../../utils/money';
import { DbService, JsonValue } from '../../config/db';

/**
 * Rule R1 guard: the cached balance must always equal the ledger.
 * Runs every night at 02:00 IST and once shortly after start-up. Any drift raises a system alert on the dashboard.
 */
@Injectable()
export class StockCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StockCheck');

  constructor(private readonly db: DbService) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.run().catch((e) => this.logger.error(e)), 60_000).unref();
  }

  @Cron('0 2 * * *', { timeZone: 'Asia/Kolkata' })
  async nightly() {
    await this.run();
  }

  async run() {
    // Ledger total per product (MongoDB $group via Prisma groupBy) against the cached balance, at 3 dp.
    const [products, balances, ledger] = await Promise.all([
      this.db.product.findMany({ select: { id: true, code: true, name: true } }),
      this.db.productStock.findMany({ select: { productId: true, onHand: true } }),
      this.db.stockMovement.groupBy({ by: ['productId'], _sum: { qty: true } }),
    ]);
    const cachedOf = new Map(balances.map((b) => [b.productId, r3n(b.onHand)]));
    const ledgerOf = new Map(ledger.map((l) => [l.productId, r3n(l._sum.qty ?? 0)]));
    const drift = products
      .map((p) => ({ product_id: p.id, code: p.code, name: p.name, cached: cachedOf.get(p.id) ?? 0, ledger: ledgerOf.get(p.id) ?? 0 }))
      .filter((d) => d.cached !== d.ledger);
    const missing = products.filter((p) => !cachedOf.has(p.id));
    for (const m of missing) {
      await this.db.productStock.upsert({ where: { productId: m.id }, create: { productId: m.id, onHand: 0 }, update: {} });
    }
    if (drift.length === 0) {
      this.logger.log('Stock ledger check passed');
      return { ok: true, drift: [] };
    }
    const details = drift.map((d) => ({ productId: d.product_id, code: d.code, name: d.name, cached: Number(d.cached), ledger: Number(d.ledger) }));
    await this.db.systemAlert.create({
      data: {
        kind: 'STOCK_DRIFT',
        message: `${drift.length} product(s) have a stock balance that does not match the ledger`,
        details: details as unknown as JsonValue,
      },
    });
    this.logger.error(`Stock drift found in ${drift.length} product(s)`);
    return { ok: false, drift: details };
  }
}

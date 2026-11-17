import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rule R1 guard: the cached balance must always equal the ledger.
 * Runs every night at 02:00 IST and once shortly after start-up. Any drift raises a system alert on the dashboard.
 */
@Injectable()
export class StockCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StockCheck');

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.run().catch((e) => this.logger.error(e)), 60_000).unref();
  }

  @Cron('0 2 * * *', { timeZone: 'Asia/Kolkata' })
  async nightly() {
    await this.run();
  }

  async run() {
    const drift = await this.prisma.$queryRaw<{ product_id: number; code: string; name: string; cached: Prisma.Decimal; ledger: Prisma.Decimal }[]>`
      SELECT p.id AS product_id, p.code, p.name, coalesce(ps.on_hand, 0) AS cached, coalesce(l.total, 0) AS ledger
      FROM product p
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      LEFT JOIN (SELECT product_id, sum(qty) AS total FROM stock_movement GROUP BY product_id) l ON l.product_id = p.id
      WHERE coalesce(ps.on_hand, 0) <> coalesce(l.total, 0)`;
    const missing = await this.prisma.$queryRaw<{ id: number }[]>`SELECT p.id FROM product p LEFT JOIN product_stock ps ON ps.product_id = p.id WHERE ps.product_id IS NULL`;
    if (missing.length) {
      await this.prisma.productStock.createMany({ data: missing.map((m) => ({ productId: m.id, onHand: 0 })), skipDuplicates: true });
    }
    if (drift.length === 0) {
      this.logger.log('Stock ledger check passed');
      return { ok: true, drift: [] };
    }
    const details = drift.map((d) => ({ productId: d.product_id, code: d.code, name: d.name, cached: Number(d.cached), ledger: Number(d.ledger) }));
    await this.prisma.systemAlert.create({
      data: {
        kind: 'STOCK_DRIFT',
        message: `${drift.length} product(s) have a stock balance that does not match the ledger`,
        details: details as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.error(`Stock drift found in ${drift.length} product(s)`);
    return { ok: false, drift: details };
  }
}

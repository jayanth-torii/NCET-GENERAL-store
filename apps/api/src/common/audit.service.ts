import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  userId: number | null;
  action: string; // LOGIN, LOGIN_FAILED, SALE_EDIT, SALE_CANCEL, PRICE_CHANGE, STOCK_ADJUST, PURCHASE_POST ...
  entity: string;
  entityId?: string | number | bigint | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Converts Decimal and BigInt values into plain JSON for jsonb columns. */
export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Write an append-only audit entry. Pass the transaction so the entry commits with the change. */
  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: entry.ip ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

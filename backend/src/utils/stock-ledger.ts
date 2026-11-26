import { ConflictException } from '@nestjs/common';
import { MovementKind, Prisma } from '@prisma/client';
import { holdKeys } from './keyed-lock';
import { D, Dec, num } from './money';

type Tx = Prisma.TransactionClient;

export interface Movement {
  productId: number;
  kind: MovementKind;
  qty: Dec | number; // signed: + in, - out
  unitCost?: Dec | number | null;
  refType: string;
  refId: bigint | number;
  note?: string | null;
}

export interface StockWarning {
  productId: number;
  code: string;
  name: string;
  onHand: number;
}

/**
 * Apply stock movements inside the caller's transaction.
 * - Balance rows are updated with on_hand = on_hand + delta (never read-modify-write).
 * - Rows are touched in ascending product_id order so concurrent bills cannot deadlock.
 * - The ledger row and the balance change commit together, so the cached balance always equals the ledger.
 * Returns the products that ended below zero (rule R8). When blockNegative is set, going below zero
 * throws and the whole transaction rolls back.
 */
export async function applyMovements(
  tx: Tx,
  movements: Movement[],
  userId: number | null,
  opts: { blockNegative: boolean },
): Promise<StockWarning[]> {
  const nonZero = movements.filter((m) => !D(m.qty).isZero());
  if (nonZero.length === 0) return [];

  const deltas = new Map<number, Dec>();
  for (const m of nonZero) deltas.set(m.productId, (deltas.get(m.productId) ?? D(0)).plus(m.qty));
  const ordered = [...deltas.entries()].sort((a, b) => a[0] - b[0]);

  // Ledger rows first (no locks needed), balance rows last: the hot balance rows stay locked only
  // for the few milliseconds between the UPDATE and the caller's COMMIT.
  await tx.stockMovement.createMany({
    data: nonZero.map((m) => ({
      productId: m.productId,
      kind: m.kind,
      qty: num(m.qty),
      unitCost: num(m.unitCost),
      refType: m.refType,
      refId: BigInt(m.refId),
      note: m.note ?? null,
      createdById: userId,
    })),
  });

  const changed = ordered.filter(([, d]) => !d.isZero());
  if (changed.length === 0) return [];
  // Wait for any other transaction changing these products to commit (the row-lock equivalent, see
  // keyed-lock.ts); held until this transaction ends.
  await holdKeys(changed.map(([productId]) => `stock:${productId}`));
  // One round trip for every balance: atomic $inc inside the transaction (never read-modify-write);
  // upsert creates a missing balance row. If another server instance wrote the same balance, MongoDB
  // reports a write conflict and withTx re-runs the whole transaction.
  await tx.$runCommandRaw({
    update: 'product_stock',
    updates: changed.map(([productId, delta]) => ({ q: { _id: productId }, u: { $inc: { on_hand: num(delta) } }, upsert: true })),
  });
  const balances = await tx.productStock.findMany({ where: { productId: { in: changed.map(([p]) => p) } }, select: { productId: true, onHand: true } });
  // Balances are compared at 3 dp (repeated float increments can carry ~1e-12 noise).
  const negatives = balances.filter((b) => deltas.get(b.productId)!.lt(0) && D(b.onHand).toDecimalPlaces(3).lt(0)).map((b) => b.productId);

  if (negatives.length === 0) return [];
  const products = await tx.product.findMany({
    where: { id: { in: negatives } },
    select: { id: true, code: true, name: true, stock: { select: { onHand: true } } },
  });
  const warnings = products.map((p) => ({
    productId: p.id,
    code: p.code,
    name: p.name,
    onHand: Number(p.stock?.onHand ?? 0),
  }));
  if (opts.blockNegative) {
    throw new ConflictException({
      message: `Not enough stock: ${warnings.map((w) => `${w.name} (would be ${w.onHand})`).join(', ')}`,
      code: 'NEGATIVE_STOCK',
      warnings,
    });
  }
  return warnings;
}

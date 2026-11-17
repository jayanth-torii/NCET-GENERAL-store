import { ConflictException } from '@nestjs/common';
import { MovementKind, Prisma } from '@prisma/client';
import { D, Dec } from './money';

type Tx = Prisma.TransactionClient;

export interface Movement {
  productId: number;
  kind: MovementKind;
  qty: Dec; // signed: + in, - out
  unitCost?: Dec | null;
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
      qty: D(m.qty),
      unitCost: m.unitCost ?? null,
      refType: m.refType,
      refId: BigInt(m.refId),
      note: m.note ?? null,
      createdById: userId,
    })),
  });

  const negatives: number[] = [];
  for (const [productId, delta] of ordered) {
    if (delta.isZero()) continue;
    const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
      UPDATE product_stock SET on_hand = on_hand + ${delta.toString()}::numeric
      WHERE product_id = ${productId}
      RETURNING on_hand`;
    let onHand: Dec;
    if (rows.length === 0) {
      // Defensive: every product gets a balance row at creation, but never lose a movement.
      const ins = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
        INSERT INTO product_stock (product_id, on_hand) VALUES (${productId}, ${delta.toString()}::numeric)
        ON CONFLICT (product_id) DO UPDATE SET on_hand = product_stock.on_hand + EXCLUDED.on_hand
        RETURNING on_hand`;
      onHand = D(ins[0].on_hand);
    } else {
      onHand = D(rows[0].on_hand);
    }
    if (delta.lt(0) && onHand.lt(0)) negatives.push(productId);
  }

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

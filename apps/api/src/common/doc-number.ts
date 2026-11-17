import { Prisma } from '@prisma/client';
import { fyCode } from './time';

type Tx = Prisma.TransactionClient;

/**
 * Next number in a document series. Runs inside the caller's transaction, so the number is
 * gapless: if the document fails to save, the increment rolls back too.
 * Each series has its own row, so different counters never wait on each other (rule R6).
 */
export async function nextInSeries(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO doc_counter (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = doc_counter.value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

/** Bill number such as C2/26-27/000481. Resets every 1 April. */
export async function nextBillNo(tx: Tx, counterCode: string, at = new Date()): Promise<string> {
  const fy = fyCode(at);
  const n = await nextInSeries(tx, `SALE:${counterCode}:${fy}`);
  return `${counterCode}/${fy}/${String(n).padStart(6, '0')}`;
}

/** Purchase, return and other document numbers such as PU/26-27/0184. */
export async function nextDocNo(tx: Tx, prefix: 'PU' | 'SR' | 'PR', at = new Date()): Promise<string> {
  const fy = fyCode(at);
  const n = await nextInSeries(tx, `${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}

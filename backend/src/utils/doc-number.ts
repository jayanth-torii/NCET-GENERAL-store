import { Tx } from '../config/db';
import { holdKeys } from './keyed-lock';
import { fyCode } from './time';


/**
 * Next number in a document series. Runs inside the caller's transaction, so the number is
 * gapless: if the document fails to save, the increment rolls back too.
 * Each series has its own row, so different counters never wait on each other (rule R6).
 */
export async function nextInSeries(tx: Tx, key: string): Promise<number> {
  await holdKeys([`series:${key}`]); // two GRNs / bills of one series queue instead of aborting each other
  // Atomic upsert + $inc inside the document's MongoDB transaction: gapless, and two counters only
  // ever contend on their own series document.
  const row = await tx.docCounter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return Number(row.value);
}

/** Bill number such as C2/26-27/000481. Resets every 1 April. */
export async function nextBillNo(tx: Tx, counterCode: string, at = new Date()): Promise<string> {
  const fy = fyCode(at);
  const n = await nextInSeries(tx, `SALE:${counterCode}:${fy}`);
  return `${counterCode}/${fy}/${String(n).padStart(6, '0')}`;
}

/** GRN (goods received note), return and other document numbers such as GRN/26-27/0184. */
export async function nextDocNo(tx: Tx, prefix: 'GRN' | 'SR' | 'PR', at = new Date()): Promise<string> {
  const fy = fyCode(at);
  const n = await nextInSeries(tx, `${prefix}:${fy}`);
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}

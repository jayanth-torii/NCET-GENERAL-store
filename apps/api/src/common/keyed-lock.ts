import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * In-process queue per key (for example `stock:159`) — the MongoDB edition's stand-in for PostgreSQL row
 * locks. MongoDB aborts the second of two transactions that write the same document instead of making it
 * wait, so four counters selling the same item would keep aborting each other. The store runs ONE API
 * server, so queueing those transactions here makes them run one after another, exactly as row locks did.
 *
 *  - A transaction (withTx) opens a scope; holdKeys() inside it queues for the keys and keeps them until
 *    the transaction has committed or finally failed (like a row lock held to COMMIT).
 *  - Keys are queued in one synchronous step, so two transactions can never wait on each other in a cycle.
 *  - If a wait passes WAIT_LIMIT_MS (should never happen), it stops waiting and MongoDB's own write-conflict
 *    detection + withTx retry keep the data correct.
 */
const WAIT_LIMIT_MS = 10_000;
const tails = new Map<string, Promise<void>>();
type Scope = { held: Set<string>; releases: (() => void)[] };
const scope = new AsyncLocalStorage<Scope>();

/** Run `fn` with a lock scope; every key taken inside is released when `fn` settles. */
export async function withLockScope<T>(fn: () => Promise<T>): Promise<T> {
  const s: Scope = { held: new Set(), releases: [] };
  try {
    return await scope.run(s, fn);
  } finally {
    for (const r of s.releases.reverse()) r();
  }
}

/** Queue for `keys` (those not already held by this scope) and hold them until the scope ends. */
export async function holdKeys(keys: string[]): Promise<void> {
  const s = scope.getStore();
  if (!s) return; // outside a transaction scope: nothing to coordinate
  const want = [...new Set(keys)].filter((k) => !s.held.has(k)).sort();
  if (!want.length) return;
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const before: Promise<void>[] = [];
  for (const k of want) {
    const prev = tails.get(k) ?? Promise.resolve();
    before.push(prev);
    const tail = prev.then(() => mine);
    tails.set(k, tail);
    s.held.add(k);
    s.releases.push(() => {
      if (tails.get(k) === tail) tails.delete(k);
    });
  }
  s.releases.push(() => release());
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(before), new Promise<void>((r) => (timer = setTimeout(r, WAIT_LIMIT_MS)))]);
  clearTimeout(timer);
}

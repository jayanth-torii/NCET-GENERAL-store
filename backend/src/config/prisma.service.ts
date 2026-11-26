import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { withLockScope } from '../utils/keyed-lock';
import { ensureMongoIndexes } from './mongo-indexes';

/*
 * Prisma on MongoDB (Atlas). The client is extended with the guarantees the PostgreSQL edition got
 * from the database itself:
 *
 *  1. Numeric ids. MongoDB has no auto-increment, so every create (including nested line items,
 *     payments, ledger rows…) gets its `id` from the `_seq` collection. Ids for one write are reserved
 *     in one round trip per collection, outside the transaction (a rolled-back save only leaves a gap
 *     in ids, never in bill numbers — those come from doc_counter inside the transaction).
 *  2. Append-only stock ledger and audit log: update/delete on them is refused.
 *  3. Exact money: Decimal values in a write are stored as numbers rounded to 4 dp.
 *  4. Uniqueness keys for the partial unique indexes: product.name_key and purchase.invoice_key.
 *
 * Transactions go through `withTx` (below), which retries on MongoDB write conflicts — the
 * replacement for PostgreSQL row locks.
 */

type ModelField = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;
const MODELS = new Map<string, Model>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m as Model]));

/** Models whose `id` is assigned from the sequence (numeric id, no default). */
export function seqIdField(model: string): ModelField | undefined {
  const m = MODELS.get(model);
  const f = m?.fields.find((x) => x.isId);
  // Numeric ids carry a placeholder @default(0) so create inputs may leave them out; the real value
  // always comes from the sequence. Any other default (StoreSetting's fixed id 1) is kept.
  if (!f || f.name !== 'id' || (f.type !== 'Int' && f.type !== 'BigInt')) return undefined;
  if (f.hasDefaultValue && Number(f.default as number) !== 0) return undefined;
  return f;
}
export function collectionOf(model: string) {
  const m = MODELS.get(model)!;
  return m.dbName ?? m.name;
}
export const SEQ_MODELS = [...MODELS.keys()].filter((m) => seqIdField(m));

const APPEND_ONLY = new Set(['StockMovement', 'AuditLog']);
const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'aggregateRaw', 'findRaw']);
const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export const invoiceKey = (no: string) => no.trim().toLowerCase();

// ---------------------------------------------------------------- write walkers
type Visit = (model: string, row: Record<string, unknown>) => void;

/** Visit every row that a create payload will create (nested included). */
function forEachCreatedRow(model: string, data: unknown, visit: Visit) {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    visit(model, row as Record<string, unknown>);
    forEachNested(model, row as Record<string, unknown>, visit);
  }
}
/** Walk relation fields of one payload for nested creates (create, createMany, connectOrCreate, upsert, update). */
function forEachNested(model: string, row: Record<string, unknown>, visit: Visit) {
  const m = MODELS.get(model);
  if (!m) return;
  for (const f of m.fields) {
    if (f.kind !== 'object') continue;
    const op = row[f.name] as Record<string, unknown> | undefined;
    if (!op || typeof op !== 'object') continue;
    const each = (v: unknown, fn: (x: Record<string, unknown>) => void) =>
      (Array.isArray(v) ? v : v ? [v] : []).forEach((x) => x && typeof x === 'object' && fn(x as Record<string, unknown>));
    each(op.create, (x) => forEachCreatedRow(f.type, x, visit));
    if (op.createMany && typeof op.createMany === 'object') forEachCreatedRow(f.type, (op.createMany as { data: unknown }).data, visit);
    each(op.connectOrCreate, (x) => forEachCreatedRow(f.type, x.create, visit));
    each(op.upsert, (x) => {
      forEachCreatedRow(f.type, x.create, visit);
      if (x.update && typeof x.update === 'object') forEachNested(f.type, x.update as Record<string, unknown>, visit);
    });
    each(op.update, (x) => forEachNested(f.type, ((x.data as Record<string, unknown>) ?? x) as Record<string, unknown>, visit));
  }
}

/** Decimal → number (rounded to 4 dp) everywhere in a payload; keeps dates, BigInt and Json as they are. */
function plain(v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return Number(v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString());
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v;
}

function setKeys(model: string, row: Record<string, unknown>) {
  if (model === 'Product' && typeof row.name === 'string') row.nameKey = nameKey(row.name);
  if (model === 'Purchase' && typeof row.supplierInvoiceNo === 'string') row.invoiceKey = invoiceKey(row.supplierInvoiceNo);
}

/** Optional scalar fields (no default) per model — written as explicit null on create, see fillNulls. */
const OPTIONAL = new Map(
  [...MODELS.values()].map((m) => [
    m.name,
    m.fields
      .filter((f) => f.kind !== 'object' && !f.isRequired && !f.isList && !f.hasDefaultValue)
      .map((f) => f.name),
  ]),
);
/**
 * On MongoDB Prisma leaves unset optional fields out of a new document, and a `field: null` filter only
 * matches documents where the field IS null — not where it is missing. Writing every unset optional field
 * as null keeps `revokedAt: null`, `readyAt: { not: null }` … behaving exactly as on PostgreSQL.
 * (Relation scalars are skipped when the payload connects the relation instead.)
 */
function fillNulls(model: string, row: Record<string, unknown>) {
  const m = MODELS.get(model);
  for (const name of OPTIONAL.get(model) ?? []) {
    if (row[name] !== undefined) continue;
    const viaRelation = m?.fields.find((r) => r.kind === 'object' && r.relationFromFields?.includes(name));
    if (viaRelation && row[viaRelation.name] !== undefined) continue;
    row[name] = null;
  }
}

// ---------------------------------------------------------------- the client
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super();
    const base: PrismaClient = this;
    /** Reserve `n` ids for a collection in one atomic step; returns the first. */
    const reserve = async (model: string, n: number): Promise<number> => {
      const r = (await retryTransient(() =>
        base.$runCommandRaw({
          findAndModify: '_seq',
          query: { _id: collectionOf(model) },
          update: { $inc: { value: n } },
          upsert: true,
          new: true,
        }),
      )) as { value: { value: number } };
      return Number(r.value.value) - n + 1;
    };
    const assignIds = async (model: string, payload: unknown, updateOnly = false) => {
      const need = new Map<string, number>();
      const rows: [string, Record<string, unknown>][] = [];
      const visit: Visit = (mdl, row) => {
        setKeys(mdl, row);
        fillNulls(mdl, row);
        const f = seqIdField(mdl);
        if (f && row[f.name] === undefined) {
          need.set(mdl, (need.get(mdl) ?? 0) + 1);
          rows.push([mdl, row]);
        }
      };
      if (updateOnly) {
        if (payload && typeof payload === 'object') {
          setKeys(model, payload as Record<string, unknown>);
          forEachNested(model, payload as Record<string, unknown>, visit);
        }
      } else forEachCreatedRow(model, payload, visit);
      if (!rows.length) return;
      const firsts = new Map<string, number>();
      await Promise.all([...need].map(async ([mdl, n]) => firsts.set(mdl, await reserve(mdl, n))));
      for (const [mdl, row] of rows) {
        const next = firsts.get(mdl)!;
        firsts.set(mdl, next + 1);
        row.id = seqIdField(mdl)!.type === 'BigInt' ? BigInt(next) : next;
      }
    };

    const extended = base.$extends({
      name: 'mongo-guarantees',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (APPEND_ONLY.has(model) && WRITE_OPS.has(operation)) {
              throw new Error(`${model} is append-only: ${operation} is not allowed`);
            }
            const a = (args ?? {}) as Record<string, unknown>;
            for (const k of ['data', 'create', 'update', 'where']) if (a[k] !== undefined) a[k] = plain(a[k]);
            if (operation === 'create' || operation === 'createMany') await assignIds(model, a.data);
            else if (operation === 'upsert') {
              await assignIds(model, a.create);
              await assignIds(model, a.update, true);
            } else if (operation === 'update' || operation === 'updateMany') await assignIds(model, a.data, true);
            // Reads are retried on a dropped/refused Atlas connection. Writes are not retried here: inside a
            // transaction a repeated $inc could count twice; the driver's retryWrites (exactly-once) and
            // withTx (whole transaction) cover them.
            return READ_OPS.has(operation) ? retryTransient(() => query(a as typeof args)) : query(a as typeof args);
          },
        },
      },
    });
    // Nest calls `new PrismaService()`; hand it the extended client (same API, guarantees above).
    return extended as unknown as PrismaService;
  }
}

// ---------------------------------------------------------------- network + transaction retry
/**
 * Errors where MongoDB did not run the command: a refused or dropped connection to Atlas (seen from this
 * network as "received fatal alert: InternalError" during the TLS handshake, labelled RetryableWriteError).
 */
export const TRANSIENT = /I\/O error|fatal alert|RetryableWriteError|RetryableError|connection (reset|closed|refused)|ECONNRESET|ETIMEDOUT|Server selection timeout|No suitable servers|P1001|P1017/i;

/** Retry one database call on a transient network error (up to 4 tries, 150 / 300 / 450 ms apart). */
export async function retryTransient<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = `${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''}`;
      if (i >= tries || !TRANSIENT.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}

const RETRYABLE = /P2034|WriteConflict|Write conflict|TransientTransactionError|NoSuchTransaction|LockTimeout|Transaction already in progress|I\/O error|fatal alert|RetryableWriteError|P1001|P1017/i;

/**
 * Run `fn` in a MongoDB transaction. A write conflict (two counters touching the same stock or counter
 * document at the same moment) aborts one of them; it is retried with a short random back-off, so the
 * caller sees one clean result — the same outcome PostgreSQL row locks gave.
 */
export async function withTx<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>, _opts?: unknown): Promise<T> {
  // Keys taken with holdKeys() inside (stock rows, …) stay held until the transaction is over.
  return withLockScope(async () => {
    let attempt = 0;
    for (;;) {
      try {
        return await prisma.$transaction(fn, { maxWait: 20_000, timeout: 60_000 });
      } catch (e) {
        const msg = `${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}`;
        // Two counters opening a brand-new number series at once both try to insert its first document;
        // the loser gets a duplicate key on doc_counter — retrying finds the document and increments it.
        const seriesRace = /P2002|E11000/.test(msg) && /doc_counter|_seq/.test(msg);
        if (++attempt > 25 || !(RETRYABLE.test(msg) || seriesRace)) throw e;
        // Exponential back-off with jitter (up to ~1.5 s), so retries spread out instead of colliding again.
        await new Promise((r) => setTimeout(r, Math.random() * Math.min(1500, 40 * 2 ** attempt)));
      }
    }
  });
}

@Injectable()
export class MongoBoot {
  constructor(prisma: PrismaService) {
    ensureMongoIndexes(prisma).catch((e) => new Logger('MongoBoot').error(`Index setup failed: ${(e as Error).message}`));
  }
}

@Global()
@Module({
  providers: [PrismaService, MongoBoot],
  exports: [PrismaService],
})
export class PrismaModule {}

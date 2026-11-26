import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Decimal from 'decimal.js';
import mongoose, { ClientSession, Model, Schema } from 'mongoose';
import type * as M from '../models';
import '../models';
import { withLockScope } from '../utils/keyed-lock';

/*
 * MongoDB through Mongoose. Each collection has a Mongoose model in models/<feature>/model.ts (stored field
 * names snake_case, camelCase aliases). The services talk to one repository per model (`db.sale`,
 * `db.product`, …) with a small, fixed query vocabulary: where / select / include / orderBy / take / skip,
 * nested creates, increments, groupBy and aggregate. Every query runs through the Mongoose model, results
 * come back as plain camelCase objects with `id`.
 *
 * Guarantees the store relies on (they used to come from the PostgreSQL database, then from Prisma):
 *  1. Numeric ids: MongoDB has no auto-increment, so every insert takes its id from the `_seq` collection,
 *     reserved in one round trip per collection and outside the transaction (a rolled-back save only leaves
 *     a gap in ids, never in bill numbers — those come from doc_counter inside the transaction).
 *  2. The stock ledger and the audit log are append-only: update and delete on them are refused.
 *  3. Exact money: Decimal values are stored as numbers rounded to 4 dp; money fields are stored as doubles.
 *  4. Uniqueness keys for the partial unique indexes: product.name_key and purchase.invoice_key.
 *  5. Optional fields are written as null (schema defaults), so `field: null` filters behave.
 *  6. Transactions (`withTx`) retry on write conflicts — the replacement for row locks.
 */

/**
 * A row as the repositories return it: every field present, relations typed as loaded (only those
 * requested in include / select are really there — the same contract the services already follow).
 */
type Prim = string | number | boolean | bigint | Date | null | undefined;
type Deep<V> = V extends Prim ? V : V extends (infer U)[] ? Loaded<U>[] : V extends object ? (unknown extends V ? V : Loaded<V>) : V;
export type Loaded<T> = { [K in keyof T]-?: Deep<Exclude<T[K], undefined>> } & { _count: Record<string, number> };

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue } | Record<string, unknown> | unknown[];
export type Where = Record<string, unknown>;
type Doc = Record<string, unknown>;
type Args = {
  where?: Where;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  data?: unknown;
  create?: unknown;
  update?: unknown;
};

// ------------------------------------------------------------------ errors
/** Database error with the codes the API maps to HTTP answers (unique 409, not found 404, conflict 409). */
export class DbError extends Error {
  constructor(
    message: string,
    public readonly code: 'P2002' | 'P2025' | 'P2034' | 'P2010',
    public readonly meta: { target?: string; modelName?: string } = {},
  ) {
    super(message);
    this.name = 'DbError';
  }
}

function mapError(e: unknown, collection?: string): unknown {
  const err = e as { code?: number; errmsg?: string; message?: string; keyPattern?: Record<string, unknown>; hasErrorLabel?: (l: string) => boolean };
  if (err?.code === 11000) {
    const index = /index: (\S+)/.exec(err.errmsg ?? err.message ?? '')?.[1] ?? Object.keys(err.keyPattern ?? {}).join('_');
    return new DbError(`Unique constraint failed on ${collection ?? '?'}.${index}`, 'P2002', { target: `${collection ?? ''}.${index}` });
  }
  if (err?.code === 112) return new DbError(`Write conflict on ${collection ?? '?'}`, 'P2034', { target: collection });
  return e;
}

// ------------------------------------------------------------------ retries
/**
 * Errors where MongoDB did not run the command: a refused or dropped connection to Atlas (seen from the store
 * network as "tlsv1 alert internal error" / "fatal alert: InternalError" during the TLS handshake).
 */
export const TRANSIENT =
  /I\/O error|fatal alert|alert internal error|RetryableWriteError|RetryableError|ResetPool|PoolCleared|pool for \S+ was cleared|MongoNetwork|connection \S+( to \S+)? (reset|closed|refused|timed out)|socket (hang up|closed)|ECONNRESET|ETIMEDOUT|EPIPE|Server selection timed out|MongoServerSelectionError|No suitable servers/i;

const describe = (e: unknown) => `${(e as { name?: string })?.name ?? ''} ${(e as { code?: unknown })?.code ?? ''} ${(e as Error)?.message ?? ''}`;

/**
 * Retry one database call on a transient network error: up to `tries` attempts, waiting 200 ms, 400 ms,
 * 800 ms … (at most 2.5 s, plus a little jitter) — about 8 s in all with the default 6, enough to ride out a
 * burst of refused TLS handshakes while the driver rebuilds its connection pool.
 */
export async function retryTransient<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !TRANSIENT.test(describe(e))) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2500, 200 * 2 ** (i - 1)) + Math.random() * 100));
    }
  }
}

// ------------------------------------------------------------------ model metadata
interface FieldMeta {
  camel: string;
  db: string;
  kind: string; // Mongoose instance: String, Int32, BigInt, Double, Date, Boolean, Mixed
}
interface RelationMeta {
  name: string;
  ref: string;
  localField: string; // db names
  foreignField: string;
  justOne: boolean;
}
interface ModelMeta {
  name: string;
  model: Model<unknown>;
  collection: string;
  fields: FieldMeta[];
  byCamel: Map<string, FieldMeta>;
  byDb: Map<string, FieldMeta>;
  relations: Map<string, RelationMeta>;
  seqId: boolean; // numeric id assigned from _seq when not given
  idCamel: string; // name of the key field in the API (id, or productId / key / name)
}

const META = new Map<string, ModelMeta>();
function buildMeta() {
  if (META.size) return;
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name) as Model<unknown>;
    const schema = model.schema as Schema;
    const fields: FieldMeta[] = [];
    schema.eachPath((path, type) => {
      const camel = (type.options as { alias?: string }).alias ?? (path === '_id' ? 'id' : path);
      fields.push({ camel, db: path, kind: type.instance });
    });
    const relations = new Map<string, RelationMeta>();
    for (const [vname, v] of Object.entries(schema.virtuals as Record<string, { options?: Record<string, unknown> }>)) {
      const o = v.options ?? {};
      if (!o.ref) continue;
      relations.set(vname, { name: vname, ref: String(o.ref), localField: String(o.localField), foreignField: String(o.foreignField), justOne: !!o.justOne });
    }
    const idKind = fields.find((f) => f.db === '_id')?.kind;
    META.set(name, {
      name,
      model,
      collection: model.collection.collectionName,
      fields,
      byCamel: new Map(fields.map((f) => [f.camel, f])),
      byDb: new Map(fields.map((f) => [f.db, f])),
      relations,
      seqId: idKind === 'Int32' || idKind === 'BigInt' || idKind === 'Number',
      idCamel: fields.find((f) => f.db === '_id')!.camel,
    });
  }
}
function meta(name: string): ModelMeta {
  buildMeta();
  const m = META.get(name);
  if (!m) throw new Error(`Unknown model ${name}`);
  return m;
}
export function collectionOf(model: string) {
  return meta(model).collection;
}
/** Collections whose numeric ids come from _seq. */
export function seqCollections(): string[] {
  buildMeta();
  return [...META.values()].filter((m) => m.seqId).map((m) => m.collection);
}

// ------------------------------------------------------------------ value helpers
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export const invoiceKey = (no: string) => no.trim().toLowerCase();

/** Decimal -> number (4 dp), bigint -> number; plain objects / arrays walked; dates kept. */
function plain(v: unknown): unknown {
  if (Decimal.isDecimal(v)) return Number((v as Decimal).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString());
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Doc = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v;
}

/** Values read from MongoDB in API form: Long / bigint -> number, Decimal128 -> number. */
function fromDb(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v === 'object') {
    const t = (v as { _bsontype?: string })._bsontype;
    if (t === 'Long' || t === 'Int32' || t === 'Double') return Number((v as { valueOf(): number }).valueOf());
    if (t === 'Decimal128') return Number(String(v));
  }
  return v;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------ where -> filter
function condition(v: unknown): unknown {
  v = plain(v);
  if (v === null || v instanceof Date || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Doc;
  const out: Doc = {};
  const flags = o.mode === 'insensitive' ? 'i' : '';
  for (const [op, x] of Object.entries(o)) {
    if (x === undefined || op === 'mode') continue;
    switch (op) {
      case 'equals':
        // case-insensitive equality: an anchored regex (strings only)
        if (flags && typeof x === 'string') {
          out.$regex = `^${escapeRe(x)}$`;
          out.$options = flags;
        } else out.$eq = x;
        break;
      case 'in': out.$in = x; break;
      case 'notIn': out.$nin = x; break;
      case 'lt': out.$lt = x; break;
      case 'lte': out.$lte = x; break;
      case 'gt': out.$gt = x; break;
      case 'gte': out.$gte = x; break;
      case 'contains': out.$regex = escapeRe(String(x)); if (flags) out.$options = flags; break;
      case 'startsWith': out.$regex = `^${escapeRe(String(x))}`; if (flags) out.$options = flags; break;
      case 'endsWith': out.$regex = `${escapeRe(String(x))}$`; if (flags) out.$options = flags; break;
      case 'not':
        if (x === null || typeof x !== 'object' || x instanceof Date) out.$ne = x;
        else if ('in' in (x as Doc)) out.$nin = (x as Doc).in;
        else out.$not = condition(x);
        break;
      default:
        throw new Error(`Unsupported filter operator "${op}"`);
    }
  }
  return out;
}

function toFilter(m: ModelMeta, where?: Where): Doc {
  if (!where) return {};
  const out: Doc = {};
  const and: Doc[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'AND') and.push(...(Array.isArray(v) ? v : [v]).map((w) => toFilter(m, w as Where)));
    else if (k === 'OR') and.push({ $or: (v as Where[]).map((w) => toFilter(m, w)) });
    else if (k === 'NOT') and.push({ $nor: (Array.isArray(v) ? v : [v]).map((w) => toFilter(m, w as Where)) });
    else if (m.byCamel.has(k)) out[m.byCamel.get(k)!.db] = condition(v);
    else if (m.relations.has(k)) throw new Error(`${m.name}: filtering on relation "${k}" is not supported; query its ids first`);
    else if (v && typeof v === 'object' && Object.keys(v).every((x) => m.byCamel.has(x))) Object.assign(out, toFilter(m, v as Where)); // compound unique key
    else throw new Error(`${m.name}: unknown field "${k}" in filter`);
  }
  if (!and.length) return out;
  return { $and: Object.keys(out).length ? [out, ...and] : and };
}

function toSort(m: ModelMeta, orderBy: unknown): Record<string, 1 | -1> | undefined {
  if (!orderBy) return undefined;
  const sort: Record<string, 1 | -1> = {};
  for (const o of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    for (const [k, dir] of Object.entries(o as Doc)) {
      const f = m.byCamel.get(k);
      if (!f) throw new Error(`${m.name}: cannot sort by "${k}"`);
      sort[f.db] = dir === 'desc' ? -1 : 1;
    }
  }
  return sort;
}

// ------------------------------------------------------------------ select / include plan
interface Plan {
  fields: 'all' | Set<string>; // camel names
  relations: Map<string, { rel: RelationMeta; args: Args }>;
  counts: string[];
}
function planOf(m: ModelMeta, args: Args): Plan {
  const plan: Plan = { fields: 'all', relations: new Map(), counts: [] };
  const spec = args.select ?? args.include;
  if (args.select) plan.fields = new Set();
  if (!spec) return plan;
  for (const [k, v] of Object.entries(spec)) {
    if (!v) continue;
    if (k === '_count') {
      const sel = (v as { select?: Doc }).select ?? {};
      plan.counts.push(...Object.keys(sel).filter((x) => sel[x]));
    } else if (m.relations.has(k)) plan.relations.set(k, { rel: m.relations.get(k)!, args: v === true ? {} : (v as Args) });
    else if (m.byCamel.has(k)) {
      if (plan.fields !== 'all') plan.fields.add(k);
    } else throw new Error(`${m.name}: unknown field "${k}" in select/include`);
  }
  return plan;
}
function projection(m: ModelMeta, plan: Plan): Record<string, 1> | undefined {
  if (plan.fields === 'all') return undefined;
  const p: Record<string, 1> = { _id: 1 };
  for (const c of plan.fields) p[m.byCamel.get(c)!.db] = 1;
  for (const { rel } of plan.relations.values()) p[rel.localField] = 1;
  for (const name of plan.counts) p[m.relations.get(name)!.localField] = 1;
  return p;
}
function toApi(m: ModelMeta, doc: Doc, plan: Plan): Doc {
  const out: Doc = {};
  for (const f of m.fields) if (plan.fields === 'all' || plan.fields.has(f.camel)) out[f.camel] = fromDb(doc[f.db]);
  return out;
}

// ------------------------------------------------------------------ repositories
type Ctx = { session?: ClientSession };

/** Data payload (camelCase) -> MongoDB document (snake_case). Relation writes are returned separately. */
function splitData(m: ModelMeta, data: Doc) {
  const own: Doc = {};
  const nested: [RelationMeta, Doc][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (m.relations.has(k)) nested.push([m.relations.get(k)!, v as Doc]);
    else if (m.byCamel.has(k)) own[k] = v;
    else throw new Error(`${m.name}: unknown field "${k}" in data`);
  }
  if (m.name === 'Product' && typeof own.name === 'string') own.nameKey = nameKey(own.name);
  if (m.name === 'Purchase' && typeof own.supplierInvoiceNo === 'string') own.invoiceKey = invoiceKey(own.supplierInvoiceNo);
  return { own, nested };
}
const toDbDoc = (m: ModelMeta, own: Doc) => Object.fromEntries(Object.entries(own).map(([k, v]) => [m.byCamel.get(k)!.db, plain(v)]));

/** Reserve `n` ids for a collection in one atomic step; returns the first. */
async function reserveIds(collection: string, n: number): Promise<number> {
  const r = await retryTransient(() =>
    mongoose.connection.db!.collection<{ _id: string; value: number }>('_seq').findOneAndUpdate({ _id: collection }, { $inc: { value: n } }, { upsert: true, returnDocument: 'after' }),
  );
  return Number(fromDb(r!.value)) - n + 1;
}

/**
 * Give every row of an insert — the rows and their nested creates (a bill, its lines, its payments) — its id
 * from _seq, reserving all collections in one parallel step instead of one round trip per level.
 */
async function reserveTreeIds(m: ModelMeta, rows: Doc[]) {
  const need = new Map<ModelMeta, Doc[]>();
  const walk = (mm: ModelMeta, list: Doc[]) => {
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      if (mm.seqId && row[mm.idCamel] === undefined) {
        if (!need.has(mm)) need.set(mm, []);
        need.get(mm)!.push(row);
      }
      for (const [k, v] of Object.entries(row)) {
        const rel = mm.relations.get(k);
        if (!rel || !v || typeof v !== 'object') continue;
        const op = v as Doc;
        const children = [...(op.create ? (Array.isArray(op.create) ? op.create : [op.create]) : []), ...(((op.createMany as { data?: Doc[] })?.data ?? []) as Doc[])];
        walk(meta(rel.ref), children as Doc[]);
      }
    }
  };
  walk(m, rows);
  await Promise.all(
    [...need].map(async ([mm, list]) => {
      let next = await reserveIds(mm.collection, list.length);
      for (const row of list) row[mm.idCamel] = next++;
    }),
  );
}

const APPEND_ONLY = new Set(['StockMovement', 'AuditLog']);

export class Repo<T = Doc> {
  constructor(
    readonly m: ModelMeta,
    private readonly ctx: Ctx,
  ) {}

  private read<T>(fn: () => Promise<T>): Promise<T> {
    // Outside a transaction a dropped connection is retried; inside one, withTx retries the whole transaction.
    return this.ctx.session ? fn() : retryTransient(fn);
  }
  private guard(op: string) {
    if (APPEND_ONLY.has(this.m.name)) throw new Error(`${this.m.name} is append-only: ${op} is not allowed`);
  }

  /**
   * Conditions on a one-to-one relation (`product: { isActive: true }`, `stock: { onHand: { lte: 0 } }`)
   * become a key filter: the related rows are queried first and their keys matched.
   */
  private async expandRelations(where?: Where): Promise<Where | undefined> {
    if (!where) return where;
    const out: Where = {};
    const extra: Where[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === 'AND' || k === 'OR' || k === 'NOT') {
        const list = await Promise.all((Array.isArray(v) ? v : [v]).map((w) => this.expandRelations(w as Where)));
        out[k] = Array.isArray(v) ? list : list[0];
      } else if (this.m.relations.has(k)) {
        const rel = this.m.relations.get(k)!;
        if (!rel.justOne) throw new Error(`${this.m.name}: filtering on list relation "${k}" is not supported`);
        const target = meta(rel.ref);
        const localCamel = this.m.byDb.get(rel.localField)!.camel;
        const foreignCamel = target.byDb.get(rel.foreignField)!.camel;
        if (v === null) {
          extra.push({ [localCamel]: null });
          continue;
        }
        const o = v as Where;
        const negate = 'isNot' in o;
        const cond = (('is' in o ? o.is : negate ? o.isNot : o) ?? {}) as Where;
        const rows = await new Repo<Doc>(target, this.ctx).findMany({ where: cond, select: { [foreignCamel]: true } });
        const keys = rows.map((r) => (r as Doc)[foreignCamel]);
        extra.push({ [localCamel]: negate ? { notIn: keys } : { in: keys } });
      } else out[k] = v;
    }
    if (extra.length) out.AND = [...(Array.isArray(out.AND) ? (out.AND as Where[]) : out.AND ? [out.AND as Where] : []), ...extra];
    return out;
  }

  async findMany(args: Args = {}): Promise<Loaded<T>[]> {
    const plan = planOf(this.m, args);
    const where = await this.expandRelations(args.where);
    const orders = (args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []) as Doc[];
    const byRelation = orders.some((o) => Object.keys(o).some((k) => this.m.relations.has(k)));
    if (!byRelation) {
      const docs = (await this.read(() =>
        this.m.model
          .find(toFilter(this.m, where), projection(this.m, plan), { session: this.ctx.session, sort: toSort(this.m, args.orderBy), skip: args.skip, limit: args.take })
          .lean()
          .exec(),
      )) as Doc[];
      return (await this.attach(docs, plan)) as Loaded<T>[];
    }
    // Sorting on a related row's field (`orderBy: { category: { name: 'asc' } }`): load, sort, then page.
    const relKeys = orders.flatMap((o) => Object.keys(o).filter((k) => this.m.relations.has(k)));
    const sortPlan: Plan = { fields: 'all', relations: new Map(relKeys.map((k) => [k, { rel: this.m.relations.get(k)!, args: {} }])), counts: [] };
    const docs = (await this.read(() => this.m.model.find(toFilter(this.m, where), undefined, { session: this.ctx.session }).lean().exec())) as Doc[];
    const withRel = await this.attach(docs, sortPlan);
    const value = (row: Doc, k: string, dir: unknown) => {
      if (this.m.relations.has(k)) {
        const [field] = Object.keys(dir as Doc);
        return (row[k] as Doc | null)?.[field] ?? null;
      }
      return row[k] ?? null;
    };
    const direction = (k: string, dir: unknown) => (this.m.relations.has(k) ? Object.values(dir as Doc)[0] : dir) === 'desc' ? -1 : 1;
    const order = docs.map((d, i) => ({ d, row: withRel[i] }));
    order.sort((a, b) => {
      for (const o of orders) {
        for (const [k, dir] of Object.entries(o)) {
          const x = value(a.row, k, dir);
          const y = value(b.row, k, dir);
          // MongoDB order: null first, then by value (binary string order)
          const c = x === y ? 0 : x === null ? -1 : y === null ? 1 : (x as number) < (y as number) ? -1 : 1;
          if (c) return c * direction(k, dir);
        }
      }
      return 0;
    });
    const paged = order.slice(args.skip ?? 0, args.take !== undefined ? (args.skip ?? 0) + args.take : undefined).map((x) => x.d);
    return (await this.attach(paged, plan)) as Loaded<T>[];
  }
  async findFirst(args: Args = {}): Promise<Loaded<T> | null> {
    return (await this.findMany({ ...args, take: 1 }))[0] ?? null;
  }
  findUnique(args: Args): Promise<Loaded<T> | null> {
    return this.findFirst(args);
  }
  async findUniqueOrThrow(args: Args): Promise<Loaded<T>> {
    const r = await this.findFirst(args);
    if (!r) throw new DbError(`No ${this.m.name} found`, 'P2025', { modelName: this.m.name });
    return r;
  }
  findFirstOrThrow(args: Args): Promise<Loaded<T>> {
    return this.findUniqueOrThrow(args);
  }
  async count(args: { where?: Where } = {}): Promise<number> {
    const where = await this.expandRelations(args.where);
    return this.read(() => this.m.model.countDocuments(toFilter(this.m, where), { session: this.ctx.session }).exec());
  }

  /** Load requested relations (one query per relation and level) and relation counts, then map to API form. */
  private async attach(docs: Doc[], plan: Plan): Promise<Doc[]> {
    const out = docs.map((d) => toApi(this.m, d, plan));
    for (const [name, { rel, args }] of plan.relations) {
      const target = meta(rel.ref);
      const keys = [...new Set(docs.map((d) => fromDb(d[rel.localField])).filter((k) => k !== null))];
      const repo = new Repo<Doc>(target, this.ctx);
      const fk = target.byDb.get(rel.foreignField)!.camel;
      const childPlan = planOf(target, args);
      // the foreign key is needed to hand children to their parent, even if not selected
      const childArgs: Args = { ...args, take: undefined, where: { AND: [{ [fk]: { in: keys } }, ...(args.where ? [args.where] : [])] } };
      if (childPlan.fields !== 'all') childArgs.select = { ...(args.select ?? {}), [fk]: true };
      const children = keys.length ? await repo.findMany(childArgs) : [];
      const byKey = new Map<unknown, Doc[]>();
      for (const c of children) {
        const k = c[fk];
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(c);
      }
      const strip = childPlan.fields !== 'all' && !childPlan.fields.has(fk);
      docs.forEach((d, i) => {
        let list = (byKey.get(fromDb(d[rel.localField])) ?? []).map((c) => (strip ? omit(c, fk) : c));
        if (args.take !== undefined) list = list.slice(0, args.take);
        out[i][name] = rel.justOne ? (list[0] ?? null) : list;
      });
    }
    if (plan.counts.length) {
      for (const d of out) d._count = {};
      for (const name of plan.counts) {
        const rel = this.m.relations.get(name)!;
        const target = meta(rel.ref);
        const keys = [...new Set(docs.map((d) => fromDb(d[rel.localField])))];
        const rows = (await this.read(() =>
          target.model.aggregate([{ $match: { [rel.foreignField]: { $in: keys } } }, { $group: { _id: `$${rel.foreignField}`, n: { $sum: 1 } } }]).session(this.ctx.session ?? null).exec(),
        )) as { _id: unknown; n: number }[];
        const n = new Map(rows.map((r) => [fromDb(r._id), r.n]));
        docs.forEach((d, i) => ((out[i]._count as Doc)[name] = n.get(fromDb(d[rel.localField])) ?? 0));
      }
    }
    return out;
  }

  // -------------------------------------------------------------- writes
  /** Insert rows (with nested relation creates) and return the inserted documents (db form). */
  private async insert(rows: Doc[], idsReady = false): Promise<Doc[]> {
    if (!idsReady) {
      rows = rows.map((r) => ({ ...r })); // ids are written onto copies, not the caller's objects
      await reserveTreeIds(this.m, rows);
    }
    const parts = rows.map((r) => splitData(this.m, plain(r) as Doc));
    if (this.m.seqId) {
      const need = parts.filter((p) => p.own[this.m.idCamel] === undefined);
      if (need.length) {
        let next = await reserveIds(this.m.collection, need.length);
        for (const p of need) p.own[this.m.idCamel] = next++;
      }
    }
    const docs = parts.map((p) => toDbDoc(this.m, p.own));
    let inserted: Doc[];
    try {
      const created = await this.m.model.insertMany(docs, { session: this.ctx.session, ordered: true });
      inserted = created.map((c) => (c as unknown as { toObject(o: object): Doc }).toObject({ virtuals: false }));
    } catch (e) {
      throw mapError(e, this.m.collection);
    }
    // nested creates on one-to-many relations: children get the parent's key
    for (let i = 0; i < parts.length; i++) {
      for (const [rel, op] of parts[i].nested) {
        const target = meta(rel.ref);
        const fk = target.byDb.get(rel.foreignField)!.camel;
        const key = fromDb(inserted[i][rel.localField]);
        const list = [...(op.create ? (Array.isArray(op.create) ? op.create : [op.create]) : []), ...(((op.createMany as { data?: Doc[] })?.data ?? []) as Doc[])];
        if (Object.keys(op).some((k) => k !== 'create' && k !== 'createMany')) throw new Error(`${this.m.name}.${rel.name}: only nested create / createMany are supported`);
        if (list.length) await new Repo<Doc>(target, this.ctx).insert(list.map((c) => ({ ...(c as Doc), [fk]: key })), true);
      }
    }
    return inserted;
  }

  async create(args: Args): Promise<Loaded<T>> {
    const [doc] = await this.insert([args.data as Doc]);
    if (args.select || args.include) return this.findUniqueOrThrow({ where: { [this.m.idCamel]: fromDb(doc._id) }, select: args.select, include: args.include });
    return toApi(this.m, doc, planOf(this.m, {})) as Loaded<T>;
  }
  async createMany(args: { data: Doc[] }): Promise<{ count: number }> {
    if (!args.data.length) return { count: 0 };
    return { count: (await this.insert(args.data)).length };
  }

  /** camelCase data -> MongoDB update ($set / $inc). */
  private toUpdate(data: Doc, allowNested = false) {
    const { own, nested } = splitData(this.m, plain(data) as Doc);
    if (nested.length && !allowNested) throw new Error(`${this.m.name}: nested relation writes are only supported in update()`);
    const $set: Doc = {};
    const $inc: Doc = {};
    for (const [k, v] of Object.entries(own)) {
      const db = this.m.byCamel.get(k)!.db;
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && ('increment' in v || 'decrement' in v || 'set' in v)) {
        const o = v as { increment?: number; decrement?: number; set?: unknown };
        if (o.increment !== undefined) $inc[db] = o.increment;
        else if (o.decrement !== undefined) $inc[db] = -o.decrement;
        else $set[db] = o.set;
      } else $set[db] = v;
    }
    const change = { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($inc).length ? { $inc } : {}) };
    return { change, nested };
  }

  /** Nested writes on one-to-many relations of an existing row: deleteMany first, then create / createMany. */
  private async writeChildren(parent: Doc, nested: [RelationMeta, Doc][]) {
    for (const [rel, op] of nested) {
      if (rel.justOne) throw new Error(`${this.m.name}.${rel.name}: nested writes on a single relation are not supported`);
      const target = meta(rel.ref);
      const fk = target.byDb.get(rel.foreignField)!.camel;
      const key = fromDb(parent[rel.localField]);
      const unknown = Object.keys(op).filter((k) => !['create', 'createMany', 'deleteMany'].includes(k));
      if (unknown.length) throw new Error(`${this.m.name}.${rel.name}: nested ${unknown.join(', ')} is not supported`);
      const repo = new Repo<Doc>(target, this.ctx);
      if (op.deleteMany !== undefined) {
        const extra = op.deleteMany && typeof op.deleteMany === 'object' && Object.keys(op.deleteMany as Doc).length ? [op.deleteMany as Where] : [];
        await repo.deleteMany({ where: { AND: [{ [fk]: key }, ...extra] } });
      }
      const list = [...(op.create ? (Array.isArray(op.create) ? op.create : [op.create]) : []), ...(((op.createMany as { data?: Doc[] })?.data ?? []) as Doc[])];
      if (list.length) await repo.insert(list.map((c) => ({ ...(c as Doc), [fk]: key })));
    }
  }

  async update(args: Args): Promise<Loaded<T>> {
    this.guard('update');
    const { change, nested } = this.toUpdate((args.data ?? {}) as Doc, true);
    let doc: Doc | null;
    if (!Object.keys(change).length) {
      // nothing to change on the row itself: no write, so updatedAt is left alone (as an `update: {}` always did)
      doc = (await this.read(() => this.m.model.findOne(toFilter(this.m, args.where), undefined, { session: this.ctx.session }).lean().exec())) as Doc | null;
    } else {
      try {
        doc = (await this.m.model.findOneAndUpdate(toFilter(this.m, args.where), change, { new: true, session: this.ctx.session }).lean().exec()) as Doc | null;
      } catch (e) {
        throw mapError(e, this.m.collection);
      }
    }
    if (!doc) throw new DbError(`No ${this.m.name} found to update`, 'P2025', { modelName: this.m.name });
    if (nested.length) await this.writeChildren(doc, nested);
    if (args.select || args.include) return this.findUniqueOrThrow({ where: { [this.m.idCamel]: fromDb(doc._id) }, select: args.select, include: args.include });
    return toApi(this.m, doc, planOf(this.m, {})) as Loaded<T>;
  }
  async updateMany(args: { where?: Where; data: Doc }): Promise<{ count: number }> {
    this.guard('updateMany');
    try {
      const r = await this.m.model.updateMany(toFilter(this.m, await this.expandRelations(args.where)), this.toUpdate(args.data).change, { session: this.ctx.session }).exec();
      return { count: r.matchedCount };
    } catch (e) {
      throw mapError(e, this.m.collection);
    }
  }
  async upsert(args: Args): Promise<Loaded<T>> {
    this.guard('upsert');
    const filter = toFilter(this.m, args.where);
    const atomic = this.atomicUpsert(args);
    if (atomic) {
      // one round trip: findOneAndUpdate with upsert gives the same row as "update if found, else create"
      let doc: Doc | null;
      try {
        doc = (await this.m.model.findOneAndUpdate(filter, atomic, { new: true, upsert: true, session: this.ctx.session }).lean().exec()) as Doc | null;
      } catch (e) {
        throw mapError(e, this.m.collection);
      }
      if (args.select || args.include) return this.findUniqueOrThrow({ where: { [this.m.idCamel]: fromDb(doc!._id) }, select: args.select, include: args.include });
      return toApi(this.m, doc!, planOf(this.m, {})) as Loaded<T>;
    }
    const existing = (await this.read(() => this.m.model.findOne(filter, { _id: 1 }, { session: this.ctx.session }).lean().exec())) as Doc | null;
    if (existing) return this.update({ where: { [this.m.idCamel]: fromDb(existing._id) }, data: args.update, select: args.select, include: args.include });
    return this.create({ data: args.create, select: args.select, include: args.include });
  }

  /**
   * The single-operation form of an upsert, or null when it would not give exactly the same row: needs the
   * key in the create data (no id to reserve), no nested writes, and every field that both create and update
   * touch must come out of the update with the create value (e.g. create value 1, update increment 1).
   */
  private atomicUpsert(args: Args): Doc | null {
    const create = plain(args.create ?? {}) as Doc;
    const update = plain(args.update ?? {}) as Doc;
    if (this.m.seqId && create[this.m.idCamel] === undefined) return null;
    if (Object.keys({ ...create, ...update }).some((k) => this.m.relations.has(k))) return null;
    if (this.m.fields.some((f) => f.db === 'updated_at')) return null; // keep timestamps exactly as before
    const $set: Doc = {};
    const $inc: Doc = {};
    const $setOnInsert: Doc = {};
    for (const [k, v] of Object.entries(update)) {
      const f = this.m.byCamel.get(k);
      if (!f) return null;
      if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Doc)) {
        const inc = (v as { increment: number }).increment;
        if (k in create && create[k] !== inc) return null; // on insert $inc starts from 0
        $inc[f.db] = inc;
      } else if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) return null;
      else {
        if (k in create && create[k] !== v) return null;
        $set[f.db] = v;
      }
    }
    const where = (args.where ?? {}) as Doc;
    for (const [k, v] of Object.entries(create)) {
      const f = this.m.byCamel.get(k);
      if (!f) return null;
      if (k in where && where[k] === v) continue; // an equality key of the filter: the insert takes it from there
      if (!(k in update)) $setOnInsert[f.db] = v;
    }
    // schema defaults for fields neither side sets (insertMany would apply them)
    const schema = this.m.model.schema;
    for (const f of this.m.fields) {
      if (f.db in $set || f.db in $inc || f.db in $setOnInsert || f.db === '_id') continue;
      const d = (schema.path(f.db)?.options as { default?: unknown })?.default;
      if (d !== undefined) $setOnInsert[f.db] = typeof d === 'function' ? (d as () => unknown)() : d;
    }
    return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($inc).length ? { $inc } : {}), ...(Object.keys($setOnInsert).length ? { $setOnInsert } : {}) };
  }
  async delete(args: { where: Where }): Promise<Loaded<T>> {
    this.guard('delete');
    const doc = (await this.m.model.findOneAndDelete(toFilter(this.m, args.where), { session: this.ctx.session }).lean().exec()) as Doc | null;
    if (!doc) throw new DbError(`No ${this.m.name} found to delete`, 'P2025', { modelName: this.m.name });
    return toApi(this.m, doc, planOf(this.m, {})) as Loaded<T>;
  }
  async deleteMany(args: { where?: Where } = {}): Promise<{ count: number }> {
    this.guard('deleteMany');
    const r = await this.m.model.deleteMany(toFilter(this.m, await this.expandRelations(args.where)), { session: this.ctx.session }).exec();
    return { count: r.deletedCount };
  }

  // -------------------------------------------------------------- aggregates
  private accumulators(spec: Record<string, Doc | undefined>) {
    const group: Doc = {};
    const read: [string, string, string][] = []; // [section, camel field, accumulator key]
    for (const [section, op] of [['_sum', '$sum'], ['_max', '$max'], ['_min', '$min'], ['_avg', '$avg']] as const) {
      for (const [k, on] of Object.entries(spec[section] ?? {})) {
        if (!on) continue;
        const key = `${section}_${k}`;
        group[key] = { [op]: `$${this.m.byCamel.get(k)!.db}` };
        read.push([section, k, key]);
      }
    }
    if (spec._count) group.__count = { $sum: 1 };
    return { group, read };
  }
  private shape(row: Doc, read: [string, string, string][], count: unknown, hasDocs: boolean) {
    const out: Doc = {};
    for (const [section, k, key] of read) {
      out[section] ??= {};
      // like SQL: a sum over no rows is null
      (out[section] as Doc)[k] = hasDocs ? (fromDb(row[key]) ?? null) : null;
    }
    if (count) {
      const n = Number(row.__count ?? 0);
      out._count = count === true ? n : Object.fromEntries(Object.keys(count as Doc).map((k) => [k, n]));
    }
    return out;
  }

  async aggregate(args: { where?: Where; _sum?: Doc; _max?: Doc; _min?: Doc; _avg?: Doc; _count?: unknown }): Promise<any> {
    const { group, read } = this.accumulators(args as Record<string, Doc | undefined>);
    const match = toFilter(this.m, await this.expandRelations(args.where));
    const rows = (await this.read(() =>
      this.m.model.aggregate([{ $match: match }, { $group: { _id: null, ...group, __n: { $sum: 1 } } }]).session(this.ctx.session ?? null).exec(),
    )) as Doc[];
    const row = rows[0] ?? {};
    return this.shape(row, read, args._count, Number(row.__n ?? 0) > 0);
  }

  async groupBy(args: { by: string[]; where?: Where; _sum?: Doc; _max?: Doc; _min?: Doc; _avg?: Doc; _count?: unknown; orderBy?: unknown }): Promise<any[]> {
    const { group, read } = this.accumulators(args as unknown as Record<string, Doc | undefined>);
    const id= Object.fromEntries(args.by.map((k) => [k, `$${this.m.byCamel.get(k)!.db}`]));
    const match = toFilter(this.m, await this.expandRelations(args.where));
    const rows = (await this.read(() =>
      this.m.model.aggregate([{ $match: match }, { $group: { _id: id, ...group } }]).session(this.ctx.session ?? null).exec(),
    )) as Doc[];
    const out = rows.map((r) => ({ ...Object.fromEntries(args.by.map((k) => [k, fromDb((r._id as Doc)[k])])), ...this.shape(r, read, args._count, true) }));
    if (args.orderBy) {
      const orders = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) as Doc[];
      out.sort((a, b) => {
        for (const o of orders) {
          const [k, dir] = Object.entries(o)[0];
          const [av, bv] = typeof dir === 'object' ? [((a as Doc)[k] as Doc)?.[Object.keys(dir as Doc)[0]], ((b as Doc)[k] as Doc)?.[Object.keys(dir as Doc)[0]]] : [(a as Doc)[k], (b as Doc)[k]];
          const d = (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0;
          const sign = (typeof dir === 'object' ? Object.values(dir as Doc)[0] : dir) === 'desc' ? -1 : 1;
          if (d) return d * sign;
        }
        return 0;
      });
    }
    return out;
  }
}

function omit(o: Doc, k: string) {
  const { [k]: _drop, ...rest } = o;
  void _drop;
  return rest;
}

// ------------------------------------------------------------------ the database handle
/** Repositories for every model, bound to an optional transaction session. */
export class Db {
  readonly appUser: Repo<M.AppUser>;
  readonly session: Repo<M.Session>;
  readonly counter: Repo<M.Counter>;
  readonly category: Repo<M.Category>;
  readonly unit: Repo<M.Unit>;
  readonly supplier: Repo<M.Supplier>;
  readonly chargeType: Repo<M.ChargeType>;
  readonly product: Repo<M.Product>;
  readonly productStock: Repo<M.ProductStock>;
  readonly stockMovement: Repo<M.StockMovement>;
  readonly stockAdjustment: Repo<M.StockAdjustment>;
  readonly purchase: Repo<M.Purchase>;
  readonly purchaseItem: Repo<M.PurchaseItem>;
  readonly purchaseCharge: Repo<M.PurchaseCharge>;
  readonly purchaseReturn: Repo<M.PurchaseReturn>;
  readonly purchaseReturnItem: Repo<M.PurchaseReturnItem>;
  readonly kit: Repo<M.Kit>;
  readonly kitItem: Repo<M.KitItem>;
  readonly sale: Repo<M.Sale>;
  readonly saleItem: Repo<M.SaleItem>;
  readonly saleKitComponent: Repo<M.SaleKitComponent>;
  readonly salePayment: Repo<M.SalePayment>;
  readonly heldBill: Repo<M.HeldBill>;
  readonly salesReturn: Repo<M.SalesReturn>;
  readonly salesReturnItem: Repo<M.SalesReturnItem>;
  readonly auditLog: Repo<M.AuditLog>;
  readonly storeSetting: Repo<M.StoreSetting>;
  readonly systemAlert: Repo<M.SystemAlert>;
  readonly docCounter: Repo<M.DocCounter>;
  readonly sequence: Repo<M.Sequence>;

  constructor(readonly txSession?: ClientSession) {
    buildMeta();
    const repo = <T>(name: string) => new Repo<T>(meta(name), { session: txSession });
    this.appUser = repo<M.AppUser>('AppUser');
    this.session = repo<M.Session>('Session');
    this.counter = repo<M.Counter>('Counter');
    this.category = repo<M.Category>('Category');
    this.unit = repo<M.Unit>('Unit');
    this.supplier = repo<M.Supplier>('Supplier');
    this.chargeType = repo<M.ChargeType>('ChargeType');
    this.product = repo<M.Product>('Product');
    this.productStock = repo<M.ProductStock>('ProductStock');
    this.stockMovement = repo<M.StockMovement>('StockMovement');
    this.stockAdjustment = repo<M.StockAdjustment>('StockAdjustment');
    this.purchase = repo<M.Purchase>('Purchase');
    this.purchaseItem = repo<M.PurchaseItem>('PurchaseItem');
    this.purchaseCharge = repo<M.PurchaseCharge>('PurchaseCharge');
    this.purchaseReturn = repo<M.PurchaseReturn>('PurchaseReturn');
    this.purchaseReturnItem = repo<M.PurchaseReturnItem>('PurchaseReturnItem');
    this.kit = repo<M.Kit>('Kit');
    this.kitItem = repo<M.KitItem>('KitItem');
    this.sale = repo<M.Sale>('Sale');
    this.saleItem = repo<M.SaleItem>('SaleItem');
    this.saleKitComponent = repo<M.SaleKitComponent>('SaleKitComponent');
    this.salePayment = repo<M.SalePayment>('SalePayment');
    this.heldBill = repo<M.HeldBill>('HeldBill');
    this.salesReturn = repo<M.SalesReturn>('SalesReturn');
    this.salesReturnItem = repo<M.SalesReturnItem>('SalesReturnItem');
    this.auditLog = repo<M.AuditLog>('AuditLog');
    this.storeSetting = repo<M.StoreSetting>('StoreSetting');
    this.systemAlert = repo<M.SystemAlert>('SystemAlert');
    this.docCounter = repo<M.DocCounter>('DocCounter');
    this.sequence = repo<M.Sequence>('Sequence');
  }

  /** A native MongoDB collection (for bulk updates and aggregation pipelines). Pass `{ session: tx.txSession }` inside transactions. */
  collection(name: string) {
    return mongoose.connection.db!.collection(name);
  }
  /** Run a native aggregation pipeline (snake_case field names, real Date values); retried outside transactions. */
  aggregate<T = Doc>(collection: string, pipeline: Doc[]): Promise<T[]> {
    const run = () => this.collection(collection).aggregate<T & Doc>(pipeline, this.opts).toArray() as Promise<T[]>;
    return this.txSession ? run() : retryTransient(run);
  }
  /** Options for native calls: the transaction session when inside withTx. */
  get opts() {
    return this.txSession ? { session: this.txSession } : {};
  }
}
export type Tx = Db;

// ------------------------------------------------------------------ connection
const log = new Logger('Database');
let connecting: Promise<typeof mongoose> | null = null;

/** Connect once (idempotent). Connection errors on idle sockets are logged, not fatal: the driver reconnects. */
export function connectDb(url = process.env.DATABASE_URL): Promise<typeof mongoose> {
  if (!url) throw new Error('Set DATABASE_URL in backend/.env');
  if (!connecting) {
    mongoose.set('strictQuery', true);
    mongoose.set('autoIndex', false); // indexes are created by `npm run migrate` / at start-up (config/mongo-indexes.ts)
    mongoose.set('autoCreate', false);
    mongoose.connection.on('error', (e) => log.warn(`MongoDB connection error (the driver reconnects): ${String((e as Error).message).slice(0, 160)}`));
    // A small pool kept warm: every new connection needs a TLS handshake, and those are what the store
    // network sometimes refuses — so fewer, longer-lived connections mean fewer failures.
    connecting = retryTransient(
      () => mongoose.connect(url, { serverSelectionTimeoutMS: 30_000, retryWrites: true, retryReads: true, maxPoolSize: 10, minPoolSize: 3, maxIdleTimeMS: 0 }),
      6,
    ).catch((e) => {
      connecting = null;
      throw e;
    });
  }
  return connecting;
}
export async function disconnectDb() {
  if (connecting) await mongoose.disconnect();
  connecting = null;
}

// ------------------------------------------------------------------ transactions
const RETRYABLE = /WriteConflict|Write conflict|P2034|TransientTransactionError|NoSuchTransaction|LockTimeout|Transaction already in progress/i;

/**
 * Run `fn` in a MongoDB transaction. A write conflict (two counters touching the same stock or counter
 * document at the same moment) aborts one of them; it is retried with a short random back-off, so the caller
 * sees one clean result — the same outcome PostgreSQL row locks gave. Keys taken with holdKeys() inside stay
 * held until the transaction is over.
 */
export async function withTx<T>(_db: Db | DbService, fn: (tx: Db) => Promise<T>, _opts?: unknown): Promise<T> {
  await connectDb();
  return withLockScope(async () => {
    let attempt = 0;
    for (;;) {
      const session = await mongoose.connection.startSession();
      try {
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        const result = await fn(new Db(session));
        // An unknown commit result is retried as a commit only (repeating the whole body could apply it twice).
        for (let c = 1; ; c++) {
          try {
            await session.commitTransaction();
            break;
          } catch (e) {
            if (c < 5 && (e as { hasErrorLabel?: (l: string) => boolean }).hasErrorLabel?.('UnknownTransactionCommitResult')) continue;
            throw e;
          }
        }
        return result;
      } catch (e) {
        if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
        const msg = `${describe(e)} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}`;
        const labelled = (e as { hasErrorLabel?: (l: string) => boolean }).hasErrorLabel?.('TransientTransactionError');
        // Two counters opening a brand-new number series at once both insert its first document; the loser
        // gets a duplicate key on doc_counter / _seq — retrying finds the document and increments it.
        const seriesRace = /P2002|E11000/.test(msg) && /doc_counter|_seq/.test(msg);
        if (++attempt > 25 || !(labelled || RETRYABLE.test(msg) || TRANSIENT.test(msg) || seriesRace)) throw e;
        await new Promise((r) => setTimeout(r, Math.random() * Math.min(1500, 40 * 2 ** attempt)));
      } finally {
        await session.endSession();
      }
    }
  });
}

// ------------------------------------------------------------------ Nest wiring
/** The database handle Nest injects into controllers and services. */
@Injectable()
export class DbService extends Db implements OnModuleDestroy {
  constructor() {
    super();
    void connectDb().catch((e) => log.error(`Could not connect to MongoDB: ${(e as Error).message}`));
  }
  async onModuleDestroy() {
    await disconnectDb();
  }
}

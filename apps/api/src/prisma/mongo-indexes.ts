import { Prisma, PrismaClient } from '@prisma/client';

/*
 * Indexes Prisma cannot declare on MongoDB, plus id-sequence repair. Safe to run any number of times:
 * `npm run migrate` runs it after `prisma db push`, and the API runs it on every start.
 *
 *   product_name_uq               one ACTIVE product per normalised name (was a partial unique index in PostgreSQL)
 *   purchase_supplier_invoice_uq  one live GRN (draft or posted) per supplier invoice number
 *   product_barcode_key           barcode unique when set (a plain MongoDB unique index would treat
 *   purchase_purchase_no_key      'no barcode' / 'no GRN no yet' as one shared value)
 *   _seq                          next id per collection is never below the highest id already stored
 */
type Raw = Pick<PrismaClient, '$runCommandRaw'>;

/** Retry a command on network drops to Atlas (refused TLS handshakes never run the command). */
async function again<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !/I\/O error|fatal alert|Retryable|ECONNRESET|ETIMEDOUT|Server selection/i.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
}

const PARTIAL_UNIQUE = [
  { collection: 'product', index: { name: 'product_barcode_key', key: { barcode: 1 }, unique: true, partialFilterExpression: { barcode: { $type: 'string' } } } },
  { collection: 'purchase', index: { name: 'purchase_purchase_no_key', key: { purchase_no: 1 }, unique: true, partialFilterExpression: { purchase_no: { $type: 'string' } } } },
  {
    collection: 'product',
    index: { name: 'product_name_uq', key: { name_key: 1 }, unique: true, partialFilterExpression: { is_active: true, name_key: { $type: 'string' } } },
  },
  {
    collection: 'purchase',
    index: {
      name: 'purchase_supplier_invoice_uq',
      key: { supplier_id: 1, invoice_key: 1 },
      unique: true,
      partialFilterExpression: { status: { $in: ['DRAFT', 'POSTED'] }, invoice_key: { $type: 'string' } },
    },
  },
];

/** Collections whose numeric _id comes from the _seq sequence. */
export const SEQ_COLLECTIONS = [
  'app_user', 'counter', 'category', 'unit', 'product', 'stock_movement', 'supplier', 'charge_type', 'purchase',
  'purchase_item', 'purchase_charge', 'kit', 'kit_item', 'sale', 'sale_item', 'sale_kit_component', 'sale_payment',
  'held_bill', 'sales_return', 'sales_return_item', 'purchase_return', 'purchase_return_item', 'stock_adjustment',
  'audit_log', 'system_alert',
];

export async function ensureMongoIndexes(db: Raw, log: (s: string) => void = () => undefined) {
  for (const { collection, index } of PARTIAL_UNIQUE) {
    try {
      await again(() => db.$runCommandRaw({ createIndexes: collection, indexes: [index] }));
    } catch (e) {
      // An index with the same name but different options (e.g. the old non-partial one): replace it.
      if (!/already exists|IndexOptionsConflict|IndexKeySpecsConflict|same name|different options/i.test((e as Error).message)) throw e;
      await again(() => db.$runCommandRaw({ dropIndexes: collection, index: index.name }));
      await again(() => db.$runCommandRaw({ createIndexes: collection, indexes: [index] }));
    }
    log(`index ${collection}.${index.name}`);
  }
  // Keep every id sequence ahead of the data (after a migration, a seed or a restore).
  for (const c of SEQ_COLLECTIONS) {
    const r = (await again(() => db.$runCommandRaw({ aggregate: c, pipeline: [{ $group: { _id: null, max: { $max: '$_id' } } }], cursor: {} }))) as {
      cursor: { firstBatch: { max: number | { $numberLong: string } | null }[] };
    };
    const raw = r.cursor.firstBatch[0]?.max ?? 0;
    const max = typeof raw === 'object' && raw !== null ? Number(raw.$numberLong) : Number(raw);
    await again(() => db.$runCommandRaw({ update: '_seq', updates: [{ q: { _id: c }, u: { $max: { value: max } }, upsert: true }] }));
  }
  log('id sequences in step with data');

  // Optional fields missing from a document (created before writes filled them with null) are set to
  // null, so `field: null` filters match them the way they match a NULL column in PostgreSQL.
  let filled = 0;
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind === 'object' || f.isRequired || f.isList || f.isId) continue;
      const field = f.dbName ?? f.name;
      const r = (await again(() => db.$runCommandRaw({ update: m.dbName ?? m.name, updates: [{ q: { [field]: { $exists: false } }, u: { $set: { [field]: null } }, multi: true }] }))) as { nModified?: number };
      filled += Number(r.nModified ?? 0);
    }
  }
  log(`optional fields present on every document (${filled} filled)`);
}

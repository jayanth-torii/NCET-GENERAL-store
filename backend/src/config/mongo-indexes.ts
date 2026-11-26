import mongoose, { Model } from 'mongoose';
import { connectDb, retryTransient, seqCollections } from './db';

/*
 * Database set-up, safe to run any number of times: `npm run migrate` runs it, and the API runs it on every
 * start.
 *
 *   indexes        every index declared in models/<feature>/model.ts (names unchanged from the earlier
 *                  editions), including the partial unique ones:
 *                    product_name_uq               one ACTIVE product per normalised name
 *                    purchase_supplier_invoice_uq  one live GRN (draft or posted) per supplier invoice number
 *                    product_barcode_key           barcode unique when set
 *                    purchase_purchase_no_key      GRN number unique when set
 *   _seq           next id per collection is never below the highest id already stored
 *   null backfill  optional fields missing from old documents are set to null, so `field: null` filters
 *                  match them the way they match a NULL column
 */

const CONFLICT = /already exists|IndexOptionsConflict|IndexKeySpecsConflict|same name|different options/i;

export async function ensureMongoIndexes(log: (s: string) => void = () => undefined) {
  await connectDb();
  const db = mongoose.connection.db!;
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name) as Model<unknown>;
    const collection = model.collection.collectionName;
    for (const [key, options] of model.schema.indexes()) {
      const opts = options as { name: string };
      try {
        await retryTransient(() => db.collection(collection).createIndex(key as Record<string, 1 | -1>, opts), 5);
      } catch (e) {
        // An index with the same name but different options (e.g. an old non-partial one): replace it.
        if (!CONFLICT.test((e as Error).message)) throw e;
        await retryTransient(() => db.collection(collection).dropIndex(opts.name), 5);
        await retryTransient(() => db.collection(collection).createIndex(key as Record<string, 1 | -1>, opts), 5);
        log(`index ${collection}.${opts.name} replaced`);
      }
    }
  }
  log('indexes in place');

  // Keep every id sequence ahead of the data (after a migration, a seed or a restore).
  for (const c of seqCollections()) {
    const [row] = await retryTransient(() => db.collection(c).aggregate<{ max: unknown }>([{ $group: { _id: null, max: { $max: '$_id' } } }]).toArray(), 5);
    const max = Number(row?.max ?? 0);
    await retryTransient(() => db.collection<{ _id: string; value: number }>('_seq').updateOne({ _id: c }, { $max: { value: max } }, { upsert: true }), 5);
  }
  log('id sequences in step with data');

  let filled = 0;
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name) as Model<unknown>;
    const optional: string[] = [];
    model.schema.eachPath((path, type) => {
      if (path !== '_id' && (type.options as { default?: unknown }).default === null) optional.push(path);
    });
    for (const field of optional) {
      const r = await retryTransient(() => db.collection(model.collection.collectionName).updateMany({ [field]: { $exists: false } }, { $set: { [field]: null } }), 5);
      filled += r.modifiedCount;
    }
  }
  log(`optional fields present on every document (${filled} filled)`);
}

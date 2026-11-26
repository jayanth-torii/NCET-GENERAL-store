/*
 * One-time copy of the PostgreSQL edition's data into MongoDB (Atlas).
 *
 *   npm run migrate:from-postgres            (reads POSTGRES_URL, writes DATABASE_URL)
 *   npm run migrate:from-postgres -- --wipe  (empties the MongoDB collections first)
 *
 * Every table becomes the collection of the same name, every column the field of the same name
 * (see src/models/ vs postgres-legacy/schema.prisma). Ids keep their values, so bill,
 * GRN and product links stay intact. Money and quantities become numbers; timestamps stay UTC.
 * Afterwards the id sequences are moved past the highest id, and the row counts are compared.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { Double, Int32, Long } from 'bson';
import mongoose, { Model } from 'mongoose';
import { Client } from 'pg';
import { connectDb, disconnectDb, invoiceKey, nameKey } from '../src/config/db';
import { ensureMongoIndexes } from '../src/config/mongo-indexes';

const wipe = process.argv.includes('--wipe');
const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) throw new Error('Set POSTGRES_URL in backend/.env to the old PostgreSQL database');

/** Every Mongoose model except the id sequences (rebuilt from the data afterwards). */
const models = () =>
  mongoose
    .modelNames()
    .filter((n) => n !== 'Sequence')
    .map((n) => mongoose.model(n) as Model<unknown>);

/** PostgreSQL column that held a model's id (MongoDB stores it as _id). */
const legacyIdColumn = (model: string) => (model === 'ProductStock' ? 'product_id' : model === 'DocCounter' ? 'key' : 'id');

/** Retry a MongoDB command on network drops (Atlas over the internet). */
async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !/I\/O error|Retryable|timed out|connection|network|TLS|fatal alert/i.test(String((e as Error).message))) throw e;
      console.log(`    network hiccup, retrying (${i}/${tries - 1})…`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

/** One PostgreSQL value as the BSON type its Mongoose path declares. */
function toBson(instance: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (instance) {
    case 'Double':
      return new Double(Number(v));
    case 'Int32':
      return new Int32(Number(v));
    case 'BigInt':
      return Long.fromString(String(v));
    case 'Date':
      return v instanceof Date ? v : new Date(String(v));
    case 'Boolean':
      return Boolean(v);
    default:
      return v; // String, enums (text), Mixed / Json (already parsed by pg)
  }
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  const report: { collection: string; postgres: number; mongo: number }[] = [];
  try {
    for (const m of models()) {
      const collection = m.collection.collectionName;
      const mongo = db.collection(collection);
      const exists = await pg.query('SELECT to_regclass($1) AS t', [collection]);
      if (!exists.rows[0].t) {
        console.log(`  - ${collection}: no such table in PostgreSQL, skipped`);
        continue;
      }
      const { rows } = await pg.query(`SELECT * FROM "${collection}"`);
      const docs = rows.map((row: Record<string, unknown>) => {
        const doc: Record<string, unknown> = {};
        m.schema.eachPath((field, type) => {
          if (field === '_id') doc._id = toBson(type.instance, row[legacyIdColumn(m.modelName)]);
          else if (field in row) doc[field] = toBson(type.instance, row[field]);
        });
        // Fields that exist only in the MongoDB edition.
        if (m.modelName === 'Product') doc.name_key = nameKey(String(row.name));
        if (m.modelName === 'Purchase') doc.invoice_key = invoiceKey(String(row.supplier_invoice_no));
        if (m.modelName === 'Sale') doc.row_version = 0;
        return doc;
      });
      if (wipe) await retry(() => mongo.deleteMany({}));
      for (let i = 0; i < docs.length; i += 200) {
        const batch = docs.slice(i, i + 200);
        // Idempotent batch: a dropped connection may have stored part of it, so clear the batch's ids first.
        await retry(async () => {
          await mongo.deleteMany({ _id: { $in: batch.map((d) => d._id) as never[] } });
          // ordered insertMany fails on the first rejected document, so nothing is skipped silently
          const res = await mongo.insertMany(batch as never[], { ordered: true });
          if (res.insertedCount !== batch.length) throw new Error(`${collection}: ${res.insertedCount} of ${batch.length} stored`);
        });
      }
      const count = await retry(() => mongo.countDocuments());
      report.push({ collection, postgres: rows.length, mongo: count });
      console.log(`  ✓ ${collection.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
    }
  } finally {
    await pg.end();
  }
  await ensureMongoIndexes((s) => console.log(`  ✓ ${s}`));
  const bad = report.filter((r) => r.postgres !== r.mongo);
  console.table(report);
  if (bad.length) throw new Error(`Row counts differ for: ${bad.map((b) => b.collection).join(', ')}`);
  console.log(`Copied ${report.reduce((a, r) => a + r.postgres, 0)} rows into ${report.length} MongoDB collections. Counts match.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());

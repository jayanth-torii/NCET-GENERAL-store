/*
 * One-time copy of the PostgreSQL edition's data into MongoDB (Atlas).
 *
 *   npm run migrate:from-postgres            (reads POSTGRES_URL, writes DATABASE_URL)
 *   npm run migrate:from-postgres -- --wipe  (empties the MongoDB collections first)
 *
 * Every table becomes the collection of the same name, every column the field of the same name
 * (see prisma/schema.prisma vs prisma/postgres-legacy/schema.prisma). Ids keep their values, so bill,
 * GRN and product links stay intact. Money and quantities become numbers; timestamps stay UTC.
 * Afterwards the id sequences are moved past the highest id, and the row counts are compared.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { Prisma, PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { ensureMongoIndexes } from '../src/prisma/mongo-indexes';
import { invoiceKey, nameKey } from '../src/prisma/prisma.service';

const wipe = process.argv.includes('--wipe');
const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) throw new Error('Set POSTGRES_URL in apps/api/.env to the old PostgreSQL database');

const mongo = new PrismaClient();
const models = Prisma.dmmf.datamodel.models.filter((m) => m.name !== 'Sequence');

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

/** Extended JSON for one value of a MongoDB field. */
function toEjson(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'Float':
    case 'Int':
      return Number(v);
    case 'BigInt':
      return { $numberLong: String(v) };
    case 'DateTime':
      return { $date: (v instanceof Date ? v : new Date(String(v))).toISOString() };
    case 'Boolean':
      return Boolean(v);
    default:
      return v; // String, enums (text), Json (already parsed by pg)
  }
}

async function main() {
  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  const report: { collection: string; postgres: number; mongo: number }[] = [];
  try {
    for (const m of models) {
      const collection = m.dbName ?? m.name;
      const exists = await pg.query('SELECT to_regclass($1) AS t', [collection]);
      if (!exists.rows[0].t) {
        console.log(`  - ${collection}: no such table in PostgreSQL, skipped`);
        continue;
      }
      const { rows } = await pg.query(`SELECT * FROM "${collection}"`);
      const docs = rows.map((row: Record<string, unknown>) => {
        const doc: Record<string, unknown> = {};
        for (const f of m.fields) {
          if (f.kind === 'object') continue;
          const field = f.dbName ?? f.name;
          if (f.isId) {
            doc._id = toEjson(f.type, row[legacyIdColumn(m.name)]);
            continue;
          }
          if (field in row) doc[field] = toEjson(f.type, row[field]);
        }
        // Fields that exist only in the MongoDB edition.
        if (m.name === 'Product') doc.name_key = nameKey(String(row.name));
        if (m.name === 'Purchase') doc.invoice_key = invoiceKey(String(row.supplier_invoice_no));
        if (m.name === 'Sale') doc.row_version = 0;
        return doc;
      });
      if (wipe) await retry(() => mongo.$runCommandRaw({ delete: collection, deletes: [{ q: {}, limit: 0 }] }));
      for (let i = 0; i < docs.length; i += 200) {
        const batch = docs.slice(i, i + 200);
        // Idempotent batch: a dropped connection may have stored part of it, so clear the batch's ids first.
        await retry(async () => {
          await mongo.$runCommandRaw({ delete: collection, deletes: [{ q: { _id: { $in: batch.map((d) => d._id) } }, limit: 0 }] } as Prisma.InputJsonObject);
          const res = (await mongo.$runCommandRaw({ insert: collection, documents: batch as Prisma.InputJsonValue[], ordered: true })) as { n: number; writeErrors?: { errmsg: string }[] };
          // MongoDB reports rejected documents in the reply instead of failing the command: stop on any.
          if (res.writeErrors?.length || res.n !== batch.length) throw new Error(`${collection}: ${res.writeErrors?.[0]?.errmsg ?? `${res.n} of ${batch.length} stored`}`);
        });
      }
      const count = (await retry(() => mongo.$runCommandRaw({ count: collection }))) as { n: number };
      report.push({ collection, postgres: rows.length, mongo: count.n });
      console.log(`  ✓ ${collection.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
    }
  } finally {
    await pg.end();
  }
  await ensureMongoIndexes(mongo, (s) => console.log(`  ✓ ${s}`));
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
  .finally(() => mongo.$disconnect());

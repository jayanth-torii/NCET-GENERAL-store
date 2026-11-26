/*
 * Blueprint check: "the stock summary for 2,000 items loads in under 2 s".
 *
 *   npm run perf:stock            (2,000 products, 12 movements each, 5 timed runs)
 *
 * Builds a scratch database `<db>_perf` next to the live one (same server, so the network cost is real),
 * fills it with products, balances and a year of stock movements, times the real StockService.summary,
 * then drops the scratch database. The live database is never written. Refuses to run if the scratch
 * name would equal the live one.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import mongoose from 'mongoose';
import { connectDb, DbService, disconnectDb, retryTransient } from '../src/config/db';
import { StockService } from '../src/services/stock/service';

const PRODUCTS = Number(process.env.PERF_PRODUCTS ?? 2000);
const MOVES_PER_PRODUCT = 12;
const RUNS = 5;
const LIMIT_MS = 2000;

(async () => {
  await connectDb();
  const live = mongoose.connection.db!.databaseName;
  const scratchName = `${live}_perf`;
  if (scratchName === live) throw new Error('refusing: scratch database name equals the live one');
  // Point the models at the scratch database for this process only.
  const scratch = mongoose.connection.useDb(scratchName, { useCache: true });
  for (const name of mongoose.modelNames()) scratch.model(name, mongoose.model(name).schema);
  const raw = scratch.db!;
  await retryTransient(() => raw.dropDatabase());

  console.log(`Filling ${scratchName}: ${PRODUCTS} products, ${PRODUCTS * MOVES_PER_PRODUCT} movements …`);
  await raw.collection('category').insertMany([...Array(20)].map((_, i) => ({ _id: (i + 1) as never, name: `Category ${i + 1}` })));
  await raw.collection('unit').insertOne({ _id: 1 as never, code: 'PCS', name: 'Pieces', allows_decimal: false });
  const products = [...Array(PRODUCTS)].map((_, i) => ({
    _id: (i + 1) as never, code: `P${String(i + 1).padStart(5, '0')}`, name: `Perf item ${i + 1}`, name_key: `perf item ${i + 1}`,
    category_id: (i % 20) + 1, unit_id: 1, pack_unit_id: null, pack_size: 1, gst_rate: 0, hsn: null, barcode: null,
    mrp: 50, sale_price: 40, last_cost: 30, reorder_level: 10, is_active: true, created_at: new Date(), updated_at: new Date(),
  }));
  for (let i = 0; i < products.length; i += 500) await retryTransient(() => raw.collection('product').insertMany(products.slice(i, i + 500)));
  const kinds = ['OPENING', 'PURCHASE', 'SALE', 'SALE', 'SALE', 'SALE_RETURN', 'PURCHASE', 'SALE', 'ADJUSTMENT', 'SALE', 'PURCHASE_RETURN', 'SALE'];
  const yearAgo = Date.now() - 365 * 86400000;
  let id = 1;
  const moves: Record<string, unknown>[] = [];
  const balance = new Map<number, number>();
  for (let p = 1; p <= PRODUCTS; p++) {
    for (let k = 0; k < MOVES_PER_PRODUCT; k++) {
      const kind = kinds[k];
      const qty = kind === 'SALE' || kind === 'PURCHASE_RETURN' ? -2 : kind === 'ADJUSTMENT' ? -1 : 10;
      balance.set(p, (balance.get(p) ?? 0) + qty);
      moves.push({ _id: id++, product_id: p, kind, qty, unit_cost: 30, ref_type: kind, ref_id: id, note: null, created_by: 1, created_at: new Date(yearAgo + (k / MOVES_PER_PRODUCT) * 365 * 86400000) });
    }
  }
  for (let i = 0; i < moves.length; i += 1000) await retryTransient(() => raw.collection('stock_movement').insertMany(moves.slice(i, i + 1000) as never[]));
  await retryTransient(() => raw.collection('product_stock').insertMany([...balance].map(([p, on]) => ({ _id: p as never, on_hand: on }))));
  await retryTransient(() => raw.collection('stock_movement').createIndex({ product_id: 1, created_at: 1 }, { name: 'stock_movement_product_id_created_at_idx' }));

  // The real service, reading through models bound to the scratch database.
  const db = new DbService();
  for (const key of Object.keys(db) as (keyof DbService)[]) {
    const repo = db[key] as unknown as { m?: { model: unknown; name: string } };
    if (repo?.m?.model) repo.m.model = scratch.model(repo.m.name);
  }
  (db as unknown as { aggregate: unknown }).aggregate = (coll: string, pipeline: object[]) => retryTransient(() => raw.collection(coll).aggregate(pipeline).toArray());
  const stock = new StockService(db, undefined as never, undefined as never);
  const from = new Date(yearAgo + 180 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const times: number[] = [];
  let rows = 0;
  for (let r = 0; r < RUNS; r++) {
    const t = process.hrtime.bigint();
    rows = (await stock.summary({ from, to })).length;
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`Stock summary of ${rows} items: ${times.map((x) => `${Math.round(x)} ms`).join(', ')} (median ${Math.round(median)} ms)`);
  console.log(median < LIMIT_MS ? `PASSED: under ${LIMIT_MS} ms` : `FAILED: median above ${LIMIT_MS} ms`);
  if (median >= LIMIT_MS || rows !== PRODUCTS) process.exitCode = 1;
  await retryTransient(() => raw.dropDatabase());
  console.log(`${scratchName} dropped`);
})()
  .catch((e) => {
    console.error(String((e as Error).message ?? e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());

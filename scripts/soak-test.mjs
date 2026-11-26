// Soak test (blueprint): steady counter traffic for a long time, watching for errors, slow-downs and
// stock drift.   node scripts/soak-test.mjs [minutes=30] [counters=2]      (needs ADMIN_PASSWORD)
// Each counter bills every ~3 s (1–3 items, cash) and a manager screen reads the dashboard, the sales list
// and the stock summary every ~10 s. A line per minute shows bills, errors and save times; at the end it
// checks that stock fell by exactly what was sold and that save times did not creep up.
// It creates test records (products, counters, cashiers, bills): run it on a development database.
import { check, Client, results, uuid } from './lib.mjs';

const MINUTES = Number(process.argv[2] ?? 30);
const COUNTERS = Number(process.argv[3] ?? 2);
const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) throw new Error('Set ADMIN_PASSWORD');
const T = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);

async function main() {
  const admin = new Client('admin');
  await admin.login('admin', ADMIN_PW);
  const cats = (await admin.get('/categories')).data;
  const PCS = (await admin.get('/units')).data.find((u) => u.code === 'PCS').id;
  const items = [];
  for (let i = 0; i < 5; i++) {
    const r = await admin.post('/products', { name: `SOAK ITEM ${i} ${T}`, categoryId: cats[0].id, unitId: PCS, salePrice: 10 + i, openingQty: 1000000, openingCost: 5 });
    if (r.status !== 201) throw new Error(JSON.stringify(r.data));
    items.push({ id: r.data.id, price: 10 + i });
  }
  const start = Object.fromEntries(await Promise.all(items.map(async (it) => [it.id, (await admin.get(`/products/${it.id}`)).data.onHand])));

  const lanes = [];
  for (let i = 0; i < COUNTERS; i++) {
    const c = await admin.post('/counters', { code: `S${i}${T.slice(-3)}`.toUpperCase().slice(0, 6), name: `Soak ${i}` });
    if (c.status !== 201) throw new Error(JSON.stringify(c.data));
    const username = `soak${i}${T}`;
    await admin.post('/users', { username, fullName: `Soak cashier ${i}`, role: 'CASHIER', password: 'Temp1234' });
    const cl = new Client(username);
    await cl.login(username, 'Temp1234', c.data.id);
    await cl.post('/auth/change-password', { currentPassword: 'Temp1234', newPassword: 'Soak12345' });
    await cl.login(username, 'Soak12345', c.data.id);
    lanes.push(cl);
  }

  const sold = Object.fromEntries(items.map((it) => [it.id, 0]));
  const minutes = []; // { saves: number[], errors, reads: number[] }
const failures = []; // first failures, with status and message, printed at the end
  const end = Date.now() + MINUTES * 60_000;
  const bucket = () => {
    const m = Math.floor((Date.now() - (end - MINUTES * 60_000)) / 60_000);
    return (minutes[m] ??= { saves: [], errors: 0, reads: [] });
  };
  let printed = 0;
  const printer = setInterval(() => {
    while (printed < minutes.length - 1) {
      const b = minutes[printed];
      console.log(`  minute ${String(printed + 1).padStart(2)}: ${String(b.saves.length).padStart(3)} bills, ${b.errors} errors, save p50 ${Math.round(pct(b.saves, 0.5))} ms / p95 ${Math.round(pct(b.saves, 0.95))} ms, reads p95 ${Math.round(pct(b.reads, 0.95))} ms`);
      printed++;
    }
  }, 5000);

  const counterLoop = async (cl) => {
    while (Date.now() < end) {
      const picked = items.filter(() => Math.random() < 0.5).slice(0, 3);
      const lines = (picked.length ? picked : [items[0]]).map((it) => ({ it, qty: 1 + Math.floor(Math.random() * 3) }));
      const total = lines.reduce((a, l) => a + l.qty * l.it.price, 0);
      const t = performance.now();
      const r = await cl.post('/sales', { items: lines.map((l) => ({ productId: l.it.id, qty: l.qty })), payments: [{ mode: 'CASH', amount: total }] }, { 'Idempotency-Key': uuid() }).catch((e) => ({ status: 0, data: String(e) }));
      const b = bucket();
      if (r.status === 201) {
        b.saves.push(performance.now() - t);
        for (const l of lines) sold[l.it.id] += l.qty;
      } else {
        b.errors++;
        if (failures.length < 10) failures.push(`${new Date().toISOString()} POST /sales -> ${r.status} ${JSON.stringify(r.data?.message ?? r.data).slice(0, 160)}`);
      }
      await sleep(2000 + Math.random() * 2000);
    }
  };
  const managerLoop = async () => {
    while (Date.now() < end) {
      for (const p of ['/dashboard', '/sales', '/stock/summary']) {
        const t = performance.now();
        const r = await admin.get(p).catch(() => ({ status: 0 }));
        const b = bucket();
        if (r.status === 200) b.reads.push(performance.now() - t);
        else {
          b.errors++;
          if (failures.length < 10) failures.push(`${new Date().toISOString()} GET ${p} -> ${r.status} ${JSON.stringify(r.data?.message ?? '').slice(0, 160)}`);
        }
      }
      await sleep(10_000);
    }
  };
  console.log(`Soak: ${COUNTERS} counters + 1 manager screen for ${MINUTES} min`);
  await Promise.all([...lanes.map(counterLoop), managerLoop()]);
  clearInterval(printer);
  for (; printed < minutes.length; printed++) {
    const b = minutes[printed];
    console.log(`  minute ${String(printed + 1).padStart(2)}: ${String(b.saves.length).padStart(3)} bills, ${b.errors} errors, save p50 ${Math.round(pct(b.saves, 0.5))} ms / p95 ${Math.round(pct(b.saves, 0.95))} ms, reads p95 ${Math.round(pct(b.reads, 0.95))} ms`);
  }

  const allSaves = minutes.flatMap((b) => b.saves);
  const errors = minutes.reduce((a, b) => a + b.errors, 0);
  check(allSaves.length > 0, `bills saved: ${allSaves.length}`);
  check(errors === 0, `no failed requests (${errors})`);
  for (const f of failures) console.log(`       ${f}`);
  for (const it of items) {
    const now = (await admin.get(`/products/${it.id}`)).data.onHand;
    check(Math.abs(start[it.id] - now - sold[it.id]) < 1e-6, `item ${it.id}: stock fell by exactly the quantity sold (${sold[it.id]})`);
  }
  // No creeping slow-down: the last third's median save time stays within 1.5x of the first third's.
  const third = Math.max(1, Math.floor(minutes.length / 3));
  const first = minutes.slice(0, third).flatMap((b) => b.saves);
  const last = minutes.slice(-third).flatMap((b) => b.saves);
  const ratio = pct(last, 0.5) / Math.max(1, pct(first, 0.5));
  check(ratio < 1.5, `save time steady: last-third median ${Math.round(pct(last, 0.5))} ms vs first ${Math.round(pct(first, 0.5))} ms (x${ratio.toFixed(2)})`);
  results();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

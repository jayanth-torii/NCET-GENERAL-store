// Rush-hour load test (UR-5, NFR-01). Development database only.
// Several counters bill the same hot items at the same time, with double F10 presses mixed in.
// Passes when: no duplicate bill numbers, every double press returns the same bill, stock moves by exactly
// the quantity sold, the ledger matches the cached balance, and p95 save time is under 300 ms.
//   node scripts/rush-test.mjs [counters=4] [billsPerCounter=60]
import { check, Client, results, uuid } from './lib.mjs';

const COUNTERS = Number(process.argv[2] ?? 4);
const BILLS = Number(process.argv[3] ?? 60);
const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) {
  console.error('Set ADMIN_PASSWORD to the admin password of the development database first.');
  process.exit(1);
}
const T = Date.now().toString(36);

async function main() {
  const admin = new Client('admin');
  await admin.login('admin', ADMIN_PW);
  const cats = (await admin.get('/categories')).data;
  const units = (await admin.get('/units')).data;
  const PCS = units.find((u) => u.code === 'PCS').id;

  // Hot items with plenty of opening stock.
  const hot = [];
  for (let i = 0; i < 3; i++) {
    const r = await admin.post('/products', { name: `RUSH ITEM ${i} ${T}`, categoryId: cats[0].id, unitId: PCS, salePrice: 10 + i, openingQty: 100000, openingCost: 5 });
    if (r.status !== 201) throw new Error(JSON.stringify(r.data));
    hot.push(r.data.id);
  }
  const startStock = await Promise.all(hot.map(async (id) => (await admin.get(`/products/${id}`)).data.onHand));

  // One counter and one cashier per lane.
  const lanes = [];
  for (let i = 0; i < COUNTERS; i++) {
    const code = `R${i}${T.slice(-3)}`.toUpperCase().slice(0, 6);
    const c = await admin.post('/counters', { code, name: `Rush ${i}` });
    if (c.status !== 201) throw new Error(JSON.stringify(c.data));
    const username = `rush${i}${T}`;
    await admin.post('/users', { username, fullName: `Rush cashier ${i}`, role: 'CASHIER', password: 'Temp1234' });
    const cl = new Client(username);
    await cl.login(username, 'Temp1234', c.data.id);
    await cl.post('/auth/change-password', { currentPassword: 'Temp1234', newPassword: 'Rush12345' });
    await cl.login(username, 'Rush12345', c.data.id);
    lanes.push(cl);
  }

  const timings = [];
  const billNos = [];
  const sold = hot.map(() => 0);
  let replays = 0;
  let replayMismatch = 0;
  let errors = 0;

  const t0 = Date.now();
  await Promise.all(
    lanes.map(async (cl) => {
      for (let b = 0; b < BILLS; b++) {
        const qtys = hot.map(() => 1 + Math.floor(Math.random() * 3));
        const total = qtys.reduce((a, q, i) => a + q * (10 + i), 0);
        const body = { items: hot.map((id, i) => ({ productId: id, qty: qtys[i] })), payments: [{ mode: 'CASH', amount: total + 20 }] };
        const key = uuid();
        const doublePress = Math.random() < 0.15;
        const start = performance.now();
        const reqs = [cl.post('/sales', body, { 'Idempotency-Key': key })];
        if (doublePress) reqs.push(cl.post('/sales', body, { 'Idempotency-Key': key }));
        const res = await Promise.all(reqs);
        timings.push(performance.now() - start);
        if (res.some((r) => r.status !== 201)) {
          errors++;
          console.log('error', res.map((r) => r.data));
          continue;
        }
        billNos.push(res[0].data.billNo);
        if (doublePress) {
          replays++;
          if (res[1].data.billNo !== res[0].data.billNo) replayMismatch++;
        }
        qtys.forEach((q, i) => (sold[i] += q));
      }
    }),
  );
  const elapsed = (Date.now() - t0) / 1000;

  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  const p50 = timings[Math.floor(timings.length * 0.5)];
  console.log(`\n${COUNTERS} counters x ${BILLS} bills in ${elapsed.toFixed(1)} s (${(billNos.length / elapsed).toFixed(1)} bills/s). p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms. Double presses: ${replays}.\n`);

  check(errors === 0, 'no failed saves', errors);
  check(billNos.length === COUNTERS * BILLS, 'every bill saved once', billNos.length);
  check(new Set(billNos).size === billNos.length, 'no duplicate bill numbers');
  check(replayMismatch === 0, 'double F10 returned the same bill every time');
  for (let i = 0; i < hot.length; i++) {
    const now = (await admin.get(`/products/${hot[i]}`)).data.onHand;
    check(startStock[i] - now === sold[i], `hot item ${i}: stock fell by exactly the quantity sold (${sold[i]})`, { start: startStock[i], now });
  }
  const chk = await admin.post('/admin/stock-check');
  check(chk.data.ok === true, 'ledger equals cached balance after the rush');
  check(p95 < 300, `p95 save time ${p95.toFixed(0)} ms < 300 ms`);
  // Sequence per counter has no gaps.
  const byCounter = new Map();
  for (const no of billNos) {
    const [c, , seq] = no.split('/');
    byCounter.set(c, [...(byCounter.get(c) ?? []), Number(seq)]);
  }
  for (const [c, seqs] of byCounter) {
    seqs.sort((x, y) => x - y);
    check(seqs.every((s, i) => s === seqs[0] + i), `counter ${c}: bill numbers are continuous`);
  }
  // Tidy up: switch off this run's test products so they do not appear on the landing page.
  for (const id of hot) await admin.post(`/products/${id}/deactivate`);
  process.exit(results() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

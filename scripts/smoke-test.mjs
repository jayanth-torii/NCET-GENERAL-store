// End-to-end test of the Store POS API. Run against a DEVELOPMENT database only: it creates test users,
// products, purchases and bills.
//   node scripts/smoke-test.mjs
// Env: BASE_URL (default http://localhost:3000), ADMIN_PASSWORD (current admin password),
//      NEW_ADMIN_PASSWORD (used if the admin still has to change the initial password).
import { check, Client, results, uuid } from './lib.mjs';

const ADMIN_PW = process.env.ADMIN_PASSWORD ?? 'ChangeMe@123';
// No real password lives in the repository: the new admin password comes from the environment.
const NEW_ADMIN_PW = process.env.NEW_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'Test@Admin123';
const T = Date.now().toString(36);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function loginAdmin() {
  const admin = new Client('admin');
  let r = await admin.post('/auth/login', { username: 'admin', password: ADMIN_PW });
  if (r.status === 401) r = await admin.post('/auth/login', { username: 'admin', password: NEW_ADMIN_PW });
  if (r.status !== 200) throw new Error(`admin login failed ${JSON.stringify(r.data)}`);
  if (r.data.mustChangePassword) {
    const blocked = await admin.get('/dashboard');
    check(blocked.status === 403 && blocked.data.code === 'PASSWORD_CHANGE_REQUIRED', 'first login is forced to change password');
    const c = await admin.post('/auth/change-password', { currentPassword: ADMIN_PW, newPassword: NEW_ADMIN_PW });
    check(c.status === 200, 'admin changes initial password');
    await admin.login('admin', NEW_ADMIN_PW);
  }
  return admin;
}

async function makeUser(admin, role, counterId) {
  const username = `${role.toLowerCase().replace('_', '')}${T}`;
  const r = await admin.post('/users', { username, fullName: `Test ${role}`, role, password: 'Temp1234' });
  if (r.status !== 201) throw new Error(`create ${role}: ${JSON.stringify(r.data)}`);
  const c = new Client(role);
  await c.login(username, 'Temp1234', counterId);
  await c.post('/auth/change-password', { currentPassword: 'Temp1234', newPassword: 'Store1234' });
  await c.login(username, 'Store1234', counterId);
  return { client: c, id: r.data.id, username };
}

async function main() {
  console.log('Auth and roles');
  const anon = new Client('anon');
  check((await anon.get('/dashboard')).status === 401, 'no session -> 401');
  const time = await anon.get('/auth/time');
  check(time.status === 200 && /^\d{2}-\d{2}-\d{4}/.test(time.data.display), 'server time in DD-MM-YYYY', time.data);
  const bad = await anon.post('/auth/login', { username: 'admin', password: 'wrong-password' });
  check(bad.status === 401, 'wrong password rejected');

  const admin = await loginAdmin();
  const counters = (await admin.get('/counters')).data;
  const C1 = counters.find((c) => c.code === 'C1').id;
  const C2 = counters.find((c) => c.code === 'C2').id;
  const cats = (await admin.get('/categories')).data;
  const units = (await admin.get('/units')).data;
  const PCS = units.find((u) => u.code === 'PCS').id;
  const BOX = units.find((u) => u.code === 'BOX').id;
  const stationery = cats.find((c) => c.name === 'Stationery').id;
  const chargeTypes = (await admin.get('/charge-types')).data;
  const transport = chargeTypes.find((c) => c.name === 'Transport').id;
  await admin.put('/settings', { storeName: 'GENERAL STORE', addressLine: 'Nagarjuna College of Engineering & Technology', phone: null, gstin: null, gstMode: 'NOT_REGISTERED', receiptFooter: 'Thank you!', blockNegativeStock: false, roundBillToRupee: true, maxCashierDiscount: 0 });

  const mgr = await makeUser(admin, 'MANAGER', C1);
  const keeper = await makeUser(admin, 'STORE_KEEPER', null);
  const cashier = await makeUser(admin, 'CASHIER', C2);
  const noCounter = new Client('cashier-no-counter');
  const nc = await noCounter.post('/auth/login', { username: cashier.username, password: 'Store1234' });
  check(nc.status === 400, 'cashier cannot log in without a counter');

  console.log('\nProducts');
  const pA = await keeper.client.post('/products', { name: `NOTE BOOK 200 PAGE RULED ${T}`, categoryId: stationery, unitId: PCS, salePrice: 35, mrp: 35, reorderLevel: 20 });
  check(pA.status === 201 && pA.data.code, 'store keeper creates product with auto code', pA.data);
  const pB = await keeper.client.post('/products', { name: `5 STAR Rs10 ${T}`, categoryId: stationery, unitId: PCS, packUnitId: BOX, packSize: 12, salePrice: 10, mrp: 10 });
  check(pB.status === 201, 'product with box of 12');
  const dup = await keeper.client.post('/products', { name: `  note book 200  page RULED ${T} `, categoryId: stationery, unitId: PCS, salePrice: 35 });
  check(dup.status === 409, 'duplicate name (case and spaces) blocked', dup.data);
  const overMrp = await keeper.client.post('/products', { name: `Over MRP ${T}`, categoryId: stationery, unitId: PCS, salePrice: 50, mrp: 40 });
  check(overMrp.status === 400, 'sale price above MRP blocked');
  const opening = await keeper.client.post('/products', { name: `Opening try ${T}`, categoryId: stationery, unitId: PCS, salePrice: 5, openingQty: 10 });
  check(opening.status === 403, 'store keeper cannot enter opening stock');
  const priceChange = await keeper.client.patch(`/products/${pA.data.id}`, { name: pA.data.name, categoryId: stationery, unitId: PCS, salePrice: 30, mrp: 35, reorderLevel: 20 });
  check(priceChange.status === 403, 'store keeper cannot change sale price');
  const A = pA.data.id;
  const B = pB.data.id;

  console.log('\nPurchase (boxes, charges, invoice gate, maker/checker)');
  check((await keeper.client.post('/suppliers', { name: `Fake Traders ${T}` })).status === 403, 'store keeper cannot invent a supplier');
  const sup = await mgr.client.post('/suppliers', { name: `KC Distributors ${T}` });
  check(sup.status === 201, 'manager creates supplier');
  const invNo = `INV-${T}`;
  const draft = await keeper.client.post('/purchases', { supplierId: sup.data.id, supplierInvoiceNo: invNo, invoiceDate: today, taxInclusive: true });
  check(draft.status === 201 && draft.data.status === 'DRAFT', 'draft purchase created');
  const P = draft.data.id;
  const body = (invoiceTotal) => ({
    supplierId: sup.data.id, supplierInvoiceNo: invNo, invoiceDate: today, taxInclusive: true,
    lines: [
      { productId: A, entryUnit: 'BASE', enteredQty: 100, rate: 25 },
      { productId: B, entryUnit: 'PACK', enteredQty: 5, amount: 420 },
    ],
    charges: [{ chargeTypeId: transport, amount: 500, paidTo: 'VRL Logistics', referenceNo: 'LR-55' }],
    billDiscount: 0,
    invoiceTotal,
  });
  let saved = await keeper.client.put(`/purchases/${P}`, body(3500));
  check(saved.status === 200 && saved.data.computed.computedTotal === 3420 && saved.data.computed.difference === 80, 'computed total and difference returned', saved.data.computed);
  check((await keeper.client.post(`/purchases/${P}/post`)).status === 403, 'store keeper cannot post a purchase to stock');
  const ready1 = await keeper.client.post(`/purchases/${P}/ready`);
  check(ready1.status === 422 && ready1.data.code === 'TOTAL_MISMATCH', 'cannot mark ready while totals differ', ready1.data);
  const post1 = await mgr.client.post(`/purchases/${P}/post`);
  check(post1.status === 422 && post1.data.difference === 80, 'post refused with 422 and the difference', post1.data);
  check((await mgr.client.put(`/purchases/${P}`, { ...body(3420.6), lines: [{ productId: A, entryUnit: 'BASE', enteredQty: 1, rate: 0 }] })).status === 400, 'zero-rate purchase line refused');
  saved = await keeper.client.put(`/purchases/${P}`, body(3420.6));
  const ready2 = await keeper.client.post(`/purchases/${P}/ready`);
  check(ready2.status === 200 && ready2.data.readyAt, 'store keeper marks the matching bill ready', ready2.data.readyAt);
  const post2 = await mgr.client.post(`/purchases/${P}/post`);
  check(post2.status === 200 && post2.data.status === 'POSTED' && /^PU\//.test(post2.data.purchaseNo), 'manager posts within Rs 1', post2.data);
  check(post2.data.roundOff === 0.6 && post2.data.grandTotal === 3420.6, 'round-off recorded', { r: post2.data.roundOff, g: post2.data.grandTotal });
  const itA = post2.data.items.find((i) => i.productId === A);
  const itB = post2.data.items.find((i) => i.productId === B);
  // transport 500 by value: A 2500/2920 -> 428.08 ; B 420/2920 -> 71.92
  check(Math.abs(itA.landedUnitCost - 29.2808) < 0.0002 && itB.baseQty === 60, 'landed cost includes transport share; 5 boxes = 60 pcs', { a: itA.landedUnitCost, b: itB.baseQty });
  check((await keeper.client.put(`/purchases/${P}`, body(3420.6))).status === 409, 'posted purchase cannot be edited');
  const dupInv = await keeper.client.post('/purchases', { supplierId: sup.data.id, supplierInvoiceNo: invNo.toLowerCase(), invoiceDate: today });
  check(dupInv.status === 409, 'same supplier invoice cannot be entered twice', dupInv.data);
  const future = await keeper.client.post('/purchases', { supplierId: sup.data.id, supplierInvoiceNo: `F-${T}`, invoiceDate: '2099-01-01' });
  check(future.status === 400, 'future invoice date rejected');
  let a = (await admin.get(`/products/${A}`)).data;
  let b = (await admin.get(`/products/${B}`)).data;
  check(a.onHand === 100 && b.onHand === 60, 'stock increased', { a: a.onHand, b: b.onHand });

  console.log('\nCounter billing');
  const key = uuid();
  const bill = { items: [{ productId: A, qty: 5 }, { productId: B, qty: 5 }], payments: [{ mode: 'CASH', amount: 250 }] };
  const s1 = await cashier.client.post('/sales', bill, { 'Idempotency-Key': key });
  check(s1.status === 201 && s1.data.grandTotal === 225 && s1.data.changeDue === 25 && /^C2\/\d{2}-\d{2}\/\d{6}$/.test(s1.data.billNo), '5x35 + 5x10 = 225, change 25, bill no C2/FY/seq', s1.data);
  const s1b = await cashier.client.post('/sales', bill, { 'Idempotency-Key': key });
  check(s1b.data.billNo === s1.data.billNo && s1b.data.replayed, 'same Idempotency-Key returns the same bill');
  a = (await admin.get(`/products/${A}`)).data;
  check(a.onHand === 95, 'stock reduced once only', a.onHand);
  check((await cashier.client.post('/sales', bill)).status === 400, 'missing Idempotency-Key rejected');
  check((await cashier.client.post('/sales', { items: [{ productId: A, qty: 1, rate: 20 }], payments: [{ mode: 'CASH', amount: 20 }] }, { 'Idempotency-Key': uuid() })).status === 403, 'cashier cannot change price');
  check((await cashier.client.post('/sales', { items: [{ productId: A, qty: 1, discount: 5 }], payments: [{ mode: 'CASH', amount: 30 }] }, { 'Idempotency-Key': uuid() })).status === 403, 'cashier cannot give discount above limit');
  const short = await cashier.client.post('/sales', { items: [{ productId: A, qty: 2 }], payments: [{ mode: 'CASH', amount: 60 }] }, { 'Idempotency-Key': uuid() });
  check(short.status === 400 && /short by 10.00/.test(short.data.message), 'short payment rejected', short.data);
  check((await cashier.client.post('/sales', { items: [{ productId: A, qty: 1 }], payments: [{ mode: 'UPI', amount: 100 }] }, { 'Idempotency-Key': uuid() })).status === 400, 'UPI above bill rejected');
  check((await cashier.client.post('/sales', { items: [{ productId: A, qty: 1.5 }], payments: [{ mode: 'CASH', amount: 100 }] }, { 'Idempotency-Key': uuid() })).status === 400, 'fractional qty of a PCS item rejected');
  const noRef = await cashier.client.post('/sales', { items: [{ productId: A, qty: 10 }], payments: [{ mode: 'UPI', amount: 200 }, { mode: 'CASH', amount: 200 }] }, { 'Idempotency-Key': uuid() });
  check(noRef.status === 400 && /transaction ID/.test(noRef.data.message), 'UPI payment without a transaction ID refused', noRef.data);
  const UTR = `UTR${T}`.toUpperCase().slice(0, 16);
  const split = await cashier.client.post('/sales', { items: [{ productId: A, qty: 10 }], payments: [{ mode: 'UPI', amount: 200, reference: UTR }, { mode: 'CASH', amount: 200 }] }, { 'Idempotency-Key': uuid() });
  check(split.status === 201 && split.data.changeDue === 50, 'split UPI + cash with change', split.data);
  const reuse = await cashier.client.post('/sales', { items: [{ productId: A, qty: 1 }], payments: [{ mode: 'UPI', amount: 35, reference: UTR.toLowerCase() }] }, { 'Idempotency-Key': uuid() });
  check(reuse.status === 409 && /already used/.test(reuse.data.message), 'same UPI transaction cannot pay a second bill', reuse.data);
  const notAtCounter = await keeper.client.post('/sales', bill, { 'Idempotency-Key': uuid() });
  check(notAtCounter.status === 403, 'store keeper cannot bill');
  check((await keeper.client.get(`/sales?from=${today}&to=${today}`)).status === 403, 'store keeper cannot read the sales register');
  check((await keeper.client.get(`/sales/${s1.data.id}/receipt?format=html`)).status === 403, 'store keeper cannot fetch receipts');
  const cat0 = (await cashier.client.get('/products/catalogue')).data.products.find((p) => p.id === A);
  check(cat0 && cat0.lastCost === null, 'cashier does not see purchase cost');
  check((await mgr.client.post('/sales', { items: [{ productId: A, qty: 1, rate: 0 }], payments: [] }, { 'Idempotency-Key': uuid() })).status === 400, 'manager cannot bill at zero');
  check((await mgr.client.post('/sales', { items: [{ productId: A, qty: 1, rate: 20 }], payments: [{ mode: 'CASH', amount: 20 }] }, { 'Idempotency-Key': uuid() })).status === 400, 'price override without a remark refused');
  const over = await mgr.client.post('/sales', { items: [{ productId: A, qty: 1, rate: 20 }], payments: [{ mode: 'CASH', amount: 20 }], remarks: 'Damaged cover' }, { 'Idempotency-Key': uuid() });
  check(over.status === 201, 'price override with a remark saved');
  const overRow = (await mgr.client.get(`/sales?from=${today}&to=${today}`)).data.rows.find((r) => r.id === over.data.id);
  check(overRow && overRow.priceOverride === true, 'register flags the price override');

  console.log('\nHold and recall');
  const held = await cashier.client.post('/sales/held', { label: 'Lab kit customer', payload: { lines: [{ productId: A, qty: 2 }] } });
  check(held.status === 201, 'bill held');
  const heldList = (await cashier.client.get('/sales/held')).data;
  check(heldList.some((h) => h.id === held.data.id), 'held bill listed for this counter');
  const fromHeld = await cashier.client.post('/sales', { items: [{ productId: A, qty: 2 }], payments: [{ mode: 'CASH', amount: 70 }], heldBillId: held.data.id }, { 'Idempotency-Key': uuid() });
  check(fromHeld.status === 201, 'recalled bill saved');
  check(!(await cashier.client.get('/sales/held')).data.some((h) => h.id === held.data.id), 'held bill removed after saving');

  console.log('\nCounter lock (Ctrl+L) is enforced by the server');
  check((await cashier.client.post('/auth/lock')).status === 200, 'cashier locks the counter');
  const lockedTry = await cashier.client.get('/sales/held');
  check(lockedTry.status === 423 && lockedTry.data.code === 'COUNTER_LOCKED', 'every request refused while locked', lockedTry.data);
  check((await cashier.client.post('/sales', bill, { 'Idempotency-Key': uuid() })).status === 423, 'cannot bill while locked');
  check((await cashier.client.get('/auth/me')).data.locked === true, 'session reports locked');
  check((await cashier.client.post('/auth/verify-password', { password: 'nope-wrong1' })).status === 401, 'wrong password does not unlock');
  check((await cashier.client.post('/auth/verify-password', { password: 'Store1234' })).status === 200, 'right password unlocks');
  check((await cashier.client.get('/sales/held')).status === 200, 'requests work again after unlock');

  console.log('\nKits');
  const kit = await mgr.client.post('/kits', { code: `PHY${T}`.toUpperCase().slice(0, 20), name: `Physics cycle lab kit ${T}`, price: 80, items: [{ productId: A, qty: 2 }, { productId: B, qty: 1 }] });
  check(kit.status === 201, 'manager creates section kit', kit.data);
  const before = { a: (await admin.get(`/products/${A}`)).data.onHand, b: (await admin.get(`/products/${B}`)).data.onHand };
  const ks = await cashier.client.post('/sales', { items: [{ kitId: kit.data.id, qty: 3 }], payments: [{ mode: 'CASH', amount: 240 }] }, { 'Idempotency-Key': uuid() });
  check(ks.status === 201 && ks.data.grandTotal === 240, 'kit billed as one line', ks.data);
  const after = { a: (await admin.get(`/products/${A}`)).data.onHand, b: (await admin.get(`/products/${B}`)).data.onHand };
  check(before.a - after.a === 6 && before.b - after.b === 3, 'kit components deducted from stock', { before, after });

  console.log('\nEdit, cancel, returns');
  check((await cashier.client.post(`/sales/${s1.data.id}/cancel`, { reason: 'mistake' })).status === 403, 'cashier cannot cancel');
  const edit = await mgr.client.patch(`/sales/${s1.data.id}`, { items: [{ productId: A, qty: 4 }], payments: [{ mode: 'CASH', amount: 140 }] });
  check(edit.status === 200 && edit.data.grandTotal === 140 && edit.data.editCount === 1, 'manager edits bill same day', edit.data);
  const stockAfterEdit = { a: (await admin.get(`/products/${A}`)).data.onHand, b: (await admin.get(`/products/${B}`)).data.onHand };
  check(stockAfterEdit.a === after.a + 1 && stockAfterEdit.b === after.b + 5, 'edit restores old lines and applies new', { after, stockAfterEdit });
  check((await mgr.client.post(`/sales/${split.data.id}/cancel`, { reason: '' })).status === 400, 'cancel needs a reason');
  const cancel = await mgr.client.post(`/sales/${split.data.id}/cancel`, { reason: 'Customer left without goods' });
  check(cancel.status === 201 && cancel.data.status === 'CANCELLED', 'manager cancels with reason');
  check((await admin.get(`/products/${A}`)).data.onHand === stockAfterEdit.a + 10, 'cancel puts stock back');
  check((await mgr.client.post(`/sales/${split.data.id}/cancel`, { reason: 'again please' })).status === 409, 'cannot cancel twice');
  const det = (await mgr.client.get(`/sales/${ks.data.id}`)).data;
  const overRet = await mgr.client.post(`/sales/${ks.data.id}/returns`, { items: [{ saleItemId: det.items[0].id, qty: 4 }], reason: 'Wrong kit' });
  check(overRet.status === 400, 'cannot return more than sold');
  const ret1 = await mgr.client.post(`/sales/${ks.data.id}/returns`, { items: [{ saleItemId: det.items[0].id, qty: 1 }], reason: 'Student dropped course' });
  check(ret1.status === 201 && ret1.data.total === 80 && /^SR\//.test(ret1.data.returnNo), 'partial kit return refunds 80', ret1.data);
  check((await mgr.client.post(`/sales/${ks.data.id}/cancel`, { reason: 'try after return' })).status === 409, 'bill with returns cannot be cancelled');

  console.log('\nNegative stock warning (R8)');
  const big = await cashier.client.post('/sales', { items: [{ productId: B, qty: 500 }], payments: [{ mode: 'CASH', amount: 5000 }] }, { 'Idempotency-Key': uuid() });
  check(big.status === 201 && big.data.warnings.length === 1, 'sale below zero allowed with a warning', big.data.warnings);
  const low = (await keeper.client.get('/stock/low')).data;
  check(low.some((l) => l.productId === B && l.status === 'NEGATIVE'), 'negative item listed');

  console.log('\nAdjustments');
  const req = await keeper.client.post('/stock/adjustments', { productId: B, countedQty: 0, reason: 'Physical count correction' });
  check(req.status === 201 && req.data.status === 'PENDING', 'store keeper adjustment waits for approval', req.data);
  const appr = await mgr.client.post(`/stock/adjustments/${req.data.id}/approve`, {});
  check(appr.status === 200 && appr.data.status === 'APPROVED', 'manager approves');
  check((await admin.get(`/products/${B}`)).data.onHand === 0, 'stock set to counted quantity');
  check((await mgr.client.post(`/stock/adjustments/${req.data.id}/approve`, {})).status === 409, 'cannot approve twice');
  check((await cashier.client.post('/stock/adjustments', { productId: B, qtyChange: 5, reason: 'test' })).status === 403, 'cashier cannot adjust stock');

  console.log('\nPurchase return');
  const pd = (await keeper.client.get(`/purchases/${P}`)).data;
  const prBody = { items: [{ purchaseItemId: pd.items.find((i) => i.productId === A).id, baseQty: 10 }], reason: 'Damaged pages' };
  check((await keeper.client.post(`/purchases/${P}/returns`, prBody)).status === 403, 'store keeper cannot return goods to supplier alone');
  const pr = await mgr.client.post(`/purchases/${P}/returns`, prBody);
  check(pr.status === 201 && pr.data.total === 250, 'manager records purchase return at purchase value', pr.data);
  const bc = await keeper.client.patch(`/products/${A}`, { name: pA.data.name, barcode: '8901234567890', categoryId: stationery, unitId: PCS, salePrice: 35, mrp: 35, reorderLevel: 20 });
  check(bc.status === 403, 'store keeper cannot change a product barcode');

  console.log('\nStock equation (R1) and ledger check');
  const summary = (await admin.get(`/stock/summary?from=${today}&to=${today}`)).data;
  const rows = summary.sections[0].rows.filter((r) => r.productId === A || r.productId === B);
  for (const r of rows) {
    const eq = r.opening + r.purchased - r.sold + r.salesReturn - r.purchaseReturn + r.adjustment;
    check(Math.abs(eq - r.closing) < 1e-9 && Math.abs(r.closing - r.onHand) < 1e-9, `closing = equation = on hand for ${r.code}`, r);
  }
  const chk = await admin.post('/admin/stock-check');
  check(chk.status === 200 && chk.data.ok === true, 'cached balance equals ledger for every product', chk.data);
  const mv = (await admin.get(`/stock/movements?product=${A}&from=${today}&to=${today}`)).data;
  check(mv.data.closing === mv.data.product.onHand, 'item ledger closing equals on hand');

  console.log('\nReports and exports');
  for (const [path, label] of [
    [`/reports/sales/daily?date=${today}`, 'daily'],
    [`/reports/sales/monthly?month=${today.slice(0, 7)}`, 'monthly'],
    [`/reports/sales/register?from=${today}&to=${today}`, 'sales register'],
    [`/reports/purchases/register?from=${today}&to=${today}`, 'purchase register'],
    [`/reports/stock/yearly`, 'yearly stock'],
    [`/reports/stock/low`, 'low stock'],
  ]) {
    const j = await mgr.client.get(`${path}${path.includes('?') ? '&' : '?'}format=json`);
    const pdf = await mgr.client.get(`${path}${path.includes('?') ? '&' : '?'}format=pdf`);
    const x = await mgr.client.get(`${path}${path.includes('?') ? '&' : '?'}format=xlsx`);
    check(j.status === 200 && j.data.sections.length > 0, `${label}: json`);
    check(pdf.status === 200 && pdf.data.subarray(0, 4).toString() === '%PDF', `${label}: pdf`);
    check(x.status === 200 && x.data.subarray(0, 2).toString() === 'PK', `${label}: xlsx`);
  }
  const daily = (await mgr.client.get(`/reports/sales/daily?date=${today}`)).data;
  const modeTable = daily.sections.find((s) => s.title === 'Collections by payment mode');
  const collected = modeTable.rows.reduce((t, r) => t + r.collected, 0);
  const netSales = daily.summary.find((s) => s.label === 'Net sales').value;
  check(Math.abs(collected - netSales) < 0.005, 'payments by mode reconcile with net sales', { collected, netSales });
  check((await cashier.client.get('/reports/sales/monthly')).status === 403, 'cashier cannot see monthly report');
  check((await cashier.client.get(`/reports/sales/daily?date=2020-01-01`)).status === 403, 'cashier can only see today');
  check((await cashier.client.get(`/reports/sales/daily?date=${today}`)).status === 200, 'cashier sees own day');
  check((await keeper.client.get(`/reports/sales/daily?date=${today}`)).status === 403, 'store keeper cannot see sales');
  const rcpt = await cashier.client.get(`/sales/${s1.data.id}/receipt?format=html`);
  check(rcpt.status === 200 && rcpt.data.toString().includes(s1.data.billNo), 'receipt html');
  const rcpt2 = await cashier.client.get(`/sales/${s1.data.id}/receipt?format=html`);
  check(rcpt2.data.toString().includes('DUPLICATE'), 'second print is stamped DUPLICATE');
  const rpdf = await cashier.client.get(`/sales/${s1.data.id}/receipt?format=pdf`);
  check(rpdf.status === 200 && rpdf.data.subarray(0, 4).toString() === '%PDF', 'receipt pdf download');
  const dailyM = (await mgr.client.get(`/reports/sales/daily?date=${today}`)).data;
  const actions = dailyM.sections.find((s) => s.title === 'Manager actions to check');
  check(actions && actions.rows.some((r) => r.action === 'PRICE_OVERRIDE') && actions.rows.some((r) => r.action === 'RECEIPT_REPRINT'), 'daily report lists price overrides and reprints for the manager');
  const upiRows = dailyM.sections.find((s) => s.title === 'UPI and card transactions').rows;
  check(upiRows.some((r) => r.reference === UTR), 'daily report lists the UPI transaction ID for reconciliation');

  console.log('\nAudit and sessions');
  const audit = (await admin.get(`/audit?from=${today}&to=${today}`)).data.rows.map((r) => r.action);
  for (const action of ['SALE_EDIT', 'SALE_CANCEL', 'PURCHASE_POST', 'SALES_RETURN', 'STOCK_ADJUST_APPROVE', 'LOGIN', 'LOGIN_FAILED']) {
    check(audit.includes(action), `audit has ${action}`);
  }
  for (const action of ['RECEIPT_REPRINT', 'HOLD_CREATE', 'PRICE_OVERRIDE', 'PURCHASE_READY']) check(audit.includes(action), `audit has ${action}`);
  const sessions = (await admin.get('/auth/sessions')).data;
  const keeperSession = sessions.find((x) => x.user.username === keeper.username);
  check(!!keeperSession, 'admin sees who is logged in');
  check((await admin.post(`/auth/sessions/${keeperSession.id}/revoke`)).status === 200, 'admin ends a session');
  check((await keeper.client.get('/purchases')).status === 401, 'ended session is refused at once');
  const mgrCookie = mgr.client.cookie;
  check((await mgr.client.post('/auth/logout')).status === 200, 'logout');
  mgr.client.cookie = mgrCookie; // replay the old cookie
  check((await mgr.client.get('/users')).status === 401, 'a copied cookie is useless after logout');
  await mgr.client.login(mgr.username, 'Store1234', C1);
  await admin.patch(`/users/${cashier.id}`, { fullName: 'Test CASHIER', role: 'CASHIER', isActive: false });
  check((await cashier.client.get('/sales/held')).status === 401, 'switched-off user is signed out at once');
  const selfOff = await admin.patch(`/users/${(await admin.get('/auth/me')).data.id}`, { fullName: 'Store Admin', role: 'ADMIN', isActive: false });
  check(selfOff.status === 400, 'admin cannot switch off own account');

  // Tidy up: switch off this run's test products so they do not appear on the landing page.
  for (const id of [A, B]) await admin.post(`/products/${id}/deactivate`);
  if (kit.data?.id) await admin.patch(`/kits/${kit.data.id}`, { code: kit.data.code, name: kit.data.name, price: 80, isActive: false, items: [{ productId: A, qty: 2 }, { productId: B, qty: 1 }] }).catch(() => undefined);

  process.exit(results() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Browser test of the real UI (blueprint test "E2E: counter flow"). Development database only.
// Uses the Edge or Chrome already installed on the PC, through playwright-core.
//   node scripts/e2e-ui.mjs [screenshotDir]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { check, Client, results, BASE } from './lib.mjs';

const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) {
  console.error('Set ADMIN_PASSWORD to the admin password of the development database first.');
  process.exit(1);
}
const SHOTS = process.argv[2] ?? join(process.cwd(), 'e2e-screens');
mkdirSync(SHOTS, { recursive: true });
const T = Date.now().toString(36);

const browserPath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);

async function setup() {
  const admin = new Client('admin');
  await admin.login('admin', ADMIN_PW);
  const counters = (await admin.get('/counters')).data;
  const C1 = counters.find((c) => c.code === 'C1').id;
  const mk = async (role) => {
    const username = `ui${role.toLowerCase().replace('_', '')}${T}`;
    await admin.post('/users', { username, fullName: `UI ${role}`, role, password: 'Temp1234' });
    const c = new Client(username);
    await c.login(username, 'Temp1234', role === 'CASHIER' ? C1 : null);
    await c.post('/auth/change-password', { currentPassword: 'Temp1234', newPassword: 'Ui123456' });
    return username;
  };
  const cats = (await admin.get('/categories')).data;
  const units = (await admin.get('/units')).data;
  const p = await admin.post('/products', { name: `UI NOTEBOOK ${T}`, categoryId: cats[0].id, unitId: units.find((u) => u.code === 'PCS').id, salePrice: 35, mrp: 35, openingQty: 50, openingCost: 25 });
  const supplierName = `UI Supplier ${T}`;
  await admin.post('/suppliers', { name: supplierName });
  return { C1, product: p.data, supplierName, cashier: await mk('CASHIER'), manager: await mk('MANAGER'), keeper: await mk('STORE_KEEPER') };
}

async function main() {
  if (!browserPath) throw new Error('No Edge or Chrome found');
  const s = await setup();
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && !/401|423|Failed to load resource/.test(m.text()) && errors.push(`${page.url()}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
    return page;
  };
  const login = async (page, user, pw, counterCode) => {
    await page.goto(BASE);
    // Landing page first: Enter goes to the login form.
    await page.waitForSelector('[data-intro-ready]');
    await page.keyboard.press('Enter');
    await page.getByLabel('Username').waitFor();
    await page.getByLabel('Username').fill(user);
    await page.getByLabel('Password').fill(pw);
    if (counterCode) {
      const sel = page.getByLabel('Counter');
      await sel.locator('option', { hasText: `${counterCode} ·` }).first().waitFor({ state: 'attached' });
      const value = await sel.locator('option', { hasText: `${counterCode} ·` }).first().getAttribute('value');
      await sel.selectOption(value);
    }
    await page.getByRole('button', { name: 'Log in' }).click();
  };

  // ---- Landing page: every item arrives within 6 s, catalogue searchable, login reachable ----
  const lp = await newPage();
  await lp.goto(BASE);
  await lp.waitForSelector('[data-intro-ready]', { timeout: 15000 });
  const t0 = Date.now();
  for (const at of [0.5, 1.5, 3.0, 4.5]) {
    const wait = t0 + at * 1000 - Date.now();
    if (wait > 0) await lp.waitForTimeout(wait);
    await lp.screenshot({ path: join(SHOTS, `00-landing-${String(at).replace('.', '_')}s.png`) });
  }
  await lp.waitForFunction(() => document.documentElement.dataset.introMs, null, { timeout: 8000 });
  const introMs = Number(await lp.evaluate(() => document.documentElement.dataset.introMs));
  check(introMs >= 5900 && introMs <= 6300, `landing animation runs 6 s (${(introMs / 1000).toFixed(2)} s)`);
  await lp.waitForTimeout(300);
  await lp.screenshot({ path: join(SHOTS, '00-landing-final.png') });
  const shown = await lp.getByTestId('item-count').innerText();
  check(Number(shown.replace(/,/g, '')) > 0, `landing counts the store's items (${shown})`);
  const landingOverflow = await lp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!landingOverflow, 'landing page has no sideways scrolling');
  await lp.getByRole('button', { name: 'Log in' }).click();
  await lp.getByLabel('Username').waitFor();
  check(true, 'Log in button on the landing page opens the login form');
  // Phone width
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  await pp.goto(BASE);
  await pp.waitForSelector('[data-intro-ready]');
  await pp.waitForTimeout(1500);
  check(!(await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'landing page fits a phone screen');
  await pp.screenshot({ path: join(SHOTS, '00-landing-phone.png'), fullPage: true });
  await phone.close();

  // ---- Cashier: keyboard-only bill with F10 ----
  const page = await newPage();
  await login(page, s.cashier, 'Ui123456', 'C1');
  await page.waitForSelector('[data-page="dashboard"]', { timeout: 15000 });
  check(true, 'cashier logs in and sees the dashboard');
  await page.screenshot({ path: join(SHOTS, '01-cashier-dashboard.png') });
  // F2 from any page jumps to Counter sales
  await page.keyboard.press('F2');
  const search = page.locator('#pos-search');
  await search.waitFor({ timeout: 5000 }).then(() => check(true, 'F2 on the dashboard opens Counter sales'), () => check(false, 'F2 on the dashboard opens Counter sales'));
  await page.waitForTimeout(800); // catalogue load
  // An F key with nothing to act on explains itself instead of doing nothing
  // click empty page padding (top-left of <main>) to leave the search box; the sidebar rail sits at x < 48
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('F9');
  check(await page.waitForSelector('text=the bill is empty', { timeout: 3000 }).then(() => true, () => false), 'F9 on an empty bill says why it cannot save');
  await page.keyboard.press('F3');
  check(await page.waitForSelector('text=add an item to the bill first', { timeout: 3000 }).then(() => true, () => false), 'F3 on an empty bill says why there is no QR');
  // Laptops whose top row sends volume/brightness use Alt+number instead (Alt+4 = F4)
  const panelBefore = await page.getByRole('button', { name: 'Section kits' }).getAttribute('class');
  await page.keyboard.press('Alt+4');
  await page.waitForTimeout(200);
  check((await page.getByRole('button', { name: 'Section kits' }).getAttribute('class')) !== panelBefore, 'Alt+4 works the same as F4');
  await page.keyboard.press('Alt+4');
  await search.fill(`3*${s.product.code}`);
  await search.press('Enter');
  await page.waitForSelector(`text=UI NOTEBOOK ${T}`);
  const totalText = await page.locator('aside .text-5xl').innerText();
  check(totalText.replace(/\s/g, '') === '₹105.00', '3 x 35 shows ₹105.00 on screen', totalText);
  await page.screenshot({ path: join(SHOTS, '02-billing-with-line.png') });
  await page.getByLabel('Cash received').fill('200');
  const change = await page.locator('text=Change to give').locator('xpath=..').innerText();
  check(/95\.00/.test(change), 'change due shows ₹95.00', change);
  const receipt = page.waitForRequest((r) => /\/sales\/\d+\/receipt\?format=html/.test(r.url()), { timeout: 10000 });
  await page.keyboard.press('F10');
  await receipt;
  check(true, 'F10 saved the bill and loaded the receipt for printing');
  await page.waitForSelector('text=Last bill');
  const billNo = await page.locator('text=Last bill').locator('xpath=following-sibling::div[1]').innerText();
  check(/^C1\/\d{2}-\d{2}\/\d{6}$/.test(billNo.trim()), `bill number on screen ${billNo.trim()}`);
  check((await page.locator('aside .text-5xl').innerText()).replace(/\s/g, '') === '₹0.00', 'screen cleared for the next customer');
  await page.screenshot({ path: join(SHOTS, '03-billing-after-save.png') });

  // Hold and recall with F6/F7
  await search.fill(s.product.code);
  await search.press('Enter');
  await page.keyboard.press('F6');
  await page.getByLabel('Name for this bill').fill(`Waiting ${T}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Hold bill' }).click();
  // the hold is saved when its dialog closes (a cloud database takes longer than the old fixed 400 ms)
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
  await page.keyboard.press('F7');
  try {
    await page.waitForSelector(`text=Waiting ${T}`);
  } catch (e) {
    // keep evidence of what the screen showed when the held bill did not appear
    await page.screenshot({ path: join(SHOTS, 'fail-recall.png') }).catch(() => undefined);
    const dialog = await page.getByRole('dialog').allInnerTexts().catch(() => []);
    console.log('recall step failed; dialogs on screen:', JSON.stringify(dialog).slice(0, 600));
    throw e;
  }
  await page.getByRole('dialog').locator('li', { hasText: `Waiting ${T}` }).getByRole('button', { name: 'Recall', exact: true }).click();
  await page.waitForSelector(`text=UI NOTEBOOK ${T}`);
  check(true, 'F6 holds and F7 recalls a bill');
  await page.keyboard.press('F9');
  await page.waitForTimeout(800);

  // Lock with Ctrl+L
  await page.keyboard.press('Control+l');
  await page.waitForSelector('text=Counter locked');
  await page.reload();
  await page.waitForSelector('text=Counter locked');
  check(true, 'Ctrl+L locks and the lock survives a page reload');
  await page.getByLabel('Password').fill('Ui123456');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.waitForSelector('text=Counter locked', { state: 'detached' });
  check(true, 'password unlocks');
  // top menu bar: Sales → Bill view
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bill view / return against bill' }).click();
  await page.waitForSelector(`text=${billNo.trim()}`);
  check(true, 'cashier sees own bill in register');

  // ---- Manager: visit every page ----
  const m = await newPage();
  await login(m, s.manager, 'Ui123456', 'C1');
  await m.waitForSelector('[data-page="dashboard"]');
  const pages = [
    ['Dashboard', '/', 'text=Net sales today'],
    ['Sales register', '/sales', 'text=Completed:'],
    ['Purchases', '/purchases', 'text=New purchase'],
    ['Products', '/products', `text=UI NOTEBOOK ${T}`],
    ['Stock summary', '/stock', 'text=Stock summary'],
    ['Low stock', '/stock?tab=low', 'text=Low and negative stock'],
    ['Adjustments', '/stock?tab=adjust', 'text=New adjustment'],
    ['Reports daily', '/reports', 'text=Daily sales report'],
    ['Settings', '/admin', 'text=People who use the system'],
    ['GST input register', '/gst?tab=input', 'text=Rate-wise summary'],
    ['GST output register', '/gst?tab=output', 'text=Credit notes (sales returns)'],
    ['Expiry report', '/stock?tab=expiry', 'text=Batches listed'],
  ];
  let n = 4;
  for (const [label, path, marker] of pages) {
    await m.goto(`${BASE}${path}`);
    try {
      await m.waitForSelector(marker, { timeout: 15000 });
      check(true, `manager opens ${label}`);
    } catch {
      check(false, `manager opens ${label}`, await m.locator('main').innerText().catch(() => ''));
    }
    await m.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-${label.toLowerCase().replace(/\s/g, '-')}.png`), fullPage: true });
  }
  // Monthly and yearly report tabs
  await m.goto(`${BASE}/reports`);
  await m.getByRole('tab', { name: 'Monthly sales' }).click();
  await m.waitForSelector('text=Day by day');
  check(true, 'monthly report renders');
  await m.getByRole('tab', { name: 'Yearly stock (FY)' }).click();
  await m.waitForSelector('text=Category subtotals');
  check(true, 'yearly FY stock report renders');
  const dl = m.waitForEvent('download');
  await m.getByRole('button', { name: 'Download Excel' }).click();
  const file = await dl;
  check(/^stock_FY\d{4}-\d{2}\.xlsx$/.test(file.suggestedFilename()), `Excel downloads as ${file.suggestedFilename()}`);
  await m.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-yearly-stock.png`), fullPage: true });

  // Bill detail drawer
  await m.goto(`${BASE}/sales`);
  await m.getByRole('button', { name: billNo.trim() }).click();
  await m.waitForSelector('text=Cancel bill');
  check(true, 'manager sees edit/cancel/return on today\'s bill');
  await m.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-bill-detail.png`) });

  // ---- Store keeper: purchase screen ----
  const k = await newPage();
  await login(k, s.keeper, 'Ui123456');
  await k.waitForSelector('[data-page="dashboard"]');
  check((await k.getByRole('button', { name: 'Sales', exact: true }).count()) === 0 && (await k.getByRole('button', { name: 'GST', exact: true }).count()) === 0, 'store keeper has no Sales or GST menu');
  // Purchase → Purchase entry (new GRN) from the top menu
  await k.getByRole('button', { name: 'Purchase', exact: true }).click();
  await k.getByRole('menuitem', { name: 'Purchase entry (new GRN)' }).click();
  await k.getByRole('dialog').waitFor();
  check(true, 'Purchase menu opens a new GRN');
  check((await k.getByLabel('Or add a new supplier').count()) === 0, 'store keeper cannot add a supplier (manager only)');
  await k.getByRole('dialog').getByLabel('Supplier', { exact: true }).selectOption({ label: s.supplierName });
  await k.getByLabel('Invoice / DC no').fill(`UI-${T}`);
  await k.getByLabel('Invoice amount ₹ (grand total on the supplier bill)').fill('300');
  await k.getByRole('button', { name: 'Start entering items' }).click();
  await k.waitForSelector('text=draft purchase');
  check(/^GRN\/\d{2}-\d{2}\/\d{4}/.test(await k.locator('h1').first().innerText()), 'GRN number shown as soon as the bill is saved');
  await k.getByLabel('Add item').fill(s.product.code);
  // wait for the search result, as a person would, before pressing Enter
  await k.locator('ul button', { hasText: s.product.name }).first().waitFor({ timeout: 20000 });
  await k.getByLabel('Add item').press('Enter');
  await k.getByLabel('Quantity').fill('10');
  await k.getByLabel('Rate', { exact: true }).fill('25');
  await k.getByRole('button', { name: 'Add charge' }).click();
  await k.getByLabel('Charge amount').fill('20');
  await k.getByLabel('Sale price').fill('34');
  await k.getByLabel('Expiry').fill('2030-12-31');
  await k.waitForSelector('text=Difference');
  check((await k.getByRole('button', { name: 'Post to stock' }).count()) === 0, 'store keeper has no "Post to stock" button');
  check(await k.getByRole('button', { name: 'Mark ready for manager' }).isDisabled(), '"Mark ready" is blocked while totals differ by more than ₹1');
  await k.getByLabel('Invoice amount ₹', { exact: true }).fill('270.50');
  await k.waitForSelector('text=Matches the supplier bill');
  await k.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-purchase-draft.png`), fullPage: true });
  await k.getByRole('button', { name: 'Mark ready for manager' }).click();
  await k.waitForSelector('text=Waiting for a manager', { timeout: 15000 });
  check(true, 'store keeper marks the purchase ready');
  const draftUrl = k.url();
  // Manager posts it
  await m.goto(draftUrl);
  await m.waitForSelector('text=Waiting for a manager');
  await m.getByRole('button', { name: 'Post to stock' }).click();
  await m.waitForSelector('text=Return to supplier', { timeout: 15000 });
  check(true, 'manager posts the purchase to stock');
  await m.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-purchase-posted.png`), fullPage: true });

  // FR-16: barcode labels from the posted purchase (headless print() is a no-op)
  await m.getByRole('button', { name: 'Print barcode labels' }).click();
  await m.getByRole('dialog').waitFor();
  const labelBtn = m.getByRole('dialog').getByRole('button', { name: /^Print \d+ labels?$/ });
  check(/^Print [1-9]\d* labels?$/.test(await labelBtn.innerText()), 'label dialog fills one label per piece received', await labelBtn.innerText());
  await labelBtn.click();
  await m.waitForSelector('#labels-frame', { state: 'attached', timeout: 10000 });
  const svgCount = await m.frameLocator('#labels-frame').locator('.label svg').count();
  check(svgCount > 0, `label sheet has barcodes (${svgCount} labels)`);
  await m.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 }).catch(() => undefined);

  // Phone-width check of billing (rush tablet)
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const tp = await tablet.newPage();
  await login(tp, s.cashier, 'Ui123456', 'C1');
  await tp.waitForSelector('[data-page="dashboard"]');
  await tp.goto(`${BASE}/billing`);
  await tp.waitForSelector('#pos-search');
  const overflow = await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'billing fits a tablet screen without sideways scrolling');
  await tp.screenshot({ path: join(SHOTS, `${String(n++).padStart(2, '0')}-tablet-billing.png`), fullPage: true });

  check(errors.length === 0, 'no JavaScript errors in the browser', errors.slice(0, 5).join('\n'));
  // Tidy up: switch off this run's test product so it does not appear on the landing page.
  const admin = new Client('admin');
  await admin.login('admin', ADMIN_PW);
  await admin.post(`/products/${s.product.id}/deactivate`);
  await browser.close();
  console.log(`\nScreenshots: ${SHOTS}`);
  process.exit(results() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

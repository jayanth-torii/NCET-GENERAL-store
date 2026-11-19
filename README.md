# NCET General Store POS v2

Browser-based, multi-counter point of sale for the NCET campus General Store. It replaces Link-Zee 1.0 and follows `NCET_Store_POS_Blueprint.pdf`.

One small server in the store runs the app and the database. Counters, the rush-hour tablet and the office PC open it in a browser over the store network. Billing does not need the internet.

## What is in it

| Module | What it does |
|---|---|
| Look | Dark NGI theme on every page: deep navy page, navy cards, NGI orange as the only accent. Colours are set once in `apps/web/tailwind.config.js`. Receipts, PDFs and Excel files stay black on white |
| Menu | Top menu bar with drop-downs, grouped like the store's previous desktop software: **File** (masters, counters, users), **Sales**, **Purchase**, **Inventory**, **Expiry/Damage**, **Reports**, **GST**, **Maintenance**. Each role sees only its own items. The header shows the store GSTIN |
| GRN | Every purchase gets a **GRN number** (GRN/26-27/0001) the moment it is first saved. The **invoice amount** is asked when the GRN is created. Each line takes batch, **expiry date**, and an optional **new sale price / MRP** (with margin shown), applied to the product when the GRN is posted and audited as a price change |
| GST | **Input register** (tax on GRNs by invoice date, IGST for other-state suppliers, less debit notes) and **output register** (tax on bills, CGST + SGST, less credit notes), each with a rate-wise summary, as PDF / Excel |
| Expiry | Inventory → Expiry report: batches expired or expiring within 30 / 60 / 90 / 180 / 365 days, with days left, GRN and supplier |
| Landing page | Public page before login: every active store item (read live from the product list, no duplicates) bursts in, orbits and settles in 6 seconds on a canvas, with the item count and categories. Hover an item for its name. Enter or "Log in" goes to the login form; Esc skips the intro |
| Dashboard | Net sales, bills and average bill against yesterday, 7-day chart (net sales / bills), recent bills, store UPI card, how customers paid, what needs attention (below zero, reorder, adjustments, purchases to post), ledger alerts |
| Counter sales | Barcode / code / name search, `5*123` quantity entry, quick keys (top 24 sellers), section kits, Cash + UPI + Card split with change, **UPI QR for the exact amount (F3)** with the transaction ID recorded, hold / recall, F2 F3 F4 F6 F7 F8 F9 F10 (**or Alt+2 … Alt+0** on laptops whose top row is volume/brightness), F2 from any page opens billing, every key explains itself when it cannot act, Ctrl+P reprint, Ctrl+L lock, idle auto-lock, silent 80 mm receipt printing, PDF of any bill |
| Sales register | Every bill with status and flags (edited, price changed, printed N×); reprint (copies are stamped DUPLICATE and logged), PDF (80 mm / A4); manager edit or cancel (same day, with reason, audited); sales returns against the bill, refunded the way the bill was paid, within the return window |
| Purchases | Supplier bill entry in boxes or pieces, rate **or** line amount, new product without leaving the screen, any number of charges (Transport, Hamali, Courier…) with transporter and LR no., landed cost per item, **posting blocked until the total is within ₹1 of the supplier bill**. **Maker / checker:** the store keeper enters the bill and marks it ready; a manager posts it to stock. Returns to supplier and cancels are manager actions. **Barcode labels** (FR-16) from any posted purchase: one label per piece received by default, A4 sheet of 24 stickers (3 × 8), Code 128 of the item's barcode or code, with name, price and MRP |
| Products | About 12 fields, GST % + HSN, duplicate-name block, sale price cannot exceed MRP, Excel export / import |
| Stock | Live stock summary (Opening, Purchased, Sold, Returns, Adjustments, Closing, Value), item ledger with running balance, low / negative / dead stock, adjustments (store keeper requests, manager approves) |
| Reports | Daily, monthly, sales register, purchase register, **section kits** (kits sold and returned per section, FR-14), yearly FY stock (April–March), low and dead stock. Every report on screen, as PDF and as Excel. **Class order sheet** (FR-14): PDF for one kit and section with the kit contents and one row per student for roll no, name, paid, issued and signature |
| Admin | Users and 4 roles, **who is logged in (with end-session)**, counters, charge types, categories, units, suppliers, kits, store settings (GST mode, rounding, cashier discount limit, negative-stock block, **UPI ID and payee name, transaction-ID rules, idle lock minutes, return window**), append-only audit log, go-live opening-count import, ledger check |

### Payments: how UPI and card are kept honest

- **UPI at the counter (F3):** the screen shows a QR with the store's UPI ID, the exact outstanding amount and the bill note. The customer scans it with any UPI app; the money goes straight from their bank to the store's account. No card or bank details are ever typed into, or stored by, this system.
- **Transaction ID:** by default every UPI payment must record the transaction ID (UTR) from the customer's app, and **one ID can back only one completed bill**. A second bill with the same ID is refused (checked inside the save transaction with a lock, so two counters cannot claim the same payment at the same moment). Card slip IDs can be made mandatory with a setting.
- **Reconciliation:** the daily report lists every UPI and card transaction with its ID, amount and bill, to tick against the UPI app or bank statement, and collections by mode always add up to net sales.
- **Refunds** go back the way the bill was paid: a UPI bill is refunded by UPI, never from the cash drawer.
- Online gateways (Razorpay, PhonePe for Business) are not built in. The UPI flow above needs no merchant API and works offline on the store LAN; a gateway can be added later behind the same payment-record rules.

### Rules the system enforces (no workarounds)

- The **server clock** sets every bill date. Nobody can backdate a bill. Dates show as DD-MM-YYYY (IST).
- **Bill numbers** are per counter per financial year (`C2/26-27/000481`), gapless, and reset on 1 April.
- A bill is saved **once**: each bill carries an idempotency key, so a double F10 or a network retry returns the same bill.
- Stock and the stock ledger change in the **same transaction**; the ledger and audit log are append-only (database triggers refuse UPDATE/DELETE). A nightly 02:00 check raises a dashboard alert if a balance ever differs from its ledger.
- Cashiers bill at the **master price**; only managers can change a price on a bill. Cashier discounts are limited by a setting (default 0%).
- UPI + card can never exceed the bill (change is cash only). Payment rows always add up to the bill, so collections by mode reconcile with sales.
- Bills are never deleted: cancel writes reversing stock movements; edits and cancels are same-day and manager-only; older bills only through a sales return.
- One supplier invoice can be entered only once. Future invoice dates are refused.
- Every login uses a personal account. First login forces a new password. Passwords are Argon2id hashed. Five wrong passwords lock that username for 10 minutes. Switching a user off or changing their role signs them out at once. Ctrl+L locks the counter **on the server**, so clearing the browser does not unlock it; counters also lock after the configured idle minutes.
- **Sessions live on the server.** Logging out ends the session there, so a copied cookie is useless afterwards. Password changes and resets end every session of that user. Admins see who is logged in, from where, and can end any session.
- There must always be one active admin; admins cannot switch off their own account.
- **Store keepers cannot change stock on their own:** purchases they enter must be posted by a manager; purchase returns, supplier creation and stock adjustments need a manager; they cannot change a product's code, barcode, name or unit (which would re-price an item at the counter), and they cannot see sales at all.
- **Managers are accountable:** billing below the master price needs a remark, flags the bill, and is logged; prices cannot be zero; every edit, cancel, return, price override, reprint, discarded hold and stock adjustment appears in the daily report's "Manager actions to check" section.
- **Receipts:** the first print of a bill is the original; every later print is stamped DUPLICATE n and logged with the user, and the register shows how many times a bill was printed.
- **Held bills** are logged on creation and on discard; a cashier can discard only their own.
- Cashiers never see purchase costs; a mid-year physical count is recorded as approved adjustments (visible in the Adjust column), never silently as "opening stock".
- Security headers: Content-Security-Policy (scripts only from this server), HSTS on HTTPS, nosniff, frame-ancestors self.

## Running it

Requirements: Node.js 20+ (tested on 24), Docker Desktop (for PostgreSQL 16).

```powershell
npm install
copy apps\api\.env.example apps\api\.env      # then edit: JWT_SECRET (32+ random chars), ADMIN_INITIAL_PASSWORD, DB password
npm run db:up                                  # PostgreSQL 16 in Docker (only reachable from this PC)
npm run migrate                                # create tables
npm run seed                                   # admin user, counters C1 C2 C3 OF, units, categories, charge types
npm run seed:demo                              # OPTIONAL training data - not for the live store
npm run build
npm start                                      # http://<server-ip>:3000
```

Log in as `admin` with `ADMIN_INITIAL_PASSWORD`; you will be asked to set a new password. Then create a personal account for every staff member under **Settings & users**.

For development: `npm run dev:api` and `npm run dev:web` (Vite on port 5173 forwards `/api` to 3000).

### Counter PCs: printing with no dialog

Make a desktop shortcut for each counter:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://<server-ip>:3000/billing
```

Set the 80 mm thermal printer as that PC's default printer. F10 then saves and prints straight away. Without `--kiosk-printing` the browser shows its print dialog. Any bill can also be downloaded as a PDF.

### HTTPS on the store network (recommended)

Create a local certificate (for example with `mkcert`), install its root on each counter PC, and set `HTTPS_CERT_FILE` and `HTTPS_KEY_FILE` in `apps/api/.env`. The session cookie becomes secure automatically.

### Backups

`docker compose -f ops/docker-compose.yml up -d backup` starts the nightly backup (23:30 IST): a `pg_dump` into `./backups` (set `BACKUP_DIR` to the USB disk), checked after writing, keeping 30 daily and 12 monthly copies. For the off-site copy set `CLOUD_CMD`, for example `rclone copy {} remote:storepos` with an encrypted rclone remote. Test a restore every month:

```powershell
docker exec -i ncet-store-pos-db-1 pg_restore -U storepos -d storepos_restore_test --create < backups\daily\storepos_YYYY-MM-DD.dump
```

## Moving from Link-Zee (blueprint section 21)

1. Copy the Link-Zee `.mdb` file and export the Item Master to Excel/CSV (Access or `mdb-export`).
2. Arrange it into the product sheet layout (export one from **Products → Export Excel** to get the columns), fix spellings and merge duplicates. Keep the old item codes so staff keep the codes they know.
3. **Products → Import Excel**. If any row has a problem, nothing is imported and every problem is listed.
4. On cutover day count the shelves and upload the count under **Settings & users → Go-live tools** (columns `Code`, `Counted Qty`, optional `Cost`).
5. Run both systems for one week and compare daily totals (the daily report's "Collections by payment mode" against the counted drawer), then switch off Link-Zee.

## Tests

| Command | What it proves |
|---|---|
| `npm test` | Unit tests: bill totals (5×35 + 5×10 = 225.00), rounding, payments, landed-cost allocation (shares always add up exactly), ₹1 total gate, line-amount rate, IST dates and financial year |
| `npm run smoke` | 155 end-to-end API checks: GRN numbers, GRN sale price / MRP rules, expiry report, GST input and output registers, section kit report and order sheet, roles, maker/checker on purchases, invoice gate, idempotency, UPI transaction-ID rules and reuse, price-override rules, duplicate receipt stamping, edit/cancel/returns, kits, hold, lock, sessions (logout, admin revoke, copied cookie), negative stock, adjustments, stock equation, ledger check, every report as JSON/PDF/XLSX, audit trail |
| `npm run rush` | 4 counters billing the same items at once with double presses: no duplicate or missing bill numbers, exact stock, ledger intact, p95 save time under 300 ms |
| `node scripts/e2e-ui.mjs` | Real browser (installed Edge/Chrome): landing page timing, search and phone layout; 47 checks: top menu per role, GST and expiry pages, keyboard-only billing with F10, F2 from the dashboard, F-key messages, Alt+number keys, hold/recall, Ctrl+L, every page per role, store keeper marks a purchase ready and a manager posts it, barcode label sheet, Excel download, tablet layout, no JS errors |

`smoke`, `rush` and `e2e-ui` create test records - run them against a development database only. They need env `ADMIN_PASSWORD` = the current admin password (no password is stored in the repository).

## Settings that depend on the store's answers (blueprint section 25)

- **UPI**: Settings → Store settings → UPI ID and payee name. Until these are set, the F3 QR button explains what is missing. Ask the bank for the store's own UPI ID (a staff member's personal UPI ID would send store money to a personal account).
- **GST**: Settings → GST. "Not registered" prints a plain bill; "Registered" needs the GSTIN and prints a tax invoice with CGST/SGST. Sale prices are GST-inclusive either way.
- **Counters**: add as many as needed under Settings & users → Counters; each gets its own bill series.
- **Charge types**: add any the supplier bills show (Hamali, Loading…) without code changes.
- **Negative stock**: allowed with a warning by default; can be switched to a hard block.

## Known items

- `npm audit` reports advisories in `prisma` (CLI only), `exceljs` → `uuid` (a code path the app does not use) and `zod` (oversized input; the server caps request bodies at 1 MB and every list has a maximum length). Fixing them needs major-version upgrades (Prisma 7, Zod 4) - plan these as a separate change with the full test suite.
- PDFs are produced with pdfmake instead of the Puppeteer suggested in the blueprint, so the store server needs no headless browser. The PDF fonts are plain Latin, so amounts print as "Rs" instead of "₹" in PDFs only (screen and Excel use ₹).

## Layout

```
apps/api      NestJS + Prisma (PostgreSQL). src/sales, purchase, stock, reports, catalogue, auth, admin
apps/web      React 19 + Vite + Tailwind. src/pages, components, lib (API client, catalogue cache, printing)
ops/          docker-compose.yml (PostgreSQL 16 + nightly backup), backup.sh
scripts/      smoke-test, rush-test, e2e-ui
```

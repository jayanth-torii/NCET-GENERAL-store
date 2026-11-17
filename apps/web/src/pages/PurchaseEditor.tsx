import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, post, put } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { useCatalogue } from '../lib/catalogue';
import { LabelItem, MAX_LABELS, printLabels } from '../lib/labels';
import { date, dateTime, money, qty as fmtQty, r2, todayIso } from '../lib/format';
import type { CatalogueItem, ChargeType, Product, Supplier } from '../lib/types';
import { ProductForm } from '../components/ProductForm';
import { Button, Card, Checkbox, ConfirmDialog, cx, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Select, Table, td, th, useToast } from '../components/ui';

interface PItem {
  id: number;
  productId: number;
  entryUnit: 'PACK' | 'BASE';
  enteredQty: number;
  packSize: number;
  baseQty: number;
  rate: number;
  grossAmount: number;
  discount: number;
  gstRate: number;
  taxAmount: number;
  lineTotal: number;
  landedUnitCost: number | null;
  batch: string | null;
  expiry: string | null;
  returnedQty: number;
  product: { code: string; name: string; unit: { code: string; allowDecimal: boolean }; packUnit: { code: string } | null; packSize: number };
}
interface PDetail {
  id: number;
  purchaseNo: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  supplierId: number;
  supplier: Supplier;
  supplierInvoiceNo: string;
  invoiceDate: string;
  taxInclusive: boolean;
  notes: string | null;
  invoiceTotal: number | null;
  discountTotal: number;
  grandTotal: number;
  roundOff: number;
  postedAt: string | null;
  readyAt: string | null;
  readyBy: { fullName: string } | null;
  cancelReason: string | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
  items: PItem[];
  charges: { id: number; chargeTypeId: number; amount: number; paidTo: string | null; referenceNo: string | null; chargeType: ChargeType }[];
  returns: { id: number; returnNo: string; createdAt: string; reason: string; total: number; user: { fullName: string } }[];
  computed: { itemsTotal: number; taxTotal: number; chargesTotal: number; discountTotal: number; computedTotal: number; difference: number | null; roundOff: number; grandTotal: number; canPost: boolean; problem: string | null };
}

interface LineForm {
  key: string;
  productId: number;
  code: string;
  name: string;
  unit: string;
  allowDecimal: boolean;
  packUnit: string | null;
  packSize: number;
  entryUnit: 'PACK' | 'BASE';
  enteredQty: string;
  mode: 'rate' | 'amount';
  value: string;
  discount: string;
  gstRate: string;
  batch: string;
  expiry: string;
}
interface ChargeForm {
  key: string;
  chargeTypeId: string;
  amount: string;
  paidTo: string;
  referenceNo: string;
}

const nz = (s: string) => (s.trim() === '' ? 0 : Number(s));

export function PurchaseEditor() {
  const { id } = useParams();
  const pid = Number(id);
  const q = useQuery({ queryKey: ['purchase', pid], queryFn: () => get<PDetail>(`/purchases/${pid}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? new Error('Purchase not found')} />;
  return q.data.status === 'DRAFT' ? <DraftEditor key={q.data.id} p={q.data} /> : <PostedView p={q.data} />;
}

function DraftEditor({ p }: { p: PDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const cat = useCatalogue();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => get<Supplier[]>('/suppliers') });
  const chargeTypes = useQuery({ queryKey: ['charge-types'], queryFn: () => get<ChargeType[]>('/charge-types') });

  const [header, setHeader] = useState({ supplierId: String(p.supplierId), supplierInvoiceNo: p.supplierInvoiceNo, invoiceDate: p.invoiceDate, taxInclusive: p.taxInclusive, notes: p.notes ?? '' });
  const [lines, setLines] = useState<LineForm[]>(() =>
    p.items.map((i) => ({
      key: String(i.id),
      productId: i.productId,
      code: i.product.code,
      name: i.product.name,
      unit: i.product.unit.code,
      allowDecimal: i.product.unit.allowDecimal,
      packUnit: i.product.packUnit?.code ?? null,
      packSize: Number(i.product.packSize),
      entryUnit: i.entryUnit,
      enteredQty: String(Number(i.enteredQty)),
      mode: 'amount',
      value: String(Number(i.grossAmount)),
      discount: Number(i.discount) ? String(Number(i.discount)) : '',
      gstRate: String(Number(i.gstRate)),
      batch: i.batch ?? '',
      expiry: i.expiry ?? '',
    })),
  );
  const [charges, setCharges] = useState<ChargeForm[]>(() => p.charges.map((c) => ({ key: String(c.id), chargeTypeId: String(c.chargeTypeId), amount: String(Number(c.amount)), paidTo: c.paidTo ?? '', referenceNo: c.referenceNo ?? '' })));
  const [billDiscount, setBillDiscount] = useState(Number(p.discountTotal) ? String(Number(p.discountTotal)) : '');
  const [invoiceTotal, setInvoiceTotal] = useState(p.invoiceTotal === null ? '' : String(Number(p.invoiceTotal)));
  const [server, setServer] = useState<PDetail>(p);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'post' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [newProduct, setNewProduct] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);

  const touch = () => setDirty(true);

  // Live estimate on screen; the server's numbers (after Save) are the ones that count.
  const est = useMemo(() => {
    let items = 0;
    for (const l of lines) {
      const qn = nz(l.enteredQty);
      const gross = l.mode === 'amount' ? r2(nz(l.value)) : r2(qn * nz(l.value));
      const taxable = gross - nz(l.discount);
      items += header.taxInclusive ? taxable : r2(taxable + r2((taxable * nz(l.gstRate)) / 100));
    }
    const ch = charges.reduce((a, c) => a + nz(c.amount), 0);
    const total = r2(items + ch - nz(billDiscount));
    const inv = invoiceTotal.trim() === '' ? null : Number(invoiceTotal);
    const diff = inv === null ? null : r2(inv - total);
    return { items: r2(items), charges: r2(ch), total, diff };
  }, [lines, charges, billDiscount, invoiceTotal, header.taxInclusive]);

  const hits = useMemo(() => cat.search(search, 8), [search, cat]);

  const addLine = (c: CatalogueItem | Product) => {
    const item = 'unitCode' in c ? { id: c.id, code: c.code, name: c.name, unit: c.unitCode, allowDecimal: c.allowDecimal, packUnit: c.packUnitCode, packSize: Number(c.packSize), gstRate: Number(c.gstRate), lastCost: c.lastCost } : { id: c.id, code: c.code, name: c.name, unit: c.unit, allowDecimal: c.allowDecimal, packUnit: c.packUnit, packSize: Number(c.packSize), gstRate: Number(c.gstRate), lastCost: c.lastCost };
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        productId: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        allowDecimal: item.allowDecimal,
        packUnit: item.packUnit,
        packSize: item.packSize,
        entryUnit: item.packUnit && item.packSize > 1 ? 'PACK' : 'BASE',
        enteredQty: '',
        mode: 'rate',
        value: '',
        discount: '',
        gstRate: String(item.gstRate),
        batch: '',
        expiry: '',
      },
    ]);
    setSearch('');
    touch();
    setTimeout(() => document.getElementById(`qty-${item.id}-${lines.length}`)?.focus(), 30);
  };
  const setLine = (i: number, patchLine: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patchLine } : l)));
    touch();
  };

  const body = () => ({
    supplierId: Number(header.supplierId),
    supplierInvoiceNo: header.supplierInvoiceNo,
    invoiceDate: header.invoiceDate,
    taxInclusive: header.taxInclusive,
    notes: header.notes || null,
    lines: lines.map((l) => ({
      productId: l.productId,
      entryUnit: l.entryUnit,
      enteredQty: Number(l.enteredQty),
      ...(l.mode === 'rate' ? { rate: Number(l.value) } : { amount: Number(l.value) }),
      discount: nz(l.discount),
      gstRate: nz(l.gstRate),
      batch: l.batch || null,
      expiry: l.expiry || null,
    })),
    charges: charges.map((c) => ({ chargeTypeId: Number(c.chargeTypeId), amount: Number(c.amount), paidTo: c.paidTo || null, referenceNo: c.referenceNo || null })),
    billDiscount: nz(billDiscount),
    invoiceTotal: invoiceTotal.trim() === '' ? null : Number(invoiceTotal),
  });

  const localProblem = (): string | null => {
    for (const [i, l] of lines.entries()) {
      if (!(Number(l.enteredQty) > 0)) return `Line ${i + 1} (${l.name}): enter the quantity`;
      if (l.value.trim() === '' || Number.isNaN(Number(l.value))) return `Line ${i + 1} (${l.name}): enter the ${l.mode === 'rate' ? 'rate' : 'line amount'}`;
    }
    for (const [i, c] of charges.entries()) {
      if (!c.chargeTypeId) return `Charge ${i + 1}: choose the type`;
      if (!(Number(c.amount) > 0)) return `Charge ${i + 1}: enter the amount`;
    }
    return null;
  };

  const save = async (): Promise<PDetail | null> => {
    const prob = localProblem();
    if (prob) {
      setErr(new Error(prob));
      return null;
    }
    setBusy('save');
    setErr(null);
    try {
      const r = await put<PDetail>(`/purchases/${p.id}`, body());
      setServer(r);
      setDirty(false);
      return r;
    } catch (e) {
      setErr(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Store keeper: hand over to a manager. Manager: post to stock. The same screen, different button. */
  const postIt = async (action: 'ready' | 'post') => {
    const saved = dirty ? await save() : server;
    if (!saved) return;
    setBusy('post');
    setErr(null);
    try {
      const r = await post<PDetail>(`/purchases/${p.id}/${action}`);
      if (action === 'post') toast(`Posted ${r.purchaseNo}. Stock updated.`);
      else toast('Marked ready. A manager can now post it to stock.');
      setServer(r);
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
      void qc.invalidateQueries({ queryKey: ['purchase', p.id] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const isManager = can(...MANAGE);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const diff = est.diff;
  const matched = diff !== null && Math.abs(diff) <= 1;
  const sc = server.computed;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Draft purchase #${p.id}`}
        subtitle={
          server.readyAt
            ? `Started by ${p.createdBy.fullName}, marked ready by ${server.readyBy?.fullName ?? 'the store keeper'}. Waiting for a manager to post it.`
            : `Started by ${p.createdBy.fullName}. Stock changes only when a manager posts it.`
        }
        actions={
          <>
            <Link to="/purchases">
              <Button variant="ghost">All purchases</Button>
            </Link>
            <Button variant="ghost" onClick={() => setDelOpen(true)}>
              Delete draft
            </Button>
            <Button busy={busy === 'save'} onClick={() => void save().then((r) => r && toast('Draft saved'))}>
              Save draft
            </Button>
            {isManager ? (
              <Button variant="primary" busy={busy === 'post'} disabled={!matched || lines.length === 0} onClick={() => void postIt('post')} title={matched ? '' : 'The total must match the supplier bill (within ₹1) before posting'}>
                Post to stock
              </Button>
            ) : (
              <Button variant="primary" busy={busy === 'post'} disabled={!matched || lines.length === 0 || (!dirty && !!server.readyAt)} onClick={() => void postIt('ready')} title={matched ? '' : 'The total must match the supplier bill (within ₹1) first'}>
                {!dirty && server.readyAt ? 'Ready for manager' : 'Mark ready for manager'}
              </Button>
            )}
          </>
        }
      />

      <Card title="Supplier bill">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier">
            {(id) => (
              <Select id={id} value={header.supplierId} onChange={(e) => (setHeader((h) => ({ ...h, supplierId: e.target.value })), touch())}>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Invoice / DC no">{(id) => <Input id={id} value={header.supplierInvoiceNo} onChange={(e) => (setHeader((h) => ({ ...h, supplierInvoiceNo: e.target.value })), touch())} className="font-mono" />}</Field>
          <Field label="Invoice date">{(id) => <Input id={id} type="date" max={todayIso()} value={header.invoiceDate} onChange={(e) => (setHeader((h) => ({ ...h, invoiceDate: e.target.value })), touch())} />}</Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Rates include GST" checked={header.taxInclusive} onChange={(v) => (setHeader((h) => ({ ...h, taxInclusive: v })), touch())} />
          </div>
        </div>
      </Card>

      <Card
        title="Items"
        actions={
          <span className="text-xs text-ink-mute">
            Enter boxes or pieces, then the rate <i>or</i> the line amount printed on the bill.
          </span>
        }
      >
        <Table>
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={th}>In</th>
              <th className={cx(th, 'text-right')}>Qty</th>
              <th className={th}>Enter</th>
              <th className={cx(th, 'text-right')}>Value ₹</th>
              <th className={cx(th, 'text-right')}>Disc ₹</th>
              <th className={cx(th, 'text-right')}>GST %</th>
              <th className={th}>Batch / expiry</th>
              <th className={cx(th, 'text-right')}>Pieces</th>
              <th className={cx(th, 'text-right')}>Landed / pc</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const base = l.entryUnit === 'PACK' ? nz(l.enteredQty) * l.packSize : nz(l.enteredQty);
              const landed = !dirty ? server.items[i]?.landedUnitCost : null;
              return (
                <tr key={l.key}>
                  <td className={cx(td, 'min-w-[180px]')}>
                    <div className="font-medium">{l.name}</div>
                    <div className="font-mono text-xs text-ink-mute">{l.code}</div>
                  </td>
                  <td className={cx(td, 'w-32')}>
                    <Select aria-label="Entry unit" compact value={l.entryUnit} onChange={(e) => setLine(i, { entryUnit: e.target.value as 'PACK' | 'BASE' })} disabled={!l.packUnit || l.packSize <= 1}>
                      <option value="BASE">{l.unit}</option>
                      {l.packUnit && l.packSize > 1 && <option value="PACK">{`${l.packUnit} of ${fmtQty(l.packSize)}`}</option>}
                    </Select>
                  </td>
                  <td className={cx(td, 'w-24')}>
                    <Input id={`qty-${l.productId}-${i}`} aria-label="Quantity" inputMode="decimal" className="text-right font-mono" value={l.enteredQty} onChange={(e) => setLine(i, { enteredQty: e.target.value })} />
                  </td>
                  <td className={cx(td, 'w-32')}>
                    <Select aria-label="Rate or amount" compact value={l.mode} onChange={(e) => setLine(i, { mode: e.target.value as 'rate' | 'amount' })}>
                      <option value="rate">Rate</option>
                      <option value="amount">Line amount</option>
                    </Select>
                  </td>
                  <td className={cx(td, 'w-28')}>
                    <Input aria-label={l.mode === 'rate' ? 'Rate' : 'Line amount'} inputMode="decimal" className="text-right font-mono" value={l.value} onChange={(e) => setLine(i, { value: e.target.value })} />
                  </td>
                  <td className={cx(td, 'w-24')}>
                    <Input aria-label="Discount" inputMode="decimal" className="text-right font-mono" value={l.discount} placeholder="0" onChange={(e) => setLine(i, { discount: e.target.value })} />
                  </td>
                  <td className={cx(td, 'w-24')}>
                    <Select aria-label="GST rate" compact value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })}>
                      {['0', '5', '12', '18', '28'].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={cx(td, 'w-40')}>
                    <div className="flex flex-col gap-1">
                      <Input aria-label="Batch" className="h-8" value={l.batch} placeholder="batch" onChange={(e) => setLine(i, { batch: e.target.value })} maxLength={30} />
                      <Input aria-label="Expiry" className="h-8" type="date" value={l.expiry} onChange={(e) => setLine(i, { expiry: e.target.value })} />
                    </div>
                  </td>
                  <td className={cx(td, num, !l.allowDecimal && !Number.isInteger(base) && 'text-rose-700')}>
                    {fmtQty(base)} {l.unit}
                  </td>
                  <td className={cx(td, num)}>{landed !== null && landed !== undefined ? money(landed) : <span className="text-ink-mute">save</span>}</td>
                  <td className={td}>
                    <button className="rounded px-2 py-1 text-ink-mute hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${l.name}`} onClick={() => (setLines((ls) => ls.filter((_, j) => j !== i)), touch())}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="relative flex flex-wrap items-end gap-2 border-t border-line p-3">
          <Field label="Add item" className="min-w-[260px] flex-1">
            {(id) => (
              <Input
                id={id}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, code or barcode"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hits[0]) {
                    e.preventDefault();
                    addLine(hits[0]);
                  }
                }}
              />
            )}
          </Field>
          <Button onClick={() => setNewProduct(search)}>New product</Button>
          {search.trim() && (
            <ul className="absolute left-3 right-3 top-full z-20 -mt-2 max-h-72 overflow-auto rounded-md border border-line bg-white shadow-lg">
              {hits.map((h) => (
                <li key={h.id}>
                  <button className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onMouseDown={(e) => (e.preventDefault(), addLine(h))}>
                    <span className="w-16 font-mono text-xs text-ink-mute">{h.code}</span>
                    <span className="flex-1">{h.name}</span>
                    <span className="font-mono text-xs text-ink-mute">
                      stock {fmtQty(h.onHand)} {h.unit}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button className="w-full px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50" onMouseDown={(e) => (e.preventDefault(), setNewProduct(search))}>
                  + Create “{search.trim()}” as a new product
                </button>
              </li>
            </ul>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Charges on this bill"
          actions={
            <Button size="sm" onClick={() => (setCharges((c) => [...c, { key: crypto.randomUUID(), chargeTypeId: String(chargeTypes.data?.[0]?.id ?? ''), amount: '', paidTo: '', referenceNo: '' }]), touch())}>
              Add charge
            </Button>
          }
        >
          {charges.length === 0 ? (
            <p className="p-4 text-sm text-ink-mute">Transport, loading, courier and other charges. Add as many as the bill has. Charges that count as cost are spread into each item's landed cost.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Type</th>
                  <th className={cx(th, 'text-right')}>Amount ₹</th>
                  <th className={th}>Paid to / transporter</th>
                  <th className={th}>LR / reference no</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {charges.map((c, i) => {
                  const ct = chargeTypes.data?.find((x) => String(x.id) === c.chargeTypeId);
                  return (
                    <tr key={c.key}>
                      <td className={cx(td, 'w-48')}>
                        <Select aria-label="Charge type" value={c.chargeTypeId} onChange={(e) => (setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, chargeTypeId: e.target.value } : x))), touch())}>
                          {chargeTypes.data?.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                        {ct && <div className="mt-1 text-xs text-ink-mute">{ct.addsToCost && ct.allocation !== 'NONE' ? `Into cost ${ct.allocation === 'BY_QTY' ? 'by quantity' : 'by value'}` : 'Not added to item cost'}</div>}
                      </td>
                      <td className={cx(td, 'w-32')}>
                        <Input aria-label="Charge amount" inputMode="decimal" className="text-right font-mono" value={c.amount} onChange={(e) => (setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))), touch())} />
                      </td>
                      <td className={td}>
                        <Input aria-label="Paid to" value={c.paidTo} maxLength={80} onChange={(e) => (setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, paidTo: e.target.value } : x))), touch())} />
                      </td>
                      <td className={td}>
                        <Input aria-label="Reference number" value={c.referenceNo} maxLength={40} onChange={(e) => (setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, referenceNo: e.target.value } : x))), touch())} />
                      </td>
                      <td className={td}>
                        <button className="rounded px-2 py-1 text-ink-mute hover:bg-rose-50 hover:text-rose-700" aria-label="Remove charge" onClick={() => (setCharges((cs) => cs.filter((_, j) => j !== i)), touch())}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Totals">
          <div className="space-y-3 p-4">
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-sm">
              <dt className="font-sans text-ink-mute">Items</dt>
              <dd className="text-right">{money(est.items)}</dd>
              <dt className="font-sans text-ink-mute">Charges</dt>
              <dd className="text-right">{money(est.charges)}</dd>
              <dt className="font-sans text-ink-mute">Bill discount</dt>
              <dd className="text-right">
                <Input aria-label="Bill discount" inputMode="decimal" className="h-8 text-right font-mono" value={billDiscount} placeholder="0" onChange={(e) => (setBillDiscount(e.target.value), touch())} />
              </dd>
              <dt className="font-sans font-semibold">Computed total</dt>
              <dd className="text-right font-semibold">{money(est.total)}</dd>
            </dl>
            <Field label="Grand total printed on the supplier bill">
              {(id) => <Input id={id} inputMode="decimal" className="h-12 text-right font-mono text-xl" value={invoiceTotal} onChange={(e) => (setInvoiceTotal(e.target.value), touch())} />}
            </Field>
            <div className={cx('rounded-md px-3 py-2 text-sm', diff === null ? 'bg-paper text-ink-mute' : matched ? 'bg-navy-50 text-navy-700' : 'bg-rose-50 text-rose-700')}>
              {diff === null ? (
                'Type the bill total to check it.'
              ) : matched ? (
                <>Matches the supplier bill{diff !== 0 && <> (round-off {money(diff)})</>}. Ready to post.</>
              ) : (
                <>
                  Difference <b className="font-mono">₹{money(diff)}</b>. Check quantities, rates, charges and discount. Posting is blocked until this is within ₹1.
                </>
              )}
            </div>
            {!dirty && sc && (
              <p className="text-xs text-ink-mute">
                Saved figures: items {money(sc.itemsTotal)}, GST {money(sc.taxTotal)}, charges {money(sc.chargesTotal)}, total {money(sc.computedTotal)}.
              </p>
            )}
            {dirty && <p className="text-xs text-amber-700">Unsaved changes. Save to see landed cost per item.</p>}
            <ErrorBox error={err instanceof ApiError && err.code === 'TOTAL_MISMATCH' ? new Error(err.message) : err} />
          </div>
        </Card>
      </div>

      <Modal open={newProduct !== null} onClose={() => setNewProduct(null)} title="New product" side>
        {newProduct !== null && (
          <ProductForm
            initialName={newProduct}
            onCancel={() => setNewProduct(null)}
            onSaved={(prod) => {
              toast(`${prod.name} added as code ${prod.code}`);
              setNewProduct(null);
              void qc.invalidateQueries({ queryKey: ['catalogue'] });
              addLine(prod);
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete this draft?"
        message="The draft and its lines are removed. Stock was never changed by it."
        confirmLabel="Delete draft"
        danger
        onConfirm={async () => {
          await del(`/purchases/${p.id}`);
          void qc.invalidateQueries({ queryKey: ['purchases'] });
          nav('/purchases');
        }}
      />
    </div>
  );
}

/** FR-16: choose how many labels per purchase line (default: the pieces received), then print an A4 label sheet. */
function LabelsDialog({ open, onClose, items }: { open: boolean; onClose: () => void; items: PItem[] }) {
  const cat = useCatalogue();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<{ storeName: string }>('/settings'), staleTime: 60_000, enabled: open });
  const [copies, setCopies] = useState<Record<number, string>>({});
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setErr(null);
      setCopies(Object.fromEntries(items.map((i) => [i.id, String(Math.max(0, Math.floor(Number(i.baseQty) - Number(i.returnedQty))))])));
    }
  }, [open, items]);
  const byId = cat.byId;
  const total = items.reduce((a, i) => a + (Number(copies[i.id]) || 0), 0);
  const go = async () => {
    setErr(null);
    const bad = items.find((i) => {
      const v = copies[i.id] ?? '';
      return v !== '' && (!/^\d+$/.test(v) || Number(v) > MAX_LABELS);
    });
    if (bad) return setErr(new Error(`${bad.product.name}: enter a whole number of labels from 0 to ${MAX_LABELS}.`));
    const list: LabelItem[] = items
      .filter((i) => Number(copies[i.id]) > 0)
      .map((i) => {
        const c = byId.get(i.productId);
        return { name: i.product.name, code: i.product.code, barcode: c?.barcode ?? null, price: Number(c?.salePrice ?? 0), mrp: c?.mrp ?? null, copies: Number(copies[i.id]) };
      });
    try {
      await printLabels(list, settings.data?.storeName ?? 'General Store');
      onClose();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print barcode labels"
      wide
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" onClick={() => void go()} disabled={!cat.data}>
            Print {total} label{total === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-mute">One label per piece received is filled in. Change any number, or set 0 to skip an item. Prints on an A4 sheet of 24 stickers (3 × 8).</p>
      <Table>
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={th}>Barcode on label</th>
            <th className={cx(th, 'text-right')}>Price</th>
            <th className={cx(th, 'text-right')}>Labels</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const c = byId.get(i.productId);
            return (
              <tr key={i.id}>
                <td className={td}>{i.product.name}</td>
                <td className={cx(td, 'font-mono text-xs')}>{c?.barcode || i.product.code}</td>
                <td className={cx(td, num)}>{c ? money(c.salePrice) : ''}</td>
                <td className={cx(td, 'w-28')}>
                  <Input aria-label={`Labels for ${i.product.name}`} inputMode="numeric" className="h-9 text-right font-mono" value={copies[i.id] ?? ''} onChange={(e) => setCopies((x) => ({ ...x, [i.id]: e.target.value.trim() }))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="mt-3">
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function PostedView({ p }: { p: PDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retOpen, setRetOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['purchase', p.id] });
    void qc.invalidateQueries({ queryKey: ['purchases'] });
    void qc.invalidateQueries({ queryKey: ['catalogue'] });
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${p.purchaseNo} · ${p.supplier.name}`}
        subtitle={`Invoice ${p.supplierInvoiceNo} dated ${date(p.invoiceDate)} · posted ${dateTime(p.postedAt)} by ${p.postedBy?.fullName ?? ''}`}
        actions={
          <>
            <Link to="/purchases">
              <Button variant="ghost">All purchases</Button>
            </Link>
            {p.status === 'POSTED' && <Button onClick={() => setLabelsOpen(true)}>Print barcode labels</Button>}
            {p.status === 'POSTED' && can(...MANAGE) && <Button onClick={() => setRetOpen(true)}>Return to supplier</Button>}
            {p.status === 'POSTED' && can(...MANAGE) && p.returns.length === 0 && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel purchase
              </Button>
            )}
          </>
        }
      />
      {p.status === 'CANCELLED' && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">Cancelled: {p.cancelReason}. Its stock was taken back out.</p>}
      <LabelsDialog open={labelsOpen} onClose={() => setLabelsOpen(false)} items={p.items} />
      <Card>
        <Table>
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={cx(th, 'text-right')}>Entered</th>
              <th className={cx(th, 'text-right')}>Pieces</th>
              <th className={cx(th, 'text-right')}>Rate</th>
              <th className={cx(th, 'text-right')}>Amount</th>
              <th className={cx(th, 'text-right')}>Disc</th>
              <th className={cx(th, 'text-right')}>GST</th>
              <th className={cx(th, 'text-right')}>Line total</th>
              <th className={cx(th, 'text-right')}>Landed / pc</th>
              <th className={cx(th, 'text-right')}>Returned</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td className={td}>
                  {i.product.name}
                  <div className="font-mono text-xs text-ink-mute">
                    {i.product.code}
                    {i.batch && ` · batch ${i.batch}`}
                    {i.expiry && ` · exp ${date(i.expiry)}`}
                  </div>
                </td>
                <td className={cx(td, num)}>
                  {fmtQty(i.enteredQty)} {i.entryUnit === 'PACK' ? i.product.packUnit?.code : i.product.unit.code}
                </td>
                <td className={cx(td, num)}>{fmtQty(i.baseQty)}</td>
                <td className={cx(td, num)}>{Number(i.rate).toFixed(4)}</td>
                <td className={cx(td, num)}>{money(i.grossAmount)}</td>
                <td className={cx(td, num)}>{Number(i.discount) ? money(i.discount) : ''}</td>
                <td className={cx(td, num)}>{Number(i.taxAmount) ? money(i.taxAmount) : ''}</td>
                <td className={cx(td, num)}>{money(i.lineTotal)}</td>
                <td className={cx(td, num, 'text-navy-700')}>{i.landedUnitCost === null ? '' : money(i.landedUnitCost)}</td>
                <td className={cx(td, num)}>{Number(i.returnedQty) ? fmtQty(i.returnedQty) : ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Charges">
          {p.charges.length === 0 ? (
            <p className="p-4 text-sm text-ink-mute">No charges.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {p.charges.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 px-4 py-2">
                  <span>
                    {c.chargeType.name}
                    {c.paidTo && ` · ${c.paidTo}`}
                    {c.referenceNo && ` · LR ${c.referenceNo}`}
                  </span>
                  <span className="font-mono">{money(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Totals">
          <dl className="grid grid-cols-2 gap-y-1 p-4 font-mono text-sm">
            <dt className="font-sans text-ink-mute">Items</dt>
            <dd className="text-right">{money(p.computed.itemsTotal)}</dd>
            <dt className="font-sans text-ink-mute">Charges</dt>
            <dd className="text-right">{money(p.computed.chargesTotal)}</dd>
            {Number(p.discountTotal) > 0 && (
              <>
                <dt className="font-sans text-ink-mute">Bill discount</dt>
                <dd className="text-right">−{money(p.discountTotal)}</dd>
              </>
            )}
            <dt className="font-sans text-ink-mute">Round off</dt>
            <dd className="text-right">{money(p.roundOff)}</dd>
            <dt className="font-sans font-semibold">Grand total</dt>
            <dd className="text-right font-semibold">₹{money(p.grandTotal)}</dd>
            <dt className="font-sans text-ink-mute">Supplier bill</dt>
            <dd className="text-right">{p.invoiceTotal === null ? '' : money(p.invoiceTotal)}</dd>
          </dl>
        </Card>
      </div>
      {p.returns.length > 0 && (
        <Card title="Returns to supplier">
          <ul className="divide-y divide-line text-sm">
            {p.returns.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-4 py-2">
                <span>
                  {r.returnNo} · {dateTime(r.createdAt)} · {r.user.fullName} · {r.reason}
                </span>
                <span className="font-mono">₹{money(r.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${p.purchaseNo}?`}
        message="Every item's quantity is taken back out of stock. Use this only when the bill was entered by mistake. To send goods back, use Return to supplier instead."
        confirmLabel="Cancel purchase"
        danger
        needReason
        onConfirm={async (reason) => {
          await post(`/purchases/${p.id}/cancel`, { reason });
          toast('Purchase cancelled');
          refresh();
        }}
      />
      {retOpen && (
        <PurchaseReturnDialog
          p={p}
          onClose={() => setRetOpen(false)}
          onDone={() => {
            setRetOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function PurchaseReturnDialog({ p, onClose, onDone }: { p: PDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const items = Object.entries(qtys)
    .map(([k, v]) => ({ purchaseItemId: Number(k), baseQty: Number(v) }))
    .filter((x) => x.baseQty > 0);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ returnNo: string; total: number }>(`/purchases/${p.id}/returns`, { items, reason });
      toast(`${r.returnNo}: ₹${money(r.total)} to recover from ${p.supplier.name}`);
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Return goods to supplier"
      wide
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" busy={busy} disabled={!items.length || reason.trim().length < 3} onClick={go}>
            Record return
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-mute">Quantities are in selling units (pieces).</p>
      <Table>
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={cx(th, 'text-right')}>Received</th>
            <th className={cx(th, 'text-right')}>Already returned</th>
            <th className={cx(th, 'text-right')}>Return now</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => {
            const left = Number(i.baseQty) - Number(i.returnedQty);
            return (
              <tr key={i.id}>
                <td className={td}>{i.product.name}</td>
                <td className={cx(td, num)}>{fmtQty(i.baseQty)}</td>
                <td className={cx(td, num)}>{fmtQty(i.returnedQty)}</td>
                <td className={cx(td, 'w-28')}>
                  <Input aria-label={`Return quantity for ${i.product.name}`} inputMode="decimal" className="text-right font-mono" disabled={left <= 0} placeholder={`max ${fmtQty(left)}`} value={qtys[i.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="mt-4">
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Damaged in transit" />}</Field>
      </div>
      <div className="mt-3">
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

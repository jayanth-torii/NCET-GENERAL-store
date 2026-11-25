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
import { AlertTriangle, ArrowLeft, Ban, Barcode, Boxes, Check, CheckCircle2, FileText, IndianRupee, Info, PackageCheck, PackagePlus, Plus, Receipt, Save as SaveIcon, ScanBarcode, Send, Trash2, Truck, Undo2 } from 'lucide-react';
import { Avatar, Button, Card, Checkbox, ConfirmDialog, cx, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Select, StatTile, Table, td, th, useToast } from '../components/ui';

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
  salePrice: number | null;
  mrp: number | null;
  returnedQty: number;
  product: { code: string; name: string; salePrice: number; mrp: number | null; unit: { code: string; allowDecimal: boolean }; packUnit: { code: string } | null; packSize: number };
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
  salePrice: string; // new selling price; blank keeps the current one
  mrp: string;
  curPrice: number; // product master price now, shown as the hint
  curMrp: number | null;
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
      salePrice: i.salePrice === null ? '' : String(Number(i.salePrice)),
      mrp: i.mrp === null ? '' : String(Number(i.mrp)),
      curPrice: Number(i.product.salePrice),
      curMrp: i.product.mrp === null ? null : Number(i.product.mrp),
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
    const common = { id: c.id, code: c.code, name: c.name, allowDecimal: c.allowDecimal, packSize: Number(c.packSize), gstRate: Number(c.gstRate), lastCost: c.lastCost, salePrice: Number(c.salePrice), mrp: c.mrp === null ? null : Number(c.mrp) };
    const item = 'unitCode' in c ? { ...common, unit: c.unitCode, packUnit: c.packUnitCode } : { ...common, unit: c.unit, packUnit: c.packUnit };
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
        salePrice: '',
        mrp: '',
        curPrice: item.salePrice,
        curMrp: item.mrp,
      },
    ]);
    setSearch('');
    touch();
    // Jump to the new line's quantity, but only if the user has not already moved on: a fast typist
    // who clicked into another box within these 30 ms would otherwise have keystrokes land in Quantity.
    const from = document.activeElement;
    setTimeout(() => {
      const now = document.activeElement;
      if (now === from || now === document.body || now === null) document.getElementById(`qty-${item.id}-${lines.length}`)?.focus();
    }, 30);
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
      salePrice: l.salePrice.trim() === '' ? null : Number(l.salePrice),
      mrp: l.mrp.trim() === '' ? null : Number(l.mrp),
    })),
    charges: charges.map((c) => ({ chargeTypeId: Number(c.chargeTypeId), amount: Number(c.amount), paidTo: c.paidTo || null, referenceNo: c.referenceNo || null })),
    billDiscount: nz(billDiscount),
    invoiceTotal: invoiceTotal.trim() === '' ? null : Number(invoiceTotal),
  });

  const localProblem = (): string | null => {
    for (const [i, l] of lines.entries()) {
      if (!(Number(l.enteredQty) > 0)) return `Line ${i + 1} (${l.name}): enter the quantity`;
      if (l.value.trim() === '' || Number.isNaN(Number(l.value))) return `Line ${i + 1} (${l.name}): enter the ${l.mode === 'rate' ? 'rate' : 'line amount'}`;
      const sp = l.salePrice.trim() === '' ? null : Number(l.salePrice);
      const mrp = l.mrp.trim() === '' ? l.curMrp : Number(l.mrp);
      if (sp !== null && !(sp > 0)) return `Line ${i + 1} (${l.name}): sale price must be more than zero`;
      if (l.mrp.trim() !== '' && !(Number(l.mrp) > 0)) return `Line ${i + 1} (${l.name}): MRP must be more than zero`;
      if (mrp !== null && (sp ?? l.curPrice) > mrp) return `Line ${i + 1} (${l.name}): sale price ${sp ?? l.curPrice} is above the MRP ${mrp}`;
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

  const lineReady = (l: LineForm) => Number(l.enteredQty) > 0 && l.value.trim() !== '' && !Number.isNaN(Number(l.value));
  const steps: { id: string; label: string; done: boolean; note: string }[] = [
    { id: 'step-bill', label: 'Supplier bill', done: !!header.supplierId && header.supplierInvoiceNo.trim() !== '' && invoiceTotal.trim() !== '', note: 'Supplier, invoice no, amount' },
    { id: 'step-items', label: 'Items', done: lines.length > 0 && lines.every(lineReady), note: lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'Add from the bill' },
    { id: 'step-charges', label: 'Charges', done: charges.every((c) => Number(c.amount) > 0), note: charges.length ? `${charges.length} added` : 'Optional' },
    { id: 'step-totals', label: 'Totals match', done: matched, note: diff === null ? 'Needs invoice amount' : matched ? 'Within ₹1' : `Off by ₹${money(Math.abs(diff))}` },
    { id: 'step-totals', label: isManager ? 'Posting' : 'Hand to manager', done: !dirty && !!server.readyAt, note: isManager ? 'Stock goes up' : server.readyAt ? 'Handed over' : 'Mark it ready' },
  ];
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const inv = invoiceTotal.trim() === '' ? null : Number(invoiceTotal);
  const meter = inv && inv > 0 ? Math.min(100, (est.total / inv) * 100) : 0;
  const addCharge = (chargeTypeId: string) => (setCharges((c) => [...c, { key: crypto.randomUUID(), chargeTypeId, amount: '', paidTo: '', referenceNo: '' }]), touch());

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${p.purchaseNo ?? `Draft #${p.id}`} · draft purchase`}
        subtitle={
          server.readyAt
            ? `Started by ${p.createdBy.fullName}, marked ready by ${server.readyBy?.fullName ?? 'the store keeper'}. Waiting for a manager to post it.`
            : `Started by ${p.createdBy.fullName}. Stock changes only when a manager posts it.`
        }
        actions={
          <>
            <Link to="/purchases">
              <Button variant="ghost">
                <ArrowLeft aria-hidden /> All purchases
              </Button>
            </Link>
            <Button variant="ghost" className="hover:!text-rose-700" onClick={() => setDelOpen(true)}>
              <Trash2 aria-hidden /> Delete draft
            </Button>
            <Button busy={busy === 'save'} onClick={() => void save().then((r) => r && toast('Draft saved'))}>
              <SaveIcon aria-hidden /> Save draft
              {dirty && <span className="size-2 rounded-full bg-amber-500" title="Unsaved changes" />}
            </Button>
          </>
        }
      />

      {/* progress */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {steps.map((s, i) => {
          const current = !s.done && steps.slice(0, i).every((x) => x.done);
          return (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => go(s.id)}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift',
                  s.done ? 'border-leaf-600/25 bg-leaf-50' : current ? 'border-brand-500/50 bg-brand-500/[0.06] ring-2 ring-brand-500/10' : 'border-line bg-surface',
                )}
              >
                <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', s.done ? 'bg-leaf-600 text-white' : current ? 'bg-main text-main-fg' : 'bg-ink/[0.07] text-ink-mute')}>
                  {s.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cx('block truncate text-sm font-semibold', s.done ? 'text-leaf-700' : 'text-ink')}>{s.label}</span>
                  <span className="block truncate text-[11px] text-ink-mute">{s.note}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section id="step-bill" className="scroll-mt-24">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-600" aria-hidden /> Supplier bill
                </span>
              }
              actions={p.purchaseNo && <span className="rounded-md bg-main px-2.5 py-1 font-mono text-sm font-semibold text-main-fg">GRN No: {p.purchaseNo}</span>}
            >
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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
                {(() => {
                  const s = suppliers.data?.find((x) => String(x.id) === header.supplierId);
                  return (
                    <div className="col-span-full -mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-mute sm:order-last">
                      <span className={cx('rounded-md px-2 py-0.5 font-mono', s?.gstin ? 'bg-leaf-50 text-leaf-700' : 'bg-ink/[0.05]')}>GST no: {s?.gstin ?? 'not registered'}</span>
                      {s?.phone && <span className="rounded-md bg-ink/[0.05] px-2 py-0.5 font-mono">Ph {s.phone}</span>}
                    </div>
                  );
                })()}
                <Field label="Invoice / DC no">{(id) => <Input id={id} value={header.supplierInvoiceNo} onChange={(e) => (setHeader((h) => ({ ...h, supplierInvoiceNo: e.target.value })), touch())} className="font-mono" />}</Field>
                <Field label="Invoice date">{(id) => <Input id={id} type="date" max={todayIso()} value={header.invoiceDate} onChange={(e) => (setHeader((h) => ({ ...h, invoiceDate: e.target.value })), touch())} />}</Field>
                <Field label="Invoice amount ₹">
                  {(id) => <Input id={id} inputMode="decimal" className="text-right font-mono font-semibold" value={invoiceTotal} placeholder="Bill grand total" onChange={(e) => (setInvoiceTotal(e.target.value), touch())} />}
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox label="Rates include GST" checked={header.taxInclusive} onChange={(v) => (setHeader((h) => ({ ...h, taxInclusive: v })), touch())} />
                </div>
              </div>
            </Card>
          </section>

          <section id="step-items" className="scroll-mt-24">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-brand-600" aria-hidden /> Items
                  {lines.length > 0 && <span className="rounded-full bg-main px-2 py-0.5 text-[11px] font-semibold text-main-fg">{lines.length}</span>}
                </span>
              }
            >
              <p className="flex items-start gap-2 px-5 pb-3 text-xs text-ink-mute">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Enter boxes or pieces, then the rate <i>or</i> the line amount printed on the bill. A new sale price / MRP is applied when the GRN is posted; leave blank to keep the current one.
                </span>
              </p>
              {lines.length === 0 ? (
                <div className="mx-4 mb-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
                    <PackagePlus className="h-6 w-6" aria-hidden />
                  </span>
                  <p className="text-sm font-medium">No items yet</p>
                  <p className="text-xs text-ink-mute">Search below for the first item on the supplier bill, or create a new product.</p>
                </div>
              ) : (
                <Table cards={false}>
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
                      <th className={cx(th, 'text-right')}>Sale price ₹</th>
                      <th className={cx(th, 'text-right')}>MRP ₹</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const base = l.entryUnit === 'PACK' ? nz(l.enteredQty) * l.packSize : nz(l.enteredQty);
                      const landed = !dirty ? server.items[i]?.landedUnitCost : null;
                      return (
                        <tr key={l.key} className="animate-row-in">
                          <td className={cx(td, 'min-w-[200px] !whitespace-normal')}>
                            <span className="flex items-center gap-2.5">
                              <Avatar name={l.name} size="sm" />
                              <span className="min-w-0">
                                <span className="block font-medium leading-snug">{l.name}</span>
                                <span className="font-mono text-xs text-ink-mute">{l.code}</span>
                              </span>
                            </span>
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
                          <td className={cx(td, num)}>{landed !== null && landed !== undefined ? <span className="font-semibold text-brand-700">{money(landed)}</span> : <span className="text-ink-mute">save</span>}</td>
                          <td className={cx(td, 'w-28')}>
                            <Input aria-label="Sale price" inputMode="decimal" className="text-right font-mono" value={l.salePrice} placeholder={money(l.curPrice)} onChange={(e) => setLine(i, { salePrice: e.target.value })} />
                            {(() => {
                              const sp = l.salePrice.trim() === '' ? l.curPrice : Number(l.salePrice);
                              const cost = landed !== null && landed !== undefined ? Number(landed) : null;
                              if (cost === null || !(sp > 0)) return <div className="mt-0.5 text-right text-[11px] text-ink-mute">now {money(l.curPrice)}</div>;
                              const m = ((sp - cost) / sp) * 100;
                              return <div className={cx('mt-0.5 text-right text-[11px] font-medium', m < 0 ? 'text-rose-700' : 'text-leaf-700')}>margin {m.toFixed(1)}%</div>;
                            })()}
                          </td>
                          <td className={cx(td, 'w-28')}>
                            <Input aria-label="MRP" inputMode="decimal" className="text-right font-mono" value={l.mrp} placeholder={l.curMrp === null ? '—' : money(l.curMrp)} onChange={(e) => setLine(i, { mrp: e.target.value })} />
                          </td>
                          <td className={td}>
                            <button className="rounded-md p-1.5 text-ink-mute transition-colors hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${l.name}`} onClick={() => (setLines((ls) => ls.filter((_, j) => j !== i)), touch())}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              <div className="relative flex flex-wrap items-end gap-2 border-t border-line bg-surface/60 p-3">
                <Field label="Add item" className="min-w-[260px] flex-1">
                  {(id) => (
                    <div className="relative">
                      <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-600" aria-hidden />
                      <Input
                        id={id}
                        className="pl-9"
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
                    </div>
                  )}
                </Field>
                <Button onClick={() => setNewProduct(search)}>
                  <Plus aria-hidden /> New product
                </Button>
                {search.trim() && (
                  <ul className="absolute left-3 right-3 top-full z-20 -mt-2 max-h-72 animate-pop-in overflow-auto rounded-xl border border-line bg-page p-1.5 shadow-pop">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-brand-500/10" onMouseDown={(e) => (e.preventDefault(), addLine(h))}>
                          <Avatar name={h.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{h.name}</span>
                            <span className="font-mono text-xs text-ink-mute">{h.code}</span>
                          </span>
                          <span className={cx('rounded-md px-2 py-0.5 font-mono text-xs', Number(h.onHand) <= 0 ? 'bg-rose-50 text-rose-700' : 'bg-leaf-50 text-leaf-700')}>
                            stock {fmtQty(h.onHand)} {h.unit}
                          </span>
                        </button>
                      </li>
                    ))}
                    <li>
                      <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-500/10" onMouseDown={(e) => (e.preventDefault(), setNewProduct(search))}>
                        <Plus className="h-4 w-4" aria-hidden /> Create “{search.trim()}” as a new product
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            </Card>
          </section>

          <section id="step-charges" className="scroll-mt-24">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-brand-600" aria-hidden /> Charges on this bill
                </span>
              }
              actions={
                <Button size="sm" onClick={() => addCharge(String(chargeTypes.data?.[0]?.id ?? ''))}>
                  <Plus aria-hidden /> Add charge
                </Button>
              }
            >
              {charges.length === 0 ? (
                <div className="px-5 pb-4">
                  <p className="text-sm text-ink-mute">Transport, loading, courier and other charges. Add as many as the bill has. Charges that count as cost are spread into each item's landed cost.</p>
                  {(chargeTypes.data?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {chargeTypes.data!.map((t) => (
                        <button key={t.id} type="button" onClick={() => addCharge(String(t.id))} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-brand-500/40 px-3 text-xs font-medium text-brand-700 transition-colors hover:border-solid hover:bg-brand-500/10">
                          <Plus className="h-3 w-3" aria-hidden /> {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Table cards={false}>
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
                        <tr key={c.key} className="animate-row-in">
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
                            <button className="rounded-md p-1.5 text-ink-mute transition-colors hover:bg-rose-50 hover:text-rose-700" aria-label="Remove charge" onClick={() => (setCharges((cs) => cs.filter((_, j) => j !== i)), touch())}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </section>
        </div>

        {/* sticky totals + the one action that moves the GRN forward */}
        <section id="step-totals" className="scroll-mt-24">
          <div className="space-y-3 xl:sticky xl:top-20 xl:max-h-[calc(100svh-6rem)] xl:overflow-y-auto">
            <div className="overflow-hidden rounded-xl border border-line bg-paper shadow-card">
              <div className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 px-5 py-3.5 text-white">
                <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-brand-400/25 blur-2xl" />
                <div className="relative text-xs font-medium uppercase tracking-wider text-white/70">Computed total</div>
                <div key={est.total} className="relative animate-bump origin-left font-mono text-4xl font-semibold tabular-nums">₹{money(est.total)}</div>
                <div className="relative mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-white/70">
                    <span>against supplier bill</span>
                    <span className="font-mono">{inv === null ? '—' : `₹${money(inv)}`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/15">
                    <div className={cx('h-full rounded-full transition-all duration-500', matched ? 'bg-leaf-500' : 'bg-amber-500')} style={{ width: `${meter}%` }} />
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <div className={cx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', diff === null ? 'border-line bg-surface text-ink-mute' : matched ? 'border-leaf-600/25 bg-leaf-50 text-leaf-700' : 'border-rose-600/25 bg-rose-50 text-rose-700')}>
                  {diff === null ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : matched ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span>
                    {diff === null ? (
                      'Type the invoice amount (top of the page) to check it.'
                    ) : matched ? (
                      <>Matches the supplier bill{diff !== 0 && <> (round-off {money(diff)})</>}. Ready to post.</>
                    ) : (
                      <>
                        Difference <b className="font-mono">₹{money(diff)}</b>. Check quantities, rates, charges and discount. Posting is blocked until this is within ₹1.
                      </>
                    )}
                  </span>
                </div>
                {isManager ? (
                  <Button variant="primary" size="lg" className="h-12 w-full" busy={busy === 'post'} disabled={!matched || lines.length === 0} onClick={() => void postIt('post')} title={matched ? '' : 'The total must match the supplier bill (within ₹1) before posting'}>
                    <PackageCheck aria-hidden /> Post to stock
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" className="h-12 w-full" busy={busy === 'post'} disabled={!matched || lines.length === 0 || (!dirty && !!server.readyAt)} onClick={() => void postIt('ready')} title={matched ? '' : 'The total must match the supplier bill (within ₹1) first'}>
                    <Send aria-hidden /> {!dirty && server.readyAt ? 'Ready for manager' : 'Mark ready for manager'}
                  </Button>
                )}
                <dl className="grid grid-cols-2 items-center gap-y-1.5 font-mono text-sm">
                  <dt className="font-sans text-ink-mute">Items</dt>
                  <dd className="text-right">{money(est.items)}</dd>
                  <dt className="font-sans text-ink-mute">Charges</dt>
                  <dd className="text-right">{money(est.charges)}</dd>
                  <dt className="font-sans text-ink-mute">Bill discount</dt>
                  <dd className="text-right">
                    <Input aria-label="Bill discount" inputMode="decimal" className="h-8 text-right font-mono" value={billDiscount} placeholder="0" onChange={(e) => (setBillDiscount(e.target.value), touch())} />
                  </dd>
                  <dt className="border-t border-line pt-1.5 font-sans font-semibold">Computed total</dt>
                  <dd className="border-t border-line pt-1.5 text-right font-semibold">{money(est.total)}</dd>
                </dl>
                <div className="flex items-baseline justify-between rounded-lg bg-surface px-3 py-2">
                  <span className="text-sm text-ink-mute">Invoice amount (supplier bill)</span>
                  <span className="font-mono text-xl font-semibold">{invoiceTotal.trim() === '' ? '—' : money(Number(invoiceTotal))}</span>
                </div>
                {!dirty && sc && (
                  <p className="text-xs text-ink-mute">
                    Saved figures: items {money(sc.itemsTotal)}, GST {money(sc.taxTotal)}, charges {money(sc.chargesTotal)}, total {money(sc.computedTotal)}.
                  </p>
                )}
                {dirty && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <span className="size-2 rounded-full bg-amber-500" /> Unsaved changes. Save to see landed cost per item.
                  </p>
                )}
                <ErrorBox error={err instanceof ApiError && err.code === 'TOTAL_MISMATCH' ? new Error(err.message) : err} />
              </div>
            </div>
          </div>
        </section>
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
  // Edits only: the default (one label per piece received) is derived during render, so the dialog
  // never shows "Print 0 labels" for a moment before an effect fills the numbers in.
  useEffect(() => {
    if (open) {
      setErr(null);
      setCopies({});
    }
  }, [open]);
  const copiesOf = (i: PItem) => copies[i.id] ?? String(Math.max(0, Math.floor(Number(i.baseQty) - Number(i.returnedQty))));
  const byId = cat.byId;
  const total = items.reduce((a, i) => a + (Number(copiesOf(i)) || 0), 0);
  const go = async () => {
    setErr(null);
    const bad = items.find((i) => {
      const v = copiesOf(i);
      return v !== '' && (!/^\d+$/.test(v) || Number(v) > MAX_LABELS);
    });
    if (bad) return setErr(new Error(`${bad.product.name}: enter a whole number of labels from 0 to ${MAX_LABELS}.`));
    const list: LabelItem[] = items
      .filter((i) => Number(copiesOf(i)) > 0)
      .map((i) => {
        const c = byId.get(i.productId);
        return { name: i.product.name, code: i.product.code, barcode: c?.barcode ?? null, price: Number(c?.salePrice ?? 0), mrp: c?.mrp ?? null, copies: Number(copiesOf(i)) };
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
      <Table cards={false}>
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
                  <Input aria-label={`Labels for ${i.product.name}`} inputMode="numeric" className="h-9 text-right font-mono" value={copiesOf(i)} onChange={(e) => setCopies((x) => ({ ...x, [i.id]: e.target.value.trim() }))} />
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
              <Button variant="ghost">
                <ArrowLeft aria-hidden /> All purchases
              </Button>
            </Link>
            {p.status === 'POSTED' && (
              <Button onClick={() => setLabelsOpen(true)}>
                <Barcode aria-hidden /> Print barcode labels
              </Button>
            )}
            {p.status === 'POSTED' && can(...MANAGE) && (
              <Button onClick={() => setRetOpen(true)}>
                <Undo2 aria-hidden /> Return to supplier
              </Button>
            )}
            {p.status === 'POSTED' && can(...MANAGE) && p.returns.length === 0 && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <Ban aria-hidden /> Cancel purchase
              </Button>
            )}
          </>
        }
      />
      {p.status === 'CANCELLED' ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-600/25 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <Ban className="h-5 w-5 shrink-0" aria-hidden /> Cancelled: {p.cancelReason}. Its stock was taken back out.
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-leaf-600/25 bg-leaf-50 px-4 py-3 text-sm text-leaf-700">
          <PackageCheck className="h-5 w-5 shrink-0" aria-hidden /> Posted to stock. Every item below was added to the shelf count{p.returns.length > 0 ? ', less the returns at the bottom' : ''}.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Boxes />} label="Lines" value={p.items.length} sub={`${fmtQty(p.items.reduce((a, i) => a + Number(i.baseQty), 0))} pieces received`} />
        <StatTile icon={<Truck />} tone="neutral" label="Charges" value={`₹${money(p.computed.chargesTotal)}`} sub={`${p.charges.length} on the bill`} />
        <StatTile icon={<IndianRupee />} tone="teal" label="Grand total" value={`₹${money(p.grandTotal)}`} sub={p.invoiceTotal === null ? '' : `Supplier bill ₹${money(p.invoiceTotal)}`} />
        <StatTile icon={<Undo2 />} tone={p.returns.length ? 'amber' : 'neutral'} label="Returned to supplier" value={`₹${money(p.returns.reduce((a, r) => a + Number(r.total), 0))}`} sub={`${p.returns.length} return${p.returns.length === 1 ? '' : 's'}`} />
      </div>
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
              <th className={cx(th, 'text-right')}>Sale price set</th>
              <th className={cx(th, 'text-right')}>Returned</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td className={td} data-title>
                  <span className="font-medium">{i.product.name}</span>
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
                <td className={cx(td, num, 'font-semibold text-brand-700')}>{i.landedUnitCost === null ? '' : money(i.landedUnitCost)}</td>
                <td className={cx(td, num)}>
                  {i.salePrice === null ? '' : money(i.salePrice)}
                  {i.mrp !== null && <div className="text-xs text-ink-mute">MRP {money(i.mrp)}</div>}
                </td>
                <td className={cx(td, num)}>{Number(i.returnedQty) ? fmtQty(i.returnedQty) : ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-brand-600" aria-hidden /> Charges</span>}>
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
        <Card title={<span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-600" aria-hidden /> Totals</span>}>
          <dl className="grid grid-cols-2 gap-y-1.5 p-4 pt-2 font-mono text-sm">
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
        <Card title={<span className="flex items-center gap-2"><Undo2 className="h-4 w-4 text-amber-600" aria-hidden /> Returns to supplier</span>}>
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
      <Table cards={false}>
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

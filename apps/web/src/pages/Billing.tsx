import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, del, get, patch, post } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { useCatalogue, useKits } from '../lib/catalogue';
import { money, qty as fmtQty, r2 } from '../lib/format';
import { billingKey } from '../lib/keys';
import { printReceipt } from '../lib/print';
import type { CatalogueItem, Kit, Settings, StockWarning } from '../lib/types';
import { Badge, Button, ConfirmDialog, cx, ErrorBox, Field, Input, Kbd, Modal, num, Table, td, th, useToast } from '../components/ui';
import { UpiQrDialog } from '../components/UpiQrDialog';

interface Line {
  key: string;
  productId?: number;
  kitId?: number;
  code: string;
  name: string;
  unit: string;
  allowDecimal: boolean;
  qty: number;
  rate: number; // master price unless a manager changed it
  masterRate: number;
  discount: number;
  mrp: number | null;
  onHand?: number;
}

interface Draft {
  lines: Line[];
  cash: string;
  upi: string;
  upiRef: string;
  card: string;
  cardRef: string;
  customerName: string;
  remarks: string;
  key: string;
  heldBillId?: number;
}

const emptyDraft = (): Draft => ({ lines: [], cash: '', upi: '', upiRef: '', card: '', cardRef: '', customerName: '', remarks: '', key: crypto.randomUUID() });
const DRAFT_KEY = 'pos-billing-draft';

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Draft) };
  } catch {
    /* ignore */
  }
  return emptyDraft();
}

const n = (s: string) => {
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : NaN;
};

export function Billing() {
  const { me, can } = useAuth();
  const isManager = can(...MANAGE);
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const cat = useCatalogue();
  const kits = useKits();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), staleTime: 60_000 });
  const quick = useQuery({ queryKey: ['quick-keys'], queryFn: () => get<number[]>('/products/quick-keys'), staleTime: 5 * 60_000 });

  const [draft, setDraft] = useState<Draft>(() => (editId ? emptyDraft() : loadDraft()));
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<CatalogueItem[]>([]);
  const [hit, setHit] = useState(0);
  const [sel, setSel] = useState<number>(-1);
  const [panel, setPanel] = useState<'quick' | 'kits'>('quick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<StockWarning[]>([]);
  const [lastBill, setLastBill] = useState<{ id: number; billNo: string; total: number; change: number } | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [editLoaded, setEditLoaded] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);

  // Keep the bill across an accidental refresh (same browser tab only).
  useEffect(() => {
    if (editId) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, editId]);

  // Manager edit of an existing bill (same day).
  useEffect(() => {
    if (!editId || editLoaded === editId || !cat.data) return;
    void (async () => {
      try {
        const s = await get<{ billNo: string; items: { productId: number | null; kitId: number | null; codeSnapshot: string; nameSnapshot: string; qty: number; rate: number; discount: number }[]; payments: { mode: string; amount: number; reference: string | null }[]; customerName: string | null; can: { edit: boolean } }>(`/sales/${editId}`);
        if (!s.can.edit) throw new Error('This bill can no longer be edited');
        const kitMap = new Map((kits.data ?? []).map((k) => [k.id, k]));
        setDraft({
          ...emptyDraft(),
          customerName: s.customerName ?? '',
          lines: s.items.map((i) => {
            const p = i.productId ? cat.byId.get(i.productId) : undefined;
            const k = i.kitId ? kitMap.get(i.kitId) : undefined;
            return {
              key: crypto.randomUUID(),
              productId: i.productId ?? undefined,
              kitId: i.kitId ?? undefined,
              code: i.codeSnapshot,
              name: i.nameSnapshot,
              unit: p?.unit ?? 'KIT',
              allowDecimal: p?.allowDecimal ?? false,
              qty: Number(i.qty),
              rate: Number(i.rate),
              masterRate: p ? Number(p.salePrice) : k ? Number(k.price) : Number(i.rate),
              discount: Number(i.discount),
              mrp: p?.mrp ?? null,
              onHand: p?.onHand,
            };
          }),
          cash: String(s.payments.filter((p) => p.mode === 'CASH').reduce((a, p) => a + Number(p.amount), 0) || ''),
          upi: String(s.payments.filter((p) => p.mode === 'UPI').reduce((a, p) => a + Number(p.amount), 0) || ''),
          card: String(s.payments.filter((p) => p.mode === 'CARD').reduce((a, p) => a + Number(p.amount), 0) || ''),
          upiRef: s.payments.find((p) => p.mode === 'UPI')?.reference ?? '',
          cardRef: s.payments.find((p) => p.mode === 'CARD')?.reference ?? '',
        });
        setEditLoaded(editId);
        toast(`Editing bill ${s.billNo}`, 'amber');
      } catch (e) {
        setErr(e);
      }
    })();
  }, [editId, editLoaded, cat.data, cat.byId, kits.data, toast]);

  // ---------- totals (display only; the server recomputes and is the source of truth) ----------
  const roundToRupee = settings.data?.roundBillToRupee ?? true;
  const totals = useMemo(() => {
    const gross = r2(draft.lines.reduce((a, l) => a + r2(l.qty * l.rate), 0));
    const discount = r2(draft.lines.reduce((a, l) => a + l.discount, 0));
    const net = r2(gross - discount);
    const grand = roundToRupee ? Math.round(net + 1e-9) : net;
    const roundOff = r2(grand - net);
    const upi = n(draft.upi) || 0;
    const card = n(draft.card) || 0;
    const cashGiven = draft.cash.trim() === '' ? Math.max(0, r2(grand - upi - card)) : n(draft.cash);
    const paid = r2((Number.isNaN(cashGiven) ? 0 : cashGiven) + upi + card);
    const change = r2(paid - grand);
    const items = draft.lines.reduce((a, l) => a + l.qty, 0);
    return { gross, discount, net, grand, roundOff, upi, card, cashGiven, paid, change, items };
  }, [draft, roundToRupee]);

  const hasOverride = draft.lines.some((l) => l.rate !== l.masterRate);
  const payProblem = useMemo(() => {
    if (draft.lines.length === 0) return 'Add items to the bill';
    if (draft.lines.some((l) => l.rate <= 0)) return 'Every line needs a price above zero';
    if (hasOverride && draft.remarks.trim().length < 3) return 'Say why the price was changed';
    if (totals.upi > 0 && settings.data?.requireUpiReference && !draft.upiRef.trim()) return 'Type the UPI transaction ID';
    if (totals.card > 0 && settings.data?.requireCardReference && !draft.cardRef.trim()) return 'Type the card slip ID';
    if ([draft.upi, draft.card, draft.cash].some((s) => s.trim() !== '' && (Number.isNaN(n(s)) || n(s) < 0))) return 'Payment amounts must be numbers';
    if (r2(totals.upi + totals.card) > totals.grand) return 'UPI and card together are more than the bill. Give change in cash only.';
    if (totals.change < -0.001) return `Short by ₹${money(-totals.change)}`;
    return null;
  }, [draft, totals, hasOverride, settings.data]);

  // ---------- cart operations ----------
  const update = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));

  const addProduct = useCallback(
    (p: CatalogueItem, q = 1) => {
      setErr(null);
      if (!p.isActive) return setErr(new Error(`${p.name} is switched off`));
      if (!p.allowDecimal && !Number.isInteger(q)) return setErr(new Error(`${p.name} is sold in whole ${p.unit}`));
      update((d) => {
        const idx = d.lines.findIndex((l) => l.productId === p.id && l.rate === Number(p.salePrice));
        if (idx >= 0) {
          const lines = [...d.lines];
          lines[idx] = { ...lines[idx], qty: r2(lines[idx].qty + q) };
          setSel(idx);
          return { ...d, lines };
        }
        setSel(d.lines.length);
        return {
          ...d,
          lines: [...d.lines, { key: crypto.randomUUID(), productId: p.id, code: p.code, name: p.name, unit: p.unit, allowDecimal: p.allowDecimal, qty: q, rate: Number(p.salePrice), masterRate: Number(p.salePrice), discount: 0, mrp: p.mrp === null ? null : Number(p.mrp), onHand: Number(p.onHand) }],
        };
      });
    },
    [],
  );

  const addKit = useCallback((k: Kit, q = 1) => {
    setErr(null);
    update((d) => {
      const idx = d.lines.findIndex((l) => l.kitId === k.id);
      if (idx >= 0) {
        const lines = [...d.lines];
        lines[idx] = { ...lines[idx], qty: lines[idx].qty + q };
        setSel(idx);
        return { ...d, lines };
      }
      setSel(d.lines.length);
      return { ...d, lines: [...d.lines, { key: crypto.randomUUID(), kitId: k.id, code: k.code, name: k.name, unit: 'KIT', allowDecimal: false, qty: q, rate: Number(k.price), masterRate: Number(k.price), discount: 0, mrp: null }] };
    });
  }, []);

  const setLine = (i: number, patchLine: Partial<Line>) => update((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patchLine } : l)) }));
  const removeLine = (i: number) => {
    update((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }));
    setSel((s) => Math.max(-1, Math.min(s, draft.lines.length - 2)));
  };

  // ---------- search: "5*123" sets qty, exact code/barcode adds at once ----------
  const parseSearch = (text: string) => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*\*\s*(.*)$/.exec(text);
    return m ? { q: Number(m[1]), term: m[2] } : { q: 1, term: text };
  };
  useEffect(() => {
    const { term } = parseSearch(search);
    setHits(cat.search(term, 10));
    setHit(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, cat.data]);

  const pickFromSearch = (p?: CatalogueItem) => {
    const { q, term } = parseSearch(search);
    const key = term.trim().toLowerCase();
    const exact = cat.byCode.get(key);
    // Search again right now: a barcode scanner types and presses Enter faster than the list refreshes.
    const fresh = cat.search(term, 10);
    const target = p ?? exact ?? fresh[Math.min(hit, fresh.length - 1)] ?? fresh[0];
    if (!target) {
      const kit = kits.data?.find((k) => k.code.toLowerCase() === key);
      if (kit) {
        addKit(kit, Math.max(1, Math.round(q)));
        setSearch('');
        return;
      }
      // Maybe the product was added after this counter loaded its list: reload once and look again.
      void cat.refetch().then((r) => {
        const found = r.data?.products.find((x) => x.code.toLowerCase() === key || x.barcode?.toLowerCase() === key);
        if (found) {
          addProduct(found, q);
          setSearch('');
        } else setErr(new Error(`No product matches "${term.trim()}"`));
      });
      return;
    }
    addProduct(target, q);
    setSearch('');
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHit((h) => Math.min(h + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHit((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (search.trim()) pickFromSearch();
      else if (draft.lines.length) cashRef.current?.focus();
    }
  };

  // ---------- save ----------
  const clear = () => {
    setDraft(emptyDraft());
    setSel(-1);
    setErr(null);
    setSearch('');
    if (editId) nav('/billing', { replace: true });
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const payload = () => {
    const payments: { mode: string; amount: number; reference?: string }[] = [];
    if (totals.upi > 0) payments.push({ mode: 'UPI', amount: totals.upi, reference: draft.upiRef || undefined });
    if (totals.card > 0) payments.push({ mode: 'CARD', amount: totals.card, reference: draft.cardRef || undefined });
    if (totals.cashGiven > 0) payments.push({ mode: 'CASH', amount: r2(totals.cashGiven) });
    return {
      items: draft.lines.map((l) => ({ ...(l.productId ? { productId: l.productId } : { kitId: l.kitId }), qty: l.qty, ...(l.rate !== l.masterRate ? { rate: l.rate } : {}), discount: l.discount })),
      payments,
      customerName: draft.customerName.trim() || undefined,
      remarks: draft.remarks.trim() || undefined,
      heldBillId: draft.heldBillId,
    };
  };

  const save = async (print: boolean) => {
    if (busy) return;
    if (payProblem) {
      setErr(new Error(payProblem));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let saleId: number;
      let billNo: string;
      let change: number;
      let grand: number;
      let warn: StockWarning[] = [];
      if (editId) {
        const r = await patch<{ id: number; billNo: string; grandTotal: number; changeDue: number; warnings: StockWarning[] }>(`/sales/${editId}`, payload());
        saleId = r.id;
        billNo = r.billNo;
        change = r.changeDue;
        grand = r.grandTotal;
        warn = r.warnings;
      } else {
        const r = await post<{ id: number; billNo: string; grandTotal: number; changeDue: number; warnings: StockWarning[] }>('/sales', payload(), { 'Idempotency-Key': draft.key });
        saleId = r.id;
        billNo = r.billNo;
        change = r.changeDue;
        grand = r.grandTotal;
        warn = r.warnings;
      }
      setLastBill({ id: saleId, billNo, total: grand, change });
      setWarnings(warn);
      toast(`${editId ? 'Updated' : 'Saved'} ${billNo} · ₹${money(grand)}${change > 0 ? ` · change ₹${money(change)}` : ''}`);
      clear();
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
      void qc.invalidateQueries({ queryKey: ['held'] });
      if (print) {
        printReceipt(saleId).catch((e) => toast(`Saved, but printing failed: ${e.message}. Use Ctrl+P to try again.`, 'rose'));
      }
    } catch (e) {
      // A network failure keeps the same bill key, so pressing F9/F10 again cannot create a second bill.
      setErr(e);
      if (e instanceof ApiError && e.status === 0) toast('Not saved yet: the server could not be reached. Press F9 or F10 again.', 'rose');
    } finally {
      setBusy(false);
    }
  };

  const reprintLast = async () => {
    try {
      const last: { id: number; billNo: string } = lastBill ?? (await get<{ id: number; billNo: string }>('/sales/last'));
      await printReceipt(last.id);
      toast(`Reprinting ${last.billNo}`);
    } catch (e) {
      setErr(e);
    }
  };

  // ---------- keyboard map ----------
  const anyModal = holdOpen || recallOpen || clearOpen || qrOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModal) return;
      // F2…F10, or Alt+2…Alt+0 for laptops whose top row sends volume/brightness (see lib/keys.ts).
      const short = billingKey(e);
      const k = short ?? e.key;
      const fkey = short !== null;
      // Stop the browser's own action (F3 find, F6 address bar, F7 caret browsing, F10 menu) on every billing F key.
      if (fkey) e.preventDefault();
      if (fkey && e.repeat) return; // holding the key down must not fire it again (no double saves)
      const why = (text: string) => toast(text, 'amber');
      if (k === 'F2') {
        searchRef.current?.focus();
      } else if (k === 'F3') {
        if (!draft.lines.length) why('F3: add an item to the bill first, then show the UPI QR.');
        else if (totals.grand - totals.card <= 0) why('F3: nothing left to collect by UPI.');
        else setQrOpen(true);
      } else if (k === 'F4') {
        setPanel((p) => (p === 'quick' ? 'kits' : 'quick'));
      } else if (k === 'F6') {
        if (editId) why('F6: an edited bill cannot be put on hold.');
        else if (!draft.lines.length) why('F6: the bill is empty, nothing to hold.');
        else setHoldOpen(true);
      } else if (k === 'F7') {
        if (editId) why('F7: finish or clear the bill you are editing first.');
        else setRecallOpen(true);
      } else if (k === 'F8') {
        if (sel >= 0 && sel < draft.lines.length) removeLine(sel);
        else why('F8: select a line in the bill first (click it or use the arrow keys).');
      } else if (k === 'F9' || k === 'F10') {
        if (!draft.lines.length) why(`${k}: the bill is empty. Add an item first.`);
        else void save(k === 'F10');
      } else if (e.ctrlKey && (k === 'p' || k === 'P')) {
        e.preventDefault();
        void reprintLast();
      } else if (k === 'Escape') {
        if (search) setSearch('');
        else if (draft.lines.length) setClearOpen(true);
      } else if (document.activeElement === document.body || document.activeElement === null) {
        if (k === 'ArrowDown') setSel((s) => Math.min(s + 1, draft.lines.length - 1));
        if (k === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
        if ((k === '+' || k === '=') && sel >= 0) setLine(sel, { qty: draft.lines[sel].qty + 1 });
        if (k === '-' && sel >= 0 && draft.lines[sel].qty > 1) setLine(sel, { qty: draft.lines[sel].qty - 1 });
      }
    };
    // Capture phase: the shortcut runs even when the cursor is inside an input that handles keys itself.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  if (!me?.counterId) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm">
        <h1 className="mb-2 text-xl font-semibold">Log in at a counter to bill</h1>
        <p className="text-ink-mute">You are logged in without a counter. Log out and choose your counter on the login screen. Each counter has its own bill numbers.</p>
      </div>
    );
  }

  const quickItems = (quick.data ?? []).map((id) => cat.byId.get(id)).filter(Boolean) as CatalogueItem[];
  const maxPct = Number(settings.data?.maxCashierDiscount ?? 0);
  const canDiscount = isManager || maxPct > 0;

  return (
    <div className="grid min-h-[calc(100vh-5rem)] gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      {/* Left: search + lines */}
      <div className="flex min-w-0 flex-col gap-3">
        {editId && (
          <div className="flex items-center justify-between rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <span>Editing a saved bill. Saving replaces its lines and payments and is recorded in the audit log.</span>
            <Button size="sm" onClick={clear}>
              Stop editing
            </Button>
          </div>
        )}
        <div className="relative">
          <label htmlFor="pos-search" className="sr-only">
            Search product
          </label>
          <Input
            id="pos-search"
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Scan barcode, type code or name.  5*123 adds 5 of code 123"
            className="h-14 font-mono text-lg"
            autoComplete="off"
          />
          <span className="pointer-events-none absolute right-3 top-4 text-ink-mute">
            <Kbd>F2</Kbd>
          </span>
          {search.trim() && hits.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-96 overflow-auto rounded-md border border-line bg-white shadow-lg" role="listbox">
              {hits.map((h, i) => (
                <li
                  key={h.id}
                  role="option"
                  aria-selected={i === hit}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickFromSearch(h);
                  }}
                  className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === hit ? 'bg-navy-50' : 'hover:bg-paper')}
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-ink-mute">{h.code}</span>
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span className={cx('font-mono text-xs', Number(h.onHand) <= 0 ? 'text-rose-600' : 'text-ink-mute')}>
                    {fmtQty(h.onHand)} {h.unit}
                  </span>
                  <span className="w-20 text-right font-mono">{money(h.salePrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-[240px] flex-1 overflow-hidden rounded-lg border border-line bg-white">
          <Table>
            <thead>
              <tr>
                <th className={th}>#</th>
                <th className={th}>Item</th>
                <th className={cx(th, 'text-right')}>Qty</th>
                <th className={cx(th, 'text-right')}>Rate</th>
                {canDiscount && <th className={cx(th, 'text-right')}>Disc ₹</th>}
                <th className={cx(th, 'text-right')}>Amount</th>
                <th className={th}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-sm text-ink-mute">
                    Scan or search an item, or tap a quick key. <Kbd>F4</Kbd> switches between best sellers and section kits.
                  </td>
                </tr>
              )}
              {draft.lines.map((l, i) => {
                const amount = r2(l.qty * l.rate - l.discount);
                const low = l.onHand !== undefined && l.onHand - l.qty < 0;
                return (
                  <tr key={l.key} onClick={() => setSel(i)} className={cx(sel === i && 'bg-navy-50/70')}>
                    <td className={cx(td, 'w-8 text-ink-mute')}>{i + 1}</td>
                    <td className={td}>
                      <div className="font-medium">{l.name}</div>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-mute">
                        {l.code}
                        {l.kitId && <Badge tone="teal">Kit</Badge>}
                        {low && <Badge tone="amber">Stock {fmtQty(l.onHand)}</Badge>}
                        {l.rate !== l.masterRate && <Badge tone="amber">Price changed</Badge>}
                      </div>
                    </td>
                    <td className={cx(td, 'w-24')}>
                      <Input
                        aria-label={`Quantity of ${l.name}`}
                        inputMode="decimal"
                        className="h-9 text-right font-mono"
                        value={String(l.qty)}
                        onChange={(e) => {
                          const v = n(e.target.value);
                          if (!Number.isNaN(v) && v >= 0) setLine(i, { qty: l.allowDecimal ? Math.round(v * 1000) / 1000 : Math.round(v) });
                        }}
                        onBlur={() => l.qty <= 0 && removeLine(i)}
                      />
                    </td>
                    <td className={cx(td, 'w-28')}>
                      {isManager ? (
                        <Input
                          aria-label={`Rate of ${l.name}`}
                          inputMode="decimal"
                          className="h-9 text-right font-mono"
                          value={String(l.rate)}
                          onChange={(e) => {
                            const v = n(e.target.value);
                            if (!Number.isNaN(v) && v >= 0) setLine(i, { rate: r2(v) });
                          }}
                        />
                      ) : (
                        <div className={num}>{money(l.rate)}</div>
                      )}
                    </td>
                    {canDiscount && (
                      <td className={cx(td, 'w-24')}>
                        <Input
                          aria-label={`Discount on ${l.name}`}
                          inputMode="decimal"
                          className="h-9 text-right font-mono"
                          value={l.discount ? String(l.discount) : ''}
                          placeholder="0"
                          onChange={(e) => {
                            const v = e.target.value.trim() === '' ? 0 : n(e.target.value);
                            if (!Number.isNaN(v) && v >= 0) setLine(i, { discount: r2(v) });
                          }}
                        />
                      </td>
                    )}
                    <td className={cx(td, num, 'w-28 text-base')}>{money(amount)}</td>
                    <td className={cx(td, 'w-10')}>
                      <button className="rounded px-2 py-1 text-ink-mute hover:bg-rose-50 hover:text-rose-700" onClick={() => removeLine(i)} aria-label={`Remove ${l.name}`} title="Remove line (F8)">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>

        {/* Quick keys / kits */}
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="mb-2 flex items-center gap-2">
            <button className={cx('rounded px-2 py-1 text-sm font-medium', panel === 'quick' ? 'bg-navy-50 text-navy-700' : 'text-ink-mute')} onClick={() => setPanel('quick')}>
              Best sellers
            </button>
            <button className={cx('rounded px-2 py-1 text-sm font-medium', panel === 'kits' ? 'bg-navy-50 text-navy-700' : 'text-ink-mute')} onClick={() => setPanel('kits')}>
              Section kits
            </button>
            <span className="ml-auto text-xs text-ink-mute">
              <Kbd>F4</Kbd> switch
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {panel === 'quick' &&
              quickItems.map((p) => (
                <button key={p.id} onClick={() => addProduct(p)} className="min-h-[56px] rounded-md border border-line bg-paper/60 px-2 py-1.5 text-left text-xs leading-tight hover:border-navy-500 hover:bg-navy-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy-500">
                  <span className="line-clamp-2 font-medium">{p.name}</span>
                  <span className="mt-0.5 block font-mono text-ink-mute">₹{money(p.salePrice)}</span>
                </button>
              ))}
            {panel === 'kits' &&
              (kits.data?.length ? (
                kits.data.map((k) => (
                  <button key={k.id} onClick={() => addKit(k)} className="min-h-[56px] rounded-md border border-navy-100 bg-navy-50/60 px-2 py-1.5 text-left text-xs leading-tight hover:border-navy-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy-500" title={k.items.map((i) => `${i.qty} x ${i.product.name}`).join('\n')}>
                    <span className="line-clamp-2 font-medium">{k.name}</span>
                    <span className="mt-0.5 block font-mono text-ink-mute">
                      ₹{money(k.price)} · {k.items.length} items
                    </span>
                  </button>
                ))
              ) : (
                <p className="col-span-full text-sm text-ink-mute">No section kits yet. A manager can add them under Settings &amp; users → Kits.</p>
              ))}
          </div>
        </div>
      </div>

      {/* Right: totals and payment */}
      <aside className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-mute">Bill total</div>
            <div className="font-mono text-5xl font-medium tabular-nums tracking-tight">₹{money(totals.grand)}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs text-ink-mute">
              <span>
                {draft.lines.length} {draft.lines.length === 1 ? 'line' : 'lines'}
              </span>
              <span>Qty {fmtQty(totals.items)}</span>
              {totals.discount > 0 && <span>Disc −{money(totals.discount)}</span>}
              {totals.roundOff !== 0 && <span>R/off {money(totals.roundOff)}</span>}
            </div>
          </div>
          <div className="space-y-3 p-4">
            <Field label="Cash received" hint="Leave empty if the customer pays the exact amount.">
              {(id) => <Input id={id} ref={cashRef} inputMode="decimal" className="h-12 text-right font-mono text-xl" value={draft.cash} placeholder={money(Math.max(0, totals.grand - totals.upi - totals.card))} onChange={(e) => update((d) => ({ ...d, cash: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && void save(true)} />}
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {[totals.grand, 50, 100, 200, 500, 2000]
                .filter((v, i, a) => v > 0 && a.indexOf(v) === i && (i === 0 || v >= totals.grand))
                .slice(0, 5)
                .map((v, i) => (
                  <Button key={v} size="sm" onClick={() => update((d) => ({ ...d, cash: String(v) }))}>
                    {i === 0 ? 'Exact' : `₹${v}`}
                  </Button>
                ))}
            </div>
            <Button variant="secondary" className="w-full border-brand-500/60 text-brand-500" disabled={!draft.lines.length || totals.grand - totals.card <= 0} onClick={() => setQrOpen(true)}>
              Collect by UPI · show QR <Kbd>F3</Kbd>
            </Button>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <Field label="UPI">{(id) => <Input id={id} inputMode="decimal" className="text-right font-mono" value={draft.upi} onChange={(e) => update((d) => ({ ...d, upi: e.target.value }))} placeholder="0.00" />}</Field>
              <Field label={settings.data?.requireUpiReference ? 'UPI transaction ID' : 'UPI ref'}>
                {(id) => <Input id={id} value={draft.upiRef} onChange={(e) => update((d) => ({ ...d, upiRef: e.target.value.toUpperCase() }))} placeholder={settings.data?.requireUpiReference ? 'required' : 'optional'} maxLength={32} className="font-mono" invalid={totals.upi > 0 && !!settings.data?.requireUpiReference && !draft.upiRef.trim()} />}
              </Field>
              <Field label="Card">{(id) => <Input id={id} inputMode="decimal" className="text-right font-mono" value={draft.card} onChange={(e) => update((d) => ({ ...d, card: e.target.value }))} placeholder="0.00" />}</Field>
              <Field label={settings.data?.requireCardReference ? 'Card slip ID' : 'Card ref'}>
                {(id) => <Input id={id} value={draft.cardRef} onChange={(e) => update((d) => ({ ...d, cardRef: e.target.value.toUpperCase() }))} placeholder={settings.data?.requireCardReference ? 'required' : 'optional'} maxLength={32} className="font-mono" />}
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-md bg-paper px-3 py-2">
              <span className="text-sm text-ink-mute">{totals.change >= 0 ? 'Change to give' : 'Still to pay'}</span>
              <span className={cx('font-mono text-2xl tabular-nums', totals.change < 0 ? 'text-rose-700' : 'text-navy-700')}>₹{money(Math.abs(totals.change))}</span>
            </div>
            <Field label="Customer (optional)">{(id) => <Input id={id} value={draft.customerName} maxLength={80} onChange={(e) => update((d) => ({ ...d, customerName: e.target.value }))} placeholder="Name or section, e.g. II CSE A" />}</Field>
            {hasOverride && (
              <Field label="Why was the price changed?" hint="Required when a line is billed below its master price. It goes on the audit log and the daily report.">
                {(id) => <Input id={id} value={draft.remarks} maxLength={200} onChange={(e) => update((d) => ({ ...d, remarks: e.target.value }))} invalid={draft.remarks.trim().length < 3} placeholder="e.g. Damaged cover, approved by HOD" />}
              </Field>
            )}
            <ErrorBox error={err} />
            <div className="grid grid-cols-[2fr_3fr] gap-2">
              <Button variant="secondary" size="lg" busy={busy} onClick={() => void save(false)} disabled={!!payProblem}>
                Save <Kbd>F9</Kbd>
              </Button>
              <Button variant="primary" size="lg" busy={busy} onClick={() => void save(true)} disabled={!!payProblem}>
                Save &amp; print <Kbd>F10</Kbd>
              </Button>
            </div>
            {payProblem && draft.lines.length > 0 && <p className="text-xs text-rose-600">{payProblem}</p>}
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" onClick={() => setHoldOpen(true)} disabled={!draft.lines.length || !!editId}>
                Hold <Kbd>F6</Kbd>
              </Button>
              <Button size="sm" onClick={() => setRecallOpen(true)} disabled={!!editId}>
                Recall <Kbd>F7</Kbd>
              </Button>
              <Button size="sm" onClick={() => draft.lines.length && setClearOpen(true)}>
                Clear <Kbd>Esc</Kbd>
              </Button>
            </div>
          </div>
        </div>

        {lastBill && (
          <div className="rounded-lg border border-line bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-mute">Last bill</div>
                <div className="font-mono">{lastBill.billNo}</div>
              </div>
              <div className="text-right font-mono">
                <div>₹{money(lastBill.total)}</div>
                {lastBill.change > 0 && <div className="text-xs text-navy-700">change ₹{money(lastBill.change)}</div>}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void reprintLast()}>
                Reprint <Kbd>Ctrl P</Kbd>
              </Button>
              <Button size="sm" onClick={() => window.open(`/api/v1/sales/${lastBill.id}/receipt?format=pdf`, '_blank')}>
                PDF
              </Button>
            </div>
            {warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Stock went below zero for: {warnings.map((w) => `${w.name} (${fmtQty(w.onHand)})`).join(', ')}. Enter the pending purchase or tell the store keeper.
              </div>
            )}
          </div>
        )}
        <KeyHelp />
      </aside>

      <UpiQrDialog
        open={qrOpen}
        amount={r2(Math.max(0, totals.grand - totals.card))}
        note={`${settings.data?.storeName ?? 'General Store'} ${me.counterCode} ${draft.lines.length} items`}
        settings={settings.data}
        requireRef={settings.data?.requireUpiReference ?? true}
        onClose={() => setQrOpen(false)}
        onPaid={(reference) => {
          update((d) => ({ ...d, upi: String(r2(Math.max(0, totals.grand - totals.card))), upiRef: reference, cash: '' }));
          setQrOpen(false);
          setTimeout(() => cashRef.current?.focus(), 0);
        }}
      />
      <HoldDialog
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        onHold={async (label) => {
          await post('/sales/held', { label, payload: { ...draft, key: undefined } });
          toast('Bill held');
          if (draft.heldBillId) await del(`/sales/held/${draft.heldBillId}`).catch(() => undefined);
          clear();
          void qc.invalidateQueries({ queryKey: ['held'] });
        }}
      />
      <RecallDialog
        open={recallOpen}
        onClose={() => setRecallOpen(false)}
        hasCurrent={draft.lines.length > 0}
        onRecall={(id, p) => {
          setDraft({ ...emptyDraft(), ...p, key: crypto.randomUUID(), heldBillId: id });
          setSel(-1);
          setRecallOpen(false);
          setTimeout(() => cashRef.current?.focus(), 0);
        }}
      />
      <ConfirmDialog open={clearOpen} onClose={() => setClearOpen(false)} title="Clear this bill?" message="All lines and payments on screen will be removed. Nothing has been saved." confirmLabel="Clear bill" danger onConfirm={() => clear()} />
    </div>
  );
}

function HoldDialog({ open, onClose, onHold }: { open: boolean; onClose: () => void; onHold: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setLabel('');
      setErr(null);
    }
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      await onHold(label);
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Hold this bill" footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" busy={busy} onClick={go}>Hold bill</Button></>}>
      <Field label="Name for this bill" hint="So you can find it again, e.g. the customer's name or section.">
        {(id) => <Input id={id} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} />}
      </Field>
      <div className="mt-3">
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function RecallDialog({ open, onClose, onRecall, hasCurrent }: { open: boolean; onClose: () => void; onRecall: (id: number, payload: Partial<Draft>) => void; hasCurrent: boolean }) {
  const qc = useQueryClient();
  const held = useQuery({ queryKey: ['held'], queryFn: () => get<{ id: number; label: string; createdAt: string; payload: Partial<Draft>; user: { fullName: string } }[]>('/sales/held'), enabled: open });
  return (
    <Modal open={open} onClose={onClose} title="Held bills on this counter" wide>
      {hasCurrent && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">The bill on screen will be replaced. Hold it first if you still need it.</p>}
      {held.isLoading && <p className="text-sm text-ink-mute">Loading…</p>}
      {held.data?.length === 0 && <p className="text-sm text-ink-mute">No held bills.</p>}
      <ul className="divide-y divide-line">
        {held.data?.map((h) => {
          const lines = (h.payload.lines ?? []) as Line[];
          const total = lines.reduce((a, l) => a + l.qty * l.rate - l.discount, 0);
          return (
            <li key={h.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{h.label}</div>
                <div className="text-xs text-ink-mute">
                  {lines.length} lines · held by {h.user.fullName} at {new Date(h.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <span className="font-mono">₹{money(total)}</span>
              <Button size="sm" variant="primary" onClick={() => onRecall(h.id, h.payload)}>
                Recall
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await del(`/sales/held/${h.id}`);
                  void qc.invalidateQueries({ queryKey: ['held'] });
                }}
              >
                Discard
              </Button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function KeyHelp() {
  const keys: [string, string, string][] = [
    ['F2', 'Alt 2', 'Search'],
    ['F3', 'Alt 3', 'Show UPI QR'],
    ['F4', 'Alt 4', 'Best sellers / kits'],
    ['F6', 'Alt 6', 'Hold bill'],
    ['F7', 'Alt 7', 'Recall bill'],
    ['F8', 'Alt 8', 'Delete selected line'],
    ['F9', 'Alt 9', 'Save'],
    ['F10', 'Alt 0', 'Save & print'],
    ['Ctrl P', '', 'Reprint last bill'],
    ['Ctrl L', '', 'Lock counter'],
    ['Esc', '', 'Clear bill'],
  ];
  return (
    <div className="hidden rounded-lg border border-line bg-white p-3 text-xs text-ink-mute xl:block">
      <div className="grid grid-cols-1 gap-y-1">
        {keys.map(([k, alt, v]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <span className="flex gap-1">
              <Kbd>{k}</Kbd>
              {alt && (
                <>
                  <span className="opacity-60">or</span>
                  <Kbd>{alt}</Kbd>
                </>
              )}
            </span>
            <span className="text-right">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-mute/80">
        If the F keys change volume or brightness on a laptop, use the <Kbd>Alt</Kbd> + number keys, or hold <Kbd>Fn</Kbd> with the F key.
      </p>
    </div>
  );
}

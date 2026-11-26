import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, qs } from '../../services/http.common';
import { MANAGE, useAuth } from '../../app/auth';
import { date, money, todayIso } from '../../services/format';
import type { Supplier } from '../../data/types';
import { Ban, ChevronRight, FilePen, Hourglass, PackageCheck, Plus, Truck } from 'lucide-react';
import { Avatar, Badge, Button, Card, Checkbox, cx, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Pager, SearchInput, Segmented, Select, StatTile, Table, td, th, useToast } from '../../components/ui';

interface Row {
  id: number;
  purchaseNo: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  supplier: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  grandTotal: number;
  invoiceTotal: number | null;
  itemCount: number;
  createdBy: string;
  postedAt: string | null;
  readyAt: string | null;
}

type View = '' | 'DRAFT' | 'READY' | 'POSTED' | 'CANCELLED';
type Page = { rows: Row[]; total: number; page: number; pageSize: number };

function StatusBadge({ r }: { r: Row }) {
  return r.status === 'DRAFT' ? r.readyAt ? <Badge tone="amber">Ready to post</Badge> : <Badge>Draft</Badge> : r.status === 'POSTED' ? <Badge tone="teal">Posted</Badge> : <Badge tone="rose">Cancelled</Badge>;
}
const accent = (r: Row) => (r.status === 'POSTED' ? 'bg-leaf-500' : r.status === 'CANCELLED' ? 'bg-rose-500' : r.readyAt ? 'bg-amber-500' : 'bg-ink-mute/40');

export function Purchases() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', supplierId: '', page: 1 });
  const [view, setView] = useState<View>('');
  // Transactions → New purchase (GRN) opens this page with ?new=1.
  const [params, setParams] = useSearchParams();
  const newOpen = params.get('new') === '1';
  const setNewOpen = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: !v });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => get<Supplier[]>('/suppliers') });
  // "Ready to post" is a draft that the store keeper handed over, so it is filtered from the drafts.
  const status = view === 'READY' ? 'DRAFT' : view;
  const list = useQuery({ queryKey: ['purchases', f, status], queryFn: () => get<Page>(`/purchases${qs({ ...f, status, pageSize: 100 })}`) });
  // Counts for the tiles (store-wide, not limited by the search box).
  const drafts = useQuery({ queryKey: ['purchases', 'count-drafts'], queryFn: () => get<Page>(`/purchases${qs({ status: 'DRAFT', pageSize: 500 })}`) });
  const posted = useQuery({ queryKey: ['purchases', 'count-posted'], queryFn: () => get<Page>(`/purchases${qs({ status: 'POSTED', pageSize: 1 })}`) });
  const cancelled = useQuery({ queryKey: ['purchases', 'count-cancelled'], queryFn: () => get<Page>(`/purchases${qs({ status: 'CANCELLED', pageSize: 1 })}`) });
  const readyCount = drafts.data?.rows.filter((r) => r.readyAt).length ?? 0;
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  const pick = (v: View) => {
    setView((cur) => (cur === v ? '' : v));
    setF((x) => ({ ...x, page: 1 }));
  };
  const rows = (list.data?.rows ?? []).filter((r) => view !== 'READY' || r.readyAt);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchases (GRN)"
        subtitle="Supplier bills. Each gets a GRN number when first saved. Stock goes up only when the GRN is posted, and posting needs the total to match the invoice amount."
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus aria-hidden /> New purchase
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<FilePen />} tone="neutral" label="Drafts being entered" value={(drafts.data?.total ?? 0) - readyCount} sub="Not yet handed over" active={view === 'DRAFT'} onClick={() => pick('DRAFT')} />
        <StatTile icon={<Hourglass />} tone="amber" label="Ready to post" value={readyCount} sub="Waiting for a manager" active={view === 'READY'} onClick={() => pick('READY')} />
        <StatTile icon={<PackageCheck />} tone="teal" label="Posted to stock" value={posted.data?.total ?? 0} sub="Stock received" active={view === 'POSTED'} onClick={() => pick('POSTED')} />
        <StatTile icon={<Ban />} tone="rose" label="Cancelled" value={cancelled.data?.total ?? 0} sub="Entered by mistake" active={view === 'CANCELLED'} onClick={() => pick('CANCELLED')} />
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Status"
            value={view}
            onChange={(v) => {
              setView(v);
              setF((x) => ({ ...x, page: 1 }));
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'DRAFT', label: 'Drafts' },
              { value: 'READY', label: 'Ready', count: readyCount || undefined },
              { value: 'POSTED', label: 'Posted' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <SearchInput className="min-w-[200px] flex-1" aria-label="Invoice or GRN no" value={f.q} onChange={(e) => set({ q: e.target.value })} onClear={() => set({ q: '' })} placeholder="Search invoice or GRN no" />
          <Select aria-label="Supplier" className="w-full sm:w-56" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
            <option value="">All suppliers</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
              <Truck className="h-7 w-7" aria-hidden />
            </span>
            <p className="text-sm text-ink-mute">{view || f.q || f.supplierId ? 'No purchase matches these filters.' : 'No purchases yet. Press "New purchase" when boxes arrive with a supplier bill.'}</p>
            {!view && !f.q && !f.supplierId && (
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Plus aria-hidden /> New purchase
              </Button>
            )}
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th className={th}>GRN no</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Invoice</th>
                  <th className={th}>Invoice date</th>
                  <th className={th}>Status</th>
                  <th className={cx(th, 'text-right')}>Lines</th>
                  <th className={cx(th, 'text-right')}>Invoice amt ₹</th>
                  <th className={th}>Entered by</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const gap = r.status === 'DRAFT' && r.invoiceTotal !== null ? Number(r.invoiceTotal) - Number(r.grandTotal) : null;
                  return (
                    <tr key={r.id} className="group cursor-pointer" onClick={() => nav(`/purchases/${r.id}`)}>
                      <td className={cx(td, 'relative font-mono font-semibold')}>
                        <span className={cx('absolute inset-y-2 left-0 w-1 rounded-r', accent(r))} aria-hidden />
                        {r.purchaseNo ?? <span className="font-normal text-ink-mute">draft #{r.id}</span>}
                      </td>
                      <td className={td}>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={r.supplier} size="sm" />
                          {r.supplier}
                        </span>
                      </td>
                      <td className={cx(td, 'font-mono text-ink-soft')}>{r.supplierInvoiceNo}</td>
                      <td className={cx(td, 'text-ink-soft')}>{date(r.invoiceDate)}</td>
                      <td className={td}>
                        <StatusBadge r={r} />
                      </td>
                      <td className={cx(td, num)}>{r.itemCount}</td>
                      <td className={cx(td, num)}>
                        <span className="font-semibold">{money(r.status === 'DRAFT' ? r.invoiceTotal ?? r.grandTotal : r.grandTotal)}</span>
                        {gap !== null && r.itemCount > 0 && Math.abs(gap) > 1 && <span className="block text-[11px] font-normal text-rose-700">{money(Math.abs(gap))} still to match</span>}
                      </td>
                      <td className={cx(td, 'text-ink-soft')}>{r.createdBy}</td>
                      <td className={cx(td, 'w-8 text-ink-mute')} data-card-hide>
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pager page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      <NewPurchase open={newOpen} onClose={() => setNewOpen(false)} suppliers={suppliers.data ?? []} />
    </div>
  );
}

function NewPurchase({ open, onClose, suppliers }: { open: boolean; onClose: () => void; suppliers: Supplier[] }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState('');
  const [inv, setInv] = useState('');
  const [invDate, setInvDate] = useState(todayIso());
  const [inclusive, setInclusive] = useState(true);
  const [amount, setAmount] = useState('');
  const [newSup, setNewSup] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const addSupplier = async () => {
    setErr(null);
    try {
      const s = await post<Supplier>('/suppliers', { name: newSup });
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      setSupplierId(String(s.id));
      setNewSup('');
      toast(`Supplier ${s.name} added`);
    } catch (e) {
      setErr(e);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (amount.trim() === '' || !(amt > 0)) return setErr(new Error('Enter the invoice amount (the grand total printed on the supplier bill)'));
    setBusy(true);
    setErr(null);
    try {
      const p = await post<{ id: number; purchaseNo: string }>('/purchases', { supplierId: Number(supplierId), supplierInvoiceNo: inv, invoiceDate: invDate, taxInclusive: inclusive, invoiceTotal: amt });
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      toast(`${p.purchaseNo} created. Write this GRN number on the supplier bill.`);
      nav(`/purchases/${p.id}`);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase (GRN)">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-3 py-2.5 text-xs text-ink-soft">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-main text-main-fg">
            <Truck className="h-4 w-4" aria-hidden />
          </span>
          Copy the top of the supplier bill. A GRN number is given as soon as you continue; write it on the paper bill.
        </div>
        <Field label="Supplier">
          {(id) => (
            <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Choose…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {can(...MANAGE) ? (
          <div className="flex items-end gap-2">
            <Field label="Or add a new supplier" className="flex-1">
              {(id) => <Input id={id} value={newSup} onChange={(e) => setNewSup(e.target.value)} placeholder="Supplier name" />}
            </Field>
            <Button type="button" disabled={newSup.trim().length < 2} onClick={addSupplier}>
              Add
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-mute">A supplier that is not in the list has to be added by a manager first.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice / DC no">{(id) => <Input id={id} value={inv} onChange={(e) => setInv(e.target.value)} required maxLength={40} className="font-mono" />}</Field>
          <Field label="Invoice date">{(id) => <Input id={id} type="date" value={invDate} max={todayIso()} onChange={(e) => setInvDate(e.target.value)} required />}</Field>
        </div>
        <Field label="Invoice amount ₹ (grand total on the supplier bill)">
          {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className="text-right font-mono text-lg" placeholder="0.00" />}
        </Field>
        <Checkbox label="Rates on this bill already include GST" checked={inclusive} onChange={setInclusive} />
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Start entering items
          </Button>
        </div>
      </form>
    </Modal>
  );
}

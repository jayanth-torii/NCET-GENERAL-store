import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { date, money, todayIso } from '../lib/format';
import type { Supplier } from '../lib/types';
import { Badge, Button, Card, Checkbox, cx, Empty, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Pager, Select, Table, td, th, useToast } from '../components/ui';

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

export function Purchases() {
  const nav = useNavigate();
  const [f, setF] = useState({ status: '', q: '', supplierId: '', page: 1 });
  // Transactions → New purchase (GRN) opens this page with ?new=1.
  const [params, setParams] = useSearchParams();
  const newOpen = params.get('new') === '1';
  const setNewOpen = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: !v });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => get<Supplier[]>('/suppliers') });
  const list = useQuery({ queryKey: ['purchases', f], queryFn: () => get<{ rows: Row[]; total: number; page: number; pageSize: number }>(`/purchases${qs({ ...f, pageSize: 100 })}`) });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  return (
    <div>
      <PageHeader
        title="Purchases (GRN)"
        subtitle="Supplier bills. Each gets a GRN number when first saved. Stock goes up only when the GRN is posted, and posting needs the total to match the invoice amount."
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            New purchase
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr_220px]">
        <Field label="Status">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All</option>
              <option value="DRAFT">Drafts</option>
              <option value="POSTED">Posted</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          )}
        </Field>
        <Field label="Invoice or GRN no">{(id) => <Input id={id} value={f.q} onChange={(e) => set({ q: e.target.value })} />}</Field>
        <Field label="Supplier">
          {(id) => (
            <Select id={id} value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">All suppliers</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Card>
        {list.isLoading ? (
          <Loading />
        ) : list.data?.rows.length === 0 ? (
          <Empty>No purchases yet. Press "New purchase" when boxes arrive with a supplier bill.</Empty>
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
                </tr>
              </thead>
              <tbody>
                {list.data?.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-paper" onClick={() => nav(`/purchases/${r.id}`)}>
                    <td className={cx(td, 'font-mono')}>{r.purchaseNo ?? <span className="text-ink-mute">draft #{r.id}</span>}</td>
                    <td className={td}>{r.supplier}</td>
                    <td className={cx(td, 'font-mono')}>{r.supplierInvoiceNo}</td>
                    <td className={td}>{date(r.invoiceDate)}</td>
                    <td className={td}>{r.status === 'DRAFT' ? r.readyAt ? <Badge tone="amber">Ready to post</Badge> : <Badge>Draft</Badge> : r.status === 'POSTED' ? <Badge tone="teal">Posted</Badge> : <Badge tone="rose">Cancelled</Badge>}</td>
                    <td className={cx(td, num)}>{r.itemCount}</td>
                    <td className={cx(td, num)}>{money(r.status === 'DRAFT' ? r.invoiceTotal ?? r.grandTotal : r.grandTotal)}</td>
                    <td className={td}>{r.createdBy}</td>
                  </tr>
                ))}
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

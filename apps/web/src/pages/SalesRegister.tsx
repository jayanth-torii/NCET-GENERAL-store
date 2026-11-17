import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { download, get, post, qs } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { dateTime, money, qty, todayIso } from '../lib/format';
import { printReceipt } from '../lib/print';
import type { Counter } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, cx, Empty, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Pager, Select, Table, td, th, useToast } from '../components/ui';

interface Row {
  id: number;
  billNo: string;
  billedAt: string;
  counter: string;
  cashier: string;
  status: 'COMPLETED' | 'CANCELLED';
  grandTotal: number;
  itemCount: number;
  hasReturns: boolean;
  edited: boolean;
  printCount: number;
  priceOverride: boolean;
  payModes: string;
  customerName: string | null;
}

export function SalesRegister() {
  const { can } = useAuth();
  const isManager = can(...MANAGE);
  const today = todayIso();
  const [f, setF] = useState({ from: today, to: today, counterId: '', status: '', q: '', page: 1 });
  const [open, setOpen] = useState<number | null>(null);
  const counters = useQuery({ queryKey: ['counters'], queryFn: () => get<Counter[]>('/counters'), enabled: isManager });
  const list = useQuery({
    queryKey: ['sales', f],
    queryFn: () => get<{ rows: Row[]; total: number; page: number; pageSize: number; completedTotal: number; completedCount: number }>(`/sales${qs({ ...f, pageSize: 100 })}`),
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  const [dl, setDl] = useState<unknown>(null);

  return (
    <div>
      <PageHeader
        title="Sales register"
        subtitle={isManager ? 'Every bill with its status. Open a bill to reprint, download, edit, cancel or take a return.' : 'Your bills from today.'}
        actions={
          isManager && (
            <>
              <Button onClick={() => download(`/reports/sales/register${qs({ from: f.from, to: f.to, counterId: f.counterId, format: 'pdf' })}`).catch(setDl)}>PDF</Button>
              <Button onClick={() => download(`/reports/sales/register${qs({ from: f.from, to: f.to, counterId: f.counterId, format: 'xlsx' })}`).catch(setDl)}>Excel</Button>
            </>
          )
        }
      />
      <ErrorBox error={dl} />
      {isManager && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="From">{(id) => <Input id={id} type="date" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="date" value={f.to} min={f.from} onChange={(e) => set({ to: e.target.value })} />}</Field>
          <Field label="Counter">
            {(id) => (
              <Select id={id} value={f.counterId} onChange={(e) => set({ counterId: e.target.value })}>
                <option value="">All counters</option>
                {counters.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="">All</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            )}
          </Field>
          <Field label="Bill no or customer">{(id) => <Input id={id} value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="C1/26-27/000123" />}</Field>
        </div>
      )}
      <Card>
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.data!.rows.length === 0 ? (
          <Empty>No bills in this period.</Empty>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 border-b border-line px-4 py-2 text-sm">
              <span>
                Completed: <b className="font-mono">{list.data!.completedCount}</b> bills
              </span>
              <span>
                Total: <b className="font-mono">₹{money(list.data!.completedTotal)}</b>
              </span>
            </div>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Bill no</th>
                  <th className={th}>Time</th>
                  <th className={th}>Counter</th>
                  <th className={th}>Cashier</th>
                  <th className={th}>Paid by</th>
                  <th className={th}>Status</th>
                  <th className={cx(th, 'text-right')}>Lines</th>
                  <th className={cx(th, 'text-right')}>Total</th>
                </tr>
              </thead>
              <tbody>
                {list.data!.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-paper" onClick={() => setOpen(r.id)}>
                    <td className={cx(td, 'font-mono')}>
                      <button className="text-navy-700 underline-offset-2 hover:underline">{r.billNo}</button>
                    </td>
                    <td className={cx(td, 'whitespace-nowrap')}>{dateTime(r.billedAt)}</td>
                    <td className={td}>{r.counter}</td>
                    <td className={td}>{r.cashier}</td>
                    <td className={td}>{r.payModes}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.status === 'CANCELLED' ? <Badge tone="rose">Cancelled</Badge> : <Badge tone="teal">Completed</Badge>}
                        {r.edited && <Badge tone="amber">Edited</Badge>}
                        {r.priceOverride && <Badge tone="amber">Price changed</Badge>}
                        {r.printCount > 1 && <Badge tone="amber">Printed {r.printCount}×</Badge>}
                        {r.hasReturns && <Badge tone="amber">Returns</Badge>}
                      </div>
                    </td>
                    <td className={cx(td, num)}>{r.itemCount}</td>
                    <td className={cx(td, num, r.status === 'CANCELLED' && 'text-ink-mute line-through')}>{money(r.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      {open !== null && <BillDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

interface Detail {
  id: number;
  billNo: string;
  billedAt: string;
  status: 'COMPLETED' | 'CANCELLED';
  counter: { code: string };
  user: { fullName: string };
  itemsTotal: number;
  discountTotal: number;
  roundOff: number;
  taxTotal: number;
  grandTotal: number;
  tendered: number;
  changeDue: number;
  customerName: string | null;
  cancelReason: string | null;
  cancelledBy: { fullName: string } | null;
  cancelledAt: string | null;
  editCount: number;
  editedAt: string | null;
  items: { id: number; lineNo: number; codeSnapshot: string; nameSnapshot: string; qty: number; rate: number; discount: number; lineTotal: number; kitId: number | null; productId: number | null; returnedQty: number; components: { qtyPerKit: number; product: { code: string; name: string } }[] }[];
  payments: { id: number; mode: string; amount: number; reference: string | null }[];
  returns: { id: number; returnNo: string; createdAt: string; reason: string; total: number; refundMode: string; user: { fullName: string } }[];
  can: { edit: boolean; cancel: boolean; return: boolean };
}

export function BillDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => get<Detail>(`/sales/${id}`) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const s = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sale', id] });
    void qc.invalidateQueries({ queryKey: ['sales'] });
    void qc.invalidateQueries({ queryKey: ['catalogue'] });
  };
  return (
    <Modal open onClose={onClose} side title={s ? `Bill ${s.billNo}` : 'Bill'}>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error ?? err} />
      {s && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {s.status === 'CANCELLED' ? <Badge tone="rose">Cancelled</Badge> : <Badge tone="teal">Completed</Badge>}
            {s.editCount > 0 && <Badge tone="amber">Edited {s.editCount}×</Badge>}
            <span className="text-ink-mute">
              {dateTime(s.billedAt)} · Counter {s.counter.code} · {s.user.fullName}
            </span>
          </div>
          {s.customerName && <p>Customer: {s.customerName}</p>}
          {s.status === 'CANCELLED' && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-700">
              Cancelled by {s.cancelledBy?.fullName} at {dateTime(s.cancelledAt)}: {s.cancelReason}
            </p>
          )}
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={cx(th, 'text-right')}>Qty</th>
                <th className={cx(th, 'text-right')}>Rate</th>
                <th className={cx(th, 'text-right')}>Disc</th>
                <th className={cx(th, 'text-right')}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <div>{i.nameSnapshot}</div>
                    <div className="font-mono text-xs text-ink-mute">
                      {i.codeSnapshot}
                      {i.returnedQty > 0 && <span className="ml-2 text-amber-700">returned {qty(i.returnedQty)}</span>}
                    </div>
                    {i.components.length > 0 && <div className="text-xs text-ink-mute">{i.components.map((c) => `${qty(c.qtyPerKit)} × ${c.product.name}`).join(', ')}</div>}
                  </td>
                  <td className={cx(td, num)}>{qty(i.qty)}</td>
                  <td className={cx(td, num)}>{money(i.rate)}</td>
                  <td className={cx(td, num)}>{i.discount ? money(i.discount) : ''}</td>
                  <td className={cx(td, num)}>{money(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 font-mono">
            <dt className="font-sans text-ink-mute">Items</dt>
            <dd className="text-right">{money(s.itemsTotal)}</dd>
            {s.discountTotal > 0 && (
              <>
                <dt className="font-sans text-ink-mute">Discount</dt>
                <dd className="text-right">−{money(s.discountTotal)}</dd>
              </>
            )}
            {s.roundOff !== 0 && (
              <>
                <dt className="font-sans text-ink-mute">Round off</dt>
                <dd className="text-right">{money(s.roundOff)}</dd>
              </>
            )}
            <dt className="font-sans font-semibold">Total</dt>
            <dd className="text-right text-lg font-semibold">₹{money(s.grandTotal)}</dd>
            {s.payments.map((p) => (
              <div key={p.id} className="contents">
                <dt className="font-sans text-ink-mute">
                  {p.mode}
                  {p.reference ? ` (${p.reference})` : ''}
                </dt>
                <dd className="text-right">{money(p.amount)}</dd>
              </div>
            ))}
            <dt className="font-sans text-ink-mute">Change given</dt>
            <dd className="text-right">{money(s.changeDue)}</dd>
          </dl>
          {s.returns.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Returns</h3>
              <ul className="space-y-1">
                {s.returns.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 rounded bg-amber-50 px-3 py-1.5 text-amber-700">
                    <span>
                      {r.returnNo} · {dateTime(r.createdAt)} · {r.user.fullName} · {r.reason}
                    </span>
                    <span className="font-mono">
                      −₹{money(r.total)} {r.refundMode}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button onClick={() => printReceipt(s.id).then(() => toast('Sent to printer. Copies are stamped DUPLICATE and logged.')).catch(setErr)}>Reprint</Button>
            <Button onClick={() => download(`/sales/${s.id}/receipt?format=pdf`).catch(setErr)}>PDF (80 mm)</Button>
            <Button onClick={() => download(`/sales/${s.id}/receipt?format=pdf&size=a4`).catch(setErr)}>PDF (A4)</Button>
            {s.can.edit && (
              <Button variant="warn" onClick={() => nav(`/billing?edit=${s.id}`)}>
                Edit bill
              </Button>
            )}
            {s.can.return && <Button onClick={() => setReturnOpen(true)}>Sales return</Button>}
            {s.can.cancel && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel bill
              </Button>
            )}
          </div>
          {!s.can.edit && s.status === 'COMPLETED' && s.can.return && <p className="text-xs text-ink-mute">Only today's bills without returns can be edited or cancelled. Use a sales return for anything else.</p>}
        </div>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${s?.billNo}?`}
        message="Stock for every item goes back on the shelf and the bill is marked cancelled. It stays in the register and the audit log."
        confirmLabel="Cancel bill"
        danger
        needReason
        onConfirm={async (reason) => {
          await post(`/sales/${id}/cancel`, { reason });
          toast('Bill cancelled');
          refresh();
        }}
      />
      {s && returnOpen && (
        <ReturnDialog
          sale={s}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            refresh();
          }}
        />
      )}
    </Modal>
  );
}

function ReturnDialog({ sale, onClose, onDone }: { sale: Detail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  // Refunds go back the way the bill was paid.
  const paidModes = [...new Set(sale.payments.map((p) => p.mode))];
  const [mode, setMode] = useState(paidModes[0] ?? 'CASH');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const items = Object.entries(qtys)
    .map(([k, v]) => ({ saleItemId: Number(k), qty: Number(v) }))
    .filter((x) => x.qty > 0);
  const estimate = items.reduce((a, x) => {
    const it = sale.items.find((i) => i.id === x.saleItemId)!;
    return a + (it.lineTotal / it.qty) * x.qty;
  }, 0);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ returnNo: string; total: number }>(`/sales/${sale.id}/returns`, { items, reason, refundMode: mode });
      toast(`${r.returnNo}: refund ₹${money(r.total)} by ${mode}`);
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
      title={`Return items from ${sale.billNo}`}
      wide
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" busy={busy} disabled={!items.length || reason.trim().length < 3} onClick={go}>
            Record return · about ₹{money(estimate)}
          </Button>
        </>
      }
    >
      <Table>
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={cx(th, 'text-right')}>Sold</th>
            <th className={cx(th, 'text-right')}>Already returned</th>
            <th className={cx(th, 'text-right')}>Return now</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => {
            const left = i.qty - i.returnedQty;
            return (
              <tr key={i.id}>
                <td className={td}>{i.nameSnapshot}</td>
                <td className={cx(td, num)}>{qty(i.qty)}</td>
                <td className={cx(td, num)}>{qty(i.returnedQty)}</td>
                <td className={cx(td, 'w-28')}>
                  <Input aria-label={`Return quantity for ${i.nameSnapshot}`} inputMode="decimal" className="text-right font-mono" disabled={left <= 0} placeholder={`max ${qty(left)}`} value={qtys[i.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Wrong size, damaged" />}</Field>
        <Field label="Refund by">
          {(id) => (
            <Select id={id} value={mode} onChange={(e) => setMode(e.target.value)}>
              {(paidModes.length ? paidModes : ['CASH']).map((m) => (
                <option key={m} value={m}>
                  {m === 'CASH' ? 'Cash' : m === 'UPI' ? 'UPI (back to the same account)' : 'Card'}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-3">
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { useCatalogue } from '../lib/catalogue';
import { dateTime, monthStartIso, qty, todayIso } from '../lib/format';
import type { Category, CatalogueItem } from '../lib/types';
import { ReportView } from '../components/ReportView';
import { Badge, Button, Card, Checkbox, ConfirmDialog, cx, Empty, ErrorBox, Field, Input, Loading, num, PageHeader, Select, Table, Tabs, td, th, useToast } from '../components/ui';

type Tab = 'summary' | 'low' | 'adjust' | 'ledger';

export function Stock() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'summary';
  const setTab = (t: Tab) => setParams({ tab: t });
  const [ledgerFor, setLedgerFor] = useState<number | null>(null);
  return (
    <div>
      <PageHeader title="Stock" subtitle="Live stock from the movement ledger. Closing = Opening + Purchased − Sold + Sales returns − Purchase returns ± Adjustments." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Stock summary' },
          { value: 'low', label: 'Low & negative' },
          { value: 'adjust', label: 'Adjustments' },
          { value: 'ledger', label: 'Item ledger' },
        ]}
      />
      {tab === 'summary' && (
        <Summary
          onOpen={(id) => {
            setLedgerFor(id);
            setTab('ledger');
          }}
        />
      )}
      {tab === 'low' && <ReportView path="/reports/stock/low" formats={['pdf', 'xlsx']} />}
      {tab === 'adjust' && <Adjustments />}
      {tab === 'ledger' && <Ledger initial={ledgerFor} />}
    </div>
  );
}

function Summary({ onOpen }: { onOpen: (productId: number) => void }) {
  const today = todayIso();
  const [from, setFrom] = useState(monthStartIso(today));
  const [to, setTo] = useState(today);
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [below, setBelow] = useState(false);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') });
  return (
    <>
      <form
        className="mb-4 grid grid-cols-2 items-end gap-3 md:grid-cols-[160px_160px_200px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
        }}
      >
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value || to)} />}</Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Search">{(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setApplied(q)} placeholder="Name or code, then Enter" />}</Field>
        <div className="pb-2">
          <Checkbox label="Below reorder only" checked={below} onChange={setBelow} />
        </div>
      </form>
      <ReportView path={`/stock/summary${qs({ from, to, categoryId, q: applied, belowReorderOnly: below ? 'true' : undefined })}`} onRowClick={(r) => onOpen(Number(r.productId))} />
      <p className="mt-2 text-xs text-ink-mute">Click a row to open its item ledger.</p>
    </>
  );
}

interface Adj {
  id: number;
  qtyChange: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  product: { code: string; name: string; unit: { code: string }; stock: { onHand: number } | null };
  requestedBy: { fullName: string };
  decidedBy: { fullName: string } | null;
}

function ProductPicker({ value, onChange }: { value: CatalogueItem | null; onChange: (p: CatalogueItem | null) => void }) {
  const cat = useCatalogue();
  const [text, setText] = useState('');
  const hits = cat.search(text, 8);
  if (value)
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 text-sm">
        <span className="truncate">
          <span className="font-mono text-xs text-ink-mute">{value.code}</span> {value.name}
        </span>
        <button type="button" className="text-xs text-navy-700" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search product" aria-label="Product" />
      {text.trim() && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => (onChange(h), setText(''))}>
                <span className="w-14 font-mono text-xs text-ink-mute">{h.code}</span>
                <span className="flex-1">{h.name}</span>
                <span className="font-mono text-xs text-ink-mute">
                  {qty(h.onHand)} {h.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Adjustments() {
  const { can } = useAuth();
  const isManager = can(...MANAGE);
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const list = useQuery({ queryKey: ['adjustments', status], queryFn: () => get<Adj[]>(`/stock/adjustments${qs({ status })}`) });
  const [product, setProduct] = useState<CatalogueItem | null>(null);
  const [mode, setMode] = useState<'count' | 'change'>('count');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<{ adj: Adj; approve: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return setErr(new Error('Choose a product'));
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ status: string }>('/stock/adjustments', { productId: product.id, ...(mode === 'count' ? { countedQty: Number(value) } : { qtyChange: Number(value) }), reason });
      toast(r.status === 'APPROVED' ? 'Stock adjusted' : 'Sent to a manager for approval');
      setProduct(null);
      setValue('');
      setReason('');
      void qc.invalidateQueries({ queryKey: ['adjustments'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const preview = product && value.trim() !== '' && !Number.isNaN(Number(value)) ? (mode === 'count' ? Number(value) - Number(product.onHand) : Number(value)) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card title="New adjustment">
        <form onSubmit={submit} className="space-y-3 p-4">
          <Field label="Product">{() => <ProductPicker value={product} onChange={setProduct} />}</Field>
          {product && (
            <p className="text-sm text-ink-mute">
              System stock now: <b className="font-mono text-ink">{qty(product.onHand)}</b> {product.unit}
            </p>
          )}
          <Field label="How">
            {(id) => (
              <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as 'count' | 'change')}>
                <option value="count">I counted the shelf</option>
                <option value="change">Add or remove a quantity</option>
              </Select>
            )}
          </Field>
          <Field label={mode === 'count' ? 'Counted quantity' : 'Change (use minus to remove, e.g. -3)'}>{(id) => <Input id={id} inputMode="decimal" className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
          {preview !== null && (
            <p className={cx('text-sm', preview < 0 ? 'text-rose-700' : 'text-navy-700')}>
              Stock will change by <b className="font-mono">{preview > 0 ? '+' : ''}{qty(preview)}</b>
            </p>
          )}
          <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Damaged, count correction, expired…" />}</Field>
          <ErrorBox error={err} />
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            {isManager ? 'Adjust stock' : 'Send for approval'}
          </Button>
          {!isManager && <p className="text-xs text-ink-mute">Store keeper adjustments wait for a manager to approve them.</p>}
        </form>
      </Card>
      <Card
        title="Adjustments"
        actions={
          <Select aria-label="Status" className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </Select>
        }
      >
        {list.isLoading ? (
          <Loading />
        ) : list.data?.length === 0 ? (
          <Empty>Nothing here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Item</th>
                <th className={cx(th, 'text-right')}>Change</th>
                <th className={th}>Reason</th>
                <th className={th}>By</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.data?.map((a) => (
                <tr key={a.id}>
                  <td className={cx(td, 'whitespace-nowrap')}>{dateTime(a.createdAt)}</td>
                  <td className={td}>
                    {a.product.name}
                    <div className="font-mono text-xs text-ink-mute">
                      {a.product.code} · now {qty(a.product.stock?.onHand ?? 0)} {a.product.unit.code}
                    </div>
                  </td>
                  <td className={cx(td, num, Number(a.qtyChange) < 0 ? 'text-rose-700' : 'text-navy-700')}>
                    {Number(a.qtyChange) > 0 ? '+' : ''}
                    {qty(a.qtyChange)}
                  </td>
                  <td className={td}>{a.reason}</td>
                  <td className={td}>
                    {a.requestedBy.fullName}
                    {a.decidedBy && <div className="text-xs text-ink-mute">decided by {a.decidedBy.fullName}</div>}
                  </td>
                  <td className={td}>{a.status === 'PENDING' ? <Badge tone="amber">Waiting</Badge> : a.status === 'APPROVED' ? <Badge tone="teal">Approved</Badge> : <Badge tone="rose">Rejected</Badge>}</td>
                  <td className={cx(td, 'whitespace-nowrap')}>
                    {isManager && a.status === 'PENDING' && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setDecide({ adj: a, approve: true })}>
                          Approve
                        </Button>{' '}
                        <Button size="sm" onClick={() => setDecide({ adj: a, approve: false })}>
                          Reject
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ConfirmDialog
        open={decide !== null}
        onClose={() => setDecide(null)}
        title={decide?.approve ? 'Approve adjustment?' : 'Reject adjustment?'}
        message={decide ? `${decide.adj.product.name}: ${Number(decide.adj.qtyChange) > 0 ? '+' : ''}${qty(decide.adj.qtyChange)} ${decide.adj.product.unit.code}. ${decide.adj.reason}` : ''}
        confirmLabel={decide?.approve ? 'Approve' : 'Reject'}
        danger={!decide?.approve}
        onConfirm={async () => {
          await post(`/stock/adjustments/${decide!.adj.id}/${decide!.approve ? 'approve' : 'reject'}`, {});
          toast(decide!.approve ? 'Approved and stock updated' : 'Rejected');
          void qc.invalidateQueries({ queryKey: ['adjustments'] });
          void qc.invalidateQueries({ queryKey: ['catalogue'] });
        }}
      />
    </div>
  );
}

function Ledger({ initial }: { initial: number | null }) {
  const cat = useCatalogue();
  const today = todayIso();
  const [product, setProduct] = useState<CatalogueItem | null>(null);
  const [from, setFrom] = useState(monthStartIso(today));
  const [to, setTo] = useState(today);
  const chosen = product ?? (initial ? cat.byId.get(initial) ?? null : null);
  return (
    <div>
      <div className="mb-4 grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_160px_160px]">
        <Field label="Product">{() => <ProductPicker value={chosen} onChange={setProduct} />}</Field>
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value || to)} />}</Field>
      </div>
      {chosen ? <ReportView path={`/stock/movements${qs({ product: chosen.id, from, to })}`} /> : <Empty>Choose a product to see every movement with its running balance.</Empty>}
    </div>
  );
}

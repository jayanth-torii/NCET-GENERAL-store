import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Download, IndianRupee, PackageX, Pencil, Plus, Power, Upload } from 'lucide-react';
import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { api, download, get, post, qs } from '../../services/http.common';
import { MANAGE, useAuth } from '../../app/auth';
import { useCatalogue } from '../../services/catalogue.service';
import { money, qty } from '../../services/format';
import type { Category, Product } from '../../data/types';
import { ProductForm } from '../../components/ProductForm';
import { Avatar, Badge, Button, Card, ConfirmDialog, cx, Empty, ErrorBox, Loading, Modal, num, PageHeader, Pager, SearchInput, Segmented, StatTile, Table, td, th, useToast } from '../../components/ui';

type StockFilter = 'all' | 'out' | 'low';

/** Stock pill: red below/at zero, amber at or under the reorder level, green otherwise. */
function StockPill({ p }: { p: Product }) {
  const on = Number(p.onHand);
  const re = Number(p.reorderLevel);
  const tone = on <= 0 ? 'bg-rose-50 text-rose-700 border-rose-600/20' : re > 0 && on <= re ? 'bg-amber-50 text-amber-700 border-amber-600/25' : 'bg-leaf-50 text-leaf-700 border-leaf-600/20';
  const pct = re > 0 ? Math.max(4, Math.min(100, (on / (re * 3)) * 100)) : on > 0 ? 100 : 0;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold', tone)}>
        {qty(p.onHand)} {p.unitCode}
      </span>
      {re > 0 && (
        <span className="h-1 w-16 overflow-hidden rounded-full bg-ink/[0.07]" title={`Reorder level ${qty(re)}`}>
          <span className={cx('block h-full rounded-full', on <= 0 ? 'bg-rose-500' : on <= re ? 'bg-amber-500' : 'bg-leaf-500')} style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

export function Products() {
  const { can } = useAuth();
  const isManager = can(...MANAGE);
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useCatalogue();
  const [f, setF] = useState({ q: '', categoryId: '', active: 'true', page: 1 });
  const [stock, setStock] = useState<StockFilter>('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [toggle, setToggle] = useState<Product | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') });
  const list = useQuery({ queryKey: ['products', f], queryFn: () => get<{ rows: Product[]; total: number; page: number; pageSize: number }>(`/products${qs({ ...f, pageSize: 100 })}`) });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['catalogue'] });
  };

  // Store-wide figures from the catalogue cache (all active items), so they do not depend on the page shown.
  const stats = useMemo(() => {
    const items = (cat.data?.products ?? []).filter((c) => c.isActive);
    const byCat = new Map<number, number>();
    let out = 0;
    let value = 0;
    for (const c of items) {
      byCat.set(c.categoryId, (byCat.get(c.categoryId) ?? 0) + 1);
      if (Number(c.onHand) <= 0) out++;
      if (c.lastCost !== null && Number(c.onHand) > 0) value += Number(c.onHand) * Number(c.lastCost);
    }
    return { active: items.length, out, value, byCat };
  }, [cat.data]);

  const rows = (list.data?.rows ?? []).filter((p) => {
    const on = Number(p.onHand);
    if (stock === 'out') return on <= 0;
    if (stock === 'low') return on > 0 && Number(p.reorderLevel) > 0 && on <= Number(p.reorderLevel);
    return true;
  });
  const lowOnPage = (list.data?.rows ?? []).filter((p) => Number(p.onHand) > 0 && Number(p.reorderLevel) > 0 && Number(p.onHand) <= Number(p.reorderLevel)).length;

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api<{ created: number; updated: number }>('/products/import', { form });
      toast(`Import done: ${r.created} added, ${r.updated} updated`);
      refresh();
    } catch (x) {
      setErr(x);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        subtitle="Product master. Prices include GST."
        actions={
          <>
            {isManager && (
              <>
                <Button variant="excel" onClick={() => download('/products/export').catch(setErr)} title="Download every product as an Excel sheet">
                  <Download aria-hidden /> Export Excel
                </Button>
                <Button variant="soft" busy={importing} onClick={() => fileRef.current?.click()} title="Import uses the same columns as the export. Rows are matched by Code. If any row has a problem, nothing is imported and every problem is listed.">
                  <Upload aria-hidden /> Import Excel
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onImport} />
              </>
            )}
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add product
            </Button>
          </>
        }
      />
      <ErrorBox error={err} />

      {/* store-wide figures; the stock tiles filter the list */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Boxes />} label="Active products" value={stats.active} sub={`${cats.data?.length ?? 0} categories`} active={stock === 'all'} onClick={() => setStock('all')} />
        <StatTile icon={<PackageX />} tone="rose" label="Out of stock" value={stats.out} sub="Zero or below" active={stock === 'out'} onClick={() => setStock(stock === 'out' ? 'all' : 'out')} />
        <StatTile icon={<AlertTriangle />} tone="amber" label="Low stock" value={lowOnPage} sub="At or under reorder level" active={stock === 'low'} onClick={() => setStock(stock === 'low' ? 'all' : 'low')} />
        <StatTile icon={<IndianRupee />} tone="teal" label="Stock value at cost" value={`₹${money(stats.value)}`} sub="On hand × last cost" />
      </div>

      {/* filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput className="min-w-[220px] flex-1" aria-label="Search" value={f.q} onChange={(e) => set({ q: e.target.value })} onClear={() => set({ q: '' })} placeholder="Search by name, code or barcode" />
          <Segmented
            label="Show"
            value={f.active as 'true' | 'false' | 'all'}
            onChange={(v) => set({ active: v })}
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Switched off' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Category">
          {[{ id: '', name: 'All categories' }, ...(cats.data ?? []).map((c) => ({ id: String(c.id), name: c.name }))].map((c) => {
            const on = f.categoryId === c.id;
            const n = c.id ? stats.byCat.get(Number(c.id)) ?? 0 : stats.active;
            return (
              <button
                key={c.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => set({ categoryId: c.id })}
                className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors', on ? 'border-transparent bg-main text-main-fg' : 'border-line bg-paper text-ink-soft hover:border-brand-500/40 hover:text-ink')}
              >
                {c.name}
                <span className={cx('rounded-full px-1.5 text-[10px] font-semibold', on ? 'bg-white/20' : 'bg-ink/[0.06]')}>{n}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>{stock === 'all' ? 'No products match.' : stock === 'out' ? 'Nothing is out of stock in this list.' : 'Nothing is at its reorder level in this list.'}</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Name</th>
                  <th className={th}>Category</th>
                  <th className={cx(th, 'text-right')}>Sale ₹</th>
                  <th className={cx(th, 'text-right')}>MRP ₹</th>
                  <th className={cx(th, 'text-right')}>GST</th>
                  <th className={cx(th, 'text-right')}>Cost ₹</th>
                  <th className={cx(th, 'text-right')}>On hand</th>
                  <th className={th}>Rack</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={cx('group', !p.isActive && 'opacity-60')}>
                    <td className={cx(td, 'font-mono text-xs text-ink-mute')}>{p.code}</td>
                    <td className={td} data-title>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={p.name} size="sm" />
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{p.name}</span>
                          {!p.isActive && (
                            <span className="ml-2">
                              <Badge>Off</Badge>
                            </span>
                          )}
                          {p.packUnitCode && <span className="block text-xs font-normal text-ink-mute">{`${p.packUnitCode} of ${qty(p.packSize)} ${p.unitCode}`}</span>}
                        </span>
                      </span>
                    </td>
                    <td className={td}>
                      <span className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-xs">{p.categoryName}</span>
                    </td>
                    <td className={cx(td, num, 'font-semibold')}>{money(p.salePrice)}</td>
                    <td className={cx(td, num, 'text-ink-mute')}>{p.mrp === null ? '' : money(p.mrp)}</td>
                    <td className={cx(td, num)}>
                      <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 text-xs text-brand-700">{Number(p.gstRate)}%</span>
                    </td>
                    <td className={cx(td, num, 'text-ink-mute')}>{p.lastCost === null ? '' : money(p.lastCost)}</td>
                    <td className={cx(td, num)}>
                      <StockPill p={p} />
                    </td>
                    <td className={cx(td, 'text-ink-mute')}>{p.rackNo}</td>
                    <td className={cx(td, 'whitespace-nowrap text-right')}>
                      <span className="inline-flex gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          <Pencil aria-hidden /> Edit
                        </Button>
                        {isManager && (
                          <Button size="sm" variant="ghost" className={p.isActive ? 'hover:!text-rose-700' : 'hover:!text-leaf-700'} onClick={() => setToggle(p)}>
                            <Power aria-hidden /> {p.isActive ? 'Switch off' : 'Switch on'}
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add product' : `Edit ${editing?.name ?? ''}`} wide>
        {editing !== null && (
          <ProductForm
            product={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={(p) => {
              toast(`${p.name} saved (code ${p.code})`);
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={toggle !== null}
        onClose={() => setToggle(null)}
        title={toggle?.isActive ? `Switch off ${toggle?.name}?` : `Switch on ${toggle?.name}?`}
        message={toggle?.isActive ? 'It will no longer appear at the counter or in purchases. Its history and stock stay.' : 'It will be available for billing and purchases again.'}
        confirmLabel={toggle?.isActive ? 'Switch off' : 'Switch on'}
        onConfirm={async () => {
          await post(`/products/${toggle!.id}/${toggle!.isActive ? 'deactivate' : 'activate'}`);
          refresh();
        }}
      />
    </div>
  );
}

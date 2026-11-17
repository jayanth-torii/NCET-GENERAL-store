import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, useRef, useState } from 'react';
import { api, download, get, post, qs } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import { money, qty } from '../lib/format';
import type { Category, Product } from '../lib/types';
import { ProductForm } from '../components/ProductForm';
import { Badge, Button, Card, ConfirmDialog, cx, Empty, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Pager, Select, Table, td, th, useToast } from '../components/ui';

export function Products() {
  const { can } = useAuth();
  const isManager = can(...MANAGE);
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ q: '', categoryId: '', active: 'true', page: 1 });
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
    <div>
      <PageHeader
        title="Products"
        subtitle="Product master. Prices include GST."
        actions={
          <>
            {isManager && (
              <>
                <Button onClick={() => download('/products/export').catch(setErr)}>Export Excel</Button>
                <Button busy={importing} onClick={() => fileRef.current?.click()}>
                  Import Excel
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onImport} />
              </>
            )}
            <Button variant="primary" onClick={() => setEditing('new')}>
              Add product
            </Button>
          </>
        }
      />
      {isManager && <p className="-mt-3 mb-4 text-xs text-ink-mute">Import uses the same columns as the export. Rows are matched by Code. If any row has a problem, nothing is imported and every problem is listed.</p>}
      <ErrorBox error={err} />
      <div className="mb-4 mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_160px]">
        <Field label="Search">{(id) => <Input id={id} value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Name, code or barcode" />}</Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">All</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Show">
          {(id) => (
            <Select id={id} value={f.active} onChange={(e) => set({ active: e.target.value })}>
              <option value="true">Active</option>
              <option value="false">Switched off</option>
              <option value="all">All</option>
            </Select>
          )}
        </Field>
      </div>
      <Card>
        {list.isLoading ? (
          <Loading />
        ) : list.data?.rows.length === 0 ? (
          <Empty>No products match.</Empty>
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
                {list.data?.rows.map((p) => (
                  <tr key={p.id} className={cx(!p.isActive && 'text-ink-mute')}>
                    <td className={cx(td, 'font-mono')}>{p.code}</td>
                    <td className={td}>
                      {p.name}
                      {!p.isActive && (
                        <span className="ml-2">
                          <Badge>Off</Badge>
                        </span>
                      )}
                      {p.packUnitCode && <div className="text-xs text-ink-mute">{`${p.packUnitCode} of ${qty(p.packSize)} ${p.unitCode}`}</div>}
                    </td>
                    <td className={td}>{p.categoryName}</td>
                    <td className={cx(td, num)}>{money(p.salePrice)}</td>
                    <td className={cx(td, num)}>{p.mrp === null ? '' : money(p.mrp)}</td>
                    <td className={cx(td, num)}>{Number(p.gstRate)}%</td>
                    <td className={cx(td, num)}>{p.lastCost === null ? '' : money(p.lastCost)}</td>
                    <td className={cx(td, num, Number(p.onHand) < 0 ? 'text-rose-700' : Number(p.reorderLevel) > 0 && Number(p.onHand) <= Number(p.reorderLevel) ? 'text-amber-700' : '')}>
                      {qty(p.onHand)} {p.unitCode}
                    </td>
                    <td className={td}>{p.rackNo}</td>
                    <td className={cx(td, 'whitespace-nowrap text-right')}>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      {isManager && (
                        <Button size="sm" variant="ghost" onClick={() => setToggle(p)}>
                          {p.isActive ? 'Switch off' : 'Switch on'}
                        </Button>
                      )}
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

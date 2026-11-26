import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, get, patch, post, put, qs } from '../../services/http.common';
import { useAuth } from '../../app/auth';
import { useCatalogue } from '../../services/catalogue.service';
import { dateTime, money, qty, ROLE_LABEL, todayIso } from '../../services/format';
import type { Category, ChargeType, Counter, Kit, Role, Settings, Supplier, Unit } from '../../data/types';
import { Badge, Button, Card, Checkbox, ConfirmDialog, cx, Empty, ErrorBox, Field, Input, Loading, Modal, num, PageHeader, Select, Table, Tabs, td, th, useToast, wrap } from '../../components/ui';

type Tab = 'users' | 'sessions' | 'counters' | 'charges' | 'catalogue' | 'suppliers' | 'kits' | 'settings' | 'audit' | 'golive';

export function Admin() {
  const { me } = useAuth();
  const isAdmin = me?.role === 'ADMIN';
  const tabs: { value: Tab; label: string }[] = [
    { value: 'users', label: 'Users' },
    { value: 'kits', label: 'Section kits' },
    { value: 'suppliers', label: 'Suppliers' },
    { value: 'catalogue', label: 'Categories & units' },
    ...(isAdmin
      ? [
          { value: 'charges' as Tab, label: 'Charge types' },
          { value: 'counters' as Tab, label: 'Counters' },
          { value: 'settings' as Tab, label: 'Store settings' },
          { value: 'golive' as Tab, label: 'Go-live tools' },
        ]
      : []),
    { value: 'sessions', label: 'Who is logged in' },
    { value: 'audit', label: 'Audit log' },
  ];
  // The tab lives in the URL (?tab=counters) so the top menu can open any of them directly.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : 'users';
  const setTab = (t: Tab) => setParams({ tab: t });
  return (
    <div>
      <PageHeader title="Masters & utilities" subtitle={isAdmin ? 'Everything here is recorded in the audit log.' : 'Managers can manage kits, suppliers and categories. Ask the admin for users and settings.'} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'users' && <Users isAdmin={isAdmin} />}
      {tab === 'counters' && <Counters />}
      {tab === 'charges' && <ChargeTypes />}
      {tab === 'catalogue' && <CatalogueMasters isAdmin={isAdmin} />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'kits' && <Kits />}
      {tab === 'settings' && <StoreSettings />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'sessions' && <Sessions isAdmin={isAdmin} />}
      {tab === 'golive' && <GoLive />}
    </div>
  );
}

// ---------------- Users ----------------
interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

function Users({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  return (
    <Card title="People who use the system" actions={isAdmin && <Button size="sm" variant="primary" onClick={() => setEdit('new')}>Add user</Button>}>
      {users.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Username</th>
              <th className={th}>Role</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className={cx(!u.isActive && 'text-ink-mute')}>
                <td className={td}>{u.fullName}</td>
                <td className={cx(td, 'font-mono')}>{u.username}</td>
                <td className={td}>{ROLE_LABEL[u.role]}</td>
                <td className={td}>
                  {u.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Switched off</Badge>} {u.mustChangePassword && u.isActive && <Badge tone="amber">Must set password</Badge>}
                </td>
                <td className={cx(td, 'whitespace-nowrap text-right')}>
                  {isAdmin && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(u)} disabled={u.id === me?.id}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReset(u)}>
                        Reset password
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <UserDialog
        user={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          toast('User saved');
          void qc.invalidateQueries({ queryKey: ['users'] });
        }}
      />
      <ResetDialog
        user={reset}
        onClose={() => setReset(null)}
        onDone={() => {
          setReset(null);
          toast('Temporary password set. They must change it when they log in.');
          void qc.invalidateQueries({ queryKey: ['users'] });
        }}
      />
    </Card>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: User | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ username: '', fullName: '', role: 'CASHIER' as Role, password: '', isActive: true });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErr(null);
    if (user && user !== 'new') setF({ username: user.username, fullName: user.fullName, role: user.role, password: '', isActive: user.isActive });
    else setF({ username: '', fullName: '', role: 'CASHIER', password: '', isActive: true });
  }, [user]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (user === 'new') await post('/users', { username: f.username, fullName: f.fullName, role: f.role, password: f.password });
      else if (user) await patch(`/users/${user.id}`, { fullName: f.fullName, role: f.role, isActive: f.isActive });
      onSaved();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={user !== null} onClose={onClose} title={user === 'new' ? 'Add user' : 'Edit user'}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Full name">{(id) => <Input id={id} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required maxLength={60} />}</Field>
        <Field label="Username" hint="Letters, digits, dot or underscore. Cannot change later.">
          {(id) => <Input id={id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required disabled={user !== 'new'} className="font-mono" />}
        </Field>
        <Field label="Role">
          {(id) => (
            <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="CASHIER">Cashier: bills, holds, reprints, own day's report</option>
              <option value="STORE_KEEPER">Store keeper: purchases, products, stock</option>
              <option value="MANAGER">Manager: everything except users and settings</option>
              <option value="ADMIN">Admin: everything</option>
            </Select>
          )}
        </Field>
        {user === 'new' ? (
          <Field label="Temporary password" hint="They must change it at first login. 8+ characters with letters and numbers.">
            {(id) => <Input id={id} type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="off" />}
          </Field>
        ) : (
          <Checkbox label="Account is active (switching off signs them out at once)" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
        )}
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetDialog({ user, onClose, onDone }: { user: User | null; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPw('');
    setErr(null);
  }, [user]);
  return (
    <Modal open={user !== null} onClose={onClose} title={`Reset password for ${user?.fullName}`}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/users/${user!.id}/reset-password`, { password: pw });
            onDone();
          } catch (x) {
            setErr(x);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-ink-mute">They are signed out everywhere and must choose a new password at next login.</p>
        <Field label="Temporary password">{(id) => <Input id={id} value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="off" />}</Field>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Set password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Simple list editor used by several masters ----------------
function ListEditor<T extends { id: number }>({
  title,
  rows,
  loading,
  columns,
  canEdit,
  empty,
  form,
  onSave,
  addLabel = 'Add',
}: {
  title: string;
  rows: T[] | undefined;
  loading: boolean;
  columns: { label: string; render: (r: T) => ReactNode; right?: boolean }[];
  canEdit: boolean;
  empty: string;
  form: (value: Partial<T>, set: (v: Partial<T>) => void) => ReactNode;
  onSave: (value: Partial<T>, existing: T | null) => Promise<unknown>;
  addLabel?: string;
}) {
  const [edit, setEdit] = useState<{ row: T | null; value: Partial<T> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Card title={title} actions={canEdit && <Button size="sm" variant="primary" onClick={() => (setErr(null), setEdit({ row: null, value: {} }))}>{addLabel}</Button>}>
      {loading ? (
        <Loading />
      ) : !rows?.length ? (
        <Empty>{empty}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={cx(th, c.right && 'text-right')}>
                  {c.label}
                </th>
              ))}
              {canEdit && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.label} className={cx(td, c.right && num)}>
                    {c.render(r)}
                  </td>
                ))}
                {canEdit && (
                  <td className={cx(td, 'text-right')}>
                    <Button size="sm" variant="ghost" onClick={() => (setErr(null), setEdit({ row: r, value: { ...r } }))}>
                      Edit
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.row ? `Edit` : addLabel} wide>
        {edit && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                await onSave(edit.value, edit.row);
                toast('Saved');
                setEdit(null);
              } catch (x) {
                setErr(x);
              } finally {
                setBusy(false);
              }
            }}
          >
            {form(edit.value, (v) => setEdit((s) => (s ? { ...s, value: { ...s.value, ...v } } : s)))}
            <ErrorBox error={err} />
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setEdit(null)}>
                Back
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

function Counters() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['counters'], queryFn: () => get<Counter[]>('/counters') });
  return (
    <ListEditor<Counter>
      title="Counters"
      rows={q.data}
      loading={q.isLoading}
      canEdit
      empty="No counters."
      addLabel="Add counter"
      columns={[
        { label: 'Code', render: (c) => <span className="font-mono">{c.code}</span> },
        { label: 'Name', render: (c) => c.name },
        { label: 'Printer', render: (c) => c.printerName ?? '' },
        { label: 'Status', render: (c) => (c.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Off</Badge>) },
      ]}
      form={(v, set) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Bill numbers start with this, e.g. C2/26-27/000481">{(id) => <Input id={id} value={v.code ?? ''} onChange={(e) => set({ code: e.target.value.toUpperCase() })} required maxLength={6} className="font-mono" />}</Field>
          <Field label="Name">{(id) => <Input id={id} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required />}</Field>
          <Field label="Printer name (note)">{(id) => <Input id={id} value={v.printerName ?? ''} onChange={(e) => set({ printerName: e.target.value })} />}</Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Active" checked={v.isActive ?? true} onChange={(x) => set({ isActive: x })} />
          </div>
        </div>
      )}
      onSave={async (v, row) => {
        const body = { code: v.code, name: v.name, printerName: v.printerName || null, isActive: v.isActive ?? true };
        if (row) await patch(`/counters/${row.id}`, body);
        else await post('/counters', body);
        void qc.invalidateQueries({ queryKey: ['counters'] });
      }}
    />
  );
}

function ChargeTypes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['charge-types-all'], queryFn: () => get<ChargeType[]>('/charge-types?all=true') });
  const label = { BY_VALUE: 'By value', BY_QTY: 'By quantity', NONE: 'Not allocated' };
  return (
    <ListEditor<ChargeType>
      title="Purchase charge types"
      rows={q.data}
      loading={q.isLoading}
      canEdit
      empty="No charge types."
      addLabel="Add charge type"
      columns={[
        { label: 'Name', render: (c) => c.name },
        { label: 'Adds to item cost', render: (c) => (c.addsToCost ? 'Yes' : 'No') },
        { label: 'Spread', render: (c) => label[c.allocation] },
        { label: 'Status', render: (c) => (c.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Off</Badge>) },
      ]}
      form={(v, set) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="E.g. Transport, Hamali, Courier">{(id) => <Input id={id} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required maxLength={40} />}</Field>
          <Field label="Spread into item cost">
            {(id) => (
              <Select id={id} value={v.allocation ?? 'BY_VALUE'} onChange={(e) => set({ allocation: e.target.value as ChargeType['allocation'] })}>
                <option value="BY_VALUE">By each line's value</option>
                <option value="BY_QTY">By each line's quantity</option>
                <option value="NONE">Do not spread</option>
              </Select>
            )}
          </Field>
          <Checkbox label="Counts as part of item cost" checked={v.addsToCost ?? true} onChange={(x) => set({ addsToCost: x })} />
          <Checkbox label="Active" checked={v.isActive ?? true} onChange={(x) => set({ isActive: x })} />
        </div>
      )}
      onSave={async (v, row) => {
        const body = { name: v.name, addsToCost: v.addsToCost ?? true, allocation: v.allocation ?? 'BY_VALUE', isActive: v.isActive ?? true };
        if (row) await patch(`/charge-types/${row.id}`, body);
        else await post('/charge-types', body);
        void qc.invalidateQueries({ queryKey: ['charge-types-all'] });
        void qc.invalidateQueries({ queryKey: ['charge-types'] });
      }}
    />
  );
}

function CatalogueMasters({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') });
  const units = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ListEditor<Category>
        title="Categories"
        rows={cats.data}
        loading={cats.isLoading}
        canEdit
        empty="No categories."
        addLabel="Add category"
        columns={[{ label: 'Name', render: (c) => c.name }]}
        form={(v, set) => <Field label="Name">{(id) => <Input id={id} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required maxLength={60} />}</Field>}
        onSave={async (v, row) => {
          if (row) await patch(`/categories/${row.id}`, { name: v.name });
          else await post('/categories', { name: v.name });
          void qc.invalidateQueries({ queryKey: ['categories'] });
        }}
      />
      <ListEditor<Unit>
        title="Units"
        rows={units.data}
        loading={units.isLoading}
        canEdit={isAdmin}
        empty="No units."
        addLabel="Add unit"
        columns={[
          { label: 'Code', render: (u) => <span className="font-mono">{u.code}</span> },
          { label: 'Name', render: (u) => u.name },
          { label: 'Fractions', render: (u) => (u.allowDecimal ? 'Allowed' : 'Whole only') },
        ]}
        form={(v, set) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code">{(id) => <Input id={id} value={v.code ?? ''} onChange={(e) => set({ code: e.target.value.toUpperCase() })} required maxLength={8} className="font-mono" />}</Field>
            <Field label="Name">{(id) => <Input id={id} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required />}</Field>
            <Checkbox label="Allow fractions (e.g. 0.5 ream)" checked={v.allowDecimal ?? false} onChange={(x) => set({ allowDecimal: x })} />
          </div>
        )}
        onSave={async (v, row) => {
          const body = { code: v.code, name: v.name, allowDecimal: v.allowDecimal ?? false };
          if (row) await patch(`/units/${row.id}`, body);
          else await post('/units', body);
          void qc.invalidateQueries({ queryKey: ['units'] });
        }}
      />
    </div>
  );
}

function Suppliers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suppliers-all'], queryFn: () => get<Supplier[]>('/suppliers?all=true') });
  return (
    <ListEditor<Supplier>
      title="Suppliers"
      rows={q.data}
      loading={q.isLoading}
      canEdit
      empty="No suppliers yet."
      addLabel="Add supplier"
      columns={[
        { label: 'Name', render: (s) => s.name },
        { label: 'Phone', render: (s) => s.phone ?? '' },
        { label: 'GSTIN', render: (s) => <span className="font-mono">{s.gstin ?? ''}</span> },
        { label: 'Status', render: (s) => (s.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Off</Badge>) },
      ]}
      form={(v, set) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">{(id) => <Input id={id} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={v.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />}</Field>
          <Field label="GSTIN">{(id) => <Input id={id} value={v.gstin ?? ''} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} className="font-mono" />}</Field>
          <Field label="Address">{(id) => <Input id={id} value={v.address ?? ''} onChange={(e) => set({ address: e.target.value })} maxLength={300} />}</Field>
          <Checkbox label="Active" checked={v.isActive ?? true} onChange={(x) => set({ isActive: x })} />
        </div>
      )}
      onSave={async (v, row) => {
        const body = { name: v.name, phone: v.phone || null, gstin: v.gstin || null, address: v.address || null, isActive: v.isActive ?? true };
        if (row) await patch(`/suppliers/${row.id}`, body);
        else await post('/suppliers', body);
        void qc.invalidateQueries({ queryKey: ['suppliers-all'] });
        void qc.invalidateQueries({ queryKey: ['suppliers'] });
      }}
    />
  );
}

// ---------------- Kits ----------------
function Kits() {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useCatalogue();
  const q = useQuery({ queryKey: ['kits-all'], queryFn: () => get<Kit[]>('/kits?all=true') });
  const [edit, setEdit] = useState<Kit | 'new' | null>(null);
  const [f, setF] = useState({ code: '', name: '', price: '', isActive: true, items: [] as { productId: number; name: string; qty: string; price: number }[] });
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErr(null);
    setSearch('');
    if (edit && edit !== 'new') setF({ code: edit.code, name: edit.name, price: String(Number(edit.price)), isActive: edit.isActive, items: edit.items.map((i) => ({ productId: i.productId, name: i.product.name, qty: String(Number(i.qty)), price: Number(i.product.salePrice) })) });
    else setF({ code: '', name: '', price: '', isActive: true, items: [] });
  }, [edit]);
  const normal = f.items.reduce((a, i) => a + Number(i.qty || 0) * i.price, 0);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { code: f.code, name: f.name, price: Number(f.price), isActive: f.isActive, items: f.items.map((i) => ({ productId: i.productId, qty: Number(i.qty) })) };
      if (edit === 'new') await post('/kits', body);
      else if (edit) await patch(`/kits/${edit.id}`, body);
      toast('Kit saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['kits-all'] });
      void qc.invalidateQueries({ queryKey: ['kits'] });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Section kits" actions={<Button size="sm" variant="primary" onClick={() => setEdit('new')}>Add kit</Button>}>
      <p className="border-b border-line px-4 py-2 text-sm text-ink-mute">A kit, such as a lab-record set for one section, is billed as one line. Stock comes off each item in it.</p>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>No kits yet.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Name</th>
              <th className={th}>Contents</th>
              <th className={cx(th, 'text-right')}>Price ₹</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {q.data.map((k) => (
              <tr key={k.id}>
                <td className={cx(td, 'font-mono')}>{k.code}</td>
                <td className={td} data-title>{k.name}</td>
                <td className={cx(td, wrap, 'text-xs text-ink-mute')}>{k.items.map((i) => `${qty(i.qty)} × ${i.product.name}`).join(', ')}</td>
                <td className={cx(td, num)}>{money(k.price)}</td>
                <td className={td}>{k.isActive ? <Badge tone="teal">Active</Badge> : <Badge>Off</Badge>}</td>
                <td className={td}>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(k)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add kit' : 'Edit kit'} wide>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_160px]">
            <Field label="Code">{(id) => <Input id={id} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required maxLength={20} className="font-mono" placeholder="PHY-CYC" />}</Field>
            <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} placeholder="Physics cycle lab kit" />}</Field>
            <Field label="Kit price ₹" hint={`Items at normal price: ₹${money(normal)}`}>
              {(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required className="font-mono" />}
            </Field>
          </div>
          <div className="relative">
            <Field label="Add item">{(id) => <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product" />}</Field>
            {search.trim() && (
              <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-line bg-white shadow-lg">
                {cat.search(search, 8).map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50"
                      onClick={() => {
                        if (!f.items.some((i) => i.productId === h.id)) setF({ ...f, items: [...f.items, { productId: h.id, name: h.name, qty: '1', price: Number(h.salePrice) }] });
                        setSearch('');
                      }}
                    >
                      <span className="w-14 font-mono text-xs text-ink-mute">{h.code}</span>
                      <span className="flex-1">{h.name}</span>
                      <span className="font-mono text-xs">₹{money(h.salePrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="divide-y divide-line rounded-md border border-line">
            {f.items.length === 0 && <li className="p-3 text-sm text-ink-mute">No items yet.</li>}
            {f.items.map((i, idx) => (
              <li key={i.productId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{i.name}</span>
                <Input aria-label={`Quantity of ${i.name}`} inputMode="decimal" className="h-8 w-20 text-right font-mono" value={i.qty} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)) })} />
                <button type="button" className="text-ink-mute hover:text-rose-700" aria-label={`Remove ${i.name}`} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== idx) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <Checkbox label="Active (shown at the counter)" checked={f.isActive} onChange={(x) => setF({ ...f, isActive: x })} />
          <ErrorBox error={err} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEdit(null)}>
              Back
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save kit
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------------- Settings ----------------
function StoreSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [f, setF] = useState<Settings | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF({ ...q.data, maxCashierDiscount: Number(q.data.maxCashierDiscount) });
  }, [q.data]);
  if (!f) return <Loading />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await put('/settings', { ...f, maxCashierDiscount: Number(f.maxCashierDiscount) });
      toast('Settings saved');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Store settings">
      <form onSubmit={submit} className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Store name (on receipts)">{(id) => <Input id={id} value={f.storeName} onChange={(e) => setF({ ...f, storeName: e.target.value })} required />}</Field>
        <Field label="Address line">{(id) => <Input id={id} value={f.addressLine} onChange={(e) => setF({ ...f, addressLine: e.target.value })} required />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="GST">
          {(id) => (
            <Select id={id} value={f.gstMode} onChange={(e) => setF({ ...f, gstMode: e.target.value as Settings['gstMode'] })}>
              <option value="NOT_REGISTERED">Not GST-registered (plain bill)</option>
              <option value="REGISTERED">GST-registered (tax invoice with CGST/SGST)</option>
            </Select>
          )}
        </Field>
        <Field label="GSTIN" hint="Needed when GST-registered">
          {(id) => <Input id={id} value={f.gstin ?? ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} className="font-mono" />}
        </Field>
        <Field label="Receipt footer">{(id) => <Input id={id} value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} maxLength={200} />}</Field>
        <Field label="Largest discount a cashier may give (%)" hint="0 means only managers can give discounts">
          {(id) => <Input id={id} inputMode="decimal" value={String(f.maxCashierDiscount)} onChange={(e) => setF({ ...f, maxCashierDiscount: e.target.value as unknown as number })} className="font-mono" />}
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label="Round bills to the nearest rupee" checked={f.roundBillToRupee} onChange={(v) => setF({ ...f, roundBillToRupee: v })} />
          <Checkbox label="Block sales when stock would go below zero" checked={f.blockNegativeStock} onChange={(v) => setF({ ...f, blockNegativeStock: v })} />
        </div>
        <h3 className="mt-2 border-t border-line pt-4 text-sm font-semibold md:col-span-2">UPI and card payments</h3>
        <Field label="Store UPI ID" hint="The counter shows a QR for the exact bill amount to this ID. Money goes straight to the store's bank account.">
          {(id) => <Input id={id} value={f.upiId ?? ''} onChange={(e) => setF({ ...f, upiId: e.target.value.trim() })} placeholder="storename@bank" className="font-mono" maxLength={64} />}
        </Field>
        <Field label="Payee name shown in the UPI app">{(id) => <Input id={id} value={f.upiPayeeName ?? ''} onChange={(e) => setF({ ...f, upiPayeeName: e.target.value })} maxLength={60} />}</Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label="UPI payments must record the transaction ID" checked={f.requireUpiReference} onChange={(v) => setF({ ...f, requireUpiReference: v })} />
          <Checkbox label="Card payments must record the slip ID" checked={f.requireCardReference} onChange={(v) => setF({ ...f, requireCardReference: v })} />
        </div>
        <Field label="Lock a counter after this many idle minutes" hint="0 means never. Ctrl+L locks at once.">
          {(id) => <Input id={id} inputMode="numeric" value={String(f.autoLockMinutes)} onChange={(e) => setF({ ...f, autoLockMinutes: Number(e.target.value.replace(/\D/g, '') || 0) })} className="font-mono" />}
        </Field>
        <Field label="Accept sales returns up to (days after the bill)" hint="0 means no limit. Refunds always go back the way the bill was paid.">
          {(id) => <Input id={id} inputMode="numeric" value={String(f.returnWindowDays)} onChange={(e) => setF({ ...f, returnWindowDays: Number(e.target.value.replace(/\D/g, '') || 0) })} className="font-mono" />}
        </Field>
        <div className="md:col-span-2">
          <ErrorBox error={err} />
        </div>
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" variant="primary" busy={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------- Sessions ----------------
interface SessionRow {
  id: string;
  counterId: number | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  user: { id: number; username: string; fullName: string; role: Role };
}
function Sessions({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionRow[]>('/auth/sessions'), refetchInterval: 30_000 });
  const counters = useQuery({ queryKey: ['counters'], queryFn: () => get<Counter[]>('/counters') });
  const [revoke, setRevoke] = useState<SessionRow | null>(null);
  const counterCode = (id: number | null) => counters.data?.find((c) => c.id === id)?.code ?? '—';
  const device = (ua: string | null) => (!ua ? '' : /Mobile|Android|iPhone|iPad/.test(ua) ? 'Phone / tablet' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser');
  return (
    <Card title="Logged-in sessions" actions={<span className="text-xs text-ink-mute">Sessions end after 12 hours, on logout, or when ended here.</span>}>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>Nobody is logged in.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Who</th>
              <th className={th}>Role</th>
              <th className={th}>Counter</th>
              <th className={th}>Device</th>
              <th className={th}>From</th>
              <th className={th}>Logged in</th>
              <th className={th}>Last active</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {q.data.map((s) => (
              <tr key={s.id} className={cx(s.id === me?.sessionId && 'bg-navy-50/50')}>
                <td className={td}>
                  {s.user.fullName} {s.id === me?.sessionId && <Badge tone="teal">This session</Badge>}
                  <div className="font-mono text-xs text-ink-mute">{s.user.username}</div>
                </td>
                <td className={td}>{ROLE_LABEL[s.user.role]}</td>
                <td className={cx(td, 'font-mono')}>{counterCode(s.counterId)}</td>
                <td className={td}>{device(s.userAgent)}</td>
                <td className={cx(td, 'font-mono text-xs')}>{s.ip}</td>
                <td className={cx(td, 'whitespace-nowrap')}>{dateTime(s.createdAt)}</td>
                <td className={cx(td, 'whitespace-nowrap')}>{dateTime(s.lastSeenAt)}</td>
                <td className={cx(td, 'text-right')}>
                  {isAdmin && s.id !== me?.sessionId && (
                    <Button size="sm" variant="ghost" onClick={() => setRevoke(s)}>
                      End session
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={revoke !== null}
        onClose={() => setRevoke(null)}
        title={`End ${revoke?.user.fullName}'s session?`}
        message="They are logged out at once on that computer. Anything unsaved on their screen is lost."
        confirmLabel="End session"
        danger
        onConfirm={async () => {
          await post(`/auth/sessions/${revoke!.id}/revoke`);
          toast('Session ended');
          void qc.invalidateQueries({ queryKey: ['sessions'] });
        }}
      />
    </Card>
  );
}

// ---------------- Audit ----------------
interface AuditRow {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  user: { fullName: string; username: string } | null;
}
function AuditLog() {
  const today = todayIso();
  const [f, setF] = useState({ from: today, to: today, action: '', page: 1 });
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => get<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>(`/audit${qs(f)}`) });
  const [open, setOpen] = useState<AuditRow | null>(null);
  const actions = ['', 'LOGIN', 'LOGIN_FAILED', 'SALE_EDIT', 'SALE_CANCEL', 'SALES_RETURN', 'PRICE_CHANGE', 'STOCK_ADJUST', 'STOCK_ADJUST_REQUEST', 'STOCK_ADJUST_APPROVE', 'STOCK_ADJUST_REJECT', 'PURCHASE_POST', 'PURCHASE_CANCEL', 'PURCHASE_RETURN', 'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_IMPORT', 'USER_CREATE', 'USER_UPDATE', 'USER_PASSWORD_RESET', 'SETTINGS_UPDATE', 'OPENING_COUNT_IMPORT'];
  return (
    <Card title="Audit log (append-only)">
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 md:grid-cols-[160px_160px_260px]">
        <Field label="From">{(id) => <Input id={id} type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value || f.from, page: 1 })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value || f.to, page: 1 })} />}</Field>
        <Field label="Action">
          {(id) => (
            <Select id={id} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a || 'All actions'}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.rows.length ? (
        <Empty>No entries.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>Action</th>
              <th className={th}>Record</th>
              <th className={th}>From</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.id}>
                <td className={cx(td, 'whitespace-nowrap')}>{dateTime(r.createdAt)}</td>
                <td className={td}>{r.user?.fullName ?? '—'}</td>
                <td className={cx(td, 'font-mono text-xs')}>{r.action}</td>
                <td className={td}>
                  {r.entity} {r.entityId}
                </td>
                <td className={cx(td, 'font-mono text-xs text-ink-mute')}>{r.ip}</td>
                <td className={td}>
                  {r.before != null || r.after != null ? (
                    <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>
                      Details
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.total > q.data.pageSize && (
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <Button size="sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>
            Newer
          </Button>
          <Button size="sm" disabled={f.page * q.data.pageSize >= q.data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>
            Older
          </Button>
        </div>
      )}
      <Modal open={open !== null} onClose={() => setOpen(null)} title={`${open?.action} · ${open ? dateTime(open.createdAt) : ''}`} wide>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-ink-mute">Before</h3>
            <pre className="max-h-[60vh] overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(open?.before ?? null, null, 2)}</pre>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase text-ink-mute">After</h3>
            <pre className="max-h-[60vh] overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(open?.after ?? null, null, 2)}</pre>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

// ---------------- Go-live ----------------
function GoLive() {
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [check, setCheck] = useState<{ ok: boolean; drift: { code: string; name: string; cached: number; ledger: number }[] } | null>(null);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api<{ rows: number; changed: number }>('/stock/opening-import', { form });
      toast(`Physical count loaded: ${r.rows} rows, ${r.changed} items changed`);
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Load the physical stock count">
        <div className="space-y-3 p-4 text-sm">
          <p>
            Upload an .xlsx with columns <b>Code</b>, <b>Counted Qty</b> and optionally <b>Cost</b>. Each item's stock is set to the counted quantity with an opening entry for the difference. If any row has a problem, nothing is loaded.
          </p>
          <p className="text-ink-mute">Tip: export products from the Products page, keep the Code column, add a Counted Qty column and fill it on cutover day.</p>
          <Button variant="primary" busy={busy} onClick={() => ref.current?.click()}>
            Upload count sheet
          </Button>
          <input ref={ref} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
          <ErrorBox error={err} />
        </div>
      </Card>
      <Card title="Check stock ledger">
        <div className="space-y-3 p-4 text-sm">
          <p>Checks that every item's stock equals the sum of its ledger entries. This also runs every night at 02:00.</p>
          <Button
            onClick={async () => {
              try {
                setCheck(await post('/admin/stock-check'));
              } catch (x) {
                setErr(x);
              }
            }}
          >
            Run check now
          </Button>
          {check && (check.ok ? <p className="text-navy-700">All items match the ledger.</p> : <p className="text-rose-700">{check.drift.length} item(s) do not match. See the dashboard alert.</p>)}
        </div>
      </Card>
    </div>
  );
}

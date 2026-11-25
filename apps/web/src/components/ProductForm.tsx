import { useQuery } from '@tanstack/react-query';
import { BadgePercent, IndianRupee, Ruler, Tag, Warehouse } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { get, patch, post } from '../lib/api';
import { MANAGE, useAuth } from '../lib/auth';
import type { Category, Product, Unit } from '../lib/types';
import { Button, cx, ErrorBox, Field, Input, Select } from './ui';

type FormState = Record<string, string>;

const toForm = (p?: Partial<Product>): FormState => ({
  code: p?.code ?? '',
  barcode: p?.barcode ?? '',
  name: p?.name ?? '',
  categoryId: p?.categoryId ? String(p.categoryId) : '',
  unitId: p?.unitId ? String(p.unitId) : '',
  packUnitId: p?.packUnitId ? String(p.packUnitId) : '',
  packSize: p?.packSize ? String(p.packSize) : '1',
  hsnCode: p?.hsnCode ?? '',
  gstRate: p?.gstRate !== undefined ? String(p.gstRate) : '0',
  mrp: p?.mrp !== null && p?.mrp !== undefined ? String(p.mrp) : '',
  salePrice: p?.salePrice !== undefined ? String(p.salePrice) : '',
  reorderLevel: p?.reorderLevel !== undefined ? String(p.reorderLevel) : '0',
  rackNo: p?.rackNo ?? '',
  openingQty: '',
  openingCost: '',
});

/** Product master form (about 12 fields instead of the old 25). Used on the Products page and inside a purchase. */
export function ProductForm({ product, initialName, onSaved, onCancel }: { product?: Product; initialName?: string; onSaved: (p: Product) => void; onCancel: () => void }) {
  const { can } = useAuth();
  const isManager = can(...MANAGE);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') });
  const units = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const [f, setF] = useState<FormState>(() => ({ ...toForm(product), ...(initialName && !product ? { name: initialName } : {}) }));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const priceLocked = !!product && !isManager;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
    const body = {
      code: f.code.trim() || null,
      barcode: f.barcode.trim() || null,
      name: f.name,
      categoryId: Number(f.categoryId),
      unitId: Number(f.unitId),
      packUnitId: f.packUnitId ? Number(f.packUnitId) : null,
      packSize: Number(f.packSize || 1),
      hsnCode: f.hsnCode.trim() || null,
      gstRate: Number(f.gstRate || 0),
      mrp: numOrNull(f.mrp),
      salePrice: Number(f.salePrice),
      reorderLevel: Number(f.reorderLevel || 0),
      rackNo: f.rackNo.trim() || null,
      ...(!product && isManager && f.openingQty.trim() ? { openingQty: Number(f.openingQty), openingCost: f.openingCost.trim() ? Number(f.openingCost) : undefined } : {}),
    };
    if (!body.categoryId) return setErr(new Error('Choose a category'));
    if (!body.unitId) return setErr(new Error('Choose a unit'));
    if (f.salePrice.trim() === '' || Number.isNaN(body.salePrice)) return setErr(new Error('Enter the sale price'));
    setBusy(true);
    try {
      const saved = product ? await patch<Product>(`/products/${product.id}`, body) : await post<Product>('/products', body);
      onSaved(saved);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  // Live price check shown under the prices.
  const sp = Number(f.salePrice);
  const mrp = f.mrp.trim() === '' ? null : Number(f.mrp);
  const cost = product?.lastCost !== null && product?.lastCost !== undefined ? Number(product.lastCost) : f.openingCost.trim() ? Number(f.openingCost) : null;
  const priceNote: { tone: 'ok' | 'warn' | 'bad'; text: string } | null =
    f.salePrice.trim() === '' || !(sp > 0)
      ? null
      : mrp !== null && sp > mrp
        ? { tone: 'bad', text: `Sale price is above the MRP (₹${mrp}). It will be refused.` }
        : {
            tone: cost !== null && cost >= sp ? 'warn' : 'ok',
            text: [mrp !== null && mrp > 0 ? `${(((mrp - sp) / mrp) * 100).toFixed(1)}% below MRP` : null, cost !== null ? `margin ${(((sp - cost) / sp) * 100).toFixed(1)}% on last cost ₹${cost}` : null, Number(f.gstRate) > 0 ? `includes GST ₹${(sp - sp / (1 + Number(f.gstRate) / 100)).toFixed(2)}` : 'no GST'].filter(Boolean).join(' · '),
          };

  const section = (icon: ReactNode, title: string, hint: string) => (
    <div className="col-span-full -mb-1 mt-2 flex items-center gap-2 border-b border-line pb-2 first:mt-0">
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="ml-auto hidden text-xs text-ink-mute sm:inline">{hint}</span>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {section(<Tag />, 'Basics', 'How staff find it at the counter')}
        <Field label="Name" className="sm:col-span-2" hint="The system blocks a second product with the same name.">
          {(id) => <Input id={id} value={f.name} onChange={set('name')} required maxLength={120} autoFocus />}
        </Field>
        <Field label="Code" hint={product ? undefined : 'Leave empty to get the next number'}>
          {(id) => <Input id={id} value={f.code} onChange={set('code')} maxLength={30} className="font-mono" />}
        </Field>
        <Field label="Barcode">{(id) => <Input id={id} value={f.barcode} onChange={set('barcode')} maxLength={64} className="font-mono" />}</Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={f.categoryId} onChange={set('categoryId')} required>
              <option value="">Choose…</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="hidden sm:block" />
        {section(<Ruler />, 'Units & packing', 'Boxes from the supplier, pieces at the counter')}
        <Field label="Selling unit">
          {(id) => (
            <Select id={id} value={f.unitId} onChange={set('unitId')} required>
              <option value="">Choose…</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Bought in (pack unit)" hint="E.g. BOX, if the supplier sends boxes">
          {(id) => (
            <Select id={id} value={f.packUnitId} onChange={set('packUnitId')}>
              <option value="">Same as selling unit</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Selling units per pack">{(id) => <Input id={id} inputMode="decimal" value={f.packSize} onChange={set('packSize')} disabled={!f.packUnitId} className="font-mono" />}</Field>
        {section(<IndianRupee />, 'Price & tax', 'Sale price includes GST')}
        <Field label="MRP ₹" hint={priceLocked ? 'Only a manager can change prices' : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={f.mrp} onChange={set('mrp')} disabled={priceLocked} className="font-mono" />}
        </Field>
        <Field label="Sale price ₹" hint="GST included. Cannot be above MRP.">
          {(id) => <Input id={id} inputMode="decimal" value={f.salePrice} onChange={set('salePrice')} required disabled={priceLocked} className="font-mono" />}
        </Field>
        <Field label="HSN code">{(id) => <Input id={id} value={f.hsnCode} onChange={set('hsnCode')} maxLength={10} className="font-mono" />}</Field>
        <Field label="GST %">
          {(id) => (
            <Select id={id} value={f.gstRate} onChange={set('gstRate')}>
              {['0', '5', '12', '18', '28'].map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </Select>
          )}
        </Field>
        {priceNote && (
          <div
            className={cx(
              'col-span-full flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
              priceNote.tone === 'bad' ? 'border-rose-600/25 bg-rose-50 text-rose-700' : priceNote.tone === 'warn' ? 'border-amber-600/25 bg-amber-50 text-amber-700' : 'border-leaf-600/20 bg-leaf-50 text-leaf-700',
            )}
          >
            <BadgePercent className="h-4 w-4 shrink-0" aria-hidden />
            {priceNote.text}
          </div>
        )}
        {section(<Warehouse />, 'Stock', 'Shelf place and reorder alert')}
        <Field label="Reorder level" hint="Flag when stock falls to this">
          {(id) => <Input id={id} inputMode="decimal" value={f.reorderLevel} onChange={set('reorderLevel')} className="font-mono" />}
        </Field>
        <Field label="Rack">{(id) => <Input id={id} value={f.rackNo} onChange={set('rackNo')} maxLength={30} />}</Field>
        {!product && isManager && (
          <>
            <Field label="Opening stock (optional)" hint="Only when the item is already on the shelf">
              {(id) => <Input id={id} inputMode="decimal" value={f.openingQty} onChange={set('openingQty')} className="font-mono" />}
            </Field>
            <Field label="Opening cost per unit ₹">{(id) => <Input id={id} inputMode="decimal" value={f.openingCost} onChange={set('openingCost')} className="font-mono" disabled={!f.openingQty} />}</Field>
          </>
        )}
      </div>
      <ErrorBox error={err} />
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {product ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  );
}

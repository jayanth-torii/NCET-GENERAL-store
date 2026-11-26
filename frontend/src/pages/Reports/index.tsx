import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { download, get, qs } from '../../services/http.common';
import { MANAGE, PURCHASE, useAuth } from '../../app/auth';
import { useKits } from '../../services/catalogue.service';
import { monthStartIso, todayIso } from '../../services/format';
import type { Category } from '../../data/types';
import { ReportView } from '../../components/ReportView';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Tabs } from '../../components/ui';

type Tab = 'daily' | 'monthly' | 'register' | 'purchases' | 'kits' | 'yearly' | 'dead';

/** FR-14: kit sales by section, plus a printable class order sheet for any kit. */
function SectionKits({ from, to, today, setFrom, setTo }: { from: string; to: string; today: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const kits = useKits();
  const active = (kits.data ?? []).filter((k) => k.isActive);
  const [kitId, setKitId] = useState('');
  const [section, setSection] = useState('');
  const [students, setStudents] = useState('60');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const sheet = async () => {
    setErr(null);
    const n = Number(students);
    if (!kitId) return setErr(new Error('Choose the kit for the order sheet.'));
    if (!Number.isInteger(n) || n < 1 || n > 200) return setErr(new Error('Students must be a whole number from 1 to 200.'));
    setBusy(true);
    try {
      await download(`/reports/kits/order-sheet${qs({ kit: kitId, section, students: n, format: 'pdf' })}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title="Class order sheet" className="mb-5">
        <div className="space-y-3 px-5 pb-5">
          <p className="text-sm text-ink-mute">Print a sheet for a class: what the kit contains, then one row per student to note payment and tick when the kit is issued.</p>
          <div className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1fr_auto] sm:items-end">
            <Field label="Kit">
              {(id) => (
                <Select id={id} value={kitId} onChange={(e) => setKitId(e.target.value)}>
                  <option value="">Choose a kit…</option>
                  {active.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} · ₹{k.price}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Section">{(id) => <Input id={id} value={section} maxLength={40} placeholder="e.g. II CSE A" onChange={(e) => setSection(e.target.value)} />}</Field>
            <Field label="Students">{(id) => <Input id={id} type="number" min={1} max={200} value={students} onChange={(e) => setStudents(e.target.value)} />}</Field>
            <Button variant="primary" busy={busy} onClick={() => void sheet()}>
              Download order sheet (PDF)
            </Button>
          </div>
          {kits.data && active.length === 0 && <p className="text-sm text-amber-700">No active kits yet. Create one in Masters → Section kits.</p>}
          <ErrorBox error={err} />
        </div>
      </Card>
      <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value || to)} />}</Field>
      </div>
      <ReportView path={`/reports/kits${qs({ from, to })}`} />
    </>
  );
}

function fyOptions(today: string) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const cur = m >= 4 ? y : y - 1;
  return [0, 1, 2, 3, 4].map((i) => {
    const s = cur - i;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
  });
}

export function Reports() {
  const { me, can } = useAuth();
  const isManager = can(...MANAGE);
  const isStock = can(...PURCHASE);
  const today = todayIso();
  const tabs: { value: Tab; label: string }[] = [
    ...(me?.role !== 'STORE_KEEPER' ? [{ value: 'daily' as Tab, label: me?.role === 'CASHIER' ? 'My day' : 'Daily sales' }] : []),
    ...(isManager
      ? [
          { value: 'monthly' as Tab, label: 'Monthly sales' },
          { value: 'register' as Tab, label: 'Sales register' },
          { value: 'purchases' as Tab, label: 'Purchase register' },
          { value: 'kits' as Tab, label: 'Section kits' },
        ]
      : []),
    ...(isStock
      ? [
          { value: 'yearly' as Tab, label: 'Yearly stock (FY)' },
          { value: 'dead' as Tab, label: 'Dead stock' },
        ]
      : []),
  ];
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : tabs[0]?.value ?? 'daily';
  const setTab = (t: Tab) => setParams({ tab: t });
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(monthStartIso(today));
  const [to, setTo] = useState(today);
  const fys = fyOptions(today);
  const [fy, setFy] = useState(fys[0]);
  const [categoryId, setCategoryId] = useState('');
  const [days, setDays] = useState('90');
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories'), enabled: isStock });

  return (
    <div>
      <PageHeader title="Reports" subtitle="Every report opens on screen and downloads as PDF or Excel with the same figures." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'daily' && (
        <>
          {isManager && (
            <div className="mb-4 max-w-[200px]">
              <Field label="Date">{(id) => <Input id={id} type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />}</Field>
            </div>
          )}
          <ReportView path={`/reports/sales/daily${qs({ date: isManager ? day : today })}`} />
        </>
      )}
      {tab === 'monthly' && (
        <>
          <div className="mb-4 max-w-[200px]">
            <Field label="Month">{(id) => <Input id={id} type="month" value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value || today.slice(0, 7))} />}</Field>
          </div>
          <ReportView path={`/reports/sales/monthly${qs({ month })}`} />
        </>
      )}
      {(tab === 'register' || tab === 'purchases') && (
        <>
          <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
            <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} />}</Field>
            <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value || to)} />}</Field>
          </div>
          <ReportView path={`/reports/${tab === 'register' ? 'sales' : 'purchases'}/register${qs({ from, to })}`} />
        </>
      )}
      {tab === 'kits' && <SectionKits from={from} to={to} today={today} setFrom={setFrom} setTo={setTo} />}
      {tab === 'yearly' && (
        <>
          <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
            <Field label="Financial year (April to March)">
              {(id) => (
                <Select id={id} value={fy} onChange={(e) => setFy(e.target.value)}>
                  {fys.map((f) => (
                    <option key={f} value={f}>
                      FY {f}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
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
          </div>
          <ReportView path={`/reports/stock/yearly${qs({ fy, categoryId })}`} />
        </>
      )}
      {tab === 'dead' && (
        <>
          <div className="mb-4 max-w-[200px]">
            <Field label="No sale for (days)">
              {(id) => (
                <Select id={id} value={days} onChange={(e) => setDays(e.target.value)}>
                  {['30', '60', '90', '180', '365'].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <ReportView path={`/reports/stock/dead${qs({ days })}`} />
        </>
      )}
    </div>
  );
}

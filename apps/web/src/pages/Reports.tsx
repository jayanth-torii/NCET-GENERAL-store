import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, qs } from '../lib/api';
import { MANAGE, PURCHASE, useAuth } from '../lib/auth';
import { monthStartIso, todayIso } from '../lib/format';
import type { Category } from '../lib/types';
import { ReportView } from '../components/ReportView';
import { Field, Input, PageHeader, Select, Tabs } from '../components/ui';

type Tab = 'daily' | 'monthly' | 'register' | 'purchases' | 'yearly' | 'dead';

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
        ]
      : []),
    ...(isStock
      ? [
          { value: 'yearly' as Tab, label: 'Yearly stock (FY)' },
          { value: 'dead' as Tab, label: 'Dead stock' },
        ]
      : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? 'daily');
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

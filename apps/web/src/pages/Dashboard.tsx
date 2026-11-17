import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { download, get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, time, todayIso } from '../lib/format';
import type { Settings } from '../lib/types';
import { cx, ErrorBox, useToast } from '../components/ui';

interface Dash {
  date: string;
  sales?: { scope: 'own' | 'store'; bills: number; net: number; returns: number; cancelled: number; byMode: Record<string, number>; week: { date: string; net: number; bills: number }[] };
  stock?: { low: number; negative: number; pendingAdjustments: number; draftPurchases: number; readyPurchases: number };
  alerts?: { id: number; kind: string; message: string; createdAt: string; details: { code: string; name: string; cached: number; ledger: number }[] | null }[];
}

interface BillRow {
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
  payModes: string;
  customerName: string | null;
}

/*
 * Dark NGI dashboard: deep navy page, navy cards, NGI orange as the only accent.
 * Cards carry no borders or divider lines; depth comes from fill, gradient and shadow.
 */
const PAGE = 'bg-[#06102A]';
const CARD = 'rounded-2xl bg-gradient-to-b from-[#12224A] to-[#0C1838] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.75)]';
const INSET = 'rounded-xl bg-[#0A1530]';
const MUTED = 'text-[#8E9CC2]';

const rupees = (v: number) => `₹${money(v)}`;
const compact = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`);

/** "+8%" pill, as in the reference. Neutral when there is nothing to compare. */
function Change({ now, before }: { now: number; before: number | null }) {
  if (before === null || before <= 0 || now <= 0) return <span className={cx('rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium', MUTED)}>today</span>;
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 0.5) return <span className={cx('rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium', MUTED)}>same as yesterday</span>;
  const up = pct >= 0;
  return (
    <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', up ? 'bg-brand-500/10 text-brand-500 ring-brand-500/40' : 'bg-white/5 text-[#C5CEE6] ring-white/15')}>
      {up ? '+' : '−'}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const ICONS = {
  bill: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />,
  purchase: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />,
  stock: <path d="M4 21V9M10 21V3M16 21v-8M22 21H2" />,
  report: <path d="M4 4h16v16H4zM8 15v-3M12 15V9M16 15v-5" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  cart: <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6M10 21h.01M17 21h.01" />,
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  box: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />,
  nfc: <path d="M8 9a5 5 0 0 1 0 6M11 7a8 8 0 0 1 0 10M14 5a11 11 0 0 1 0 14" />,
};
function Glyph({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-4 w-4', className)} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function ActionButton({ children, icon, primary, onClick, to }: { children: ReactNode; icon: keyof typeof ICONS; primary?: boolean; onClick?: () => void; to?: string }) {
  const cls = cx(
    'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    primary ? 'bg-brand-600 text-white shadow-[0_10px_24px_-8px_rgba(246,135,42,0.7)] hover:bg-brand-500' : 'bg-white/[0.06] text-white hover:bg-white/10',
  );
  return to ? (
    <Link to={to} className={cls}>
      <Glyph name={icon} />
      {children}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      <Glyph name={icon} />
      {children}
    </button>
  );
}

function Kpi({ label, value, now, before }: { label: string; value: ReactNode; now: number; before: number | null }) {
  return (
    <div className={cx(CARD, 'p-5')}>
      <div className={cx('text-sm', MUTED)}>{label}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="font-mono text-[26px] font-semibold leading-none tabular-nums text-white">{value}</div>
        <Change now={now} before={before} />
      </div>
    </div>
  );
}

/** Weekly bars: dark columns, the selected day lit in NGI orange with a glow and its value above. */
function WeekChart({ week }: { week: { date: string; net: number; bills: number }[] }) {
  const [metric, setMetric] = useState<'net' | 'bills'>('net');
  const [sel, setSel] = useState(week.length - 1);
  const vals = week.map((w) => (metric === 'net' ? w.net : w.bills));
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const fmt = (v: number) => (metric === 'net' ? rupees(v) : `${v} bill${v === 1 ? '' : 's'}`);
  return (
    <div className={cx(CARD, 'p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={cx('text-sm', MUTED)}>Last 7 days</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">{metric === 'net' ? rupees(total) : `${total} bills`}</div>
        </div>
        <div className={cx(INSET, 'inline-flex p-1')} role="tablist" aria-label="Chart measure">
          {(['net', 'bills'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={metric === m}
              onClick={() => setMetric(m)}
              className={cx('rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors', metric === m ? 'bg-white/10 text-white' : cx(MUTED, 'hover:text-white'))}
            >
              {m === 'net' ? 'Net sales' : 'Bills'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 flex h-60 items-end gap-2 sm:gap-3" role="img" aria-label={`${metric === 'net' ? 'Net sales' : 'Bills'} for the last 7 days`}>
        {week.map((w, i) => {
          const v = vals[i];
          const active = i === sel;
          const h = v > 0 ? Math.max(8, (v / max) * 100) : 4;
          const today = i === week.length - 1;
          return (
            <button
              key={w.date}
              type="button"
              onMouseEnter={() => setSel(i)}
              onFocus={() => setSel(i)}
              onClick={() => setSel(i)}
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2 focus-visible:outline-none"
              aria-label={`${date(w.date)}: ${fmt(v)}`}
            >
              <div className="relative flex w-full flex-1 items-end justify-center">
                {active && (
                  <div className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#fff] px-2.5 py-1 font-mono text-xs font-semibold text-navy-800 shadow-lg" style={{ bottom: `calc(${h}% + 10px)` }}>
                    {fmt(v)}
                  </div>
                )}
                <div
                  className={cx(
                    'w-full max-w-[52px] rounded-t-xl rounded-b-md transition-all duration-300',
                    active ? 'bg-gradient-to-b from-[#FFB27A] via-brand-500 to-brand-700/30 shadow-[0_0_34px_-2px_rgba(246,135,42,0.75)]' : 'bg-gradient-to-b from-[#24365F] to-[#142347] group-hover:from-[#2C416F]',
                  )}
                  style={{ height: `${h}%` }}
                />
              </div>
              <span className={cx('text-xs', active ? 'font-semibold text-white' : MUTED)}>{today ? 'Today' : date(w.date).slice(0, 5)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecentBills({ enabled }: { enabled: boolean }) {
  const today = todayIso();
  const q = useQuery({
    queryKey: ['dash-bills', today],
    queryFn: () => get<{ rows: BillRow[] }>(`/sales${qs({ from: today, to: today, pageSize: 7 })}`),
    enabled,
    refetchInterval: 30_000,
  });
  const [find, setFind] = useState('');
  if (!enabled) return null;
  const rows = (q.data?.rows ?? []).filter((r) => !find || r.billNo.toLowerCase().includes(find.toLowerCase()) || r.cashier.toLowerCase().includes(find.toLowerCase()));
  const pill = (r: BillRow) =>
    r.status === 'CANCELLED'
      ? 'bg-[#3A1620] text-[#FF9AA5]'
      : r.hasReturns
        ? 'bg-[#3A2A12] text-[#FFC27A]'
        : r.edited
          ? 'bg-[#3A2A12] text-[#FFC27A]'
          : 'bg-[#123227] text-[#8FE3B0]';
  const label = (r: BillRow) => (r.status === 'CANCELLED' ? 'Cancelled' : r.hasReturns ? 'Returned' : r.edited ? 'Edited' : 'Completed');
  return (
    <div className={cx(CARD, 'p-6')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Recent bills</h2>
          <p className={cx('text-sm', MUTED)}>Today's latest, newest first</p>
        </div>
        <div className="flex items-center gap-2">
          <label className={cx(INSET, 'flex h-10 items-center gap-2 px-3')}>
            <span className="sr-only">Search bills</span>
            <svg viewBox="0 0 24 24" className={cx('h-4 w-4', MUTED)} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Bill no or cashier" className="w-40 bg-transparent text-sm text-white placeholder:text-[#6F7DA3] focus:outline-none" />
          </label>
          <Link to="/sales" className="inline-flex h-10 items-center rounded-xl bg-white/[0.06] px-4 text-sm font-semibold text-white hover:bg-white/10">
            View all
          </Link>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[620px] whitespace-nowrap border-separate border-spacing-y-1.5 text-sm">
          <thead>
            <tr className={cx('text-left text-xs font-medium', MUTED)}>
              <th className="px-4 pb-1 font-medium">Bill no</th>
              <th className="px-4 pb-1 font-medium">Cashier</th>
              <th className="px-4 pb-1 font-medium">Time</th>
              <th className="px-4 pb-1 font-medium">Paid by</th>
              <th className="px-4 pb-1 text-right font-medium">Amount</th>
              <th className="px-4 pb-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={6} className={cx('rounded-xl bg-[#0A1530] px-4 py-6 text-center', MUTED)}>
                  Loading…
                </td>
              </tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className={cx('rounded-xl bg-[#0A1530] px-4 py-8 text-center', MUTED)}>
                  {find ? 'No bill matches that search.' : 'No bills yet today. They appear here as soon as the counters start billing.'}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="bg-[#0A1530] transition-colors hover:bg-[#0F1D40]">
                <td className="rounded-l-xl px-4 py-3 font-mono text-white">{r.billNo}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-500">{r.cashier.charAt(0).toUpperCase()}</span>
                    <span className="text-white">{r.cashier}</span>
                  </div>
                </td>
                <td className={cx('px-4 py-3 font-mono', MUTED)}>{time(r.billedAt)}</td>
                <td className={cx('px-4 py-3', MUTED)}>{r.payModes || '—'}</td>
                <td className={cx('px-4 py-3 text-right font-mono tabular-nums', r.status === 'CANCELLED' ? 'text-[#6F7DA3] line-through' : 'text-white')}>{rupees(r.grandTotal)}</td>
                <td className="rounded-r-xl px-4 py-3">
                  <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', pill(r))}>{label(r)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The store's UPI collection account, drawn like a payment card. */
function UpiCard({ settings, counter }: { settings: Settings | undefined; counter: string | null }) {
  const upi = settings?.upiId;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1B2F63] via-[#102252] to-[#0A1638] p-6 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.8)]">
      <div className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-brand-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-[#3A5BB0]/40 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <Glyph name="nfc" className="h-6 w-6 text-white/70" />
        <div className="text-right">
          <div className="font-mono text-sm tracking-widest text-white/80">{counter ?? 'OFFICE'}</div>
          <div className="text-[11px] text-white/50">counter</div>
        </div>
      </div>
      <div className="relative mt-6 h-8 w-11 rounded-md bg-gradient-to-br from-[#F4C77E] to-[#C98A3E] opacity-90" />
      <div className="relative mt-5">
        <div className="text-[11px] uppercase tracking-wider text-white/50">Store UPI</div>
        <div className="mt-0.5 truncate font-mono text-lg font-semibold text-white">{upi ?? 'Not set yet'}</div>
      </div>
      <div className="relative mt-4 flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/50">Payee name</div>
          <div className="text-sm font-medium text-white">{settings?.upiPayeeName ?? settings?.storeName ?? 'General Store'}</div>
        </div>
        <div className="text-right text-sm font-bold italic tracking-wide text-brand-500">UPI</div>
      </div>
    </div>
  );
}

function PaymentMix({ byMode }: { byMode: Record<string, number> }) {
  const modes = [
    { key: 'CASH', label: 'Cash', color: 'bg-brand-600' },
    { key: 'UPI', label: 'UPI', color: 'bg-[#FFB27A]' },
    { key: 'CARD', label: 'Card', color: 'bg-[#F4F6FB]' },
  ];
  const total = modes.reduce((a, m) => a + (byMode[m.key] ?? 0), 0);
  return (
    <div className={cx(CARD, 'p-6')}>
      <div className={cx('text-sm', MUTED)}>How customers paid</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums text-white">{rupees(total)}</span>
        <span className={cx('text-sm', MUTED)}>collected today</span>
      </div>
      <div className="mt-5 flex h-2.5 gap-1.5">
        {total > 0 ? (
          modes.map((m) => ((byMode[m.key] ?? 0) > 0 ? <div key={m.key} className={cx('rounded-full', m.color)} style={{ width: `${((byMode[m.key] ?? 0) / total) * 100}%` }} /> : null))
        ) : (
          <div className="w-full rounded-full bg-white/[0.06]" />
        )}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-2.5">
        {modes.map((m) => {
          const v = byMode[m.key] ?? 0;
          return (
            <div key={m.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2.5 text-[#C5CEE6]">
                <span className={cx('h-3 w-3 rounded', m.color)} />
                {m.label}
                <span className={MUTED}>{total > 0 ? `${((v / total) * 100).toFixed(0)}%` : '0%'}</span>
              </span>
              <span className="font-mono tabular-nums text-white">{rupees(v)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Attention({ stock }: { stock: NonNullable<Dash['stock']> }) {
  const items: { to: string; label: string; help: string; value: number; icon: keyof typeof ICONS }[] = [
    { to: '/stock?tab=low', label: 'Below zero', help: 'Sold before the purchase was entered', value: stock.negative, icon: 'alert' },
    { to: '/stock?tab=low', label: 'At reorder level', help: 'Time to place an order', value: stock.low, icon: 'cart' },
    { to: '/stock?tab=adjust', label: 'Adjustments waiting', help: 'A manager must approve', value: stock.pendingAdjustments, icon: 'sliders' },
    { to: '/purchases', label: 'Purchases to post', help: `${stock.draftPurchases} draft${stock.draftPurchases === 1 ? '' : 's'} in all`, value: stock.readyPurchases, icon: 'box' },
  ];
  const open = items.filter((i) => i.value > 0).length;
  return (
    <div className={cx(CARD, 'p-6')}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Needs attention</h2>
        <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold', open ? 'bg-brand-500/15 text-brand-500' : cx('bg-white/5', MUTED))}>{open ? `${open} open` : 'All clear'}</span>
      </div>
      <div className="mt-4 space-y-2">
        {items.map((i) => (
          <Link key={i.label} to={i.to} className={cx(INSET, 'group flex items-center gap-3 p-3.5 transition-colors hover:bg-[#0F1D40]')}>
            <span className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', i.value > 0 ? 'bg-brand-500/15 text-brand-500' : 'bg-white/5 text-[#8E9CC2]')}>
              <Glyph name={i.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-white">{i.label}</span>
              <span className={cx('block truncate text-xs', MUTED)}>{i.help}</span>
            </span>
            <span className={cx('font-mono text-lg font-semibold tabular-nums', i.value > 0 ? 'text-brand-500' : 'text-[#6F7DA3]')}>{i.value}</span>
            <Glyph name="chevron" className={cx('h-4 w-4 transition-transform group-hover:translate-x-0.5', MUTED)} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { me } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dash>('/dashboard'), refetchInterval: 30_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), staleTime: 60_000 });
  const [err, setErr] = useState<unknown>(null);

  const shell = (children: ReactNode) => (
    <div className={cx('-m-4 min-h-[calc(100vh-3.5rem)] p-4 text-white sm:-m-6 sm:p-6', PAGE)} data-page="dashboard">
      <div className="mx-auto max-w-7xl">{children}</div>
    </div>
  );
  if (q.isLoading) return shell(<div className={cx('p-8 text-sm', MUTED)}>Loading…</div>);
  if (q.error) return shell(<ErrorBox error={q.error} />);
  const d = q.data!;
  const s = d.sales;
  const prev = s && s.week.length >= 2 ? s.week[s.week.length - 2] : null;
  const avg = s && s.bills ? s.net / s.bills : 0;
  const prevAvg = prev && prev.bills ? prev.net / prev.bills : null;
  const canBill = me?.counterId && me.role !== 'STORE_KEEPER';

  return shell(
    <div className="space-y-6">
      {/* header and actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-500">
            {greeting()}, {me?.fullName}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className={cx('mt-1 text-sm', MUTED)}>
            {date(d.date)} · {s?.scope === 'own' ? 'your bills today' : s ? 'whole store' : 'stock and approvals'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s && (
            <ActionButton icon="download" onClick={() => download(`/reports/sales/daily${qs({ date: d.date, format: 'pdf' })}`).catch(setErr)}>
              Today's report
            </ActionButton>
          )}
          <ActionButton icon="report" to="/reports">
            Reports
          </ActionButton>
          {canBill ? (
            <ActionButton icon="bill" primary to="/billing">
              New bill
            </ActionButton>
          ) : (
            me?.role !== 'CASHIER' && (
              <ActionButton icon="purchase" primary to="/purchases">
                Purchases
              </ActionButton>
            )
          )}
        </div>
      </div>
      <ErrorBox error={err} />

      {d.alerts && d.alerts.length > 0 && (
        <div className="space-y-3">
          {d.alerts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-[#3A1620] p-4 text-sm text-[#FFC0C7]">
              <div className="flex gap-3">
                <Glyph name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold text-white">{a.message}</p>
                  {a.details && <p className="mt-1 text-xs">{a.details.slice(0, 5).map((x) => `${x.code} ${x.name}: balance ${x.cached}, ledger ${x.ledger}`).join(' · ')}</p>}
                </div>
              </div>
              {me?.role === 'ADMIN' && (
                <button
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  onClick={async () => {
                    await post(`/alerts/${a.id}/resolve`);
                    toast('Alert marked as handled');
                    void q.refetch();
                  }}
                >
                  Mark handled
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={cx('grid gap-6', s ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : '')}>
        {/* main column */}
        <div className="min-w-0 space-y-6">
          {s && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Kpi label="Net sales today" value={rupees(s.net)} now={s.net} before={prev?.net ?? null} />
                <Kpi label="Bills today" value={s.bills} now={s.bills} before={prev?.bills ?? null} />
                <Kpi label="Average bill" value={rupees(avg)} now={avg} before={prevAvg} />
              </div>
              {s.week.length > 0 && <WeekChart week={s.week} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={cx(CARD, 'flex items-center justify-between p-5')}>
                  <div>
                    <div className={cx('text-sm', MUTED)}>Returns refunded</div>
                    <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-white">{rupees(s.returns)}</div>
                  </div>
                  <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium', s.returns > 0 ? 'bg-brand-500/15 text-brand-500' : cx('bg-white/5', MUTED))}>after returns {compact(s.net - s.returns)}</span>
                </div>
                <div className={cx(CARD, 'flex items-center justify-between p-5')}>
                  <div>
                    <div className={cx('text-sm', MUTED)}>Cancelled bills</div>
                    <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-white">{s.cancelled}</div>
                  </div>
                  <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium', s.cancelled > 0 ? 'bg-brand-500/15 text-brand-500' : cx('bg-white/5', MUTED))}>{s.cancelled > 0 ? 'check the reasons' : 'none today'}</span>
                </div>
              </div>
            </>
          )}
          <RecentBills enabled={!!s} />
          {!s && d.stock && <Attention stock={d.stock} />}
        </div>

        {/* side column */}
        {s && (
          <div className="min-w-0 space-y-6">
            <UpiCard settings={settings.data} counter={me?.counterCode ?? null} />
            <div>
              <div className={cx('mb-3 text-sm font-medium', MUTED)}>Quick actions</div>
              <div className="grid grid-cols-2 gap-2">
                {canBill && (
                  <Link to="/billing" className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10">
                    <Glyph name="bill" /> New bill
                  </Link>
                )}
                <Link to="/sales" className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10">
                  <Glyph name="report" /> Sales register
                </Link>
                {me?.role !== 'CASHIER' && (
                  <Link to="/stock" className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10">
                    <Glyph name="stock" /> Stock
                  </Link>
                )}
                {me?.role !== 'CASHIER' && (
                  <Link to="/purchases" className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10">
                    <Glyph name="purchase" /> Purchases
                  </Link>
                )}
              </div>
            </div>
            <PaymentMix byMode={s.byMode} />
            {d.stock && <Attention stock={d.stock} />}
          </div>
        )}
      </div>
    </div>,
  );
}

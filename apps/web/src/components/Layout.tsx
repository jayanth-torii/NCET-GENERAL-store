import { useQuery } from '@tanstack/react-query';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { BILLING, MANAGE, PURCHASE, useAuth } from '../lib/auth';
import { altOf, billingKey } from '../lib/keys';
import { ROLE_LABEL } from '../lib/format';
import type { Role, Settings } from '../lib/types';
import { Button, cx, ErrorBox, Field, Input, Kbd, useToast } from './ui';

const ALL: Role[] = ['ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER'];
const ADMIN: Role[] = ['ADMIN'];
const SALES_VIEW: Role[] = ['ADMIN', 'MANAGER', 'CASHIER'];

interface MenuItem {
  to: string;
  label: string;
  roles: Role[];
  key?: string; // shortcut shown on the right
  sep?: boolean; // divider above this item
}
interface MenuGroup {
  label: string;
  items: MenuItem[];
}

/** Classic desktop-POS menu bar across the top, grouped like the store's previous billing software. */
// Grouped the way the store's previous desktop software (Wondersoft Shopaid) arranges its menus,
// so staff find each screen under the heading they already know.
const MENU: MenuGroup[] = [
  {
    label: 'File',
    items: [
      { to: '/products', label: 'Product', roles: PURCHASE },
      { to: '/admin?tab=suppliers', label: 'Supplier', roles: MANAGE },
      { to: '/admin?tab=catalogue', label: 'Product group & unit', roles: MANAGE },
      { to: '/admin?tab=kits', label: 'Section kits', roles: MANAGE },
      { to: '/admin?tab=charges', label: 'Transport / charge types', roles: ADMIN, sep: true },
      { to: '/admin?tab=counters', label: 'Counters', roles: ADMIN },
      { to: '/admin?tab=users', label: 'User', roles: MANAGE, sep: true },
      { to: '/admin?tab=settings', label: 'Store settings & GSTIN', roles: ADMIN },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/billing', label: 'Retail bill (counter sales)', roles: BILLING, key: 'F2' },
      { to: '/sales', label: 'Bill view / return against bill', roles: SALES_VIEW },
      { to: '/reports?tab=daily', label: 'Daily sales report', roles: SALES_VIEW, sep: true },
      { to: '/reports?tab=monthly', label: 'Monthly sales report', roles: MANAGE },
      { to: '/reports?tab=register', label: 'Sales register report', roles: MANAGE },
      { to: '/reports?tab=kits', label: 'Section kit sales', roles: MANAGE },
      { to: '/gst?tab=output', label: 'GST output register', roles: MANAGE },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { to: '/purchases?new=1', label: 'Purchase entry (new GRN)', roles: PURCHASE },
      { to: '/purchases', label: 'Purchase view / returns', roles: PURCHASE },
      { to: '/reports?tab=purchases', label: 'Purchase report', roles: MANAGE, sep: true },
      { to: '/gst?tab=input', label: 'GST input register', roles: MANAGE },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/stock?tab=adjust', label: 'Stock adjustment', roles: PURCHASE },
      { to: '/stock?tab=ledger', label: 'Product enquiry (item ledger)', roles: PURCHASE },
      { to: '/stock', label: 'Stock value report', roles: PURCHASE, sep: true },
      { to: '/stock?tab=low', label: 'Low & nil stock report', roles: PURCHASE },
      { to: '/reports?tab=dead', label: 'Non-moving stock', roles: PURCHASE },
      { to: '/reports?tab=yearly', label: 'Yearly stock (FY)', roles: PURCHASE },
    ],
  },
  {
    label: 'Expiry/Damage',
    items: [
      { to: '/stock?tab=expiry', label: 'Expiry report', roles: PURCHASE },
      { to: '/stock?tab=adjust', label: 'Write off expired / damaged', roles: PURCHASE },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports?tab=daily', label: 'Daily sales', roles: SALES_VIEW },
      { to: '/reports?tab=monthly', label: 'Monthly sales', roles: MANAGE },
      { to: '/reports?tab=register', label: 'Sales register', roles: MANAGE },
      { to: '/reports?tab=purchases', label: 'Purchase register', roles: MANAGE },
      { to: '/reports?tab=kits', label: 'Section kits', roles: MANAGE },
      { to: '/stock', label: 'Stock value', roles: PURCHASE, sep: true },
      { to: '/reports?tab=yearly', label: 'Yearly stock (FY)', roles: PURCHASE },
      { to: '/reports?tab=dead', label: 'Dead stock', roles: PURCHASE },
    ],
  },
  {
    label: 'GST',
    items: [
      { to: '/gst?tab=input', label: 'GST input register (purchases)', roles: MANAGE },
      { to: '/gst?tab=output', label: 'GST output register (sales)', roles: MANAGE },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { to: '/admin?tab=sessions', label: 'Who is logged in', roles: MANAGE },
      { to: '/admin?tab=audit', label: 'Audit log', roles: MANAGE },
      { to: '/admin?tab=golive', label: 'Go-live tools / backup', roles: ADMIN },
      { to: '/account', label: 'Change my password', roles: ALL, sep: true },
    ],
  },
];

/** Does this menu item point at the page (and tab) on screen now? */
function isCurrent(to: string, pathname: string, search: string) {
  const [path, query] = to.split('?');
  if (path !== pathname) return false;
  const want = new URLSearchParams(query ?? '').get('tab');
  const have = new URLSearchParams(search).get('tab');
  return want === null ? have === null || path === '/' : want === have;
}

function MenuBar({ groups, mobileOpen }: { groups: MenuGroup[]; mobileOpen: boolean }) {
  const loc = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const homeActive = loc.pathname === '/';
  const tab = (active: boolean) =>
    cx(
      'relative flex h-10 items-center gap-1 whitespace-nowrap px-4 text-[13px] font-semibold uppercase tracking-wide transition-colors',
      active ? 'text-brand-500 after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-brand-500' : 'text-ink-soft hover:bg-white/5 hover:text-white',
    );
  const item = (i: MenuItem, active: boolean) => (
    <Link
      key={i.to}
      to={i.to}
      role="menuitem"
      onClick={() => setOpen(null)}
      className={cx('flex items-center justify-between gap-6 rounded-lg px-3 py-2 text-sm', active ? 'bg-brand-500/15 text-brand-500' : 'text-ink hover:bg-white/[0.07] hover:text-white')}
    >
      {i.label}
      {i.key && <Kbd>{i.key}</Kbd>}
    </Link>
  );
  return (
    <nav ref={barRef} aria-label="Main menu" className={cx('border-t border-white/[0.06] bg-[#0B1838]', mobileOpen ? 'block' : 'hidden lg:block')}>
      {/* wide screens: one row of menus with drop-downs */}
      <div className="hidden h-10 items-stretch px-2 lg:flex">
        <Link to="/" className={tab(homeActive)}>
          Home
        </Link>
        {groups.map((g) => {
          const active = g.items.some((i) => isCurrent(i.to, loc.pathname, loc.search));
          const isOpen = open === g.label;
          return (
            <div key={g.label} className="relative" onMouseEnter={() => open && setOpen(g.label)}>
              <button type="button" aria-haspopup="menu" aria-expanded={isOpen} className={tab(active || isOpen)} onClick={() => setOpen(isOpen ? null : g.label)}>
                {g.label}
                <span aria-hidden className={cx('text-[10px] transition-transform', isOpen && 'rotate-180')}>
                  ▾
                </span>
              </button>
              {isOpen && (
                <div role="menu" aria-label={g.label} className="absolute left-0 top-full z-40 mt-1 min-w-[240px] rounded-xl border border-white/10 bg-surface p-1.5 shadow-2xl">
                  {g.items.map((i, n) => (
                    <div key={i.to}>
                      {i.sep && n > 0 && <div className="my-1 border-t border-white/[0.07]" />}
                      {item(i, isCurrent(i.to, loc.pathname, loc.search))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* small screens: every menu listed under the ☰ button (only in the page while open) */}
      {mobileOpen && (
      <div className="max-h-[70vh] overflow-y-auto p-2 lg:hidden">
        <Link to="/" className={cx('block rounded-lg px-3 py-2 text-sm font-semibold', homeActive ? 'text-brand-500' : 'text-white')}>
          Home
        </Link>
        {groups.map((g) => (
          <div key={g.label} className="mt-2">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{g.label}</div>
            {g.items.map((i) => item(i, isCurrent(i.to, loc.pathname, loc.search)))}
          </div>
        ))}
      </div>
      )}
    </nav>
  );
}

function ServerClock() {
  const { data } = useQuery({ queryKey: ['time'], queryFn: () => get<{ iso: string }>('/auth/time'), refetchInterval: 5 * 60_000 });
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (data) setOffset(new Date(data.iso).getTime() - Date.now());
  }, [data]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(now + offset);
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return (
    <span className="font-mono text-xs text-ink-mute tabular-nums" title="Server time (IST). Bills always use this clock.">
      {s.replace(/\//g, '-').replace(',', '')}
    </span>
  );
}

/** Ctrl+L locks the counter. Unlock needs the same user's password; the session itself stays valid. */
function LockScreen() {
  const { me, logout, unlock } = useAuth();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await unlock(pw);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
      setPw('');
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-page p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border-t-4 border-brand-500 bg-surface p-6 shadow-2xl">
        <div className="mx-auto w-fit rounded-xl bg-[#fff] px-3 py-2">
          <img src="/ncet-logo.png" alt="" className="h-14 w-auto" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-white">Counter locked</h1>
          <p className="text-sm text-ink-mute">
            {me?.fullName} · {me?.counterCode ?? 'Office'}
          </p>
        </div>
        <Field label="Password">{(id) => <Input id={id} type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}</Field>
        <ErrorBox error={err} />
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => void logout()}>
            Log out instead
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Unlock
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Layout() {
  const { me, logout, can, lock } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const stateRef = useRef({ canBill: false });
  stateRef.current.canBill = !!me?.counterId && can(...BILLING);
  useEffect(() => setMenu(false), [loc.pathname]);
  const doLock = () => void lock().catch(() => undefined);
  // Idle lock: no key, click or touch for the configured minutes locks the counter (setting, default 10).
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), staleTime: 60_000 });
  const idleMinutes = settings.data?.autoLockMinutes ?? 0;
  useEffect(() => {
    if (!idleMinutes || !me || me.locked) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(doLock, idleMinutes * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleMinutes, me?.locked, me?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        doLock();
      }
    };
    // Billing F keys belong to the Counter sales page. Elsewhere, F2 jumps there and the others explain where they work.
    const onFKey = (e: KeyboardEvent) => {
      const k = billingKey(e);
      if (!k || window.location.pathname.startsWith('/billing') || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (e.repeat) return;
      const st = stateRef.current;
      if (!st.canBill) toast(`${k} (${altOf(k)}) is a billing shortcut. Log in with a counter selected to use Counter sales.`, 'amber');
      else if (k === 'F2') navigate('/billing');
      else toast(`${k} (${altOf(k)}) works on the Counter sales page. Press F2 or Alt+2 to go there.`, 'amber');
    };
    window.addEventListener('keydown', onFKey);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onFKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!me) return null;
  const locked = me.locked;
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => can(...i.roles)) })).filter((g) => g.items.length > 0);
  const billing = loc.pathname.startsWith('/billing');
  const gstin = settings.data?.gstin;
  return (
    <div className="flex min-h-screen flex-col">
      {locked && <LockScreen />}
      <header className="sticky top-0 z-30 bg-[#081330]/95 text-ink shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <button className="rounded-lg p-1.5 text-white hover:bg-white/10 lg:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu">
            ☰
          </button>
          {/* the college logo has dark lettering, so it sits on its own white tile */}
          <span className="inline-flex h-10 items-center rounded-lg bg-[#fff] px-1.5">
            <img src="/ncet-logo.png" alt="Nagarjuna College of Engineering & Technology" className="h-8 w-auto" />
          </span>
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-bold tracking-tight text-white">{settings.data?.storeName ?? 'General Store'}</span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-brand-500">Point of sale</span>
          </div>
          <span
            className={cx('hidden rounded-md border px-2 py-0.5 font-mono text-[11px] md:inline', gstin ? 'border-brand-500/40 text-brand-500' : 'border-white/10 text-ink-mute')}
            title={gstin ? 'Store GSTIN (Utilities → Store settings)' : 'No GSTIN set. The admin can add it in Utilities → Store settings.'}
          >
            GSTIN {gstin || 'not set'}
          </span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ServerClock />
            <span className="hidden rounded-full bg-brand-500/15 px-2.5 py-0.5 font-mono text-xs text-brand-500 sm:inline">{me.counterCode ?? 'No counter'}</span>
            <span className="hidden font-medium text-white md:inline">
              {me.fullName} <span className="font-normal text-ink-mute">· {ROLE_LABEL[me.role]}</span>
            </span>
            <button className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-white/10 hover:text-white" onClick={doLock} title="Lock this counter (Ctrl+L)">
              Lock <Kbd>Ctrl L</Kbd>
            </button>
            <button className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-white/10 hover:text-white" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
        <MenuBar groups={groups} mobileOpen={menu} />
      </header>
      <main className={cx('min-w-0 flex-1', billing ? 'p-3' : 'p-4 sm:p-6')}>
        <Outlet />
      </main>
    </div>
  );
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...roles)) return <div className="p-8 text-sm text-ink-mute">Your role does not have access to this page.</div>;
  return <>{children}</>;
}

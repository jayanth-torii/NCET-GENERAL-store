import { useQuery } from '@tanstack/react-query';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { BILLING, MANAGE, PURCHASE, useAuth } from '../lib/auth';
import { altOf, billingKey } from '../lib/keys';
import { ROLE_LABEL } from '../lib/format';
import type { Role, Settings } from '../lib/types';
import { Button, cx, ErrorBox, Field, Input, Kbd, useToast } from './ui';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', roles: ['ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER'] },
  { to: '/billing', label: 'Counter sales', roles: BILLING },
  { to: '/sales', label: 'Sales register', roles: ['ADMIN', 'MANAGER', 'CASHIER'] },
  { to: '/purchases', label: 'Purchases', roles: PURCHASE },
  { to: '/products', label: 'Products', roles: PURCHASE },
  { to: '/stock', label: 'Stock', roles: PURCHASE },
  { to: '/reports', label: 'Reports', roles: ['ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER'] },
  { to: '/admin', label: 'Settings & users', roles: MANAGE },
];

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
  const items = NAV.filter((n) => can(...n.roles));
  const billing = loc.pathname.startsWith('/billing');
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
            <span className="text-sm font-bold tracking-tight text-white">General Store</span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-brand-500">Point of sale</span>
          </div>
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
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className={cx('w-56 shrink-0 bg-[#081330] p-3', 'fixed inset-y-14 left-0 z-20 lg:static lg:block', menu ? 'block' : 'hidden', billing && 'lg:hidden xl:block')}>
          <ul className="space-y-1">
            {items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) => cx('block rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-brand-500/15 text-brand-500' : 'text-ink-mute hover:bg-white/5 hover:text-white')}
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
            <li className="pt-2">
              <NavLink to="/account" className={({ isActive }) => cx('block rounded-xl px-3.5 py-2.5 text-sm', isActive ? 'bg-brand-500/15 text-brand-500' : 'text-ink-mute/70 hover:text-white')}>
                My password
              </NavLink>
            </li>
          </ul>
        </nav>
        <main className={cx('min-w-0 flex-1', billing ? 'p-3' : 'p-4 sm:p-6')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...roles)) return <div className="p-8 text-sm text-ink-mute">Your role does not have access to this page.</div>;
  return <>{children}</>;
}

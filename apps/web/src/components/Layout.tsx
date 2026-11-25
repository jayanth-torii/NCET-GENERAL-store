import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  CornerDownLeft,
  FileSpreadsheet,
  Home,
  KeyRound,
  Lock,
  LogOut,
  type LucideIcon,
  Moon,
  PanelLeft,
  Receipt,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Sun,
  TimerOff,
  Truck,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get } from '../lib/api';
import { BILLING, MANAGE, PURCHASE, useAuth } from '../lib/auth';
import { altOf, billingKey } from '../lib/keys';
import { ROLE_LABEL } from '../lib/format';
import type { Role, Settings } from '../lib/types';
import { Button, cx, ErrorBox, Field, Input, Kbd, useTheme, useToast } from './ui';

/*
 * App shell in the NCET ERP style: a collapsible sidebar (module groups with coloured icons and
 * sub-menus, user menu at the bottom) and a sticky top bar (sidebar toggle, page title, quick
 * search, server clock, counter, theme toggle, lock). Ctrl+B collapses the sidebar, Ctrl+K searches.
 */

const ALL: Role[] = ['ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER'];
const ADMIN: Role[] = ['ADMIN'];
const SALES_VIEW: Role[] = ['ADMIN', 'MANAGER', 'CASHIER'];

interface MenuItem {
  to: string;
  label: string;
  roles: Role[];
  key?: string; // shortcut shown on the right
}
interface MenuGroup {
  label: string;
  icon: LucideIcon;
  color: string; // text-nav-* accent, like the ERP sidebar
  items: MenuItem[];
}
interface Section {
  label: string;
  groups: MenuGroup[];
}

// Same screens and grouping as before (Sales, Purchase, Inventory, Expiry/Damage, Reports, GST),
// laid out as ERP sidebar sections.
const SECTIONS: Section[] = [
  {
    label: 'Store',
    groups: [
      {
        label: 'Sales',
        icon: ShoppingCart,
        color: 'text-nav-sales',
        items: [
          { to: '/billing', label: 'Retail bill (counter sales)', roles: BILLING, key: 'F2' },
          { to: '/sales', label: 'Bill view / return against bill', roles: SALES_VIEW },
          { to: '/reports?tab=daily', label: 'Daily sales report', roles: SALES_VIEW },
          { to: '/reports?tab=monthly', label: 'Monthly sales report', roles: MANAGE },
          { to: '/reports?tab=register', label: 'Sales register report', roles: MANAGE },
          { to: '/reports?tab=kits', label: 'Section kit sales', roles: MANAGE },
          { to: '/gst?tab=output', label: 'GST output register', roles: MANAGE },
        ],
      },
      {
        label: 'Purchase',
        icon: Truck,
        color: 'text-nav-purchase',
        items: [
          { to: '/purchases?new=1', label: 'Purchase entry (new GRN)', roles: PURCHASE },
          { to: '/purchases', label: 'Purchase view / returns', roles: PURCHASE },
          { to: '/reports?tab=purchases', label: 'Purchase report', roles: MANAGE },
          { to: '/gst?tab=input', label: 'GST input register', roles: MANAGE },
        ],
      },
      {
        label: 'Inventory',
        icon: Boxes,
        color: 'text-nav-stock',
        items: [
          { to: '/stock?tab=adjust', label: 'Stock adjustment', roles: PURCHASE },
          { to: '/stock?tab=ledger', label: 'Product enquiry (item ledger)', roles: PURCHASE },
          { to: '/stock', label: 'Stock value report', roles: PURCHASE },
          { to: '/stock?tab=low', label: 'Low & nil stock report', roles: PURCHASE },
          { to: '/reports?tab=dead', label: 'Non-moving stock', roles: PURCHASE },
          { to: '/reports?tab=yearly', label: 'Yearly stock (FY)', roles: PURCHASE },
        ],
      },
      {
        label: 'Expiry/Damage',
        icon: TimerOff,
        color: 'text-nav-expiry',
        items: [
          { to: '/stock?tab=expiry', label: 'Expiry report', roles: PURCHASE },
          { to: '/stock?tab=adjust', label: 'Write off expired / damaged', roles: PURCHASE },
        ],
      },
    ],
  },
  {
    label: 'Insights',
    groups: [
      {
        label: 'Reports',
        icon: BarChart3,
        color: 'text-nav-reports',
        items: [
          { to: '/reports?tab=daily', label: 'Daily sales', roles: SALES_VIEW },
          { to: '/reports?tab=monthly', label: 'Monthly sales', roles: MANAGE },
          { to: '/reports?tab=register', label: 'Sales register', roles: MANAGE },
          { to: '/reports?tab=purchases', label: 'Purchase register', roles: MANAGE },
          { to: '/reports?tab=kits', label: 'Section kits', roles: MANAGE },
          { to: '/stock', label: 'Stock value', roles: PURCHASE },
          { to: '/reports?tab=yearly', label: 'Yearly stock (FY)', roles: PURCHASE },
          { to: '/reports?tab=dead', label: 'Dead stock', roles: PURCHASE },
        ],
      },
      {
        label: 'GST',
        icon: Receipt,
        color: 'text-nav-gst',
        items: [
          { to: '/gst?tab=input', label: 'GST input register (purchases)', roles: MANAGE },
          { to: '/gst?tab=output', label: 'GST output register (sales)', roles: MANAGE },
        ],
      },
    ],
  },
  {
    label: 'Administration',
    groups: [
      {
        label: 'Masters',
        icon: FileSpreadsheet,
        color: 'text-nav-masters',
        items: [
          { to: '/products', label: 'Product', roles: PURCHASE },
          { to: '/admin?tab=suppliers', label: 'Supplier', roles: MANAGE },
          { to: '/admin?tab=catalogue', label: 'Product group & unit', roles: MANAGE },
          { to: '/admin?tab=kits', label: 'Section kits', roles: MANAGE },
          { to: '/admin?tab=charges', label: 'Transport / charge types', roles: ADMIN },
          { to: '/admin?tab=counters', label: 'Counters', roles: ADMIN },
          { to: '/admin?tab=users', label: 'User', roles: MANAGE },
          { to: '/admin?tab=settings', label: 'Store settings & GSTIN', roles: ADMIN },
        ],
      },
      {
        label: 'Maintenance',
        icon: Settings2,
        color: 'text-nav-admin',
        items: [
          { to: '/admin?tab=sessions', label: 'Who is logged in', roles: MANAGE },
          { to: '/admin?tab=audit', label: 'Audit log', roles: MANAGE },
          { to: '/admin?tab=golive', label: 'Go-live tools / backup', roles: ADMIN },
          { to: '/account', label: 'Change my password', roles: ALL },
        ],
      },
    ],
  },
];

/** Does this menu item point at the page (and tab) on screen now? */
function isCurrent(to: string, pathname: string, search: string) {
  const [path, query] = to.split('?');
  if (path !== pathname) return false;
  // Same page and the same "tab" / "new" switches: /purchases and /purchases?new=1 are different screens.
  const keyOf = (q: string) => {
    const p = new URLSearchParams(q);
    return ['tab', 'new'].map((k) => `${k}=${p.get(k) ?? ''}`).join('&');
  };
  return keyOf(query ?? '') === keyOf(search);
}

const SIDEBAR_KEY = 'storepos-sidebar';
function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- sidebar
function NavGroup({ g, collapsed, onExpand, onNavigate }: { g: MenuGroup; collapsed: boolean; onExpand: () => void; onNavigate: () => void }) {
  const loc = useLocation();
  const active = g.items.some((i) => isCurrent(i.to, loc.pathname, loc.search));
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const Icon = g.icon;
  return (
    <li className="relative">
      <button
        type="button"
        aria-expanded={!collapsed && open}
        title={collapsed ? g.label : undefined}
        onClick={() => {
          if (collapsed) {
            onExpand();
            setOpen(true);
          } else setOpen((o) => !o);
        }}
        className={cx(
          'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-none ring-ring/40 transition-colors hover:bg-ink/[0.06] focus-visible:ring-2',
          active && 'bg-ink/[0.06] font-medium',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className={cx('h-4 w-4 shrink-0', g.color)} aria-hidden />
        {!collapsed && (
          <>
            <span className="truncate">{g.label}</span>
            <ChevronRight className={cx('ml-auto h-4 w-4 shrink-0 text-ink-mute transition-transform duration-200', open && 'rotate-90')} aria-hidden />
          </>
        )}
      </button>
      {!collapsed && open && (
        <ul role="menu" aria-label={g.label} className="mx-3.5 flex min-w-0 translate-x-px flex-col gap-0.5 border-l border-sidebar-line px-2.5 py-0.5">
          {g.items.map((i) => {
            const cur = isCurrent(i.to, loc.pathname, loc.search);
            return (
              <li key={i.to + i.label}>
                <Link
                  to={i.to}
                  role="menuitem"
                  onClick={onNavigate}
                  aria-current={cur ? 'page' : undefined}
                  className={cx(
                    'flex min-h-7 items-center justify-between gap-2 rounded-md px-2 py-1 text-[13px] outline-none ring-ring/40 transition-colors focus-visible:ring-2',
                    cur ? 'font-medium text-ink underline underline-offset-4' : 'text-ink-soft hover:bg-ink/[0.06] hover:text-ink',
                  )}
                >
                  <span className="min-w-0">{i.label}</span>
                  {i.key && <Kbd>{i.key}</Kbd>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function UserMenu({ collapsed, onLock }: { collapsed: boolean; onLock: () => void }) {
  const { me, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!me) return null;
  const initials = me.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const avatar = <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-main text-xs font-semibold text-main-fg">{initials}</span>;
  const who = (
    <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
      <span className="truncate font-semibold">{me.fullName}</span>
      <span className="truncate text-xs text-ink-mute">
        {ROLE_LABEL[me.role]} · {me.counterCode ?? 'No counter'}
      </span>
    </span>
  );
  const row = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-ink-mute';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className={cx('flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left outline-none ring-ring/40 transition-colors hover:bg-ink/[0.06] focus-visible:ring-2', open && 'bg-ink/[0.06]', collapsed && 'justify-center p-0')}
      >
        {avatar}
        {!collapsed && (
          <>
            {who}
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute bottom-0 left-full z-50 ml-2 w-60 animate-pop-in rounded-lg border border-line bg-page p-1 text-ink shadow-lift max-md:bottom-full max-md:left-0 max-md:mb-2 max-md:ml-0">
          <div className="flex items-center gap-2 px-1 py-1.5">
            {avatar}
            {who}
          </div>
          <div className="-mx-1 my-1 h-px bg-line" />
          <Link to="/account" role="menuitem" className={row}>
            <KeyRound /> Change password
          </Link>
          <button type="button" role="menuitem" className={row} onClick={toggle}>
            {mode === 'dark' ? <Sun /> : <Moon />} {mode === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" role="menuitem" className={row} onClick={onLock}>
            <Lock /> Lock counter <span className="ml-auto">
              <Kbd>Ctrl L</Kbd>
            </span>
          </button>
          <div className="-mx-1 my-1 h-px bg-line" />
          <button type="button" role="menuitem" className={row} onClick={() => void logout()}>
            <LogOut /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarBody({ sections, collapsed, storeName, onExpand, onNavigate, onLock }: { sections: Section[]; collapsed: boolean; storeName: string; onExpand: () => void; onNavigate: () => void; onLock: () => void }) {
  const loc = useLocation();
  const homeActive = loc.pathname === '/';
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-ink">
      {/* header: like the ERP role/org switcher — main-colour tile + name */}
      <div className="flex flex-col gap-2 p-2">
        <Link to="/" onClick={onNavigate} className={cx('flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 outline-none ring-ring/40 transition-colors hover:bg-ink/[0.06] focus-visible:ring-2', collapsed && 'justify-center p-0')}>
          <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-main text-main-fg">
            <Store className="h-4 w-4" aria-hidden />
          </span>
          {!collapsed && (
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{storeName}</span>
              <span className="truncate text-xs text-ink-mute">Point of sale</span>
            </span>
          )}
        </Link>
      </div>
      <nav aria-label="Main menu" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden">
        <div className="relative flex w-full min-w-0 flex-col p-2">
          {!collapsed && <div className="flex h-8 shrink-0 items-center px-2 text-xs font-medium text-ink-mute">Platform</div>}
          <ul className="flex w-full min-w-0 flex-col gap-1">
            <li>
              <Link
                to="/"
                onClick={onNavigate}
                title={collapsed ? 'Home' : undefined}
                aria-current={homeActive ? 'page' : undefined}
                className={cx(
                  'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm outline-none ring-ring/40 transition-colors hover:bg-ink/[0.06] focus-visible:ring-2',
                  homeActive && 'bg-ink/[0.06] font-medium',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Home className="h-4 w-4 shrink-0 text-nav-home" aria-hidden />
                {!collapsed && <span>Home</span>}
              </Link>
            </li>
          </ul>
        </div>
        {sections.map((s) => (
          <div key={s.label} className="relative flex w-full min-w-0 flex-col p-2 pt-0">
            {!collapsed && <div className="flex h-8 shrink-0 items-center px-2 text-xs font-medium text-ink-mute">{s.label}</div>}
            <ul className="flex w-full min-w-0 flex-col gap-1">
              {s.groups.map((g) => (
                <NavGroup key={g.label} g={g} collapsed={collapsed} onExpand={onExpand} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-2 border-t border-sidebar-line p-2">
        <UserMenu collapsed={collapsed} onLock={onLock} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top bar bits
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
    <span className="hidden items-center gap-1.5 font-mono text-xs tabular-nums text-ink-mute lg:inline-flex" title="Server time (IST). Bills always use this clock.">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {s.replace(/\//g, '-').replace(',', '')}
    </span>
  );
}

/** Ctrl+K quick search over every screen this user can open (the ERP topbar search). */
function QuickSearch({ sections }: { sections: Section[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: { to: string; label: string; group: string; icon: LucideIcon; color: string }[] = [{ to: '/', label: 'Home', group: 'Dashboard', icon: Home, color: 'text-nav-home' }];
    for (const s of sections)
      for (const g of s.groups)
        for (const i of g.items) {
          const k = i.to + i.label;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ to: i.to, label: i.label, group: g.label, icon: g.icon, color: g.color });
        }
    return out;
  }, [sections]);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? all.filter((x) => `${x.label} ${x.group}`.toLowerCase().includes(t)) : all).slice(0, 12);
  }, [all, q]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm text-ink-mute shadow-sm transition-colors hover:bg-ink/[0.04] hover:text-ink md:w-56"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden md:inline">Search screens…</span>
        <span className="ml-auto hidden md:inline">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label="Search screens" className="w-full max-w-lg animate-pop-in overflow-hidden rounded-xl border border-line bg-page text-ink shadow-pop">
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                    else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSel((s) => Math.min(s + 1, hits.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSel((s) => Math.max(s - 1, 0));
                    } else if (e.key === 'Enter' && hits[sel]) go(hits[sel].to);
                  }}
                  placeholder="Type a screen or report name…"
                  className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-ink-mute"
                />
              </div>
              <ul className="max-h-[50vh] overflow-y-auto p-1">
                {hits.length === 0 && <li className="py-6 text-center text-sm text-ink-mute">No screen matches “{q}”.</li>}
                {hits.map((h, n) => {
                  const Icon = h.icon;
                  return (
                    <li key={h.to + h.label}>
                      <button
                        type="button"
                        onMouseEnter={() => setSel(n)}
                        onClick={() => go(h.to)}
                        className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm', n === sel && 'bg-ink/[0.06]')}
                      >
                        <Icon className={cx('h-4 w-4 shrink-0', h.color)} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{h.label}</span>
                        <span className="text-xs text-ink-mute">{h.group}</span>
                        {n === sel && <CornerDownLeft className="h-3.5 w-3.5 text-ink-mute" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface p-4">
      <form onSubmit={submit} className="w-full max-w-sm animate-pop-in rounded-xl border border-line bg-page p-6 text-ink shadow-pop">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-main text-main-fg">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Counter locked</h1>
            <p className="text-sm text-ink-mute">
              {me?.fullName} · {me?.counterCode ?? 'Office'}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <Field label="Password">{(id) => <Input id={id} type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}</Field>
          <ErrorBox error={err} />
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            Unlock
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
            Log out instead
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- layout
export function Layout() {
  const { me, can, lock } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const { mode, toggle } = useTheme();
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const stateRef = useRef({ canBill: false });
  stateRef.current.canBill = !!me?.counterId && can(...BILLING);
  const setCollapsed = (c: boolean) => {
    setCollapsedState(c);
    try {
      localStorage.setItem(SIDEBAR_KEY, c ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  };
  useEffect(() => setMobileOpen(false), [loc.pathname, loc.search]);
  const billing = loc.pathname.startsWith('/billing');
  // Counter sales needs the full width: the sidebar folds to icons there (the user can still open it).
  const [billingOpen, setBillingOpen] = useState(false);
  useEffect(() => setBillingOpen(false), [billing]);
  const railOnly = billing ? !billingOpen : collapsed;
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) setMobileOpen((o) => !o);
    else if (billing) setBillingOpen((o) => !o);
    else setCollapsed(!collapsed);
  };
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
  const toggleRef = useRef(toggleSidebar);
  toggleRef.current = toggleSidebar;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        doLock();
      } else if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleRef.current();
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
  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => can(...i.roles)) })).filter((g) => g.items.length > 0) })).filter((s) => s.groups.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.role],
  );
  // Page title for the top bar: the menu item that matches the current screen.
  const title = useMemo(() => {
    if (loc.pathname === '/') return { group: 'Home', page: 'Dashboard' };
    for (const s of sections)
      for (const g of s.groups)
        for (const i of g.items) if (isCurrent(i.to, loc.pathname, loc.search)) return { group: g.label, page: i.label };
    // No exact item (e.g. a page opened on its default tab): name the module only, never a wrong item.
    for (const s of sections) for (const g of s.groups) for (const i of g.items) if (i.to.split('?')[0] === loc.pathname) return { group: g.label, page: '' };
    return loc.pathname === '/account' ? { group: 'Account', page: 'Change password' } : null;
  }, [sections, loc.pathname, loc.search]);
  if (!me) return null;
  const gstin = settings.data?.gstin;
  const storeName = settings.data?.storeName ?? 'General Store';
  const body = (rail: boolean, closeMobile: boolean) => (
    <SidebarBody
      sections={sections}
      collapsed={rail}
      storeName={storeName}
      onExpand={() => (billing ? setBillingOpen(true) : setCollapsed(false))}
      onNavigate={() => closeMobile && setMobileOpen(false)}
      onLock={doLock}
    />
  );
  return (
    <div className="flex min-h-screen w-full bg-page">
      {me.locked && <LockScreen />}
      {/* desktop sidebar: full width or an icon rail; sticky so it stays while the page scrolls */}
      <div className={cx('relative hidden shrink-0 transition-[width] duration-200 ease-linear md:block', railOnly ? 'w-12' : 'w-64')}>
        <div className={cx('fixed inset-y-0 left-0 z-20 flex h-svh border-r border-sidebar-line transition-[width] duration-200 ease-linear', railOnly ? 'w-12' : 'w-64')}>{body(railOnly, false)}</div>
      </div>
      {/* mobile: the sidebar slides over the page */}
      {mobileOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in border-r border-sidebar-line shadow-pop">{body(false, true)}</div>
          </div>,
          document.body,
        )}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* soft shading: a faint top-to-bottom tint plus a light drop shadow under the bar */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line/70 bg-gradient-to-b from-page/95 to-surface/90 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_16px_-8px_rgb(0_0_0/0.12)] backdrop-blur-sm md:h-16 dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_6px_16px_-8px_rgb(0_0_0/0.6)]">
          <div className="flex w-full min-w-0 items-center gap-2 px-4">
            <button type="button" onClick={toggleSidebar} className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-ink/[0.06]" aria-label="Toggle sidebar" title="Toggle sidebar (Ctrl+B)">
              <PanelLeft className="h-4 w-4" />
            </button>
            <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
            {title && (
              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
                {title.page ? (
                  <>
                    <span className="shrink-0 text-ink-mute">{title.group}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-mute" aria-hidden />
                    <span className="truncate font-medium text-ink">{title.page}</span>
                  </>
                ) : (
                  <span className="truncate font-medium text-ink">{title.group}</span>
                )}
              </nav>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ServerClock />
              <span
                className={cx('hidden items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] xl:inline-flex', gstin ? 'border-brand-500/30 bg-brand-50 text-brand-700' : 'border-line text-ink-mute')}
                title={gstin ? 'Store GSTIN (Masters → Store settings)' : 'No GSTIN set. The admin can add it in Masters → Store settings.'}
              >
                <ShieldCheck className="h-3 w-3" aria-hidden />
                GSTIN {gstin || 'not set'}
              </span>
              <span className="hidden rounded-md bg-main px-2 py-0.5 font-mono text-xs font-medium text-main-fg sm:inline">{me.counterCode ?? 'No counter'}</span>
              <QuickSearch sections={sections} />
              <button type="button" onClick={toggle} className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-paper text-ink shadow-sm transition-colors hover:bg-ink/[0.04]" aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
                {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button type="button" onClick={doLock} className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-paper text-ink shadow-sm transition-colors hover:bg-ink/[0.04]" aria-label="Lock this counter" title="Lock this counter (Ctrl+L)">
                <Lock className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
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

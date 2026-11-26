import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  LayoutGrid,
  type LucideIcon,
  Monitor,
  Package as PackageIcon,
  PackageX,
  ReceiptText,
  Rocket,
  Rows3,
  ScrollText,
  Search as SearchIcon,
  Settings,
  ShoppingBasket,
  SlidersHorizontal,
  Tags,
  TimerOff,
  Truck,
  Users as UsersIcon,
  X,
  XCircle,
} from 'lucide-react';
import { ButtonHTMLAttributes, createContext, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../services/http.common';

/*
 * Component kit in the NCET ERP style (shadcn "new-york" look used by the ERP portal):
 * rounded-lg buttons in the NCET main colour, rounded-xl bordered cards, h-9 bordered inputs with a
 * thin focus ring, muted table headers, rounded-md status pills, dialogs on a dimmed backdrop.
 * Colours come only from theme tokens (tailwind.config.js → index.css).
 */

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Theme (light / dark, like the ERP toggle) ----------
type ThemeMode = 'light' | 'dark';
const THEME_KEY = 'storepos-theme';
function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage blocked: fall back to light */
  }
  return 'light';
}
export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}
/** Call once at start-up so the first paint already has the saved theme. */
export function initTheme() {
  applyTheme(readTheme());
}
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readTheme);
  const set = useCallback((m: ThemeMode) => {
    setMode(m);
    applyTheme(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);
  return { mode, toggle: () => set(mode === 'dark' ? 'light' : 'dark') };
}

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warn' | 'pdf' | 'excel' | 'soft';
const variants: Record<Variant, string> = {
  // Export / utility actions: tinted so they stand out, filled with their colour on hover.
  pdf: 'border border-rose-600/30 bg-rose-50 text-rose-700 shadow-sm hover:border-transparent hover:bg-rose-600 hover:text-white',
  excel: 'border border-leaf-600/30 bg-leaf-50 text-leaf-700 shadow-sm hover:border-transparent hover:bg-leaf-600 hover:text-white',
  soft: 'border border-brand-500/30 bg-brand-50 text-brand-700 shadow-sm hover:border-transparent hover:bg-main hover:text-main-fg',
  primary: 'bg-main text-main-fg shadow-sm hover:bg-main/90',
  secondary: 'border border-line bg-paper text-ink shadow-sm hover:bg-main/10 hover:text-ink',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-600/90',
  warn: 'bg-amber-600 text-white shadow-sm hover:bg-amber-600/90',
  ghost: 'text-ink-soft hover:bg-ink/[0.06] hover:text-ink',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }>(
  ({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[colors,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'lg' && 'h-11 px-6 text-base',
        variants[variant],
        className,
      )}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-line bg-surface px-1.5 font-mono text-[10px] font-medium text-ink-mute">{children}</kbd>;
}

// ---------- Form controls ----------
const control =
  'w-full rounded-md border border-line bg-paper text-sm text-ink shadow-sm transition-colors placeholder:text-ink-mute focus-visible:border-ring/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...rest }, ref) => (
  <input ref={ref} className={cx(control, 'h-9 px-3 py-1', invalid && 'border-rose-600 ring-1 ring-rose-600/40', className)} {...rest} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }>(({ className, children, compact, ...rest }, ref) => (
  <select ref={ref} className={cx(control, 'h-9', compact ? 'pl-2 pr-6' : 'pl-3 pr-8', className)} {...rest}>
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={cx(control, 'min-h-[72px] px-3 py-2', className)} {...rest} />
));
Textarea.displayName = 'Textarea';

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('grid min-w-0 content-start gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium leading-none text-ink">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : hint ? <p className="text-xs text-ink-mute">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 rounded-sm accent-main" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ---------- Layout bits ----------
/** ERP page title row: text-2xl semibold title, actions on the right, wraps on small screens. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink text-balance">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-line bg-surface text-ink shadow-card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          <h2 className="font-semibold leading-none tracking-tight text-ink">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'teal' | 'amber' | 'rose';
const tones: Record<Tone, string> = {
  neutral: 'border-line bg-paper text-ink-soft',
  teal: 'border-leaf-600/20 bg-leaf-50 text-leaf-700',
  amber: 'border-amber-600/25 bg-amber-50 text-amber-700',
  rose: 'border-rose-600/20 bg-rose-50 text-rose-700',
};
/** ERP status pill: rounded-md, xs semibold, tinted by tone. */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span data-badge data-tone={tone} className={cx('inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-3.5 w-3.5' : 'h-5 w-5')} aria-label="Loading" />;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-mute">
      <Spinner /> {label}…
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-ink-mute">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-rose-600/30 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p>{e.message ?? String(error)}</p>
        {e.errors?.length > 1 && (
          <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-xs">
            {e.errors.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="text-sm font-medium text-ink-mute">{label}</div>
      <div className={cx('mt-2 font-mono text-2xl font-semibold tabular-nums text-ink', tone === 'rose' && 'text-rose-700', tone === 'amber' && 'text-amber-700')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-mute">{sub}</div>}
    </div>
  );
}

// One icon per tab id, shared by every tab bar (Admin, Reports, Stock, GST). A tab can pass its own icon.
const TAB_ICONS: Record<string, LucideIcon> = {
  users: UsersIcon,
  kits: PackageIcon,
  suppliers: Truck,
  catalogue: Tags,
  charges: ReceiptText,
  counters: Monitor,
  settings: Settings,
  golive: Rocket,
  sessions: Activity,
  audit: ScrollText,
  daily: CalendarDays,
  monthly: CalendarRange,
  register: ClipboardList,
  purchases: ShoppingBasket,
  yearly: CalendarClock,
  dead: PackageX,
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
  summary: Boxes,
  low: AlertTriangle,
  expiry: TimerOff,
  adjust: SlidersHorizontal,
  ledger: BookOpen,
};

/**
 * Tab bar: one contained toolbar on a single line, an icon per tab, the selected tab filled with the
 * main colour. When the tabs are wider than the page it scrolls sideways (wheel, trackpad or the ‹ ›
 * buttons that appear), with a fade at the hidden edge, and keeps the selected tab in view.
 */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; icon?: ReactNode }[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // a vertical mouse wheel scrolls the bar sideways
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, [measure, tabs.length]);
  useEffect(() => {
    // Centre the selected tab inside the bar (never scrolls the page itself); the last tab ends flush right.
    const id = requestAnimationFrame(() => {
      const el = scroller.current;
      const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el || !tab) return;
      const max = el.scrollWidth - el.clientWidth;
      el.scrollTo({ left: Math.max(0, Math.min(max, tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2)), behavior: 'instant' as ScrollBehavior });
      measure();
    });
    return () => cancelAnimationFrame(id);
  }, [value, measure, tabs.length]);
  const nudge = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  const arrow = (dir: -1 | 1) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => nudge(dir)}
      aria-label={dir < 0 ? 'Scroll tabs left' : 'Scroll tabs right'}
      className={cx('absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-page text-ink shadow-lift transition-colors hover:bg-main hover:text-main-fg', dir < 0 ? 'left-1' : 'right-1')}
    >
      {dir < 0 ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
  return (
    <div className="relative mb-5 max-w-full">
      <div className="relative inline-flex max-w-full rounded-xl border border-line bg-surface shadow-card">
        <div
          ref={scroller}
          role="tablist"
          onScroll={measure}
          className="flex max-w-full gap-1 overflow-x-auto scroll-smooth p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage: `linear-gradient(to right, ${edge.left ? 'transparent 0, #000 56px' : '#000 0'}, ${edge.right ? '#000 calc(100% - 56px), transparent 100%' : '#000 100%'})`,
          }}
        >
          {tabs.map((t) => {
            const on = value === t.value;
            const Icon = TAB_ICONS[t.value];
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={on}
                onClick={() => onChange(t.value)}
                className={cx(
                  'group inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  on ? 'bg-main text-main-fg shadow-sm' : 'text-ink-soft hover:bg-paper hover:text-ink hover:shadow-sm',
                )}
              >
                {t.icon ?? (Icon && <Icon className={cx('h-4 w-4 shrink-0 transition-colors', on ? 'text-main-fg' : 'text-brand-600/80 group-hover:text-brand-600')} aria-hidden />)}
                {t.label}
              </button>
            );
          })}
        </div>
        {edge.left && arrow(-1)}
        {edge.right && arrow(1)}
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 text-sm">
      <span className="text-ink-mute">
        Page {page} of {pages} · {total} records
      </span>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

// ---------- Modal (ERP dialog / sheet) ----------
export function Modal({ open, onClose, title, children, footer, wide, side }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button:not([data-close])');
      el?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className={cx('fixed inset-0 z-50 flex animate-fade-in bg-black/60 backdrop-blur-[2px]', side ? 'justify-end' : 'items-start justify-center overflow-y-auto p-4 pt-[8vh]')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative flex flex-col border border-line bg-page text-ink shadow-pop',
          side ? 'h-full w-full max-w-2xl animate-fade-in border-y-0 border-r-0' : cx('w-full animate-pop-in rounded-xl', wide ? 'max-w-4xl' : 'max-w-lg'),
        )}
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
          <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
          <button data-close onClick={onClose} className="-mr-2 -mt-1 rounded-md p-1.5 text-ink-mute opacity-80 transition hover:bg-ink/[0.06] hover:text-ink hover:opacity-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={cx('min-h-0 px-6 py-4', side && 'flex-1 overflow-y-auto')}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-6 pb-6 pt-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation step built into the page. Optionally asks for a reason (cancel, adjust). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  needReason,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  needReason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setErr(null);
    }
  }, [open]);
  const go = async () => {
    if (needReason && reason.trim().length < 3) {
      setErr(new Error('Give a reason of at least 3 characters'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={go}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-soft">
        <div>{message}</div>
        {needReason && (
          <Field label="Reason">
            {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why is this being done?" />}
          </Field>
        )}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

// ---------- Toasts ----------
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}
const toastIcon: Record<Tone, ReactNode> = {
  teal: <CheckCircle2 className="h-4 w-4 text-leaf-600" />,
  amber: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  rose: <XCircle className="h-4 w-4 text-rose-600" />,
  neutral: <Info className="h-4 w-4 text-brand-600" />,
};
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'teal') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'rose' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-xl border border-line bg-page px-4 py-3 text-sm text-ink shadow-lift">
            <span className="mt-0.5 shrink-0">{toastIcon[t.tone]}</span>
            <span className="min-w-0">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Interactive building blocks (Billing, Purchases, Products) ----------
// Initials on a coloured tile, coloured from the name so the same item/supplier always looks the same.
const AVATAR_TONES = ['bg-chart-1/15 text-chart-1', 'bg-chart-2/15 text-chart-2', 'bg-chart-3/15 text-chart-3', 'bg-chart-4/20 text-amber-700', 'bg-chart-5/20 text-chart-5'];
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-lg font-bold', size === 'sm' ? 'size-7 text-[10px]' : 'size-9 text-xs', AVATAR_TONES[h % AVATAR_TONES.length])} aria-hidden>
      {initials || '?'}
    </span>
  );
}

type StatTone = 'brand' | 'teal' | 'amber' | 'rose' | 'neutral';
const statTones: Record<StatTone, string> = {
  brand: 'bg-brand-500/10 text-brand-600',
  teal: 'bg-leaf-50 text-leaf-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  neutral: 'bg-ink/[0.05] text-ink-soft',
};
/** KPI tile with an icon. With onClick it becomes a filter button (active = highlighted). */
export function StatTile({ icon, label, value, sub, tone = 'brand', onClick, active }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: StatTone; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5', statTones[tone])}>{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium text-ink-mute">{label}</span>
        <span className="block truncate font-mono text-xl font-semibold tabular-nums text-ink">{value}</span>
        {sub && <span className="block truncate text-[11px] text-ink-mute">{sub}</span>}
      </span>
    </>
  );
  const cls = cx('flex min-w-0 items-center gap-3 rounded-xl border bg-surface p-4 shadow-card transition-all', active ? 'border-brand-500/60 ring-2 ring-brand-500/15' : 'border-line');
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cx(cls, 'hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-lift active:scale-[0.99]')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Pill-style segmented filter (one choice). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors', value === o.value ? 'bg-main text-main-fg shadow-sm' : 'text-ink-mute hover:bg-ink/[0.05] hover:text-ink')}
        >
          {o.label}
          {o.count !== undefined && <span className={cx('rounded-full px-1.5 text-[11px] font-semibold', value === o.value ? 'bg-white/20' : 'bg-ink/[0.06]')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Search box with a magnifier and a clear button. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }>(({ className, onClear, value, ...rest }, ref) => (
  <div className={cx('relative', className)}>
    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden />
    <Input ref={ref} value={value} className="pl-9 pr-8" {...rest} />
    {onClear && String(value ?? '') !== '' && (
      <button type="button" onClick={onClear} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-mute hover:bg-ink/[0.06] hover:text-ink" aria-label="Clear search">
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
));
SearchInput.displayName = 'SearchInput';

// ---------- Table with a Table / Cards switch ----------
/*
 * Every list in the app uses this one component. In "cards" view the same <table> markup is laid out
 * as a grid of cards by CSS (index.css, table[data-view='cards']): each row becomes a card, its first
 * cell the card title, and every other cell shows its column name (copied from the header into
 * data-label). So pages keep a single markup and get both views. Editable grids pass cards={false}.
 * The chosen view is remembered and shared by every table on screen.
 */
export type TableView = 'table' | 'cards';
const VIEW_KEY = 'storepos-table-view';
const viewListeners = new Set<(v: TableView) => void>();
function readView(): TableView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'table' || v === 'cards') return v;
  } catch {
    /* storage blocked */
  }
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'cards' : 'table';
}
function useTableView() {
  const [view, setLocal] = useState<TableView>(readView);
  useEffect(() => {
    viewListeners.add(setLocal);
    return () => {
      viewListeners.delete(setLocal);
    };
  }, []);
  const set = useCallback((v: TableView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
    viewListeners.forEach((l) => l(v));
  }, []);
  return [view, set] as const;
}

/** Copy each header's text onto the cells of its column (data-label), honouring colSpan. */
function labelCells(table: HTMLTableElement) {
  const heads: string[] = [];
  table.tHead?.rows[table.tHead.rows.length - 1]?.querySelectorAll('th').forEach((h) => {
    const span = Number(h.getAttribute('colspan') ?? 1);
    for (let i = 0; i < span; i++) heads.push((h.textContent ?? '').trim());
  });
  const rows = [...Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)), ...(table.tFoot ? Array.from(table.tFoot.rows) : [])];
  let count = 0;
  for (const r of rows) {
    let col = 0;
    const cells = Array.from(r.cells);
    if (!(cells.length === 1 && cells[0].colSpan > 1) && r.parentElement?.tagName === 'TBODY') count++;
    for (const c of cells) {
      const label = heads[col] ?? '';
      if (c.getAttribute('data-label') !== label) c.setAttribute('data-label', label);
      col += c.colSpan || 1;
    }
  }
  return count;
}

export function Table({ children, className, cards = true }: { children: ReactNode; className?: string; cards?: boolean }) {
  const [pref, setView] = useTableView();
  const view: TableView = cards ? pref : 'table';
  const ref = useRef<HTMLTableElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const t = ref.current;
    if (!t || !cards) return;
    const run = () => setCount(labelCells(t));
    run();
    const mo = new MutationObserver(run);
    mo.observe(t, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [cards]);
  const btn = (v: TableView, icon: ReactNode, label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      title={`${label} view`}
      onClick={() => setView(v)}
      className={cx('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors', view === v ? 'bg-main text-main-fg shadow-sm' : 'text-ink-mute hover:bg-ink/[0.06] hover:text-ink')}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="w-full min-w-0">
      {cards && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <span className="text-xs text-ink-mute">
            {count} {count === 1 ? 'record' : 'records'}
          </span>
          <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group" aria-label="View">
            {btn('table', <Rows3 className="h-3.5 w-3.5" aria-hidden />, 'Table')}
            {btn('cards', <LayoutGrid className="h-3.5 w-3.5" aria-hidden />, 'Cards')}
          </div>
        </div>
      )}
      <div className={cx('relative w-full max-w-full', view === 'table' ? 'overflow-x-auto' : 'overflow-y-auto', className)}>
        <table ref={ref} data-view={view} className="data-table w-full caption-bottom border-collapse text-sm tabular-nums">
          {children}
        </table>
      </div>
    </div>
  );
}
export const th = 'h-10 border-b border-line bg-paper px-3 text-left align-middle text-xs font-medium text-ink-mute whitespace-nowrap';
export const td = 'border-b border-line px-3 py-2.5 align-middle whitespace-nowrap';
export const num = 'text-right font-mono whitespace-nowrap';
/** For a cell that holds free text (notes, reasons, flags): wraps inside a readable width. */
export const wrap = '!whitespace-normal min-w-[14rem] max-w-[26rem]';

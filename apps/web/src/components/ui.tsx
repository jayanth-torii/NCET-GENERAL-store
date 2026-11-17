import { ButtonHTMLAttributes, createContext, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../lib/api';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warn';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 border-transparent font-semibold shadow-[0_8px_20px_-8px_rgba(246,135,42,0.65)]',
  secondary: 'bg-white/[0.06] text-ink hover:bg-white/10 border-transparent',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 border-transparent',
  warn: 'bg-amber-600 text-white hover:bg-amber-700 border-transparent',
  ghost: 'bg-transparent text-ink-soft hover:bg-white/5 border-transparent',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }>(
  ({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
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
  return <kbd className="rounded border border-b-2 border-current/30 px-1 font-mono text-[11px] leading-4 opacity-80">{children}</kbd>;
}

// ---------- Form controls ----------
const control = 'w-full rounded-xl border border-line bg-paper text-sm text-ink placeholder:text-ink-mute/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-white/[0.03] disabled:text-ink-mute';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...rest }, ref) => (
  <input ref={ref} className={cx(control, 'h-10 px-3', invalid && 'border-rose-600 ring-2 ring-rose-600/20', className)} {...rest} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }>(({ className, children, compact, ...rest }, ref) => (
  <select ref={ref} className={cx(control, 'h-10', compact ? 'pl-2 pr-6' : 'pl-3 pr-8', className)} {...rest}>
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
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-ink-mute">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-rose-600">{error}</p> : hint ? <p className="text-xs text-ink-mute">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ---------- Layout bits ----------
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-white text-balance">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-2xl bg-gradient-to-b from-[#12224A] to-[#0C1838] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.75)]', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'teal' | 'amber' | 'rose';
const tones: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-ink-soft border-transparent',
  teal: 'bg-leaf-50 text-leaf-700 border-transparent',
  amber: 'bg-amber-50 text-amber-700 border-transparent',
  rose: 'bg-rose-50 text-rose-700 border-transparent',
};
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
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
    <div role="alert" className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
      <p>{e.message ?? String(error)}</p>
      {e.errors?.length > 1 && (
        <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-xs">
          {e.errors.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-[#12224A] to-[#0C1838] p-5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.75)]">
      <div className="text-sm text-ink-mute">{label}</div>
      <div className={cx('mt-2 font-mono text-2xl font-semibold tabular-nums text-white', tone === 'rose' && 'text-rose-700', tone === 'amber' && 'text-amber-700')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-mute">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-paper p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50', value === t.value ? 'bg-brand-500/15 text-brand-500' : 'text-ink-mute hover:text-white')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 text-sm">
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

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, wide, side }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button');
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
  return (
    <div className={cx('fixed inset-0 z-40 flex bg-black/60 backdrop-blur-[2px]', side ? 'justify-end' : 'items-start justify-center overflow-y-auto p-4 pt-[8vh]')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cx('flex flex-col bg-surface shadow-2xl', side ? 'h-full w-full max-w-2xl' : cx('w-full rounded-2xl', wide ? 'max-w-4xl' : 'max-w-lg'))}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-mute hover:bg-white/10 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <div className={cx('min-h-0 px-5 py-4', side && 'flex-1 overflow-y-auto')}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-2">{footer}</div>}
      </div>
    </div>
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
      <div className="space-y-3 text-sm">
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
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-2xl ring-1 ring-white/10', tones[t.tone])}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Table ----------
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  );
}
export const th = 'bg-paper px-3 py-2.5 text-left text-xs font-medium text-ink-mute whitespace-nowrap';
export const td = 'border-b border-white/[0.05] px-3 py-2.5 align-top';
export const num = 'text-right font-mono whitespace-nowrap';

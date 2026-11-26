/** Display helpers. Dates are always DD-MM-YYYY in IST (NFR-03). */
const IST = 'Asia/Kolkata';

export function money(v: unknown): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function rupees(v: unknown): string {
  return `₹${money(v)}`;
}

export function qty(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function parts(d: Date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return p as Record<string, string>;
}

/** DD-MM-YYYY from a Date, ISO string or YYYY-MM-DD. */
export function date(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}-${m}-${y}`;
  }
  const p = parts(new Date(v));
  return `${p.day}-${p.month}-${p.year}`;
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  const p = parts(new Date(v));
  return `${p.day}-${p.month}-${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

export function time(v: string | Date): string {
  const p = parts(new Date(v));
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Today's date in IST as YYYY-MM-DD (for date inputs). */
export function todayIso(serverDate?: string): string {
  if (serverDate) return serverDate;
  const p = parts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

export function monthStartIso(today = todayIso()): string {
  return `${today.slice(0, 8)}01`;
}

/** Round to 2 dp in paise to avoid float drift in on-screen totals. The server recomputes everything. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', MANAGER: 'Manager', STORE_KEEPER: 'Store keeper', CASHIER: 'Cashier' };

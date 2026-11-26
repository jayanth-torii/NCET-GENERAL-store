/**
 * Date helpers. The store runs on India Standard Time (UTC+05:30, no daylight saving).
 * The server clock is the only source of business dates (NFR-03). Display format is DD-MM-YYYY.
 */
export const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD of the given instant in IST. */
export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of an IST calendar day as a UTC instant. */
export function istDayStart(date: string): Date {
  assertDate(date);
  return new Date(`${date}T00:00:00+05:30`);
}

/** [start, end) of an IST day. */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = istDayStart(date);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** [start, end) of an inclusive IST date range from..to. */
export function istRange(from: string, to: string): { start: Date; end: Date } {
  assertDate(from);
  assertDate(to);
  if (from > to) throw new RangeError('The start date is after the end date');
  return { start: istDayStart(from), end: istDayRange(to).end };
}

/** [start, end) of a month given as YYYY-MM. */
export function istMonthRange(month: string): { start: Date; end: Date; from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Month must look like 2026-10');
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: istDayStart(from), end: istDayStart(next), from, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Financial year code (April to March) for an instant, e.g. "26-27". */
export function fyCode(d: Date = new Date()): string {
  const [y, m] = istDate(d).split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Range of a financial year given as "2026-27". */
export function fyRange(fy: string): { start: Date; end: Date; from: string; to: string; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new RangeError('Financial year must look like 2026-27');
  const startYear = Number(m[1]);
  if ((startYear + 1) % 100 !== Number(m[2])) throw new RangeError('Financial year must be two consecutive years, like 2026-27');
  const from = `${startYear}-04-01`;
  const to = `${startYear + 1}-03-31`;
  return { start: istDayStart(from), end: istDayStart(`${startYear + 1}-04-01`), from, to, label: `FY ${fy}` };
}

/** DD-MM-YYYY for a YYYY-MM-DD string or a Date (shown in IST). */
export function fmtDate(d: Date | string): string {
  const s = typeof d === 'string' ? d.slice(0, 10) : istDate(d);
  const [y, mo, da] = s.split('-');
  return `${da}-${mo}-${y}`;
}

/** DD-MM-YYYY HH:mm in IST. */
export function fmtDateTime(d: Date): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS).toISOString();
  return `${fmtDate(d)} ${shifted.slice(11, 16)}`;
}

export function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RangeError(`"${date}" is not a valid date (use YYYY-MM-DD)`);
  }
}

export function isSameIstDay(a: Date, b: Date = new Date()): boolean {
  return istDate(a) === istDate(b);
}

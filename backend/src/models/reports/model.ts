/** One shape for every report: the screen, the PDF and the Excel file are all rendered from it. */
export type ColType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'datetime' | 'pct';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColType;
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  note?: string;
}

export interface Report {
  title: string;
  subtitle?: string;
  fileName: string; // without extension
  generatedAt: string; // DD-MM-YYYY HH:mm
  generatedBy?: string;
  summary?: { label: string; value: string | number; type?: ColType }[];
  sections: ReportSection[];
  landscape?: boolean;
}

export function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function fmtMoney(v: unknown): string {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(v: unknown): string {
  const n = num(v);
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function formatCell(v: unknown, type: ColType = 'text'): string {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'money':
      return fmtMoney(v);
    case 'qty':
      return fmtQty(v);
    case 'int':
      return num(v).toLocaleString('en-IN');
    case 'pct':
      return `${num(v).toFixed(2)}%`;
    default:
      return String(v);
  }
}

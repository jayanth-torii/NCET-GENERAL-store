import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { download, get } from '../../services/http.common';
import { money, qty } from '../../services/format';
import type { ColType, Report } from '../../data/types';
import { Badge, Button, Card, cx, Empty, ErrorBox, Loading, num, Table, td, th, wrap } from '../ui';

const RIGHT = new Set<ColType>(['money', 'qty', 'int', 'pct']);

function cell(v: unknown, type?: ColType) {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'money':
      return money(v);
    case 'qty':
      return qty(v);
    case 'int':
      return Number(v).toLocaleString('en-IN');
    case 'pct':
      return `${Number(v).toFixed(2)}%`;
    default:
      return String(v);
  }
}

// Status words from the API shown as ERP status pills instead of shouting capitals.
const STATUS_TONE: Record<string, 'teal' | 'amber' | 'rose' | 'neutral'> = {
  COMPLETED: 'teal',
  POSTED: 'teal',
  OK: 'teal',
  ACTIVE: 'teal',
  APPROVED: 'teal',
  CANCELLED: 'rose',
  NEGATIVE: 'rose',
  EXPIRED: 'rose',
  REJECTED: 'rose',
  LOW: 'amber',
  REORDER: 'amber',
  READY: 'amber',
  PENDING: 'amber',
  RETURNED: 'amber',
  EDITED: 'amber',
  DRAFT: 'neutral',
  HELD: 'neutral',
};
function statusPill(v: unknown) {
  const s = String(v ?? '');
  const tone = STATUS_TONE[s.toUpperCase()];
  if (!tone) return null;
  return <Badge tone={tone}>{s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ')}</Badge>;
}

/** Renders any report from the API on screen, with one-click PDF and Excel downloads of the same data. */
export function ReportView({ path, formats = ['pdf', 'xlsx'], onRowClick }: { path: string; formats?: ('pdf' | 'xlsx')[]; onRowClick?: (row: Record<string, unknown>) => void }) {
  const sep = path.includes('?') ? '&' : '?';
  const q = useQuery({ queryKey: ['report', path], queryFn: () => get<Report>(`${path}${sep}format=json`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const dl = async (f: 'pdf' | 'xlsx') => {
    setBusy(f);
    setErr(null);
    try {
      await download(`${path}${sep}format=${f}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Loading label="Building report" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{r.title}</h2>
          <p className="text-sm text-ink-mute">
            {r.subtitle} · generated {r.generatedAt}
          </p>
        </div>
        <div className="flex gap-2">
          {formats.includes('pdf') && (
            <Button variant="pdf" busy={busy === 'pdf'} onClick={() => void dl('pdf')}>
              {busy !== 'pdf' && <FileText aria-hidden />}
              Download PDF
            </Button>
          )}
          {formats.includes('xlsx') && (
            <Button variant="excel" busy={busy === 'xlsx'} onClick={() => void dl('xlsx')}>
              {busy !== 'xlsx' && <FileSpreadsheet aria-hidden />}
              Download Excel
            </Button>
          )}
          <Button variant="soft" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw aria-hidden className={cx(q.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>
      <ErrorBox error={err} />
      {r.summary && r.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {r.summary.map((s) => (
            <div key={s.label} className="min-w-0 rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
              <div className="truncate text-xs text-ink-mute" title={s.label}>{s.label}</div>
              <div className="mt-1 truncate font-mono text-xl font-semibold tabular-nums">{s.type === 'money' ? `₹${money(s.value)}` : cell(s.value, s.type)}</div>
            </div>
          ))}
        </div>
      )}
      {r.sections.map((sec, si) => {
        // Free-text columns (flags, reasons, notes) wrap inside a readable width; everything else stays on one line.
        // Card view: the item / kit / cashier name (key "name") titles each card; otherwise the first column does.
        const titleKey = sec.columns.some((c) => c.key === 'name') ? 'name' : null;
        const longCols = new Set(sec.columns.filter((c) => (!c.type || c.type === 'text') && sec.rows.some((row) => String(row[c.key] ?? '').length > 32)).map((c) => c.key));
        return (
        <Card key={si} title={sec.title}>
          {sec.rows.length === 0 ? (
            <Empty>No records for this period.</Empty>
          ) : (
            <Table className="max-h-[70vh]">
              <thead className="sticky top-0">
                <tr>
                  {sec.columns.map((c) => (
                    <th key={c.key} className={cx(th, c.type && RIGHT.has(c.type) && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row, ri) => (
                  <tr key={ri} className={cx(onRowClick && 'cursor-pointer hover:bg-paper', row.flag === 'NEGATIVE' || row.status === 'NEGATIVE' ? 'bg-rose-50/60' : row.flag === 'REORDER' || row.status === 'LOW' ? 'bg-amber-50/60' : '')} onClick={() => onRowClick?.(row)}>
                    {sec.columns.map((c, ci) => (
                      <td
                        key={c.key}
                        data-title={titleKey && c.key === titleKey && ci > 0 ? '' : undefined}
                        className={cx(td, c.type && RIGHT.has(c.type) && num, longCols.has(c.key) && wrap, ci === 0 && 'font-medium')}
                      >
                        {c.key === 'status' || c.key === 'flag' ? (statusPill(row[c.key]) ?? cell(row[c.key], c.type)) : cell(row[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {sec.totals && (
                <tfoot>
                  <tr className="bg-brand-50 font-semibold">
                    {sec.columns.map((c) => (
                      <td key={c.key} className={cx(td, c.type && RIGHT.has(c.type) && num)}>
                        {cell(sec.totals![c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </Table>
          )}
          {sec.note && <p className="border-t border-line px-4 py-2 text-xs text-ink-mute">{sec.note}</p>}
        </Card>
        );
      })}
    </div>
  );
}

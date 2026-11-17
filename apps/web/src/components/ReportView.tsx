import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { download, get } from '../lib/api';
import { money, qty } from '../lib/format';
import type { ColType, Report } from '../lib/types';
import { Button, Card, cx, Empty, ErrorBox, Loading, num, Table, td, th } from './ui';

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
            <Button busy={busy === 'pdf'} onClick={() => void dl('pdf')}>
              Download PDF
            </Button>
          )}
          {formats.includes('xlsx') && (
            <Button busy={busy === 'xlsx'} onClick={() => void dl('xlsx')}>
              Download Excel
            </Button>
          )}
          <Button variant="ghost" onClick={() => void q.refetch()}>
            Refresh
          </Button>
        </div>
      </div>
      <ErrorBox error={err} />
      {r.summary && r.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {r.summary.map((s) => (
            <div key={s.label} className="rounded-2xl bg-gradient-to-b from-[#12224A] to-[#0C1838] px-5 py-4 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.75)]">
              <div className="text-xs text-ink-mute">{s.label}</div>
              <div className="font-mono text-lg tabular-nums">{s.type === 'money' ? `₹${money(s.value)}` : cell(s.value, s.type)}</div>
            </div>
          ))}
        </div>
      )}
      {r.sections.map((sec, si) => (
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
                    {sec.columns.map((c) => (
                      <td key={c.key} className={cx(td, c.type && RIGHT.has(c.type) && num)}>
                        {cell(row[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {sec.totals && (
                <tfoot>
                  <tr className="bg-navy-50/60 font-semibold">
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
      ))}
    </div>
  );
}

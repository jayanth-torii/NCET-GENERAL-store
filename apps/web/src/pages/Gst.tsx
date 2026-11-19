import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../lib/api';
import { monthStartIso, todayIso } from '../lib/format';
import { ReportView } from '../components/ReportView';
import { Field, Input, PageHeader, Tabs } from '../components/ui';

type Tab = 'input' | 'output';

/** GST registers: input (tax paid on GRNs) and output (tax collected on bills), each net of returns. */
export function Gst() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'output' ? 'output' : 'input';
  const today = todayIso();
  const [from, setFrom] = useState(monthStartIso(today));
  const [to, setTo] = useState(today);
  return (
    <div>
      <PageHeader title="GST" subtitle="Input register (purchases) and output register (sales), with CGST / SGST / IGST and a rate-wise summary. Download as PDF or Excel for filing." />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { value: 'input', label: 'Input register' },
          { value: 'output', label: 'Output register' },
        ]}
      />
      <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value || to)} />}</Field>
      </div>
      <ReportView path={`/reports/gst/${tab}${qs({ from, to })}`} />
    </div>
  );
}

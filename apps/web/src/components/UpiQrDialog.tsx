import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/format';
import type { Settings } from '../lib/types';
import { Button, ErrorBox, Field, Input, Modal } from './ui';

/**
 * Collect a UPI payment at the counter. A QR with the exact amount and the bill note is shown to the
 * customer, who scans it with any UPI app. The cashier then types the transaction ID from the
 * customer's app; the server records it and refuses the same ID on a second bill.
 * No card or bank details ever touch this system: the money goes straight from the customer's bank
 * to the store's UPI account.
 */
export function UpiQrDialog({ open, amount, note, settings, requireRef, onClose, onPaid }: { open: boolean; amount: number; note: string; settings: Settings | undefined; requireRef: boolean; onClose: () => void; onPaid: (reference: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const upiId = settings?.upiId ?? '';
  const payee = settings?.upiPayeeName ?? settings?.storeName ?? '';
  const link = upiId ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}` : '';

  useEffect(() => {
    if (!open) return;
    setRef('');
    setErr(null);
    if (!link || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, link, { width: 288, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0E2455', light: '#FFFFFF' } }).catch((e: Error) => setErr(e));
  }, [open, link]);

  const confirm = () => {
    const r = ref.trim();
    if (requireRef && !r) return setErr(new Error("Type the transaction ID from the customer's UPI app (shown under the payment as UTR or transaction ID)"));
    if (r && !/^[A-Za-z0-9-]{6,32}$/.test(r)) return setErr(new Error('Transaction ID must be 6 to 32 letters or digits'));
    onPaid(r);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Collect ₹${money(amount)} by UPI`}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" onClick={confirm} disabled={!upiId}>
            Payment received
          </Button>
        </>
      }
    >
      {!upiId ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">The store's UPI ID is not set. An admin can add it under Settings &amp; users → Store settings.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <canvas ref={canvasRef} className="rounded-lg border border-line" aria-label="UPI payment QR code" />
            <div className="text-center">
              <div className="font-mono text-3xl font-semibold tabular-nums text-navy-700">₹{money(amount)}</div>
              <div className="text-xs text-ink-mute">
                to {payee} · <span className="font-mono">{upiId}</span>
              </div>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
              <li>Customer scans with any UPI app (GPay, PhonePe, Paytm, BHIM).</li>
              <li>The amount is already filled in; they confirm with their PIN.</li>
              <li>Check the success screen on their phone, then type the transaction ID below.</li>
            </ol>
            <Field label={`Transaction ID${requireRef ? '' : ' (optional)'}`} hint="12-digit UTR or the transaction ID shown in the app">
              {(id) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} className="font-mono" maxLength={32} autoFocus data-autofocus onKeyDown={(e) => e.key === 'Enter' && confirm()} />}
            </Field>
            <ErrorBox error={err} />
          </div>
        </div>
      )}
    </Modal>
  );
}

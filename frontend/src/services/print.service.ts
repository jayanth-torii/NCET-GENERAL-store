/**
 * Print a receipt with no preview (UR-1). The receipt page is loaded into a hidden iframe and printed.
 * Counter PCs run Chrome with --kiosk-printing, which sends it straight to the default printer with
 * no dialog. Without that flag the browser shows its normal print dialog.
 * The server counts prints: the first is the original, later ones are stamped DUPLICATE and logged.
 */
export function printReceipt(saleId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const old = document.getElementById('receipt-frame');
    old?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'receipt-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.src = `/api/v1/sales/${saleId}/receipt?format=html`;
    const timer = setTimeout(() => reject(new Error('The receipt took too long to load')), 15_000);
    frame.onload = () => {
      clearTimeout(timer);
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Printing failed'));
      }
    };
    document.body.appendChild(frame);
  });
}

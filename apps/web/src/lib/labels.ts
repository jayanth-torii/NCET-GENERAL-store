import JsBarcode from 'jsbarcode';

/**
 * FR-16: barcode labels from purchase lines.
 * Prints on an A4 sheet of 24 labels (3 x 8, 63.5 x 33.9 mm, the common L7159 sticker sheet).
 * Each label carries the item name, sale price, MRP and a Code 128 barcode of the item's barcode,
 * or of its item code when it has none, so the counter scanner finds it either way.
 */
export interface LabelItem {
  name: string;
  code: string;
  barcode: string | null;
  price: number;
  mrp: number | null;
  copies: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function barcodeSvg(value: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, { format: 'CODE128', width: 1.4, height: 34, fontSize: 11, margin: 0, displayValue: true });
  return svg.outerHTML;
}

export const MAX_LABELS = 1000;

export function labelsHtml(items: LabelItem[], storeName: string): string {
  const cells: string[] = [];
  for (const it of items) {
    const value = (it.barcode || it.code).trim();
    const svg = barcodeSvg(value);
    const price = `₹${it.price.toFixed(2)}`;
    const mrp = it.mrp && it.mrp > it.price ? `<span class="mrp">MRP ₹${it.mrp.toFixed(2)}</span>` : '';
    const cell = `<div class="label"><div class="store">${esc(storeName)}</div><div class="name">${esc(it.name)}</div><div class="price">${price} ${mrp}</div><div class="bc">${svg}</div></div>`;
    for (let i = 0; i < it.copies; i++) cells.push(cell);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title><style>
@page { size: A4; margin: 13mm 7mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, sans-serif; color: #000; }
.sheet { display: grid; grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 33.9mm; column-gap: 2.5mm; }
.label { overflow: hidden; padding: 1.5mm 2.5mm; display: flex; flex-direction: column; align-items: center; text-align: center; break-inside: avoid; }
.store { font-size: 6.5pt; text-transform: uppercase; letter-spacing: .5px; }
.name { font-size: 8.5pt; font-weight: bold; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
.price { font-size: 9pt; font-weight: bold; margin: .4mm 0; }
.mrp { font-weight: normal; font-size: 7pt; text-decoration: line-through; }
.bc svg { max-width: 58mm; height: 14mm; }
</style></head><body><div class="sheet">${cells.join('')}</div></body></html>`;
}

/** Print the labels through a hidden frame (the browser's print dialog lets the user pick the printer). */
export function printLabels(items: LabelItem[], storeName: string): Promise<void> {
  const total = items.reduce((a, b) => a + b.copies, 0);
  if (total === 0) return Promise.reject(new Error('Choose at least one label to print.'));
  if (total > MAX_LABELS) return Promise.reject(new Error(`That is ${total} labels. Print at most ${MAX_LABELS} at a time.`));
  return new Promise((resolve, reject) => {
    document.getElementById('labels-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'labels-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Printing failed'));
      }
    };
    frame.srcdoc = labelsHtml(items, storeName);
    document.body.appendChild(frame);
  });
}

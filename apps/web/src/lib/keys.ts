/**
 * Billing shortcuts work two ways, so a laptop whose top row sends volume/brightness still works:
 *   F2 … F10           the usual keys
 *   Alt+2 … Alt+9, Alt+0   the same action (Alt+0 = F10), using the number row
 * Returns 'F2'…'F10' for either form, or null for any other key.
 */
export function billingKey(e: KeyboardEvent): string | null {
  const f = /^F\d{1,2}$/.test(e.key) ? e.key : /^F\d{1,2}$/.test(e.code) ? e.code : null;
  if (f && /^F([2-9]|10)$/.test(f) && !e.altKey && !e.ctrlKey) return f;
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const d = /^Digit(\d)$/.exec(e.code)?.[1] ?? /^Numpad(\d)$/.exec(e.code)?.[1];
    if (d && d !== '1') return d === '0' ? 'F10' : `F${d}`;
  }
  return null;
}

/** "F9 · Alt 9" style label for buttons and the help panel. */
export const altOf = (f: string) => `Alt ${f === 'F10' ? '0' : f.slice(1)}`;

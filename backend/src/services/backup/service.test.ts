import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, filesToPrune, retype } from './service';

describe('backups', () => {
  it('encrypts and decrypts back to the same bytes, and refuses a wrong key', () => {
    const data = Buffer.from('{"hello":"store"}');
    const enc = encrypt(data, 'correct horse');
    expect(enc.includes(data)).toBe(false);
    expect(decrypt(enc, 'correct horse').equals(data)).toBe(true);
    expect(() => decrypt(enc, 'wrong key')).toThrow();
  });

  it('keeps the newest backup of each of the last 30 days and 12 months', () => {
    const names: string[] = [];
    for (let m = 1; m <= 14; m++) for (let d = 1; d <= 28; d += 3) names.push(`ncet_store-2026-${String(m % 12 || 12).padStart(2, '0')}-${String(d).padStart(2, '0')}-0130.json.gz`.replace('2026-01', m > 12 ? '2027-01' : '2026-01').replace('2026-02', m > 12 ? '2027-02' : '2026-02'));
    names.push('ncet_store-2027-02-28-2300.json.gz', 'notes.txt');
    const pruned = new Set(filesToPrune(names));
    const kept = names.filter((n) => n.endsWith('.json.gz') && !pruned.has(n));
    // 30 daily (one per day, newest first) + monthly keepers outside that window, at most 12 months
    expect(pruned.has('notes.txt')).toBe(false);
    expect(kept).toContain('ncet_store-2027-02-28-2300.json.gz');
    expect(kept).not.toContain('ncet_store-2027-02-28-0130.json.gz'); // older backup of the same day
    const months = new Set(kept.map((n) => n.slice(11, 18)));
    expect(months.size).toBeLessThanOrEqual(12);
    expect(kept.length).toBeLessThanOrEqual(30 + 12);
    expect(kept.length).toBeGreaterThanOrEqual(30);
  });

  it('puts 64-bit and float types back on numbers', () => {
    const out = retype({ _id: 7, qty: 100, n: { $numberInt: '3' }, note: null, when: { $date: '2026-11-26T00:00:00Z' } }, { _id: 'BigInt', qty: 'Double', n: 'Int32' });
    expect(out).toEqual({ _id: { $numberLong: '7' }, qty: { $numberDouble: '100' }, n: { $numberInt: '3' }, note: null, when: { $date: '2026-11-26T00:00:00Z' } });
  });
});

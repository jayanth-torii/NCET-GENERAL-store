// API contract snapshot: calls every GET route and saves the responses, so two versions of the API can be
// compared (for example before and after a data-layer change).
//   node scripts/api-snapshot.mjs save <out.json>        (needs ADMIN_PASSWORD; API on BASE_URL or :3000)
//   node scripts/api-snapshot.mjs compare <a.json> <b.json>
// JSON bodies are compared exactly, except keys that change by themselves (time stamps of "now", session
// activity). PDF / Excel responses are compared by status and content type only (they embed the time).
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from './lib.mjs';

// Routes the snapshot itself changes (its login adds a session + audit row; the clock moves): compared by
// shape only — same keys and value types in the first row — not by value.
const SHAPE_ONLY = new Set(['/audit', '/auth/sessions', '/auth/me', '/auth/time', '/products/quick-keys']); // quick-keys: ties at the cut-off pick arbitrary items
const VOLATILE = new Set(['generatedAt', 'lastSeenAt', 'serverTime', 'now', 'today', 'expiresAt', 'serverDate', 'time', 'serverNow', 'at', 'printCount']);
// Lists whose order between equal items is not defined (best sellers with the same count): compared as sets.
const ORDER_FREE = new Set(['/products/quick-keys']);

// Every GET route the API maps (45), with :id filled from the matching list; reports also as PDF and Excel.
const GET_ROUTES = [
  '/alerts', '/audit', '/auth/counters', '/auth/me', '/auth/sessions', '/auth/showcase', '/auth/time',
  '/categories', '/charge-types', '/counters', '/dashboard', '/kits',
  '/products', '/products/:id', '/products/catalogue', '/products/export', '/products/quick-keys',
  '/purchases', '/purchases/:id',
  '/reports/gst/input', '/reports/gst/output', '/reports/kits', '/reports/kits/order-sheet',
  '/reports/purchases/register', '/reports/sales/daily', '/reports/sales/daily?format=pdf', '/reports/sales/daily?format=xlsx',
  '/reports/sales/monthly', '/reports/sales/register', '/reports/stock/dead', '/reports/stock/expiry', '/reports/stock/low',
  '/reports/stock/summary', '/reports/stock/summary?format=pdf', '/reports/stock/yearly',
  '/sales', '/sales/:id', '/sales/:id/receipt?format=html', '/sales/:id/receipt?format=pdf', '/sales/held', '/sales/last',
  '/settings', '/stock/adjustments', '/stock/low', '/stock/movements', '/stock/summary', '/suppliers', '/units', '/users',
];

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = VOLATILE.has(k) ? '<volatile>' : scrub(x);
    return o;
  }
  return v;
}

async function save(out) {
  const c = new Client('snapshot');
  await c.login('admin', process.env.ADMIN_PASSWORD);
  const firstId = {};
  const result = {};
  for (const route of GET_ROUTES) {
    let path = route;
    if (path.includes(':id')) {
      const base = path.split('/:id')[0];
      if (!(base in firstId)) {
        const list = await c.get(base);
        const arr = Array.isArray(list.data) ? list.data : list.data?.items ?? list.data?.rows ?? [];
        firstId[base] = arr[0]?.id ?? null;
      }
      if (firstId[base] == null) {
        result[route] = { skipped: 'no id' };
        continue;
      }
      path = path.replace(':id', firstId[base]);
    }
    const r = await c.get(path);
    const json = r.type.includes('json');
    result[route] = { path, status: r.status, type: r.type.split(';')[0], body: json ? scrub(r.data) : `<${r.data.length} bytes>` };
  }
  writeFileSync(out, JSON.stringify(result, null, 1));
  const ok = Object.values(result).filter((x) => x.status && x.status < 400).length;
  console.log(`saved ${Object.keys(result).length} routes (${ok} answered 2xx/3xx) to ${out}`);
}

function diffPaths(a, b, at = '', out = []) {
  if (out.length > 40) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) out.push(`${at}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`);
  else if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${at}[${i}]`, out);
  } else if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) out.push(`${at}.${k}: missing now`);
      else if (!(k in a)) out.push(`${at}.${k}: new key`);
      else diffPaths(a[k], b[k], `${at}.${k}`, out);
    }
  } else if (a !== b) out.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return out;
}

/** The daily report lists reprints; the snapshot's own receipt requests add to it, so compare that section by shape. */
function noReprints(r) {
  return { ...r, sections: (r.sections ?? []).map((sec) => (/reprint|manager/i.test(sec.title ?? '') ? { ...sec, rows: shape(sec.rows) } : sec)) };
}

/** Keys and value types only; for lists, the shape of the first row. */
function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return v === null ? 'null' : typeof v;
}

/** Report subtitles carry the clock ("As of 26-11-2026 11:42"): compare them without the time. */
function noClock(v) {
  if (typeof v === 'string') return v.replace(/As of \d{2}-\d{2}-\d{4} \d{2}:\d{2}/g, 'As of <time>');
  if (Array.isArray(v)) return v.map(noClock);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noClock(x)]));
  return v;
}

function compare(fa, fb) {
  const a = noClock(JSON.parse(readFileSync(fa, 'utf8')));
  const b = noClock(JSON.parse(readFileSync(fb, 'utf8')));
  let same = 0;
  const bad = [];
  for (const route of Object.keys(a)) {
    const x = a[route];
    const y = b[route];
    if (!y) { bad.push(`${route}: missing in second snapshot`); continue; }
    if (x.skipped || y.skipped) { if (x.skipped !== y.skipped) bad.push(`${route}: skipped ${x.skipped} vs ${y.skipped}`); else same++; continue; }
    const d = [];
    if (x.status !== y.status) d.push(`status ${x.status} -> ${y.status}`);
    if (x.type !== y.type) d.push(`type ${x.type} -> ${y.type}`);
    if (SHAPE_ONLY.has(route)) d.push(...diffPaths(shape(x.body), shape(y.body)));
    else if (ORDER_FREE.has(route)) d.push(...diffPaths([...x.body].map(String).sort(), [...y.body].map(String).sort()));
    else if (route.startsWith('/reports/sales/daily') && typeof x.body !== 'string') d.push(...diffPaths(noReprints(x.body), noReprints(y.body)));
    else if (typeof x.body !== 'string' || typeof y.body !== 'string') d.push(...diffPaths(x.body, y.body));
    if (d.length) bad.push(`${route}\n    ${d.slice(0, 12).join('\n    ')}`);
    else same++;
  }
  console.log(`${same}/${Object.keys(a).length} routes identical`);
  for (const x of bad) console.log(`DIFF ${x}`);
  process.exitCode = bad.length ? 1 : 0;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'save') await save(args[0]);
else if (cmd === 'compare') compare(args[0], args[1]);
else console.log('usage: node scripts/api-snapshot.mjs save <out.json> | compare <a.json> <b.json>');

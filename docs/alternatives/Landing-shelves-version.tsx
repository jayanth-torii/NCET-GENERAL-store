import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ITEMS, displayName, showcaseKey, spriteImage } from '../lib/showcase-sprites';
import { money } from '../lib/format';

/**
 * Landing page. What the store sells, read live from the product list, laid out like the shelves
 * themselves. Every item arrives within 6 seconds using CSS transforms only (no per-frame drawing),
 * so it stays smooth on the counter PCs and the rush tablet.
 */
const INTRO_SECONDS = 6;

interface Showcase {
  storeName: string;
  total: number;
  items: { name: string; category: string; price: number; inStock: boolean }[];
}

/** One card per product; pack sizes and prices of the same product are grouped under one name. */
interface Card {
  key: string;
  name: string;
  category: string;
  prices: number[];
  inStock: boolean;
  img: { src: string; w: number; h: number };
}

function groupItems(items: Showcase['items']): Card[] {
  const map = new Map<string, Card & { names: string[] }>();
  for (const it of items) {
    const key = showcaseKey(it.name, it.category);
    const cur = map.get(key);
    if (cur) {
      cur.prices.push(it.price);
      cur.inStock = cur.inStock || it.inStock;
      cur.names.push(it.name);
    } else {
      map.set(key, { key, name: it.name, category: it.category, prices: [it.price], inStock: it.inStock, img: spriteImage(it.name, it.category), names: [it.name] });
    }
  }
  return [...map.values()].map((c) => {
    // Prefer a name typed in normal case with spaces ("5 Star Rs10") over a legacy all-caps code ("5STAR RS5").
    const best = c.names
      .slice()
      .sort((a, b) => Number(/[a-z]/.test(b)) - Number(/[a-z]/.test(a)) || Number(b.includes(' ')) - Number(a.includes(' ')) || a.length - b.length)[0];
    return { ...c, name: displayName(best), prices: [...new Set(c.prices)].sort((a, b) => a - b) };
  });
}

/** Pick one item per category round-robin for the hero shelves, so every kind of thing is up front. */
function featured(cards: Card[], n: number): Card[] {
  const byCat = new Map<string, Card[]>();
  for (const c of cards) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  const lists = [...byCat.values()];
  const out: Card[] = [];
  for (let k = 0; out.length < n; k++) {
    let added = false;
    for (const l of lists) {
      if (l[k] && out.length < n) {
        out.push(l[k]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

function priceText(prices: number[]) {
  if (prices.length === 1) return `₹${money(prices[0]).replace(/\.00$/, '')}`;
  const f = (v: number) => money(v).replace(/\.00$/, '');
  return `₹${f(prices[0])} – ₹${f(prices[prices.length - 1])}`;
}

export function Landing({ onLogin }: { onLogin: () => void }) {
  const [data, setData] = useState<Showcase | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [done, setDone] = useState(false);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('');
  const shelvesRef = useRef<HTMLElement>(null);
  const startRef = useRef(0);
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/auth/showcase')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('showcase'))))
      .then((d: Showcase) => alive && setData(d.items.length ? d : { ...d, items: DEFAULT_ITEMS.map((i) => ({ ...i, price: 0, inStock: true })), total: DEFAULT_ITEMS.length }))
      .catch(() => alive && setData({ storeName: 'GENERAL STORE', total: DEFAULT_ITEMS.length, items: DEFAULT_ITEMS.map((i) => ({ ...i, price: 0, inStock: true })) }));
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(() => (data ? groupItems(data.items) : []), [data]);
  const shelfCards = useMemo(() => featured(cards, 18), [cards]);
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [cards]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => (!cat || c.category === cat) && (!q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)));
  }, [cards, query, cat]);

  // Choreography: shelf items 0.3 s to 2.6 s, hero text 0.2 s to 1.4 s, catalogue cards from 1.6 s, the last one ending at 6.0 s.
  const instant = reduced || skipped;
  const shelfDelay = (i: number) => 0.3 + (i / Math.max(1, shelfCards.length - 1)) * 1.8;
  const gridDelay = (i: number) => 1.6 + (i / Math.max(1, cards.length - 1)) * (INTRO_SECONDS - 0.5 - 1.6);
  const anim = (name: string, delay: number, dur: number) => (instant ? undefined : { animation: `${name} ${dur}s cubic-bezier(.22,1,.36,1) ${delay}s both` });

  // Timing record for the automated check: starts when the page is ready, ends when the last card lands.
  useEffect(() => {
    if (!data) return;
    startRef.current = performance.now();
    const t = setTimeout(
      () => {
        document.documentElement.dataset.introMs = String(Math.round(performance.now() - startRef.current));
        setDone(true);
      },
      instant ? 0 : INTRO_SECONDS * 1000,
    );
    return () => clearTimeout(t);
  }, [data, instant]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) onLogin();
      else if (e.key === 'Escape') setSkipped(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLogin]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-ink-mute" aria-busy="true">
        Opening the store…
      </div>
    );
  }

  const storeName = data.storeName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const inStock = cards.filter((c) => c.inStock).length;

  return (
    <div className={`min-h-screen bg-paper text-ink ${instant ? 'intro-instant' : ''}`} data-intro-ready="1">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <img src="/ncet-logo.png" alt="Nagarjuna College of Engineering & Technology" className="h-11 w-auto" />
          <div className="hidden h-8 border-l border-line sm:block" />
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-bold text-navy-700">{storeName}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">NCET campus store</div>
          </div>
          <nav className="ml-auto flex items-center gap-2">
            <a href="#shelves" className="hidden rounded-md px-3 py-2 text-sm font-medium text-navy-700 hover:bg-paper sm:inline-block">
              What we sell
            </a>
            <button onClick={onLogin} className="h-10 rounded-md bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              Staff log in
            </button>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pb-16 lg:pt-16">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600" style={anim('fadeUp', 0.2, 0.7)}>
            Nagarjuna College of Engineering &amp; Technology
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight text-navy-700 text-balance sm:text-5xl" style={anim('fadeUp', 0.35, 0.8)}>
            Everything for the semester, under one roof.
          </h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-soft sm:text-lg" style={anim('fadeUp', 0.55, 0.8)}>
            Stationery, lab records, exam books, copier paper, snacks and basic medicines, right on campus. Walk up to the counter with your list; we have the rest.
          </p>
          <div className="mt-6 flex flex-wrap gap-3" style={anim('fadeUp', 0.75, 0.8)}>
            <button onClick={onLogin} className="h-12 rounded-md bg-brand-600 px-6 text-base font-semibold text-white shadow hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              Open the counter
            </button>
            <a href="#shelves" className="inline-flex h-12 items-center rounded-md border border-navy-700/30 bg-white px-6 text-base font-semibold text-navy-700 hover:bg-navy-50">
              See the shelves
            </a>
          </div>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6" style={anim('fadeUp', 1.0, 0.8)}>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-mute">Products</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums text-navy-700">
                <span data-testid="item-count">{data.total.toLocaleString('en-IN')}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-mute">Categories</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums text-navy-700">{categories.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-mute">In stock now</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums text-navy-700">{inStock}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-ink-mute">
            Press <kbd className="rounded border border-line bg-white px-1 font-mono">Enter</kbd> to log in · <kbd className="rounded border border-line bg-white px-1 font-mono">Esc</kbd> skips the intro
          </p>
        </div>

        {/* shelf unit */}
        <div className="shelf-unit min-w-0" aria-label="Featured items on the shelves" role="img">
          {[0, 1, 2].map((row) => (
            <div key={row} className="shelf-row">
              <div className="shelf-items">
                {shelfCards
                  .filter((_, i) => i % 3 === row)
                  .map((c) => {
                    const i = shelfCards.indexOf(c);
                    return (
                      <figure key={c.key} className="shelf-item" style={anim('shelfIn', shelfDelay(i), 0.9)} title={`${c.name} · ${priceText(c.prices)}`}>
                        <img src={c.img.src} width={c.img.w} height={c.img.h} alt={c.name} loading="eager" decoding="async" />
                      </figure>
                    );
                  })}
              </div>
              <div className="shelf-board" />
            </div>
          ))}
        </div>
      </section>

      {/* catalogue */}
      <section id="shelves" ref={shelvesRef} className="border-t border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-navy-700">On the shelves</h2>
              <p className="mt-1 text-sm text-ink-mute">Prices as marked at the counter. Stock shown as of a minute ago.</p>
            </div>
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search items</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search, e.g. record, pen, chocolate"
                className="h-11 w-full rounded-md border border-line bg-paper px-4 text-sm text-ink placeholder:text-ink-mute/70 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={() => setCat('')} className={`rounded-full border px-3 py-1 text-sm font-medium ${!cat ? 'border-navy-700 bg-navy-700 text-white' : 'border-line bg-white text-navy-700 hover:bg-paper'}`}>
              All <span className="opacity-70">{cards.length}</span>
            </button>
            {categories.map(([c, n]) => (
              <button key={c} onClick={() => setCat(cat === c ? '' : c)} className={`rounded-full border px-3 py-1 text-sm font-medium ${cat === c ? 'border-navy-700 bg-navy-700 text-white' : 'border-line bg-white text-navy-700 hover:bg-paper'}`}>
                {c} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="mt-10 text-sm text-ink-mute">Nothing matches "{query}". Try another word, or ask at the counter.</p>
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-label="Items on the shelves">
              {visible.map((c) => {
                const i = cards.indexOf(c);
                return (
                  <li key={c.key} className="product-card" style={done || query || cat ? undefined : anim('cardIn', gridDelay(i), 0.7)}>
                    <div className="product-pic">
                      <img src={c.img.src} width={c.img.w} height={c.img.h} alt="" decoding="async" />
                    </div>
                    <div className="min-w-0 px-3 pb-3">
                      <div className="truncate text-sm font-semibold text-navy-700" title={c.name}>
                        {c.name}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-ink-mute">{c.category}</span>
                        {c.inStock ? <span className="shrink-0 rounded-full bg-leaf-50 px-2 py-0.5 font-medium text-leaf-700">In stock</span> : <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">Out of stock</span>}
                      </div>
                      {c.prices[0] > 0 && <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink">{priceText(c.prices)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <footer className="border-t border-line bg-navy-900 text-white/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm sm:px-6">
          <div>
            <div className="font-semibold text-white">{storeName}</div>
            <div className="text-xs text-white/60">Nagarjuna College of Engineering &amp; Technology · campus store</div>
          </div>
          <button onClick={onLogin} className="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
            Staff log in
          </button>
        </div>
      </footer>
    </div>
  );
}

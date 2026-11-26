import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ITEMS, dedupe, makeSprite, Sprite } from '../../assets/images/showcase-sprites';

/**
 * Landing showcase. Every item on the store's shelves is drawn and animated in one 6-second sequence,
 * modelled on a product commercial:
 *   0.0-1.5 s  burst   items fly in from all sides, a lightning flash and sparks at 1.5 s
 *   1.5-4.2 s  orbit   items swing into a tilted 3D ring around the store card, orange ribbons swirl
 *   4.2-6.0 s  settle  the ring opens into a frame around the card; counts and the Log in button arrive
 * The timeline is computed from the clock, so it always ends at exactly 6.0 s.
 */
const DURATION = 6;
const MAX_SPRITES = 72;

/** Screen pixel ratio used for drawing; above 1.5 costs a lot of fill time for no visible gain here. */
const DPR = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
/** Largest on-screen scale of a product picture (base 0.42 x size 1.08 x near-side depth 1.3). */
const SPRITE_MAX_SCALE = 0.6;

interface Showcase {
  storeName: string;
  total: number;
  items: { name: string; category: string }[];
}

interface Actor {
  s: Sprite;
  originAng: number;
  sx: number; // scatter position as a fraction of the screen
  sy: number;
  delay: number;
  spin: number;
  ring: 0 | 1;
  theta: number;
  order: number;
  rotF: number;
  size: number;
}

// ---------- maths ----------
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to MAX_SPRITES items, taken round-robin across categories so the ring mixes snacks, books and pens. */
function pick(items: Showcase['items']) {
  const byCat = new Map<string, Showcase['items']>();
  for (const i of items) byCat.set(i.category, [...(byCat.get(i.category) ?? []), i]);
  const lists = [...byCat.values()];
  const out: Showcase['items'] = [];
  for (let k = 0; out.length < MAX_SPRITES; k++) {
    let added = false;
    for (const l of lists) {
      if (l[k] && out.length < MAX_SPRITES) {
        out.push(l[k]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export function Landing({ onLogin }: { onLogin: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null); // items on the near side of the ring pass in front of the card
  const counterRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const sizeRef = useRef({ W: 0, H: 0 });
  const lastCountRef = useRef(-1);
  const doneRef = useRef(false);
  const boxesRef = useRef<{ x: number; y: number; r: number; name: string; category: string }[]>([]);
  const [data, setData] = useState<Showcase | null>(null);
  const [actors, setActors] = useState<Actor[] | null>(null);
  const [run, setRun] = useState(0); // bump to replay
  const [skipped, setSkipped] = useState(false);
  const [done, setDone] = useState(false);
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const freezeAt = useMemo(() => {
    const f = Number(new URLSearchParams(window.location.search).get('introAt'));
    return f > 0 && f <= DURATION ? f : 0;
  }, []);

  // 1. Load the store's items (public endpoint), falling back to a typical general-store range.
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/auth/showcase')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('showcase'))))
      .then((d: Showcase) => alive && setData(d.items.length ? d : { ...d, items: DEFAULT_ITEMS, total: DEFAULT_ITEMS.length }))
      .catch(() => alive && setData({ storeName: 'GENERAL STORE', total: DEFAULT_ITEMS.length, items: DEFAULT_ITEMS }));
    return () => {
      alive = false;
    };
  }, []);

  // 2. Draw a product image for every item and give each one its part in the choreography.
  useEffect(() => {
    if (!data) return;
    let alive = true;
    // One picture per product, categories mixed round the ring, each rendered once to a bitmap.
    const chosen = pick(dedupe(data.items));
    // Also load the logo and the fonts first, so nothing is decoded or re-laid-out while the intro plays.
    const logo = new Image();
    logo.src = '/ncet-logo.png';
    const ready = Promise.all([logo.decode().catch(() => undefined), document.fonts?.ready.catch(() => undefined)]);
    void Promise.all([Promise.all(chosen.map((i) => makeSprite(i.name, i.category, SPRITE_MAX_SCALE * DPR))), ready]).then(([sprites]) => {
      if (!alive) return;
      const r = rng(sprites.length * 7919 + 17);
      const twoRings = window.innerWidth >= 760 && sprites.length > 18;
      const outer = twoRings ? Math.ceil(sprites.length * 0.6) : sprites.length;
      const list: Actor[] = sprites.map((s, i) => {
        const ring: 0 | 1 = i < outer ? 0 : 1;
        const idx = ring === 0 ? i : i - outer;
        const count = ring === 0 ? outer : sprites.length - outer;
        return {
          s,
          originAng: r() * Math.PI * 2,
          sx: 0.08 + r() * 0.84,
          sy: 0.1 + r() * 0.8,
          delay: r() * 0.35,
          spin: (r() < 0.5 ? -1 : 1) * (2 + r() * 4),
          ring,
          theta: (idx / count) * Math.PI * 2 + (ring ? Math.PI / count : 0) + (r() - 0.5) * 0.08,
          order: r(),
          rotF: (r() - 0.5) * 0.7,
          size: 0.92 + r() * 0.16,
        };
      });
      setActors(list);
    });
    return () => {
      alive = false;
    };
  }, [data]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data?.items ?? []) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  // 3. The animation loop.
  const render = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const front = frontRef.current;
      if (!canvas || !front || !actors) return;
      // Size comes from the cached value set on resize: reading layout here every frame forced reflows.
      const { W, H } = sizeRef.current;
      if (!W || !H) return;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const fctx = front.getContext('2d')!;
      fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      fctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H * 0.5;
      const s0 = Math.max(0.42, Math.min(1, Math.min(W, H) / 900));

      // --- backdrop: NCET blue studio with a soft blue key light
      const bg = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, Math.hypot(W, H) * 0.65);
      bg.addColorStop(0, '#1663A2');
      bg.addColorStop(0.55, '#0F4C81');
      bg.addColorStop(1, '#0C2339');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const glowA = clamp01((t - 1.5) / 0.9) * 0.55;
      if (glowA > 0) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.55);
        g.addColorStop(0, `rgba(74,155,212,${glowA})`);
        g.addColorStop(1, 'rgba(74,155,212,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // slate plinth under the card, like the product stand in the reference
      const plA = clamp01((t - 3.6) / 1.2);
      if (plA > 0) {
        ctx.save();
        ctx.globalAlpha = plA * 0.55;
        const pg = ctx.createLinearGradient(0, cy + 150 * s0, 0, cy + 200 * s0);
        pg.addColorStop(0, '#2A3550');
        pg.addColorStop(1, '#0B1430');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 172 * s0, 260 * s0, 26 * s0, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // --- ring geometry over time
      const g = easeInOutCubic(clamp01((t - 4.0) / 1.7)); // orbit -> frame
      const twoRings = actors.some((a) => a.ring === 1);
      const rxO = Math.min(W * 0.36, H * 0.95);
      const ryO = rxO * 0.3;
      const ring = (k: 0 | 1) => ({
        rx: lerp(rxO * (k ? 0.68 : 1), W * (k ? 0.31 : 0.45), g),
        ry: lerp(ryO * (k ? 0.68 : 1), H * (k ? 0.29 : twoRings ? 0.41 : 0.42), g),
      });
      const phi = Math.PI * 2.4 * easeOutQuart(clamp01((t - 1.3) / (DURATION - 1.3)));
      const depth = 1 - g * 0.85;

      // --- caramel-style ribbons in NGI orange. Each is one filled shape (plus a thinner sheen on top).
      const ribA = clamp01((t - 1.35) / 0.6);
      if (ribA > 0) {
        const R0 = ring(0);
        const N = 72;
        ctx.globalAlpha = ribA * 0.88;
        for (let rb = 0; rb < 2; rb++) {
          const pts: [number, number, number][] = [];
          for (let k = 0; k <= N; k++) {
            const u = k / N;
            const ang = phi * (rb ? -1.15 : 1.1) + u * Math.PI * 1.3 + rb * Math.PI;
            const rr = 1 + 0.07 * Math.sin(u * 10 + t * 2.2 + rb);
            const tw = Math.cos(u * 9 + t * 2.5 + rb * 2);
            pts.push([
              cx + R0.rx * rr * Math.cos(ang),
              cy + R0.ry * rr * Math.sin(ang) + Math.sin(u * 14 + t * 3 + rb) * 14 * s0,
              (2 + 8 * Math.abs(tw)) * s0 * Math.sin(u * Math.PI), // half width: the twist makes it swell and narrow
            ]);
          }
          const band = (scale: number, color: string) => {
            const edge = (side: 1 | -1, k: number) => {
              const [x, y, hw] = pts[k];
              const [x2, y2] = pts[Math.min(N, k + 1)];
              const [x0, y0] = pts[Math.max(0, k - 1)];
              const dx = x2 - x0;
              const dy = y2 - y0;
              const len = Math.hypot(dx, dy) || 1;
              return [x - (dy / len) * hw * scale * side, y + (dx / len) * hw * scale * side];
            };
            ctx.beginPath();
            for (let k = 0; k <= N; k++) {
              const [x, y] = edge(1, k);
              if (k === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            for (let k = N; k >= 0; k--) {
              const [x, y] = edge(-1, k);
              ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
          };
          band(1, '#247FC0');
          band(0.45, '#84BDE4');
        }
        ctx.globalAlpha = 1;
      }

      // --- items
      const states: { a: Actor; x: number; y: number; z: number; sc: number; rot: number; alpha: number; trail: [number, number, number][] }[] = [];
      const posA = (a: Actor, tt: number) => {
        const pa = easeOutCubic(clamp01((tt - a.delay) / 1.0));
        const far = Math.hypot(W, H) * 0.56;
        const ox = cx + Math.cos(a.originAng) * far;
        const oy = cy + Math.sin(a.originAng) * far;
        const drift = Math.max(0, tt - a.delay - 1.0) * 18 * s0;
        return { x: lerp(ox, a.sx * W, pa) + Math.cos(a.originAng) * drift, y: lerp(oy, a.sy * H, pa) + Math.sin(a.originAng) * drift, rot: a.spin * (1 - pa), pa };
      };
      for (const a of actors) {
        if (t < a.delay) continue;
        const A = posA(a, t);
        const rg = ring(a.ring);
        const ang = a.theta + (a.ring ? -phi * 0.8 : phi);
        const z = Math.sin(ang);
        const rx = cx + rg.rx * Math.cos(ang);
        const ry = cy + rg.ry * Math.sin(ang);
        const tb = 1.4 + a.order * 0.6;
        const pb = easeInOutCubic(clamp01((t - tb) / 1.1));
        const x = lerp(A.x, rx, pb);
        const y = lerp(A.y, ry, pb);
        const rot = lerp(A.rot, lerp(Math.cos(ang) * 0.35, a.rotF, g), pb);
        const sc = 0.42 * s0 * a.size * (1 + depth * z * 0.3 * pb);
        const alpha = clamp01((t - a.delay) / 0.2) * (1 - 0.4 * depth * pb * (1 - (z + 1) / 2));
        const trail: [number, number, number][] = [];
        if (A.pa < 1 && pb === 0) {
          for (let k = 1; k <= 2; k++) {
            const P = posA(a, t - k * 0.045);
            trail.push([P.x, P.y, P.rot]);
          }
        }
        states.push({ a, x, y, z: z * pb, sc, rot, alpha, trail });
      }
      states.sort((p, q) => p.z - q.z);
      const boxes: typeof boxesRef.current = [];
      for (const st of states) {
        const { img, w, h } = st.a.s;
        const c2 = st.z > 0.05 ? fctx : ctx; // near side of the ring is drawn above the card
        for (const [tx, ty, tr] of st.trail) {
          c2.save();
          c2.globalAlpha = 0.12 * st.alpha;
          c2.translate(tx, ty);
          c2.rotate(tr);
          c2.drawImage(img, (-w * st.sc) / 2, (-h * st.sc) / 2, w * st.sc, h * st.sc);
          c2.restore();
        }
        c2.save();
        c2.globalAlpha = st.alpha;
        c2.translate(st.x, st.y);
        c2.rotate(st.rot);
        c2.drawImage(img, (-w * st.sc) / 2, (-h * st.sc) / 2, w * st.sc, h * st.sc);
        c2.restore();
        boxes.push({ x: st.x, y: st.y, r: (Math.max(w, h) * st.sc) / 2, name: st.a.s.name, category: st.a.s.category });
      }
      boxesRef.current = boxes;

      // --- sparks from the flash
      const sp = t - 1.5;
      if (sp > 0 && sp < 1.6) {
        const r = rng(99);
        for (let k = 0; k < 80; k++) {
          const ang = r() * Math.PI * 2;
          const v = (300 + r() * 700) * s0;
          const life = 0.8 + r() * 0.8;
          if (sp > life) continue;
          const d = v * (sp - (sp * sp) / (2 * life));
          const px = cx + Math.cos(ang) * d;
          const py = cy + Math.sin(ang) * d * 0.7;
          ctx.globalAlpha = 1 - sp / life;
          ctx.strokeStyle = k % 3 ? '#B6D8F0' : '#FFFFFF';
          ctx.lineWidth = 2 * s0;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(ang) * 10 * s0, py - Math.sin(ang) * 7 * s0);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // --- lightning strike and flash at 1.5 s
      if (t > 1.38 && t < 1.7) {
        const r = rng(7);
        ctx.save();
        ctx.globalAlpha = 1 - (t - 1.38) / 0.32;
        ctx.strokeStyle = '#FFFFFF';
        ctx.shadowColor = '#4A9BD4';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 3 * s0;
        ctx.beginPath();
        let lx = cx + (r() - 0.5) * W * 0.3;
        let ly = 0;
        ctx.moveTo(lx, ly);
        while (ly < cy) {
          lx += (r() - 0.5) * 70 * s0;
          ly += (20 + r() * 40) * s0;
          ctx.lineTo(lx + (cx - lx) * (ly / cy) * 0.35, Math.min(ly, cy));
        }
        ctx.stroke();
        ctx.restore();
      }
      const fl = t > 1.42 && t < 2.0 ? (t < 1.52 ? (t - 1.42) / 0.1 : 1 - (t - 1.52) / 0.48) : 0;
      if (fl > 0) {
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.6);
        fg.addColorStop(0, `rgba(255,255,255,${0.55 * fl})`);
        fg.addColorStop(0.35, `rgba(132,189,228,${0.3 * fl})`);
        fg.addColorStop(1, 'rgba(132,189,228,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
      }

      // --- item counter. Only touch the page when the number changes; rewriting text every frame costs a layout.
      if (counterRef.current && data) {
        const c = Math.round(data.total * easeOutCubic(clamp01((t - 2.2) / 2.4)));
        if (c !== lastCountRef.current) {
          lastCountRef.current = c;
          counterRef.current.textContent = c.toLocaleString('en-IN');
        }
      }
    },
    [actors, data],
  );

  useEffect(() => {
    if (!actors) return;
    cancelAnimationFrame(rafRef.current);
    // Review aid: /?introAt=2.5 freezes the intro at 2.5 s so a single moment can be inspected.
    if (freezeAt) {
      requestAnimationFrame(() => render(freezeAt));
      return;
    }
    setDone(reduced || skipped);
    lastCountRef.current = -1;
    // Warm-up: draw the flash moment (glow, gradients, sparks) and the busiest frame (every product
    // picture goes to the graphics card) once, then the empty opening frame. The clock starts two
    // frames later, after the card has been laid out, so none of this one-time work is seen as a jerk.
    render(1.55);
    render(DURATION);
    render(0);
    startRef.current = 0;
    const instantEnd = reduced || skipped;
    let settle = instantEnd ? 0 : 2;
    const tick = (now: number) => {
      if (settle > 0) {
        settle--;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (!startRef.current) startRef.current = now - (instantEnd ? DURATION * 1000 : 0);
      const t = Math.min(DURATION, (now - startRef.current) / 1000);
      render(t);
      if (t < DURATION) rafRef.current = requestAnimationFrame(tick);
      else {
        // Record how long the intro really took, for the automated timing check.
        document.documentElement.dataset.introMs = String(Math.round(now - startRef.current));
        setDone(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [actors, run, render, reduced, skipped, freezeAt]);

  // Canvas size is measured here (on load and resize) rather than inside every frame.
  useLayoutEffect(() => {
    const measure = () => {
      const canvas = canvasRef.current;
      const front = frontRef.current;
      if (!canvas || !front) return;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      sizeRef.current = { W, H };
      for (const c of [canvas, front]) {
        c.width = Math.round(W * DPR);
        c.height = Math.round(H * DPR);
      }
    };
    measure();
    const onResize = () => {
      measure();
      if (doneRef.current) render(DURATION);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [render, actors]);
  useEffect(() => {
    doneRef.current = done;
  }, [done]);

  // Enter goes to login; Esc skips the intro.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onLogin();
      else if (e.key === 'Escape') setSkipped(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLogin]);

  // Item names on hover once the animation has finished.
  const onMove = (e: React.MouseEvent) => {
    const tip = tipRef.current;
    if (!tip) return;
    if (!done) {
      tip.hidden = true;
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = [...boxesRef.current].reverse().find((b) => Math.hypot(b.x - x, b.y - y) < b.r * 0.75);
    if (!hit) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    tip.textContent = `${hit.name} · ${hit.category}`;
    tip.style.left = `${x + 14}px`;
    tip.style.top = `${y + 14}px`;
  };

  const instant = reduced || skipped;
  const anim = (name: string, delay: number, dur = 0.7) => {
    if (instant) return undefined;
    const base = `${name} ${dur}s cubic-bezier(.2,.9,.3,1.15)`;
    // When frozen for review, hold the card at the same moment as the canvas.
    if (freezeAt) return { animation: `${base} ${delay - freezeAt}s both paused` };
    // Own compositor layer while it moves, so fading a chip or button never repaints the card and its shadow.
    return done ? { animation: `${base} ${delay}s both` } : { animation: `${base} ${delay}s both`, willChange: 'transform, opacity' };
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-brand-950 text-white" onMouseMove={onMove} data-intro-ready={actors ? '1' : undefined}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas ref={frontRef} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden="true" />

      {!actors && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Stocking the shelves…</div>}

      {actors && (
        <div key={run} className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-[min(92vw,400px)] rounded-xl border border-white/10 bg-brand-950/80 px-6 py-5 text-center text-white shadow-2xl backdrop-blur-md" style={anim('heroIn', 1.9, 0.75)}>
            <span className="mx-auto block w-fit rounded-xl bg-[#fff] px-3 py-1.5">
              <img src="/ncet-logo.png" alt="Nagarjuna College of Engineering & Technology" className="h-14 w-auto sm:h-16" />
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{data?.storeName ? titleCase(data.storeName) : 'General Store'}</h1>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">NCET campus store</p>
            <p className="mt-3 text-sm text-white/70" style={anim('fadeUp', 2.4)}>
              <span ref={counterRef} data-testid="item-count" className="font-mono text-lg font-semibold text-brand-300">
                {instant ? (data?.total ?? 0).toLocaleString('en-IN') : '0'}
              </span>{' '}
              items on our shelves · {categories.length} categories
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {categories.slice(0, 8).map(([c, n], i) => (
                <span key={c} className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-white/80" style={anim('fadeUp', 4.3 + i * 0.07, 0.5)}>
                  {c} <span className="text-white/60">{n}</span>
                </span>
              ))}
            </div>
            <div className="mt-4 flex justify-center gap-2" style={anim('fadeUp', 5.1, 0.6)}>
              <button onClick={onLogin} className="h-10 rounded-lg bg-[#fff] px-6 text-sm font-semibold text-[#0F4C81] shadow hover:bg-[#fff]/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                Log in
              </button>
              <button
                onClick={() => {
                  setSkipped(false);
                  setRun((r) => r + 1);
                }}
                className="h-10 rounded-lg border border-white/20 bg-white/[0.06] px-4 text-sm font-medium text-white hover:bg-white/15"
              >
                Replay
              </button>
            </div>
          </div>
        </div>
      )}

      {actors && !done && (
        <button onClick={() => setSkipped(true)} className="absolute right-4 top-4 z-10 rounded-full bg-navy-700/80 px-4 py-1.5 text-xs font-medium text-white hover:bg-navy-600">
          Skip intro <span className="opacity-60">Esc</span>
        </button>
      )}
      <div ref={tipRef} hidden className="pointer-events-none absolute z-10 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-navy-700 shadow-lg" />
      <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-white/50">Press Enter to log in · hover an item to see its name</p>
    </div>
  );
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

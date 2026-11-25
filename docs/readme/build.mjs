// Generates the animated README pictures in this folder (plain SVG + CSS/SMIL, no external services).
// Run from the repo root:  node docs/readme/build.mjs
// hero.svg, stats.svg, bill-flow.svg and architecture.svg are hand-made and not touched here.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const F = `'Segoe UI',Inter,'Helvetica Neue',Arial,sans-serif`;
const MONO = `Consolas,'SFMono-Regular',Menlo,'Courier New',monospace`;
const EMOJI = `'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif`;
const pct = (x) => `${Math.max(0, Math.min(100, x)).toFixed(2)}%`;

const BASE =
  `.h{font:800 30px ${F};fill:#0c2339;letter-spacing:-.5px}` +
  `.t{font:700 18px ${F};fill:#0c2339}` +
  `.p{font:500 15px ${F};fill:#404040}.pb{font-weight:700;fill:#0c2339}` +
  `.s{font:500 13px ${F};fill:#737373}` +
  `.eb{font:700 12px ${F};letter-spacing:3px}` +
  `.m{font:600 14px ${MONO}}` +
  `.e{font-family:${EMOJI}}` +
  `.card{fill:#f8fafc;stroke:#e2e8f0}.ln{stroke:#e2e8f0}.ink{fill:#0c2339}.trk{fill:#e5e7eb}` +
  `@media (prefers-color-scheme: dark){.h,.t,.ink,.pb{fill:#f0f6fc}.p{fill:#c9d1d9}.s{fill:#8b949e}` +
  `.card{fill:#161b22;stroke:#30363d}.ln{stroke:#30363d}.trk{fill:#30363d}}`;

class Art {
  constructor(w, h, title) {
    Object.assign(this, { w, h, title, css: [], defs: [], body: [], n: 0 });
  }
  /** One infinite CSS animation; returns its class name. */
  anim(frames, dur, { ease = 'cubic-bezier(.2,.8,.2,1)', box = '', origin = '', base = '', delay = 0 } = {}) {
    const c = `a${this.n++}`;
    const extra = (box ? `transform-box:${box};` : '') + (origin ? `transform-origin:${origin};` : '');
    this.css.push(`@keyframes ${c}{${frames}}`, `.${c}{${extra}${base}animation:${c} ${dur}s ${ease} ${delay}s infinite}`);
    return c;
  }
  /** Looped reveal: hidden until t, shown from t+fade to `out` of the cycle, then fades away. */
  reveal(t, cycle, { from = 'translateY(12px)', fade = 0.6, out = 0.94 } = {}) {
    const a = (t / cycle) * 100, b = ((t + fade) / cycle) * 100;
    return this.anim(
      `0%,${pct(a)}{opacity:0;transform:${from}}${pct(b)},${pct(out * 100)}{opacity:1;transform:none}100%{opacity:0;transform:none}`,
      cycle,
    );
  }
  /** Looped scaleX 0 → 1 between t and t+d. */
  grow(t, d, cycle, { out = 0.94, origin = 'left center' } = {}) {
    const a = (t / cycle) * 100, b = ((t + d) / cycle) * 100;
    return this.anim(
      `0%,${pct(a)}{transform:scaleX(0)}${pct(b)},${pct(out * 100)}{transform:scaleX(1)}100%{transform:scaleX(0)}`,
      cycle, { box: 'fill-box', origin },
    );
  }
  /** Looped pop (scale 0 → 1.2 → 1) at t. */
  pop(t, cycle, { out = 0.94 } = {}) {
    const p = (x) => pct((x / cycle) * 100);
    return this.anim(
      `0%,${p(t)}{transform:scale(0)}${p(t + 0.35)}{transform:scale(1.2)}${p(t + 0.55)},${pct(out * 100)}{transform:scale(1)}100%{transform:scale(0)}`,
      cycle, { box: 'fill-box', origin: 'center' },
    );
  }
  bob(dur = 3, px = 4) {
    return this.anim(`0%,100%{transform:translateY(0)}50%{transform:translateY(-${px}px)}`, dur, { ease: 'ease-in-out' });
  }
  spin(dur = 12) {
    return this.anim('to{transform:rotate(360deg)}', dur, { ease: 'linear', box: 'fill-box', origin: 'center' });
  }
  dash(speed = 1, len = 20) {
    return this.anim(`to{stroke-dashoffset:-${len}}`, speed, { ease: 'linear' });
  }
  add(...s) { this.body.push(...s); return this; }
  def(...s) { this.defs.push(...s); return this; }
  write(file) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-labelledby="t">\n` +
      `<title id="t">${esc(this.title)}</title>\n` +
      `<style>${BASE}${this.css.join('')}@media (prefers-reduced-motion: reduce){*{animation:none!important}.mv{display:none}}</style>\n` +
      `<defs>${this.defs.join('')}</defs>\n${this.body.join('\n')}\n</svg>\n`;
    writeFileSync(join(OUT, file), svg);
    console.log('wrote', file, `${(svg.length / 1024).toFixed(1)} KB`);
  }
}

const shine = (id = 'shine') =>
  `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;

const ACC = {
  blue: ['#0F4C81', '#4a9bd4'], teal: ['#0f766e', '#2dd4bf'], violet: ['#6d28d9', '#a78bfa'],
  amber: ['#b45309', '#fbbf24'], green: ['#00684A', '#13aa52'], rose: ['#be123c', '#fb7185'],
  indigo: ['#3730a3', '#818cf8'], sky: ['#0369a1', '#38bdf8'], slate: ['#334155', '#94a3b8'],
};

// ───────────────────────────── section headers ─────────────────────────────
function header(file, num, emoji, title, sub, [c1, c2]) {
  const a = new Art(1200, 124, `${num} · ${title} — ${sub}`);
  const subW = Math.round(sub.length * 8.6 + 16);
  // Typing: SMIL on the clip width (CSS-animated clip paths are not repainted reliably in <img>).
  const n = sub.length, vals = [], keys = [];
  for (let i = 0; i <= n; i++) { vals.push(Math.round((subW * i) / n)); keys.push(((0.22 * i) / n).toFixed(4)); }
  vals.push(subW); keys.push('1');
  a.def(
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
    `<linearGradient id="u" x1="0" x2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".7" stop-color="${c2}"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient>`,
    `<clipPath id="sc"><rect x="110" y="76" width="${subW}" height="28"><animate attributeName="width" calcMode="discrete" values="${vals.join(';')}" keyTimes="${keys.join(';')}" dur="10s" repeatCount="indefinite"/></rect></clipPath>`,
  );
  const pulse = a.anim('0%{transform:scale(.8);opacity:.7}100%{transform:scale(1.35);opacity:0}', 2.6, { ease: 'ease-out', box: 'fill-box', origin: 'center' });
  const bar = a.anim('0%{transform:scaleX(0)}30%,100%{transform:scaleX(1)}', 10, { box: 'fill-box', origin: 'left center' });
  const dot = a.anim('0%{transform:translateX(0);opacity:0}8%{opacity:1}85%{opacity:1}100%{transform:translateX(1060px);opacity:0}', 5, { ease: 'ease-in-out' });
  const twk = (d) => a.anim('0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:1;transform:scale(1)}', 2.4, { ease: 'ease-in-out', box: 'fill-box', origin: 'center', delay: d });
  const star = (x, y, r, d) =>
    `<path class="${twk(d)}" d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z" fill="${c2}"/>`;
  a.add(
    `<g transform="translate(1196 98)"><g class="${a.bob(6, 6)}"><text text-anchor="end" style="font:900 96px ${F}" fill="url(#g)" opacity=".1">${num}</text></g></g>`,
    `<g transform="translate(48 62)">`,
    `<circle class="${pulse}" r="40" fill="none" stroke="${c2}" stroke-width="2"/>`,
    `<g class="${a.spin(16)}"><circle r="45" fill="none" stroke="url(#g)" stroke-width="2" stroke-dasharray="5 9" opacity=".75"/></g>`,
    `<rect x="-32" y="-32" width="64" height="64" rx="19" fill="url(#g)"/>`,
    `<g class="${a.bob(3, 4)}"><text y="11" text-anchor="middle" class="e" style="font-size:30px">${emoji}</text></g>`,
    `</g>`,
    star(16, 14, 6, 0), star(88, 18, 4, 0.8), star(90, 108, 5, 1.6),
    `<text x="110" y="30" class="eb" fill="${c1}">SECTION ${num}</text>`,
    `<text x="110" y="66" class="h">${esc(title)}</text>`,
    `<g clip-path="url(#sc)"><text x="110" y="97" class="p" style="font-size:17px">${esc(sub)}</text></g>`,
    `<line class="ln" x1="110" y1="116" x2="1200" y2="116" stroke-width="1.5"/>`,
    `<rect class="${bar}" x="110" y="114.5" width="520" height="4" rx="2" fill="url(#u)"/>`,
    `<g transform="translate(110 116.5)"><circle class="${dot}" r="4" fill="${c2}"/></g>`,
  );
  a.write(file);
}

// ───────────────────────────── features ─────────────────────────────
function features() {
  const a = new Art(1200, 510, "What's inside: counter sales, purchases, products & stock, reports, control and look");
  a.def(shine());
  const C = 14;
  const cards = [
    ['🧾', 'Counter sales', '#0F4C81', ['Scan, type 5*123, or tap a tile', 'Cash + UPI + card split, change shown', 'F3 UPI QR · F10 save & print', 'Hold, recall, reprint, Ctrl+L lock']],
    ['🚚', 'Purchases (GRN)', '#0d9488', ['Boxes ↔ pieces, rate or line amount', 'Transport, Hamali → landed cost', 'Posts only within ₹1 of the bill', 'Store keeper enters → manager posts']],
    ['📦', 'Products & stock', '#7c3aed', ['~12-field master, GST % + HSN', 'Excel import and export', 'Item ledger with running balance', 'Low, negative, dead, expiry stock']],
    ['📊', 'Reports', '#d97706', ['Daily, monthly, sales, purchases', 'Section kits + class order sheet', 'GST input & output registers', 'Every report as PDF and Excel']],
    ['🛡️', 'Control', '#16a34a', ['4 roles, personal logins', 'Server-side sessions, audit log', 'Who is logged in · end session', 'Nightly 02:00 ledger check']],
    ['🎨', 'Look', '#db2777', ['NCET ERP theme, light + dark', 'Ctrl+K screen search', 'Table ⇄ Cards on every list', 'Tablet and phone layouts']],
  ];
  cards.forEach(([e, t, col, lines], i) => {
    const x = (i % 3) * 412, y = Math.floor(i / 3) * 266 + 6;
    const t0 = 0.2 + i * 0.3;
    const rc = a.reveal(t0, C, { from: 'translateY(18px)' });
    const sh = a.anim(
      `0%,${pct(((t0 + 1.6) / C) * 100)}{transform:translateX(-160px)}${pct(((t0 + 2.8) / C) * 100)},100%{transform:translateX(520px)}`,
      C, { ease: 'ease-in-out' },
    );
    a.def(`<clipPath id="k${i}"><rect width="376" height="236" rx="18"/></clipPath>`);
    let s =
      `<g transform="translate(${x} ${y})"><g class="${rc}">` +
      `<rect class="card" width="376" height="236" rx="18"/>` +
      `<g clip-path="url(#k${i})"><rect class="${sh}" width="120" height="236" fill="url(#shine)"/></g>` +
      `<rect x="24" y="0" width="110" height="4" rx="2" fill="${col}"/>` +
      `<circle cx="50" cy="52" r="26" fill="${col}" fill-opacity=".14"/>` +
      `<g class="${a.bob(3 + i * 0.35, 4)}"><text x="50" y="61" text-anchor="middle" class="e" style="font-size:24px">${e}</text></g>` +
      `<text x="90" y="59" class="t" style="font-size:19px">${esc(t)}</text>`;
    lines.forEach((l, j) => {
      const r = a.reveal(t0 + 0.5 + j * 0.22, C, { from: 'translateX(-8px)' });
      s += `<g class="${r}"><circle cx="32" cy="${106 + j * 32}" r="4" fill="${col}"/><text x="46" y="${111 + j * 32}" class="p">${esc(l)}</text></g>`;
    });
    a.add(s + '</g></g>');
  });
  a.write('features.svg');
}

// ───────────────────────────── rules ─────────────────────────────
function rules() {
  const a = new Art(1200, 372, 'Twelve rules the system enforces, ticked off one by one');
  const C = 16;
  const items = [
    ['Server clock', ' dates every bill — no backdating'],
    ['Gapless bill numbers', ' per counter per year'],
    ['Saved once', ' — a double F10 returns the same bill'],
    ['Stock + ledger', ' change in one transaction'],
    ['Append-only', ' stock ledger and audit log'],
    ['Master price', ' at the counter; manager overrides logged'],
    ['UPI + card', ' can never exceed the bill'],
    ['Cancel, never delete', ' — reversing movements, same day'],
    ['One supplier invoice', ' can be entered only once'],
    ['5 wrong passwords', ' lock the username for 10 minutes'],
    ['Store keepers', ' need a manager to change stock'],
    ['Reprints', ' are stamped DUPLICATE n and logged'],
  ];
  items.forEach(([b, r], k) => {
    const x = k < 6 ? 0 : 609, y = 6 + (k % 6) * 60;
    const t0 = 0.2 + k * 0.32;
    const rv = a.reveal(t0, C, { from: 'translateX(-14px)' });
    const pp = a.pop(t0 + 0.3, C);
    a.add(
      `<g transform="translate(${x} ${y})"><g class="${rv}"><rect class="card" width="591" height="50" rx="14"/>` +
      `<circle cx="30" cy="25" r="15" fill="#16a34a" fill-opacity=".13"/>` +
      `<g class="${pp}"><circle cx="30" cy="25" r="11" fill="#16a34a"/><path d="M24.5 25.5l3.8 3.8 7.2-7.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<text x="56" y="30.5" class="p"><tspan class="pb">${esc(b)}</tspan>${esc(r)}</text></g></g>`,
    );
  });
  a.write('rules.svg');
}

// ───────────────────────────── payments ─────────────────────────────
function payments() {
  const a = new Art(1200, 300, 'Payments: UPI QR for the exact amount, split payments, money straight to the bank, one UTR backs one bill');
  const W = 250, gap = (1200 - 4 * W) / 3;
  const X = [0, 1, 2, 3].map((i) => i * (W + gap));
  const nodes = [
    ['F3 · UPI QR', "exact amount, store's UPI ID"],
    ['Split payments', 'cash + UPI + card, change shown'],
    ['Straight to the bank', 'no card or bank details stored'],
    ['One UTR → one bill', 'checked inside the save'],
  ];
  const hl = (i) =>
    a.anim(`0%,${pct(i * 25)}{stroke:#94a3b8;stroke-opacity:.35;stroke-width:1}${pct(i * 25 + 3)},${pct(i * 25 + 22)}{stroke:#3b82c4;stroke-opacity:1;stroke-width:2.5}${pct(i * 25 + 25)},100%{stroke:#94a3b8;stroke-opacity:.35;stroke-width:1}`, 8, { ease: 'ease-in-out' });
  nodes.forEach(([t, s], i) => {
    a.add(`<rect class="card ${hl(i)}" x="${X[i]}" y="20" width="${W}" height="190" rx="18"/>`,
      `<text x="${X[i] + W / 2}" y="158" text-anchor="middle" class="t">${esc(t)}</text>`,
      `<text x="${X[i] + W / 2}" y="182" text-anchor="middle" class="s">${esc(s)}</text>`);
  });
  // gaps: flowing dashes + coin
  for (let g = 0; g < 3; g++) {
    const x1 = X[g] + W + 6, x2 = X[g + 1] - 10;
    a.add(`<path class="${a.dash(0.9)}" d="M${x1} 95H${x2}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 6" fill="none"/>`,
      `<path d="M${x2 - 6} 89l7 6-7 6" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>`,
      `<g class="mv"><circle r="7" fill="#fbbf24" stroke="#b45309" stroke-width="1.5"><animateMotion dur="2s" begin="${g * 2}s" repeatCount="indefinite" path="M${x1} 95H${x2 - 8}"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.8;1" dur="2s" begin="${g * 2}s" repeatCount="indefinite"/></circle></g>`);
  }
  // node 1: QR
  {
    const cx = X[0] + W / 2, s = 7, n = 11, ox = cx - (n * s) / 2, oy = 40;
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const finder = (r, c) => r < 3 && c < 3 || r < 3 && c >= n - 3 || r >= n - 3 && c < 3;
    let q = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!finder(r, c) && rnd() > 0.5) q += `<rect x="${ox + c * s}" y="${oy + r * s}" width="${s}" height="${s}"/>`;
    const fd = (x, y) => `<rect x="${x + 1}" y="${y + 1}" width="${3 * s - 2}" height="${3 * s - 2}" fill="none" stroke-width="2" stroke="currentColor"/><rect x="${x + s}" y="${y + s}" width="${s}" height="${s}"/>`;
    const scan = a.anim(`0%,100%{transform:translateY(0)}50%{transform:translateY(${n * s - 2}px)}`, 2.2, { ease: 'ease-in-out' });
    a.add(`<rect x="${ox - 8}" y="${oy - 8}" width="${n * s + 16}" height="${n * s + 16}" rx="10" fill="#fff" stroke="#e2e8f0"/>`,
      `<g fill="#0c2339" color="#0c2339">${q}${fd(ox, oy)}${fd(ox + (n - 3) * s, oy)}${fd(ox, oy + (n - 3) * s)}</g>`,
      `<rect class="${scan}" x="${ox - 6}" y="${oy}" width="${n * s + 12}" height="2.5" rx="1" fill="#ef4444" opacity=".85"/>`);
  }
  // node 2: amount with mode chips
  {
    const cx = X[1] + W / 2;
    ['Cash', 'UPI', 'Card'].forEach((m, i) => {
      const on = a.anim(`0%,${pct(i * 33)}{fill-opacity:.12}${pct(i * 33 + 4)},${pct(i * 33 + 28)}{fill-opacity:1}${pct(i * 33 + 33)},100%{fill-opacity:.12}`, 4.5, { ease: 'ease-in-out' });
      const x = cx - 96 + i * 66;
      a.add(`<rect class="${on}" x="${x}" y="42" width="60" height="26" rx="13" fill="#0F4C81"/><text x="${x + 30}" y="60" text-anchor="middle" style="font:700 12px ${F}" fill="#4a9bd4">${m}</text>`);
    });
    a.add(`<g transform="translate(${cx} 114)"><g class="${a.bob(2.6, 3)}"><text text-anchor="middle" style="font:800 34px ${F}" fill="#2f74b5">₹265.00</text></g></g>`);
  }
  // node 3: bank with dropping coin
  {
    const cx = X[2] + W / 2;
    const drop = a.anim('0%{transform:translateY(-14px);opacity:0}25%{opacity:1}70%{transform:translateY(22px);opacity:1}85%,100%{transform:translateY(26px);opacity:0}', 2, { ease: 'ease-in' });
    a.add(`<g fill="#2f74b5"><path d="M${cx - 46} 70L${cx} 44L${cx + 46} 70Z"/>` +
      [0, 1, 2, 3].map((i) => `<rect x="${cx - 36 + i * 22}" y="76" width="9" height="34" rx="2"/>`).join('') +
      `<rect x="${cx - 50}" y="112" width="100" height="8" rx="3"/></g>`,
      `<g class="${drop}"><circle cx="${cx}" cy="34" r="9" fill="#fbbf24" stroke="#b45309" stroke-width="1.5"/><text x="${cx}" y="38.5" text-anchor="middle" style="font:800 11px ${F}" fill="#92400e">₹</text></g>`);
  }
  // node 4: UTR tag with lock
  {
    const cx = X[3] + W / 2;
    const ring = a.anim('0%{transform:scale(.9);opacity:.8}100%{transform:scale(1.25);opacity:0}', 2.2, { ease: 'ease-out', box: 'fill-box', origin: 'center' });
    a.add(`<rect class="${ring}" x="${cx - 92}" y="60" width="184" height="46" rx="12" fill="none" stroke="#16a34a" stroke-width="2"/>`,
      `<rect x="${cx - 92}" y="60" width="184" height="46" rx="12" fill="#16a34a" fill-opacity=".12" stroke="#16a34a"/>`,
      `<g fill="none" stroke="#16a34a" stroke-width="2.2"><rect x="${cx - 78}" y="80" width="18" height="15" rx="3" fill="#16a34a"/><path d="M${cx - 74} 80v-5a5 5 0 0 1 10 0v5"/></g>`,
      `<text x="${cx - 50}" y="89" style="font:700 15px ${MONO}" fill="#15803d">UTR ····1927</text>`);
    const no = a.anim('0%,45%{opacity:0;transform:translateY(6px)}52%,88%{opacity:1;transform:none}95%,100%{opacity:0}', 6);
    const shake = a.anim('0%,52%,60%,100%{transform:translateX(0)}54%{transform:translateX(-4px)}56%{transform:translateX(4px)}58%{transform:translateX(-3px)}', 6);
    a.add(`<g class="${no}"><g class="${shake}"><rect x="${cx - 118}" y="222" width="236" height="30" rx="15" fill="#e11d48" fill-opacity=".12" stroke="#e11d48"/>` +
      `<text x="${cx}" y="242" text-anchor="middle" style="font:700 13px ${F}" fill="#e11d48">C2 tries the same UTR ✕ refused</text></g></g>`);
  }
  a.add(`<text x="${(X[2] + W) / 2}" y="242" text-anchor="middle" class="s">Daily report lists every UPI and card transaction · collections always add up to net sales</text>`);
  a.write('payments.svg');
}

// ───────────────────────────── quick start terminal ─────────────────────────────
function terminal() {
  const a = new Art(1200, 400, 'Quick start in a terminal: npm install, migrate, build, seed, seed:demo, start');
  const C = 18, CW = 8.4;
  const steps = [
    ['npm install', '✓ workspace dependencies installed', '#3fb950'],
    ['npm run migrate', '✓ collections, partial indexes, id sequences', '#3fb950'],
    ['npm run build', '✓ API + web built, database client generated', '#3fb950'],
    ['npm run seed', '✓ admin · counters C1 C2 C3 OF · units', '#3fb950'],
    ['npm run seed:demo', '○ optional training catalogue', '#d29922'],
    ['npm start', '➜ http://<server-ip>:3000', '#58a6ff'],
  ];
  a.add(`<rect width="1200" height="400" rx="16" fill="#0d1117" stroke="#30363d"/>`,
    `<path d="M0 16a16 16 0 0 1 16-16h1168a16 16 0 0 1 16 16v26H0z" fill="#161b22"/>`,
    `<circle cx="24" cy="21" r="6" fill="#ff5f57"/><circle cx="44" cy="21" r="6" fill="#febc2e"/><circle cx="64" cy="21" r="6" fill="#28c840"/>`,
    `<text x="600" y="26" text-anchor="middle" style="font:600 13px ${F}" fill="#8b949e">PowerShell — NCET General store</text>`);
  let t = 0.4;
  steps.forEach(([cmd, out, col], i) => {
    const y = 84 + i * 46, d = cmd.length * 0.07;
    const cover = a.anim(
      `0%,${pct((t / C) * 100)}{transform:scaleX(1);animation-timing-function:steps(${cmd.length})}${pct(((t + d) / C) * 100)},96%{transform:scaleX(0)}100%{transform:scaleX(1)}`,
      C, { ease: 'linear', box: 'fill-box', origin: 'right center', base: 'transform:scaleX(0);' },
    );
    const pr = a.reveal(t - 0.2, C, { from: 'none', fade: 0.2, out: 0.96 });
    const ou = a.reveal(t + d + 0.5, C, { from: 'translateX(-8px)', fade: 0.4, out: 0.96 });
    a.add(`<g class="${pr}"><text x="28" y="${y}" style="font:700 15px ${MONO}" fill="#4a9bd4">PS&gt;</text></g>`,
      `<text x="74" y="${y}" style="font:600 15px ${MONO}" fill="#e6edf3">${esc(cmd)}</text>`,
      `<rect class="${cover}" x="72" y="${y - 18}" width="${Math.ceil(cmd.length * CW) + 6}" height="26" fill="#0d1117"/>`,
      `<g class="${ou}"><text x="430" y="${y}" style="font:600 15px ${MONO}" fill="${col}">${esc(out)}</text></g>`);
    t += d + 1.4;
  });
  const last = a.reveal(t - 0.6, C, { from: 'none', fade: 0.2, out: 0.96 });
  const blink = a.anim('50%{opacity:0}', 1, { ease: 'steps(1)' });
  a.add(`<g class="${last}"><text x="28" y="364" style="font:700 15px ${MONO}" fill="#4a9bd4">PS&gt;</text><rect class="${blink}" x="74" y="350" width="9" height="18" fill="#e6edf3"/></g>`);
  a.write('quickstart.svg');
}

// ───────────────────────────── counter PCs ─────────────────────────────
function counters() {
  const a = new Art(1200, 280, 'Four counter PCs each press F10 and their 80 mm printers print with no dialog');
  const C = 8;
  ['C1', 'C2', 'C3', 'OF'].forEach((name, i) => {
    const ox = 24 + i * 300, t0 = 0.3 + i * 1.3;
    const key = a.anim(`0%,${pct((t0 / C) * 100)}{fill:#ffffff;transform:scale(1)}${pct(((t0 + 0.15) / C) * 100)}{fill:#fbbf24;transform:scale(.9)}${pct(((t0 + 0.6) / C) * 100)},100%{fill:#ffffff;transform:scale(1)}`, C, { box: 'fill-box', origin: 'center' });
    const paper = a.anim(`0%,${pct(((t0 + 0.3) / C) * 100)}{transform:translateY(-70px)}${pct(((t0 + 1.6) / C) * 100)},88%{transform:translateY(0)}100%{transform:translateY(-70px)}`, C, { ease: 'steps(10)', base: 'transform:none;' });
    const led = a.anim(`0%,${pct(((t0 + 0.3) / C) * 100)}{fill:#475569}${pct(((t0 + 0.35) / C) * 100)},${pct(((t0 + 1.6) / C) * 100)}{fill:#22c55e}${pct(((t0 + 1.7) / C) * 100)},100%{fill:#475569}`, C, { ease: 'steps(1)' });
    a.def(`<clipPath id="pc${i}"><rect x="${ox + 70}" y="202" width="112" height="76"/></clipPath>`,
      `<linearGradient id="sg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F4C81"/><stop offset="1" stop-color="#4a9bd4"/></linearGradient>`);
    a.add(`<rect x="${ox}" y="10" width="252" height="150" rx="14" fill="#0c2339"/>`,
      `<rect x="${ox + 10}" y="20" width="232" height="130" rx="8" fill="url(#sg${i})"/>`,
      `<text x="${ox + 26}" y="58" style="font:800 30px ${F}" fill="#fff">${name}</text>`,
      `<text x="${ox + 26}" y="80" style="font:500 12px ${F}" fill="#cfe5f6">${name === 'OF' ? 'office' : 'counter ' + name[1]} · /billing</text>`,
      `<g fill="#fff" opacity=".25"><rect x="${ox + 26}" y="96" width="120" height="6" rx="3"/><rect x="${ox + 26}" y="108" width="90" height="6" rx="3"/><rect x="${ox + 26}" y="120" width="104" height="6" rx="3"/></g>`,
      `<rect class="${key}" x="${ox + 172}" y="104" width="56" height="34" rx="8"/>`,
      `<text x="${ox + 200}" y="126" text-anchor="middle" style="font:800 14px ${F}" fill="#0F4C81">F10</text>`,
      `<rect x="${ox + 112}" y="160" width="28" height="12" fill="#334155"/><rect x="${ox + 86}" y="170" width="80" height="6" rx="3" fill="#334155"/>`,
      `<rect x="${ox + 56}" y="182" width="140" height="24" rx="8" fill="#334155"/><rect x="${ox + 70}" y="198" width="112" height="4" rx="2" fill="#0f172a"/>`,
      `<circle class="${led}" cx="${ox + 184}" cy="190" r="3.5"/>`,
      `<g clip-path="url(#pc${i})"><g class="${paper}"><rect x="${ox + 76}" y="202" width="100" height="70" fill="#fff" stroke="#e2e8f0"/>` +
      `<g fill="#94a3b8"><rect x="${ox + 86}" y="212" width="60" height="4" rx="2"/><rect x="${ox + 86}" y="222" width="80" height="3" rx="1.5"/><rect x="${ox + 86}" y="230" width="72" height="3" rx="1.5"/></g>` +
      `<rect x="${ox + 86}" y="242" width="80" height="6" rx="2" fill="#0c2339"/><g fill="#0c2339">${[0, 4, 7, 12, 15, 20, 24, 27, 32, 36, 40, 45, 49, 54, 58, 62, 67, 71, 75].map((d) => `<rect x="${ox + 88 + d}" y="254" width="2" height="12"/>`).join('')}</g></g></g>`);
  });
  a.write('counters.svg');
}

// ───────────────────────────── PostgreSQL → MongoDB map ─────────────────────────────
function mongoMap() {
  const a = new Art(1200, 512, 'Where each PostgreSQL guarantee lives in the MongoDB edition');
  const C = 16;
  const rows = [
    ['SERIAL / auto-increment ids', 'atomic _seq counters — same numeric ids'],
    ['NUMERIC(12,2) money', 'Decimal maths, stored rounded to 4 dp'],
    ['SELECT … FOR UPDATE locks', 'per-item queue + retried transactions'],
    ['triggers: ledger append-only', 'client refuses update / delete'],
    ['partial unique indexes', 'MongoDB partial unique indexes'],
    ['INSERT … ON CONFLICT counter', 'upsert + $inc inside the bill (gapless)'],
    ['SQL aggregate reports', 'groupBy + $group pipelines, Decimal totals'],
    ['NULL columns', 'explicit null on every write'],
  ];
  const chip = (x, label, fill) =>
    `<rect x="${x}" y="8" width="470" height="44" rx="22" fill="${fill}"/><text x="${x + 235}" y="36" text-anchor="middle" style="font:800 16px ${F}" fill="#fff">${label}</text>`;
  a.add(chip(0, '🐘  PostgreSQL edition', '#336791'), chip(730, '🍃  MongoDB edition', '#00684A'),
    `<g transform="translate(600 30)"><g class="${a.bob(2, 3)}"><text text-anchor="middle" y="7" style="font:800 22px ${F}" fill="#94a3b8">→</text></g></g>`);
  rows.forEach(([l, r], i) => {
    const y = 76 + i * 54, t0 = 0.3 + i * 0.6;
    const L = a.reveal(t0, C, { from: 'translateX(-16px)' });
    const A = a.grow(t0 + 0.3, 0.5, C);
    const R = a.reveal(t0 + 0.7, C, { from: 'translateX(16px)' });
    a.add(`<g class="${L}"><rect class="card" x="0" y="${y}" width="470" height="44" rx="12"/><circle cx="22" cy="${y + 22}" r="5" fill="#336791"/><text x="38" y="${y + 27}" class="p">${esc(l)}</text></g>`,
      `<g class="${A}"><path class="${a.dash(0.8)}" d="M482 ${y + 22}H710" stroke="#13aa52" stroke-width="2" stroke-dasharray="5 5" fill="none"/><path d="M704 ${y + 16}l8 6-8 6" fill="none" stroke="#13aa52" stroke-width="2" stroke-linecap="round"/></g>`,
      `<g class="${R}"><rect class="card" x="730" y="${y}" width="470" height="44" rx="12"/><rect x="730" y="${y + 10}" width="4" height="24" rx="2" fill="#13aa52"/><circle cx="752" cy="${y + 22}" r="5" fill="#13aa52"/><text x="768" y="${y + 27}" class="p">${esc(r)}</text></g>`);
  });
  a.write('mongo-map.svg');
}

// ───────────────────────────── data move ─────────────────────────────
function migrate() {
  const a = new Art(1200, 290, 'Copying the PostgreSQL edition into MongoDB: batches of 200, every row count checked');
  const C = 10;
  const cyl = (x, top, side, label, sub) =>
    `<path d="M${x} 70v110a90 22 0 0 0 180 0V70" fill="${side}"/><ellipse cx="${x + 90}" cy="70" rx="90" ry="22" fill="${top}"/>` +
    `<path d="M${x} 110a90 22 0 0 0 180 0M${x} 145a90 22 0 0 0 180 0" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>` +
    `<text x="${x + 90}" y="232" text-anchor="middle" class="t">${label}</text><text x="${x + 90}" y="254" text-anchor="middle" class="s">${sub}</text>`;
  a.add(cyl(20, '#4f7fb0', '#336791', 'PostgreSQL', 'old edition · 29 tables'), cyl(1000, '#22c55e', '#00684A', 'MongoDB Atlas', 'ncet_store · 29 collections'));
  a.add(`<path class="${a.dash(1.2)}" d="M220 125H990" stroke="#94a3b8" stroke-width="2" stroke-dasharray="3 9" fill="none"/>`);
  for (let k = 0; k < 6; k++) {
    a.add(`<g class="mv"><g><rect x="-16" y="-20" width="32" height="40" rx="5" fill="#fff" stroke="#0F4C81" stroke-width="1.5"/><path d="M-9 -9h18M-9 -2h18M-9 5h12" stroke="#94a3b8" stroke-width="2"/>` +
      `<animateMotion dur="3s" begin="${k * 0.5}s" repeatCount="indefinite" path="M240 125H970"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.88;1" dur="3s" begin="${k * 0.5}s" repeatCount="indefinite"/></g></g>`);
  }
  const labels = ['batches of 200', 'retries dropped links', 'stops on any rejected doc'];
  labels.forEach((l, i) => {
    const x = 330 + i * 270;
    a.add(`<g class="${a.reveal(0.3 + i * 0.5, C)}"><rect x="${x - 95}" y="30" width="190" height="30" rx="15" fill="#0F4C81" fill-opacity=".12" stroke="#0F4C81" stroke-opacity=".35"/><text x="${x}" y="50" text-anchor="middle" style="font:700 13px ${F}" fill="#3b82c4">${l}</text></g>`);
  });
  a.add(`<rect class="trk" x="300" y="196" width="600" height="12" rx="6"/>`,
    `<rect class="${a.grow(0.5, 6, C)}" x="300" y="196" width="600" height="12" rx="6" fill="#13aa52"/>`,
    `<g class="${a.reveal(6.6, C)}"><text x="600" y="244" text-anchor="middle" style="font:800 18px ${F}" fill="#16a34a">✓ 4,633 rows · every count matched · ledger check 0</text></g>`);
  a.write('migrate.svg');
}

// ───────────────────────────── tests ─────────────────────────────
function tests() {
  const a = new Art(1200, 320, 'Test results on MongoDB Atlas: unit 15/15, smoke 155/155, browser 47/47, rush 12/13, stock check 0 differences');
  const C = 10;
  const rows = [
    ['npm test', 'bill maths, rounding, ₹1 gate, IST dates', 1, '15 / 15', '#16a34a'],
    ['npm run smoke', 'every API flow, role and report format', 1, '155 / 155', '#16a34a'],
    ['node scripts/e2e-ui.mjs', 'a real browser, keyboard-only billing', 1, '47 / 47', '#16a34a'],
    ['npm run rush', '4 counters, same items, double presses', 12 / 13, '12 / 13 · p95 2.8 s', '#d97706'],
    ['npm run check:stock', 'cached stock = ledger, every item', 1, '0 differences', '#16a34a'],
  ];
  rows.forEach(([cmd, desc, f, res, col], i) => {
    const y = 6 + i * 62, t0 = 0.3 + i * 0.4;
    a.add(`<g transform="translate(0 ${y})"><g class="${a.reveal(t0, C)}">` +
      `<rect class="card" width="1200" height="52" rx="14"/>` +
      `<text x="24" y="32" class="m" fill="#3b82c4">${esc(cmd)}</text>` +
      `<text x="250" y="32" class="p">${esc(desc)}</text>` +
      `<rect class="trk" x="610" y="21" width="380" height="10" rx="5"/>` +
      `<rect class="${a.grow(t0 + 0.4, 1.4, C)}" x="610" y="21" width="${Math.round(380 * f)}" height="10" rx="5" fill="${col}"/>` +
      `<g class="${a.pop(t0 + 1.8, C)}"><rect x="1010" y="11" width="170" height="30" rx="15" fill="${col}" fill-opacity=".14" stroke="${col}"/>` +
      `<text x="1095" y="31" text-anchor="middle" style="font:800 13px ${F}" fill="${col}">${f === 1 ? '✓ ' : '⚠ '}${esc(res)}</text></g>` +
      `</g></g>`);
  });
  a.write('tests.svg');
}

// ───────────────────────────── trade-offs ─────────────────────────────
function tradeoffs() {
  const a = new Art(1200, 250, 'Trade-offs: billing needs the internet, about 2.8 s bill saves at rush, backups must be planned');
  const cards = [
    ['#d97706', 'Billing needs the internet', ['Atlas is in the cloud: a campus outage', 'stops the counters. A replica set on the', 'store server fixes it — same code.']],
    ['#0F4C81', '≈ 2.8 s save at rush (p95)', ['15–20 round trips to Atlas per bill,', '31–218 ms each. The 300 ms target', 'assumed a local database.']],
    ['#e11d48', 'Backups are on you', ['ops/backup.sh is PostgreSQL-only.', 'Free M0 clusters have no backups —', 'schedule a mongodump of ncet_store.']],
  ];
  cards.forEach(([col, t, lines], i) => {
    const x = i * 412;
    let icon = '';
    if (i === 0) {
      icon = [0, 1, 2].map((k) => {
        const c = a.anim(`0%,${pct(k * 20)}{opacity:.15}${pct(k * 20 + 10)},70%{opacity:1}85%,100%{opacity:.15}`, 2.4, { ease: 'ease-in-out' });
        const r = 10 + k * 10;
        return `<path class="${c}" d="M${48 - r} ${58 - r * 0.2}a${r} ${r} 0 0 1 ${2 * r} 0" transform="rotate(0)" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`;
      }).join('') + `<circle cx="48" cy="62" r="4" fill="${col}"/>` +
        `<g class="${a.anim('0%,60%{opacity:0}70%,95%{opacity:1}100%{opacity:0}', 4.8)}"><line x1="22" y1="70" x2="74" y2="24" stroke="#e11d48" stroke-width="4" stroke-linecap="round"/></g>`;
    } else if (i === 1) {
      icon = `<circle cx="48" cy="48" r="26" fill="none" stroke="${col}" stroke-width="4"/><rect x="42" y="14" width="12" height="6" rx="2" fill="${col}"/>` +
        `<g class="${a.anim('to{transform:rotate(360deg)}', 2.8, { ease: 'linear', origin: '48px 48px' })}"><line x1="48" y1="48" x2="48" y2="30" stroke="${col}" stroke-width="4" stroke-linecap="round"/></g><circle cx="48" cy="48" r="4" fill="${col}"/>`;
    } else {
      icon = `<ellipse cx="48" cy="30" rx="24" ry="8" fill="${col}"/><path d="M24 30v34a24 8 0 0 0 48 0V30" fill="${col}" fill-opacity=".75"/><path d="M24 47a24 8 0 0 0 48 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>` +
        `<g class="${a.anim('to{transform:rotate(360deg)}', 3, { ease: 'linear', origin: '78px 62px' })}"><path d="M68 62a10 10 0 1 1 10 10" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><path d="M78 67l0 5 5 0" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/></g>`;
    }
    const glow = a.anim(`0%,100%{stroke-opacity:.25}50%{stroke-opacity:1}`, 3, { ease: 'ease-in-out', delay: i });
    a.add(`<g transform="translate(${x} 6)"><g class="${a.reveal(0.2 + i * 0.35, 12)}">` +
      `<rect class="card" width="376" height="236" rx="18"/><rect class="${glow}" x="1" y="1" width="374" height="234" rx="17" fill="none" stroke="${col}" stroke-width="2"/>` +
      `<g transform="translate(14 8)">${icon}</g>` +
      `<text x="24" y="128" class="t" style="font-size:19px">${esc(t)}</text>` +
      lines.map((l, j) => `<text x="24" y="${160 + j * 24}" class="s" style="font-size:14px">${esc(l)}</text>`).join('') +
      `</g></g>`);
  });
  a.write('tradeoffs.svg');
}

// ───────────────────────────── layout tree ─────────────────────────────
function layout() {
  const a = new Art(1200, 360, 'Repository layout: apps/api, apps/web, docs/readme, ops, scripts');
  const C = 14;
  const rows = [
    [0, '📁', 'apps/api', 'NestJS + Prisma (MongoDB) · sales, purchase, stock, reports, auth'],
    [1, '📂', 'src/prisma', 'client rules: ids, append-only, nulls · partial indexes'],
    [1, '📂', 'src/common', 'money, stock ledger, bill numbers, keyed locks'],
    [1, '📂', 'prisma/postgres-legacy', 'old SQL schema + migrations'],
    [0, '📁', 'apps/web', 'React 19 + Vite + Tailwind · NCET ERP theme'],
    [0, '📁', 'docs/readme', 'these animated pictures · node docs/readme/build.mjs'],
    [0, '📁', 'ops', 'PostgreSQL-edition docker-compose + backup script'],
    [0, '📁', 'scripts', 'smoke-test, rush-test, e2e-ui'],
  ];
  a.add(`<rect class="card" width="1200" height="360" rx="18"/>`);
  rows.forEach(([lvl, e, name, desc], i) => {
    const y = 40 + i * 40, x = 32 + lvl * 40, t0 = 0.3 + i * 0.45;
    if (lvl) {
      const draw = a.anim(`0%,${pct(((t0 - 0.2) / C) * 100)}{stroke-dashoffset:1}${pct(((t0 + 0.3) / C) * 100)},94%{stroke-dashoffset:0}100%{stroke-dashoffset:1}`, C, { base: 'stroke-dashoffset:0;' });
      a.add(`<path class="${draw}" d="M44 ${y - 26}V${y - 6}H${x - 6}" pathLength="1" stroke-dasharray="1" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`);
    }
    a.add(`<g class="${a.reveal(t0, C, { from: 'translateX(-10px)' })}"><text x="${x}" y="${y}" class="e" style="font-size:17px">${e}</text>` +
      `<text x="${x + 28}" y="${y}" class="m" fill="#3b82c4">${esc(name)}</text>` +
      `<text x="${470}" y="${y}" class="p">${esc(desc)}</text></g>`);
  });
  a.write('layout.svg');
}

// ───────────────────────────── Link-Zee cutover ─────────────────────────────
function linkzee() {
  const a = new Art(1200, 230, 'Moving from Link-Zee in five steps');
  const C = 12;
  const steps = [
    ['Copy the .mdb,', 'export the Item Master'],
    ['Fix spellings, merge', 'duplicates, keep codes'],
    ['Import Excel —', 'all rows or none'],
    ['Count the shelves,', 'upload on cutover day'],
    ['Run both for a week,', 'then switch off Link-Zee'],
  ];
  const X = (i) => 120 + i * 240;
  a.add(`<rect class="trk" x="120" y="66" width="960" height="6" rx="3"/>`,
    `<rect class="${a.grow(0.4, 7.6, C, { out: 0.92 })}" x="120" y="66" width="960" height="6" rx="3" fill="#13aa52"/>`);
  steps.forEach(([l1, l2], i) => {
    const t = 0.4 + (i / 4) * 7.6;
    a.add(`<circle class="card" cx="${X(i)}" cy="69" r="28" stroke-width="2"/>`,
      `<g class="${a.pop(t, C, { out: 0.92 })}"><circle cx="${X(i)}" cy="69" r="28" fill="#13aa52"/></g>`,
      `<text x="${X(i)}" y="76" text-anchor="middle" style="font:800 20px ${F}" fill="#94a3b8">${i + 1}</text>`,
      `<g class="${a.reveal(t, C, { out: 0.92 })}"><text x="${X(i)}" y="76" text-anchor="middle" style="font:800 20px ${F}" fill="#fff">${i === 4 ? '✓' : i + 1}</text></g>`,
      `<text x="${X(i)}" y="132" text-anchor="middle" class="p" style="font-weight:700">${esc(l1)}</text>`,
      `<text x="${X(i)}" y="154" text-anchor="middle" class="p">${esc(l2)}</text>`);
  });
  a.add(`<g class="${a.reveal(8.3, C, { out: 0.92 })}"><text x="600" y="206" text-anchor="middle" style="font:800 16px ${F}" fill="#16a34a">Daily totals match → Link-Zee retired 🎉</text></g>`);
  a.write('linkzee.svg');
}

// ───────────────────────────── divider + footer ─────────────────────────────
const WAVE_A = 'M0 12 Q 150 2 300 12 T 600 12 T 900 12 T 1200 12';
const WAVE_B = 'M0 12 Q 150 22 300 12 T 600 12 T 900 12 T 1200 12';
function divider() {
  const a = new Art(1200, 24, 'divider');
  a.def(`<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0F4C81" stop-opacity="0"/><stop offset=".5" stop-color="#4a9bd4"/><stop offset="1" stop-color="#0F4C81" stop-opacity="0"/></linearGradient>`);
  a.add(`<path d="${WAVE_A}" fill="none" stroke="url(#g)" stroke-width="2.5"><animate class="mv" attributeName="d" values="${WAVE_A};${WAVE_B};${WAVE_A}" dur="6s" repeatCount="indefinite"/></path>`,
    `<g class="mv"><circle r="3.5" fill="#4a9bd4"><animateMotion dur="6s" repeatCount="indefinite" path="M0 12H1200"/><animate attributeName="opacity" values="0;1;1;0" dur="6s" repeatCount="indefinite"/></circle></g>`);
  a.write('divider.svg');
}
function footer() {
  const a = new Art(1200, 150, 'Built for the General Store at Nagarjuna College of Engineering and Technology');
  a.def(`<linearGradient id="w1" x1="0" x2="1"><stop offset="0" stop-color="#0F4C81"/><stop offset="1" stop-color="#4a9bd4"/></linearGradient>`);
  const w = (y, amp, ph) => {
    const p = (o) => `M0 ${y} C 200 ${y - amp * o} 400 ${y + amp * o} 600 ${y} S 1000 ${y - amp * o} 1200 ${y} V150 H0Z`;
    return `<path d="${p(1)}" fill="url(#w1)" opacity="${ph}"><animate attributeName="d" values="${p(1)};${p(-1)};${p(1)}" dur="${7 + ph * 6}s" repeatCount="indefinite"/></path>`;
  };
  a.add(w(96, 14, 0.25), w(110, 10, 0.45), w(124, 8, 1),
    `<g transform="translate(600 40)"><g class="${a.bob(2.4, 3)}"><text text-anchor="middle" class="e" style="font-size:26px">🏪</text></g></g>`,
    `<text x="600" y="76" text-anchor="middle" class="t" style="font-size:16px">Built for the General Store at Nagarjuna College of Engineering &amp; Technology</text>`,
    `<text x="600" y="142" text-anchor="middle" style="font:600 12px ${F}" fill="#fff" fill-opacity=".85">NestJS · Prisma · MongoDB Atlas · React 19 · Vite · Tailwind</text>`);
  a.write('footer.svg');
}

// ───────────────────────────── build ─────────────────────────────
const H = [
  ['h-features.svg', '01', '✨', "What's inside", 'Six modules in one browser tab', ACC.blue],
  ['h-how.svg', '02', '🔄', 'How it works', 'Scan → pay → F10 → one transaction → receipt', ACC.sky],
  ['h-rules.svg', '03', '📜', 'Rules the system enforces', 'Checked on the server — no workarounds', ACC.indigo],
  ['h-payments.svg', '04', '💳', 'Payments', 'UPI and card, kept honest', ACC.amber],
  ['h-quickstart.svg', '05', '🚀', 'Quick start', 'From an empty folder to the first bill', ACC.teal],
  ['h-counters.svg', '06', '🖨️', 'Counter PCs', 'Silent 80 mm printing on every counter', ACC.slate],
  ['h-mongo.svg', '07', '🍃', 'The MongoDB edition', 'Every PostgreSQL guarantee, rebuilt', ACC.green],
  ['h-moving-data.svg', '08', '📦', 'Moving data', 'From the PostgreSQL edition, row for row', ACC.violet],
  ['h-tests.svg', '09', '🧪', 'Tests', 'Run on MongoDB Atlas · 25-11-2026', ACC.green],
  ['h-tradeoffs.svg', '10', '⚖️', 'Honest trade-offs', 'What the cloud costs us', ACC.rose],
  ['h-layout.svg', '11', '🗂️', 'Layout', 'Where things live', ACC.blue],
  ['h-linkzee.svg', '12', '🔁', 'Moving from Link-Zee', 'Blueprint § 21 cutover in five steps', ACC.teal],
];
H.forEach((h) => header(...h));
features(); rules(); payments(); terminal(); counters(); mongoMap(); migrate(); tests(); tradeoffs(); layout(); linkzee(); divider(); footer();

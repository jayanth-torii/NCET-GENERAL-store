/**
 * Product illustrations for the landing animation. Every store item gets drawn packaging chosen from its
 * name (or category), with the item's own name printed on it. Well-known products get their familiar
 * pack colours (Dairy Milk purple, Good Day orange, Hide & Seek dark brown...). These are plain SVG
 * illustrations: no brand logos or artwork are copied.
 */
export type Kind =
  | 'lollipop'
  | 'toffee'
  | 'chocolate'
  | 'biscuit'
  | 'packet'
  | 'drink'
  | 'bottle'
  | 'calculator'
  | 'eraser'
  | 'sharpener'
  | 'pencil'
  | 'marker'
  | 'pen'
  | 'record'
  | 'bluebook'
  | 'notebook'
  | 'sticky'
  | 'stapler'
  | 'cover'
  | 'paper'
  | 'ruler'
  | 'geometry'
  | 'bandage'
  | 'tablet'
  | 'balm'
  | 'glue'
  | 'box';

const RULES: [RegExp, Kind][] = [
  [/lolli|lollypop/, 'lollipop'],
  [/eclair|melody|toffee|candy|alpenliebe|mango ?bite|pulse|kismi/, 'toffee'],
  [/choc|5 ?star|dairy ?milk|silk|kit ?kat|munch|perk|gems|\bbar\b|wafer|fuse/, 'chocolate'],
  [/biscuit|cookie|parle|marie|oreo|bourbon|good ?day|hide ?(&|and|n)? ?seek|monaco|cracker|bounce|treat/, 'biscuit'],
  [/chips|lays|kurkure|snack|namkeen|puff|mixture|bhujia|bingo|mad angles/, 'packet'],
  [/frooti|maaza|slice|juice|tetra/, 'drink'],
  [/water|drink|cola|bottle|soda|sprite|pepsi/, 'bottle'],
  [/calc/, 'calculator'],
  [/eraser|rubber/, 'eraser'],
  [/sharp/, 'sharpener'],
  [/pencil|apsara|nataraj/, 'pencil'],
  [/marker|highlight|sketch|whitener|correction/, 'marker'],
  [/\bpens?\b|ball ?pen|gel|reynolds|cello|linc|hauser|refill|ink/, 'pen'],
  [/record|observation/, 'record'],
  [/blue ?book|answer|exam|autonom|bluebook/, 'bluebook'],
  [/sticky|post ?it/, 'sticky'],
  [/stapler|staple|pins/, 'stapler'],
  [/note ?book|long ?book|\bbook|diary|register|classmate/, 'notebook'],
  [/cover|file|folder|envelope/, 'cover'],
  [/\ba[2345]\b|sheet|paper|ream|chart|bond|graph/, 'paper'],
  [/scale|ruler/, 'ruler'],
  [/geometry|compass|protractor|instrument/, 'geometry'],
  [/band ?aid|bandage|plaster/, 'bandage'],
  [/tablet|\btab\b|capsule|paracetamol|dolo|crocin|strip|medicine|syrup|cetrizine|ors/, 'tablet'],
  [/balm|amrut|vicks|ointment|cream|zandu/, 'balm'],
  [/glue|\bgum\b|fevi|stick/, 'glue'],
];

const CATEGORY_RULES: [RegExp, Kind][] = [
  [/snack|food|chocolate/, 'packet'],
  [/medic|pharma|health/, 'tablet'],
  [/record/, 'record'],
  [/exam|autonom/, 'bluebook'],
  [/paper|copier/, 'paper'],
  [/station/, 'pen'],
];

export function kindOf(name: string, category: string): Kind {
  const n = name.toLowerCase();
  for (const [re, k] of RULES) if (re.test(n)) return k;
  const c = category.toLowerCase();
  for (const [re, k] of CATEGORY_RULES) if (re.test(c)) return k;
  return 'box';
}

/** Familiar pack colours for well-known products: [main, dark, text, accent]. */
type Style = { c1: string; c2: string; text: string; accent: string; cookie?: 'chip' | 'cashew' | 'plain' | 'sandwich' | 'cracker' };
const BRANDS: [RegExp, Style][] = [
  [/dairy ?milk|silk/, { c1: '#4A1D7A', c2: '#2C0D52', text: '#FFFFFF', accent: '#E9DDF7' }],
  [/5 ?star/, { c1: '#F2B705', c2: '#C98F00', text: '#6B1E00', accent: '#7A3B12' }],
  [/kit ?kat/, { c1: '#D0021B', c2: '#99001A', text: '#FFFFFF', accent: '#FFFFFF' }],
  [/munch/, { c1: '#FFD000', c2: '#E0A800', text: '#C8102E', accent: '#C8102E' }],
  [/perk/, { c1: '#FFD200', c2: '#E5B400', text: '#5A2D82', accent: '#5A2D82' }],
  [/gems/, { c1: '#6A2C91', c2: '#4A1D70', text: '#FFE14D', accent: '#FFE14D' }],
  [/fuse/, { c1: '#E2A400', c2: '#9A5B00', text: '#3B1A00', accent: '#3B1A00' }],
  [/good ?day/, { c1: '#F28C1E', c2: '#D46A08', text: '#5A2108', accent: '#FFD34D', cookie: 'cashew' }],
  [/hide ?(&|and|n)? ?seek/, { c1: '#2B1A12', c2: '#160C07', text: '#FFFFFF', accent: '#2E64C8', cookie: 'chip' }],
  [/parle/, { c1: '#F7D33A', c2: '#E8B400', text: '#D7261E', accent: '#FFFFFF', cookie: 'plain' }],
  [/bourbon/, { c1: '#5A2A14', c2: '#3A1709', text: '#F7E3C3', accent: '#C08A4A', cookie: 'sandwich' }],
  [/oreo/, { c1: '#0B3B9E', c2: '#062A75', text: '#FFFFFF', accent: '#FFFFFF', cookie: 'sandwich' }],
  [/marie/, { c1: '#C8102E', c2: '#8A0B1F', text: '#FFFFFF', accent: '#F7D9A0', cookie: 'plain' }],
  [/monaco|cracker/, { c1: '#E1251B', c2: '#A3170F', text: '#FFFFFF', accent: '#FFD34D', cookie: 'cracker' }],
  [/lays.*(masala|magic)/, { c1: '#1E4DA1', c2: '#12357A', text: '#FFFFFF', accent: '#FFD400' }],
  [/lays/, { c1: '#FFD400', c2: '#E8B800', text: '#C8102E', accent: '#C8102E' }],
  [/kurkure/, { c1: '#F37021', c2: '#C9520E', text: '#FFFFFF', accent: '#2DA44E' }],
  [/bingo|mad angles/, { c1: '#E6007E', c2: '#A3005A', text: '#FFFFFF', accent: '#FFE14D' }],
  [/frooti/, { c1: '#2EA043', c2: '#1F7A31', text: '#FFFFFF', accent: '#FFC21A' }],
  [/maaza/, { c1: '#F5A300', c2: '#C77D00', text: '#7A1E00', accent: '#2EA043' }],
  [/reynolds/, { c1: '#FFFFFF', c2: '#1E4DA1', text: '#1E4DA1', accent: '#1E4DA1' }],
  [/cello/, { c1: '#BFD9F2', c2: '#1E4DA1', text: '#0E2455', accent: '#1E4DA1' }],
  [/linc/, { c1: '#202020', c2: '#1E4DA1', text: '#FFFFFF', accent: '#1E4DA1' }],
  [/classmate/, { c1: '#1E73BE', c2: '#0E4A86', text: '#FFFFFF', accent: '#F6C343' }],
];

function brand(name: string): Style | null {
  const n = name.toLowerCase();
  for (const [re, s] of BRANDS) if (re.test(n)) return s;
  return null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Label for the pack: the product name, without a trailing price like "Rs10". */
function label(name: string, max = 18): string {
  const t = name
    .replace(/\s+/g, ' ')
    .replace(/\s*(rs\.?|₹)\s*\d+(\.\d+)?\s*$/i, '')
    .trim()
    .toUpperCase();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Price shown as a small flash on the pack, if the name ends with one. */
function priceFlash(name: string): string | null {
  const m = /(?:rs\.?|₹)\s*(\d+)\s*$/i.exec(name.trim());
  return m ? `₹${m[1]}` : null;
}

const FONT = `font-family="Segoe UI, Arial, Helvetica, sans-serif" font-weight="800"`;
const SCRIPT = `font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700"`;

function text(x: number, y: number, w: number, size: number, s: string, fill: string, extra = '', font = FONT) {
  const approx = s.length * size * 0.62;
  const fit = approx > w ? ` textLength="${w}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" ${font} fill="${fill}" text-anchor="middle"${fit} ${extra}>${esc(s)}</text>`;
}

function flash(x: number, y: number, p: string | null) {
  if (!p) return '';
  return `<g><circle cx="${x}" cy="${y}" r="15" fill="#FFE14D" stroke="#C8102E" stroke-width="2"/>${text(x, y + 4, 22, 10, p, '#C8102E')}</g>`;
}

const PALETTES = [
  ['#5B2A86', '#3B1360', '#F6C343'],
  ['#E2A800', '#A87400', '#5B2A00'],
  ['#C8102E', '#8A0B1F', '#FFFFFF'],
  ['#6B3A1E', '#3F1E0C', '#F6C343'],
  ['#1E4DA1', '#0E2455', '#FFFFFF'],
  ['#0F8A4B', '#08592F', '#FFFFFF'],
  ['#F6872A', '#C75D0C', '#0E2455'],
];
const pal = (name: string, hv: number, off = 0): Style => {
  const b = brand(name);
  if (b) return b;
  const [c1, c2, t] = PALETTES[(hv + off) % PALETTES.length];
  return { c1, c2, text: t, accent: t };
};

const shadow = (id: string) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity="0.35"/></filter>`;
const shine = (id: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>`;
const grad = (id: string, a: string, b: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

function crimp(x: number, y: number, h: number, dir: 1 | -1, teeth = 7) {
  const step = h / teeth;
  let d = '';
  for (let i = 0; i <= teeth; i++) d += `${x + (i % 2 ? 6 * dir : 0)},${y + i * step} `;
  return d;
}

function svg(w: number, h: number, body: string, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
}

/** A small stack of biscuits in the style of the brand. */
function cookies(x: number, y: number, kind: Style['cookie'] = 'plain') {
  let out = '';
  for (let i = 0; i < 3; i++) {
    const cx = x + i * 16;
    const cy = y - i * 5;
    if (kind === 'sandwich') {
      out += `<rect x="${cx - 20}" y="${cy - 14}" width="40" height="9" rx="4" fill="#3B1E10"/><rect x="${cx - 19}" y="${cy - 6}" width="38" height="5" rx="2" fill="#F6E7D0"/><rect x="${cx - 20}" y="${cy - 2}" width="40" height="9" rx="4" fill="#3B1E10"/>`;
    } else if (kind === 'cracker') {
      out += `<rect x="${cx - 18}" y="${cy - 16}" width="36" height="30" rx="3" fill="#E7B66A" stroke="#C48A3A"/><circle cx="${cx - 8}" cy="${cy - 6}" r="1.6" fill="#C48A3A"/><circle cx="${cx + 8}" cy="${cy + 4}" r="1.6" fill="#C48A3A"/><circle cx="${cx}" cy="${cy - 1}" r="1.6" fill="#fff"/>`;
    } else {
      const base = kind === 'chip' ? '#C98A4B' : '#E2AE62';
      out += `<circle cx="${cx}" cy="${cy}" r="20" fill="${base}" stroke="#A86F2E" stroke-width="2"/>`;
      if (kind === 'chip') out += [[-7, -6], [6, -3], [-2, 6], [8, 8], [-9, 5]].map(([a, b]) => `<ellipse cx="${cx + a}" cy="${cy + b}" rx="3" ry="2.4" fill="#3A1A0C"/>`).join('');
      else if (kind === 'cashew') out += [[-6, -5], [6, 2], [-3, 7]].map(([a, b]) => `<path d="M${cx + a - 4} ${cy + b} q4 -6 8 0" stroke="#F6E2B5" stroke-width="3" fill="none" stroke-linecap="round"/>`).join('');
      else out += [[-6, -6], [6, -6], [0, 0], [-6, 6], [6, 6]].map(([a, b]) => `<circle cx="${cx + a}" cy="${cy + b}" r="1.6" fill="#A86F2E"/>`).join('');
    }
  }
  return out;
}

type Draw = (name: string, h: number) => { svg: string; w: number; h: number };

const draw: Record<Kind, Draw> = {
  lollipop: (name, hv) => {
    const s = pal(name, hv, 2);
    const w = 120;
    const h = 200;
    const body = `<g filter="url(#s)"><rect x="56" y="104" width="8" height="90" rx="4" fill="#F4F1EA" stroke="#D6D0C4"/>
      <polygon points="46,98 74,98 82,112 38,112" fill="${s.c2}"/>
      <circle cx="60" cy="58" r="46" fill="url(#g)"/><circle cx="60" cy="58" r="46" fill="url(#sh)"/>
      <path d="M28 40 q32 -26 64 0" stroke="#fff" stroke-width="4" fill="none" opacity="0.45" stroke-linecap="round"/>
      ${text(60, 62, 76, 13, label(name, 12), s.text)}${text(60, 78, 60, 9, 'LOLLIPOP', s.accent)}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  toffee: (name, hv) => {
    const s = pal(name, hv, 4);
    const w = 170;
    const h = 80;
    const body = `<g filter="url(#s)"><polygon points="10,18 46,32 46,48 10,62 18,40" fill="${s.c2}"/><polygon points="160,18 124,32 124,48 160,62 152,40" fill="${s.c2}"/>
      <ellipse cx="85" cy="40" rx="46" ry="26" fill="url(#g)"/><ellipse cx="85" cy="40" rx="46" ry="26" fill="url(#sh)"/>${text(85, 45, 74, 13, label(name, 10), s.text)}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  chocolate: (name, hv) => {
    const s = pal(name, hv);
    const isDairy = /dairy ?milk|silk/i.test(name);
    const w = 240;
    const h = 100;
    const body = `<g filter="url(#s)">
      <polygon points="${crimp(10, 14, 72, -1)} 34,86 34,14" fill="${s.c2}"/>
      <polygon points="${crimp(230, 14, 72, 1)} 206,86 206,14" fill="${s.c2}"/>
      <rect x="22" y="10" width="196" height="80" rx="6" fill="url(#g)"/><rect x="22" y="10" width="196" height="80" rx="6" fill="url(#sh)"/>
      ${isDairy ? `<path d="M22 70 C70 50 110 92 160 64 S210 58 218 52 L218 90 L22 90Z" fill="${s.accent}" opacity="0.9"/><path d="M150 58 c10 -18 34 -16 48 -6" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>` : `<path d="M150 10 l40 0 l-28 80 l-40 0z" fill="#fff" opacity="0.12"/>`}
      <rect x="160" y="56" width="44" height="24" rx="3" fill="#4A2412"/>${[0, 1].map((r) => [0, 1].map((c) => `<rect x="${162 + c * 21}" y="${58 + r * 11}" width="19" height="9" rx="2" fill="#6B3A1E"/>`).join('')).join('')}
      ${isDairy ? text(100, 46, 140, 26, label(name, 14), s.text, '', SCRIPT) : text(100, 52, 140, 22, label(name, 14), s.text)}
      ${flash(196, 26, priceFlash(name))}
    </g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  biscuit: (name, hv) => {
    const s = pal(name, hv, 3);
    const w = 250;
    const h = 112;
    const body = `<g filter="url(#s)">
      <polygon points="${crimp(10, 12, 88, -1, 9)} 30,100 30,12" fill="${s.c2}"/><polygon points="${crimp(240, 12, 88, 1, 9)} 220,100 220,12" fill="${s.c2}"/>
      <rect x="22" y="8" width="206" height="96" rx="10" fill="url(#g)"/>
      <rect x="22" y="70" width="206" height="16" fill="${s.accent}" opacity="0.9"/>
      <rect x="22" y="8" width="206" height="96" rx="10" fill="url(#sh)"/>
      ${cookies(160, 62, s.cookie ?? 'plain')}
      ${text(88, 52, 120, 20, label(name, 13), s.text)}${text(88, 82, 110, 10, 'BISCUITS', s.c2 === '#160C07' ? '#FFFFFF' : s.c2)}
      ${flash(210, 26, priceFlash(name))}
    </g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  packet: (name, hv) => {
    const s = pal(name, hv, 1);
    const w = 136;
    const h = 176;
    const top = Array.from({ length: 9 }, (_, i) => `${14 + i * 13.5},${i % 2 ? 8 : 16}`).join(' ');
    const bot = Array.from({ length: 9 }, (_, i) => `${122 - i * 13.5},${i % 2 ? 168 : 160}`).join(' ');
    const body = `<g filter="url(#s)"><polygon points="${top} 122,160 ${bot} 14,16" fill="url(#g)"/><polygon points="${top} 122,160 ${bot} 14,16" fill="url(#sh)"/>
      <ellipse cx="68" cy="64" rx="44" ry="22" fill="#fff" opacity="0.9"/>${text(68, 70, 78, 15, label(name, 10), s.c2)}
      <ellipse cx="68" cy="122" rx="36" ry="20" fill="#F4C542"/><ellipse cx="56" cy="118" rx="14" ry="8" fill="#E8A92E"/><ellipse cx="82" cy="126" rx="12" ry="7" fill="#E8A92E"/>
      ${flash(110, 34, priceFlash(name))}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  drink: (name, hv) => {
    const s = pal(name, hv, 5);
    const w = 96;
    const h = 170;
    const body = `<g filter="url(#s)"><rect x="62" y="2" width="5" height="26" rx="2" fill="#E8E8E8" transform="rotate(12 64 15)"/><polygon points="16,26 80,26 86,34 10,34" fill="${s.c2}"/>
      <rect x="10" y="34" width="76" height="130" rx="4" fill="url(#g)"/><rect x="10" y="34" width="76" height="130" rx="4" fill="url(#sh)"/>
      <circle cx="48" cy="118" r="24" fill="${s.accent}"/><path d="M48 96 q8 -10 16 -6" stroke="#2EA043" stroke-width="4" fill="none"/>
      ${text(48, 70, 66, 14, label(name, 8), s.text)}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  bottle: (name) => {
    const w = 76;
    const h = 190;
    const body = `<g filter="url(#s)"><rect x="28" y="6" width="20" height="16" rx="3" fill="#1E4DA1"/><path d="M26 22 h24 v14 c14 8 18 18 18 32 v104 a12 12 0 0 1 -12 12 h-36 a12 12 0 0 1 -12 -12 v-104 c0 -14 4 -24 18 -32z" fill="#CDEBF7" opacity="0.92"/>
      <rect x="8" y="84" width="60" height="52" fill="#1E4DA1"/>${text(38, 114, 52, 11, label(name, 8), '#FFFFFF')}<rect x="16" y="40" width="6" height="120" rx="3" fill="#fff" opacity="0.55"/></g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  calculator: (name) => {
    const w = 130;
    const h = 186;
    let keys = '';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) keys += `<rect x="${16 + c * 26}" y="${78 + r * 20}" width="20" height="14" rx="3" fill="${r === 0 ? '#F6872A' : c === 3 ? '#4B5A78' : '#2B3550'}"/>`;
    const body = `<g filter="url(#s)"><rect x="6" y="6" width="118" height="174" rx="14" fill="#1A2238"/><rect x="6" y="6" width="118" height="174" rx="14" fill="url(#sh)"/>
      <rect x="16" y="20" width="98" height="44" rx="5" fill="#C9D9B8"/><text x="108" y="52" font-size="22" font-family="Consolas, monospace" fill="#2A3A20" text-anchor="end">991</text>
      ${keys}${text(65, 176, 100, 9, label(name, 18), '#C7CEDD')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}`) };
  },
  eraser: (name) => {
    const w = 140;
    const h = 70;
    const body = `<g filter="url(#s)"><rect x="6" y="10" width="128" height="50" rx="9" fill="#F7F7F2"/><rect x="40" y="10" width="94" height="50" rx="4" fill="#1E4DA1"/><rect x="6" y="10" width="128" height="50" rx="9" fill="url(#sh)"/>${text(87, 41, 84, 13, label(name, 12), '#FFFFFF')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}`) };
  },
  sharpener: (name) => {
    const w = 110;
    const h = 96;
    const body = `<g filter="url(#s)"><path d="M14 22 h82 l-8 62 h-66z" fill="url(#m)"/><circle cx="40" cy="50" r="13" fill="#2A2F3A"/><circle cx="40" cy="50" r="7" fill="#11141B"/><rect x="58" y="36" width="30" height="26" rx="2" fill="#AEB7C6" stroke="#7D879A"/><circle cx="73" cy="49" r="3" fill="#5D6577"/>
      ${text(55, 80, 68, 9, label(name, 14), '#1E2533')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E7ECF3"/><stop offset="0.5" stop-color="#B3BCCB"/><stop offset="1" stop-color="#8A94A6"/></linearGradient>`) };
  },
  pencil: (name, hv) => {
    const n = name.toLowerCase();
    // Apsara-style dark barrel, Nataraj-style red and black stripes, otherwise classic yellow
    // Brand looks only for the brands; every other pencil is plain yellow so it never looks like a copy of one.
    const style = /nataraj/.test(n) ? 'stripe' : /apsara/.test(n) ? 'dark' : 'yellow';
    void hv;
    const barrel = style === 'dark' ? '#1B1B1B' : style === 'stripe' ? '#C8102E' : '#F2C230';
    const txt = style === 'yellow' ? '#1E1E1E' : '#FFFFFF';
    const stripes = style === 'stripe' ? Array.from({ length: 8 }, (_, i) => `<rect x="${58 + i * 18}" y="8" width="9" height="24" fill="#111"/>`).join('') : '';
    const w = 250;
    const h = 40;
    const body = `<g filter="url(#s)"><rect x="18" y="8" width="20" height="24" rx="3" fill="#F49AC1"/><rect x="34" y="7" width="16" height="26" fill="#C9CED6"/><rect x="38" y="7" width="2" height="26" fill="#9AA2AE"/><rect x="44" y="7" width="2" height="26" fill="#9AA2AE"/>
      <rect x="50" y="8" width="150" height="24" fill="${barrel}"/>${stripes}<rect x="50" y="8" width="150" height="8" fill="#fff" opacity="0.22"/><rect x="50" y="24" width="150" height="8" fill="#000" opacity="0.15"/>
      <polygon points="200,8 236,20 200,32" fill="#E9C9A0"/><polygon points="226,16.7 236,20 226,23.3" fill="#2B2B2B"/>${style === 'stripe' ? '' : text(125, 25, 130, 12, label(name, 20), txt)}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  marker: (name, hv) => {
    const white = /whitener|correction/i.test(name);
    const c1 = white ? '#F4F6FA' : ['#F7E018', '#F6872A', '#2EA043', '#E6007E'][hv % 4];
    const w = 220;
    const h = 46;
    const body = `<g filter="url(#s)"><rect x="12" y="8" width="60" height="30" rx="8" fill="${white ? '#1E4DA1' : c1}"/><rect x="66" y="10" width="120" height="26" rx="6" fill="${white ? '#FFFFFF' : '#F4F6FA'}" stroke="#D8DDE6"/><rect x="186" y="14" width="18" height="18" fill="#D8DDE6"/><polygon points="204,15 214,23 204,31" fill="${white ? '#C9CED6' : c1}"/>
      ${text(126, 28, 104, 11, label(name, 18), '#0E2455')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  pen: (name, hv) => {
    const b = brand(name);
    const ink = /black/i.test(name) ? '#1E1E1E' : /red/i.test(name) ? '#C8102E' : /green/i.test(name) ? '#0F8A4B' : b?.c2 ?? ['#1E4DA1', '#1E1E1E', '#C8102E'][hv % 3];
    const barrel = b?.c1 ?? '#FFFFFF';
    const txt = b?.text ?? '#0E2455';
    const w = 250;
    const h = 40;
    const body = `<g filter="url(#s)"><rect x="14" y="10" width="70" height="20" rx="9" fill="${ink}"/><rect x="40" y="5" width="44" height="6" rx="3" fill="#C9CED6"/>
      <rect x="80" y="11" width="130" height="18" rx="5" fill="${barrel}" stroke="#D5DCE8"/><rect x="84" y="11" width="122" height="5" rx="2.5" fill="#fff" opacity="0.55"/>
      <polygon points="210,12 232,20 210,28" fill="#C9CED6"/><circle cx="234" cy="20" r="2" fill="${ink}"/>${text(146, 24, 116, 10, label(name, 22), txt)}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  record: (name, hv) => {
    const c = /physics/i.test(name) ? '#7A1E2B' : /chem/i.test(name) ? '#1F5135' : /electr/i.test(name) ? '#2B2F5E' : /comput/i.test(name) ? '#0E4A86' : ['#7A1E2B', '#1F5135', '#2B2F5E', '#5A3B10'][hv % 4];
    const title = /observation/i.test(name) ? 'OBSERVATION' : 'RECORD';
    const w = 140;
    const h = 186;
    const body = `<g filter="url(#s)"><rect x="10" y="6" width="122" height="174" rx="6" fill="${c}"/><rect x="10" y="6" width="16" height="174" rx="4" fill="#000" opacity="0.25"/><rect x="10" y="6" width="122" height="174" rx="6" fill="url(#sh)"/>
      <rect x="36" y="40" width="84" height="66" rx="4" fill="#F6E7C8"/>${text(78, 62, 72, 12, title, '#5A3B10')}${text(78, 88, 72, 10, label(name.replace(/lab record|record|observation( book)?/i, '').trim() || name, 14), '#5A3B10')}
      <rect x="36" y="146" width="84" height="4" fill="#E9C46A" opacity="0.8"/><rect x="36" y="154" width="84" height="2" fill="#E9C46A" opacity="0.6"/></g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}`) };
  },
  bluebook: (name) => {
    const w = 132;
    const h = 180;
    const body = `<g filter="url(#s)"><rect x="8" y="6" width="116" height="168" rx="4" fill="#2C63C8"/><rect x="8" y="6" width="116" height="168" rx="4" fill="url(#sh)"/>
      <rect x="22" y="30" width="88" height="40" rx="3" fill="#fff"/>${text(66, 47, 78, 10, 'ANSWER BOOK', '#1E3F86')}${text(66, 62, 78, 9, label(name, 16), '#1E3F86')}
      ${[0, 1, 2, 3].map((i) => `<rect x="22" y="${92 + i * 16}" width="88" height="3" fill="#fff" opacity="0.45"/>`).join('')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}`) };
  },
  notebook: (name, hv) => {
    const s = pal(name, hv, 5);
    const long = /long ?book/i.test(name);
    const drawing = /drawing/i.test(name);
    const w = long ? 118 : 140;
    const h = long ? 200 : 186;
    const rings = drawing ? '' : Array.from({ length: long ? 10 : 9 }, (_, i) => `<rect x="4" y="${18 + i * 18}" width="20" height="6" rx="3" fill="#C9CED6" stroke="#8A94A6"/>`).join('');
    const bw = w - 20;
    const body = `<g filter="url(#s)"><rect x="14" y="6" width="${bw}" height="${h - 12}" rx="8" fill="url(#g)"/><rect x="14" y="6" width="${bw}" height="${h - 12}" rx="8" fill="url(#sh)"/>${rings}
      ${drawing ? `<circle cx="${14 + bw / 2}" cy="${h * 0.62}" r="22" fill="#FFD34D"/><path d="M${24} ${h - 30} l30 -30 l20 18 l26 -28 l${bw - 86} ${30}" fill="none" stroke="#fff" stroke-width="4"/>` : ''}
      <rect x="28" y="50" width="${bw - 24}" height="54" rx="5" fill="#fff"/>${text(16 + bw / 2, 74, bw - 40, 12, label(name, 14), '#0E2455')}<rect x="38" y="84" width="${bw - 44}" height="2" fill="#0E2455" opacity="0.4"/><rect x="38" y="92" width="${bw - 44}" height="2" fill="#0E2455" opacity="0.4"/>
      ${text(16 + bw / 2, h - 22, bw - 30, 10, drawing ? 'DRAWING BOOK' : long ? 'LONG BOOK' : 'NOTEBOOK', s.accent)}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}${grad('g', s.c1, s.c2)}`) };
  },
  sticky: (name) => {
    const w = 130;
    const h = 120;
    const body = `<g filter="url(#s)"><rect x="22" y="20" width="96" height="92" fill="#F9A8D4" transform="rotate(6 70 66)"/><rect x="16" y="14" width="96" height="92" fill="#FDE047"/><path d="M16 14 h96 v14 h-96z" fill="#000" opacity="0.06"/>${text(64, 64, 80, 11, label(name, 12), '#5A4400')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  stapler: (name) => {
    const w = 200;
    const h = 90;
    const body = `<g filter="url(#s)"><rect x="14" y="58" width="170" height="16" rx="6" fill="#2B3550"/><path d="M20 56 q8 -36 60 -38 h96 q8 0 8 10 v18 q0 10 -10 10 h-146z" fill="#C8102E"/><path d="M28 40 q10 -16 50 -18" stroke="#fff" stroke-width="3" opacity="0.4" fill="none"/>
      ${text(110, 44, 110, 11, label(name, 16), '#FFFFFF')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  cover: (name) => {
    const w = 170;
    const h = 126;
    const body = `<g filter="url(#s)"><rect x="10" y="10" width="150" height="106" rx="6" fill="#8B5A2B"/><rect x="18" y="18" width="134" height="90" rx="4" fill="#A9743F"/><path d="M18 18 h134 v14 h-134z" fill="#fff" opacity="0.12"/>
      ${text(85, 70, 120, 14, label(name, 16), '#FFF4E0')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  paper: (name) => {
    const graph = /graph/i.test(name);
    const chart = /chart/i.test(name);
    const w = 160;
    const h = 196;
    const lines = graph
      ? Array.from({ length: 12 }, (_, i) => `<rect x="${24 + i * 10}" y="50" width="0.8" height="126" fill="#7FB3E6"/><rect x="24" y="${50 + i * 10.5}" width="114" height="0.8" fill="#7FB3E6"/>`).join('')
      : [0, 1, 2, 3, 4, 5].map((i) => `<rect x="32" y="${62 + i * 18}" width="${98 - (i % 3) * 14}" height="3" fill="#C9D2E0"/>`).join('');
    const body = `<g filter="url(#s)"><rect x="22" y="18" width="126" height="170" fill="${chart ? '#FBCFE8' : '#E9EDF3'}" transform="rotate(4 85 103)"/><rect x="16" y="14" width="126" height="170" fill="${chart ? '#BAE6FD' : '#F3F5F9'}" transform="rotate(-3 79 99)"/><rect x="18" y="10" width="126" height="170" fill="#FFFFFF" stroke="#DCE2EA"/>
      <rect x="18" y="10" width="126" height="34" fill="#0E2455"/>${text(81, 33, 110, 14, label(name, 14), '#FFFFFF')}${lines}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  ruler: (name) => {
    const w = 260;
    const h = 52;
    const ticks = Array.from({ length: 31 }, (_, i) => `<rect x="${14 + i * 7.6}" y="10" width="1.4" height="${i % 5 === 0 ? 14 : 8}" fill="#0E2455"/>`).join('');
    const body = `<g filter="url(#s)"><rect x="8" y="8" width="244" height="36" rx="4" fill="#CFE8F5" opacity="0.95" stroke="#8FB9D3"/>${ticks}${text(130, 39, 140, 10, label(name, 20), '#0E2455')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  geometry: (name) => {
    const w = 190;
    const h = 124;
    const body = `<g filter="url(#s)"><rect x="8" y="10" width="174" height="104" rx="10" fill="url(#m)"/><rect x="8" y="10" width="174" height="22" rx="10" fill="#0E2455"/>
      <path d="M40 96 l20 -44 l20 44" fill="none" stroke="#0E2455" stroke-width="4"/><path d="M110 96 a26 26 0 0 1 52 0z" fill="none" stroke="#F6872A" stroke-width="4"/>${text(95, 26, 150, 11, label(name, 20), '#FFFFFF')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EEF2F7"/><stop offset="1" stop-color="#AEB8C8"/></linearGradient>`) };
  },
  bandage: (name) => {
    const w = 180;
    const h = 70;
    const dots = Array.from({ length: 12 }, (_, i) => `<circle cx="${30 + (i % 6) * 8}" cy="${28 + Math.floor(i / 6) * 12}" r="1.6" fill="#B07A50"/>`).join('');
    const body = `<g filter="url(#s)"><rect x="10" y="14" width="160" height="42" rx="21" fill="#E8B48A"/>${dots}<rect x="68" y="18" width="44" height="34" rx="6" fill="#F7EDE3"/>${text(140, 40, 50, 9, label(name, 10), '#7A4A28')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  tablet: (name) => {
    const w = 180;
    const h = 96;
    const pills = Array.from({ length: 8 }, (_, i) => `<ellipse cx="${36 + (i % 4) * 32}" cy="${36 + Math.floor(i / 4) * 30}" rx="11" ry="9" fill="#FFFFFF" stroke="#B5BECC" stroke-width="2"/>`).join('');
    const body = `<g filter="url(#s)"><rect x="10" y="12" width="160" height="72" rx="8" fill="url(#m)"/>${pills}<rect x="10" y="74" width="160" height="16" rx="4" fill="#0F8A4B"/>${text(90, 86, 140, 10, label(name, 22), '#FFFFFF')}</g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F6F9"/><stop offset="1" stop-color="#BFC7D3"/></linearGradient>`) };
  },
  balm: (name) => {
    const w = 120;
    const h = 100;
    const body = `<g filter="url(#s)"><rect x="18" y="40" width="84" height="46" rx="8" fill="#F3E8D2"/><ellipse cx="60" cy="40" rx="42" ry="12" fill="#C8102E"/><rect x="18" y="28" width="84" height="14" fill="#C8102E"/><ellipse cx="60" cy="28" rx="42" ry="12" fill="#E33A4F"/>
      ${text(60, 70, 72, 11, label(name, 12), '#8A0B1F')}</g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
  glue: (name, hv) => {
    const s = pal(name, hv, 6);
    const w = 72;
    const h = 180;
    const body = `<g filter="url(#s)"><rect x="16" y="8" width="40" height="34" rx="6" fill="#F4F6FA"/><rect x="14" y="40" width="44" height="132" rx="8" fill="${s.c1}"/><rect x="14" y="40" width="44" height="132" rx="8" fill="url(#sh)"/>
      <text x="36" y="106" font-size="12" ${FONT} fill="${s.text}" text-anchor="middle" transform="rotate(-90 36 106)">${esc(label(name, 14))}</text></g>`;
    return { w, h, svg: svg(w, h, body, `${shadow('s')}${shine('sh')}`) };
  },
  box: (name, hv) => {
    const s = pal(name, hv, 2);
    const w = 150;
    const h = 136;
    const body = `<g filter="url(#s)"><polygon points="12,34 74,14 138,34 76,54" fill="#E2B77A"/><polygon points="12,34 76,54 76,126 12,104" fill="#C99A5B"/><polygon points="76,54 138,34 138,104 76,126" fill="#B5864A"/>
      <polygon points="18,54 70,70 70,96 18,80" fill="${s.c1}"/>${text(44, 82, 46, 9, label(name, 10), s.text, 'transform="skewY(17) translate(0,-13)"')}<path d="M76 54 v72" stroke="#9C7038" stroke-width="2"/></g>`;
    return { w, h, svg: svg(w, h, body, shadow('s')) };
  },
};

/** The item's picture as an image URL (for <img>), plus its natural size. Pure function: no decoding. */
export function spriteImage(name: string, category: string): { src: string; w: number; h: number; kind: Kind } {
  const kind = kindOf(name, category);
  const d = draw[kind](name, hash(name));
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`, w: d.w, h: d.h, kind };
}

/** Product name without a trailing price, in normal case, for display. */
export function displayName(name: string): string {
  const t = name
    .replace(/\s+/g, ' ')
    .replace(/\s*(rs\.?|₹)\s*\d+(\.\d+)?\s*$/i, '')
    .trim();
  if (t === t.toUpperCase()) return t.toLowerCase().replace(/(^|\s|-)([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Es|Rs|Hb|Id|Uv|Dc)\b/g, (m) => m.toUpperCase());
  return t;
}

export interface Sprite {
  name: string;
  category: string;
  kind: Kind;
  /** Pre-rendered bitmap. Drawing an SVG every frame re-renders its shadows and gradients, which made the intro stutter. */
  img: HTMLCanvasElement;
  w: number;
  h: number;
}

/**
 * Build one store item's picture, rendered once into a bitmap at the largest size it is shown
 * (`scale` already includes the screen's pixel ratio), so every animation frame is a cheap copy.
 */
export async function makeSprite(name: string, category: string, scale: number): Promise<Sprite> {
  const kind = kindOf(name, category);
  const d = draw[kind](name, hash(name));
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
  await img.decode().catch(() => new Promise((res) => (img.onload = res)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(d.w * scale));
  canvas.height = Math.max(1, Math.ceil(d.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { name, category, kind, img: canvas, w: d.w, h: d.h };
}

/**
 * One picture per product: pack sizes, prices and colours of the same product
 * (5 Star Rs5 / Rs10, Reynolds blue / black / red, Apsara 28 / Apsara Platinum) are shown once.
 * Lab records keep one picture per subject because each subject has its own colour.
 */
export function showcaseKey(name: string, category: string): string {
  const kind = kindOf(name, category);
  const n = name
    .toLowerCase()
    .replace(/(rs\.?|₹)\s*\d+(\.\d+)?/g, ' ')
    .replace(/^(\d+)\s+(?=[a-z])/, '$1') // "5 star" and "5star" are the same product ("a4 sheet" stays as is)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (kind === 'record') return `${kind}:${n}`; // one per subject
  if (kind === 'bluebook' || kind === 'stapler') return kind; // these all look the same
  const first = n.split(' ').find((w) => !/^(the|lab|a|an)$/.test(w)) ?? n;
  return `${kind}:${first}`;
}

export function dedupe<T extends { name: string; category: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = showcaseKey(i.name, i.category);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Used when the store has no products yet, so the landing page is never empty. */
export const DEFAULT_ITEMS: { name: string; category: string }[] = [
  { name: 'Dairy Milk Rs10', category: 'Snacks' },
  { name: 'Dairy Milk Lollipop', category: 'Snacks' },
  { name: '5 Star Rs10', category: 'Snacks' },
  { name: 'KitKat Rs10', category: 'Snacks' },
  { name: 'Good Day Cashew Rs10', category: 'Snacks' },
  { name: 'Hide & Seek Rs10', category: 'Snacks' },
  { name: 'Parle-G Rs5', category: 'Snacks' },
  { name: 'Reynolds Ball Pen Blue', category: 'Stationery' },
  { name: 'Cello Gripper Pen', category: 'Stationery' },
  { name: 'Apsara Platinum Pencil', category: 'Stationery' },
  { name: 'Nataraj Pencil', category: 'Stationery' },
  { name: 'Classmate Notebook 172 Pages', category: 'Stationery' },
  { name: 'Long Book 200 Pages', category: 'Stationery' },
  { name: 'Lab Record Physics', category: 'Lab records' },
  { name: 'Lab Record Chemistry', category: 'Lab records' },
  { name: 'Blue Book Theory', category: 'Exam material' },
  { name: 'A4 Sheet', category: 'Copier paper' },
  { name: 'Scientific Calculator', category: 'Stationery' },
  { name: 'Geometry Box', category: 'Stationery' },
  { name: 'Paracetamol 500 Tablet', category: 'Medicines' },
];

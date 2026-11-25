/**
 * NCET ERP theme (same look as the NCET ERP portal): white pages, soft grey cards, NCET brand blue
 * #0F4C81 as the main colour, DMSans, light by default with a dark mode (class "dark" on <html>).
 *
 * COLOUR RULE: no colour values live here. Every token reads a CSS variable defined once in
 * src/index.css (:root for light, .dark for dark), so the whole app re-colours from that one place.
 * The token names (ink, line, paper, page, surface, brand, navy, leaf, amber, rose) are the ones the
 * pages already use, so every screen follows the theme without per-page colour code.
 *
 * Status families have separate text shades (textColor) so a dark-mode label stays readable while a
 * button filled with the same shade keeps its strong colour.
 * @type {import('tailwindcss').Config}
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (family, shades) => Object.fromEntries(shades.map((s) => [s, v(`${family}-${s}`)]));
const BRAND = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const STATUS = [50, 100, 500, 600, 700];
const TEXT = [500, 600, 700, 800];

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), mute: v('ink-mute') },
        line: v('line'),
        paper: v('paper'),
        page: v('page'),
        surface: v('surface'),
        sidebar: { DEFAULT: v('sidebar'), line: v('sidebar-line') },
        main: { DEFAULT: v('main'), fg: v('main-fg') },
        ring: v('ring'),
        brand: scale('brand', BRAND),
        navy: scale('brand', BRAND),
        leaf: scale('leaf', STATUS),
        amber: scale('amber', STATUS),
        rose: scale('rose', STATUS),
        chart: { 1: v('chart-1'), 2: v('chart-2'), 3: v('chart-3'), 4: v('chart-4'), 5: v('chart-5') },
        nav: {
          home: v('nav-home'),
          sales: v('nav-sales'),
          purchase: v('nav-purchase'),
          stock: v('nav-stock'),
          expiry: v('nav-expiry'),
          reports: v('nav-reports'),
          gst: v('nav-gst'),
          masters: v('nav-masters'),
          admin: v('nav-admin'),
        },
      },
      textColor: {
        brand: scale('brand-t', TEXT),
        navy: scale('brand-t', TEXT),
        leaf: scale('leaf-t', TEXT),
        amber: scale('amber-t', TEXT),
        rose: scale('rose-t', TEXT),
      },
      fontFamily: {
        sans: ['DMSans', 'Arial', 'Helvetica', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: '0.5rem',
        md: 'calc(0.5rem - 2px)',
        sm: 'calc(0.5rem - 4px)',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        lift: '0 10px 30px -12px rgb(0 0 0 / 0.18)',
        pop: '0 20px 50px -20px rgb(0 0 0 / 0.35)',
      },
      keyframes: {
        'pop-in': { from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        'row-in': { from: { opacity: '0', transform: 'translateY(-6px)', backgroundColor: 'rgb(var(--brand-500) / 0.18)' }, to: { opacity: '1', transform: 'none' } },
        bump: { '0%': { transform: 'scale(1)' }, '40%': { transform: 'scale(1.06)' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        'row-in': 'row-in 0.35s ease-out',
        bump: 'bump 0.25s ease-out',
        'pop-in': 'pop-in 0.16s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in': 'slide-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

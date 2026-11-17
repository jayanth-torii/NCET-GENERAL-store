/**
 * NGI / NCET theme, dark edition (matches the dashboard):
 *   page #06102A, cards #0F1E44, insets #0A1530, NGI orange #F6872A as the accent, font Poppins.
 * The token names (ink, line, paper, navy-50 …) stay the same as the light theme, so every page
 * switches to the dark look from here. Pale "50/100" tints become dark tints, and the 600/700
 * shades are lightened for text only (textColor) so buttons that fill with them keep their colour.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#E8EDF8', soft: '#C5CEE6', mute: '#8E9CC2' },
        line: '#1F3060',
        paper: '#0A1530',
        page: '#06102A',
        surface: '#0F1E44',
        navy: { 50: '#16295A', 100: '#22386E', 500: '#5B7BD0', 600: '#14306A', 700: '#0E2455', 800: '#0A1A40', 900: '#061633' },
        brand: { 50: '#33293A', 100: '#4A3534', 500: '#F6872A', 600: '#E8741A', 700: '#C75D0C' },
        leaf: { 50: '#123227', 100: '#1B4535', 600: '#2E8B57', 700: '#24714A' },
        amber: { 50: '#3A2A12', 100: '#4D3816', 600: '#B86E0A', 700: '#965806' },
        rose: { 50: '#3A1620', 100: '#55202C', 600: '#C8312A', 700: '#A3241E' },
      },
      textColor: {
        navy: { 500: '#9DB4EE', 600: '#FFB27A', 700: '#FFB27A' },
        brand: { 600: '#F6872A', 700: '#FFB27A' },
        leaf: { 600: '#8FE3B0', 700: '#8FE3B0' },
        amber: { 600: '#FFC27A', 700: '#FFC27A' },
        rose: { 600: '#FF9AA5', 700: '#FF9AA5' },
      },
      fontFamily: {
        sans: ['Poppins', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

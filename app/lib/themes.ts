/* ═══════════════════════════════════════════════
   THEME DEFINITIONS
   Winston (red/white/black) & Camel (yellow/cream/black)
   ═══════════════════════════════════════════════ */

/** Convert hex color to "r,g,b" string for use in rgba() */
export function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export interface GameTheme {
  name: string;
  /** Primary accent color (gold, red, yellow) */
  GOLD: string;
  /** Bright version of primary */
  GOLD_BRIGHT: string;
  /** Secondary accent (amber, dark red, orange) */
  AMBER: string;
  /** Light foreground / text color */
  CREAM: string;
  /** Earthy accent (sienna, burgundy, gray) */
  SIENNA: string;
  /** Darkest background */
  BG_DARK: string;
  /** Mid background */
  BG_MID: string;
  /** Lightest background (still dark) */
  BG_LIGHT: string;
  /** Dark surface for cards/boards */
  TOBACCO: string;
  /** Slightly lighter surface */
  MAHOGANY: string;
  /** Base route prefix for game links */
  routePrefix: string;
}

export const DEFAULT_THEME: GameTheme = {
  name: 'default',
  GOLD: '#d4a843',
  GOLD_BRIGHT: '#e8c36a',
  AMBER: '#c9842b',
  CREAM: '#f5e6c8',
  SIENNA: '#a0522d',
  BG_DARK: '#0a0604',
  BG_MID: '#120b05',
  BG_LIGHT: '#1e1209',
  TOBACCO: '#1a0f08',
  MAHOGANY: '#2a1810',
  routePrefix: '',
};

export const WINSTON_THEME: GameTheme = {
  name: 'winston',
  GOLD: '#db0521',
  GOLD_BRIGHT: '#ff2d4a',
  AMBER: '#a80418',
  CREAM: '#f4f4f4',
  SIENNA: '#7a0316',
  BG_DARK: '#050001',
  BG_MID: '#120206',
  BG_LIGHT: '#1e050a',
  TOBACCO: '#180408',
  MAHOGANY: '#2a0a10',
  routePrefix: '/winston',
};

export const CAMEL_THEME: GameTheme = {
  name: 'camel',
  GOLD: '#f0d859',
  GOLD_BRIGHT: '#f7e97f',
  AMBER: '#fcba0f',
  CREAM: '#fffaf4',
  SIENNA: '#b7b9be',
  BG_DARK: '#040400',
  BG_MID: '#0f0e04',
  BG_LIGHT: '#1c1a08',
  TOBACCO: '#161408',
  MAHOGANY: '#262210',
  routePrefix: '/camel',
};

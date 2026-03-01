/* ═══════════════════════════════════════════════
   THEME DEFINITIONS
   Camel (warm cream) · LD (cool blue) · Winston (deep red)
   Each theme provides a full palette for canvas rendering
   and HTML overlay styling.
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
  /** 'light' | 'dark' — determines text contrast direction */
  mode: 'light' | 'dark';
  /** Primary accent color */
  GOLD: string;
  /** Bright version of primary */
  GOLD_BRIGHT: string;
  /** Secondary accent */
  AMBER: string;
  /** Foreground / text color */
  CREAM: string;
  /** Strong accent for contrast elements */
  SIENNA: string;
  /** Deepest background layer */
  BG_DARK: string;
  /** Mid background layer */
  BG_MID: string;
  /** Lightest background layer */
  BG_LIGHT: string;
  /** Surface color for cards/boards */
  TOBACCO: string;
  /** Slightly different surface tone */
  MAHOGANY: string;
  /** Base route prefix for game links */
  routePrefix: string;
}

/* ── Camel — warm cream & earthy browns ─────────────────── */
export const CAMEL_THEME: GameTheme = {
  name: 'camel',
  mode: 'light',
  GOLD: '#C19A6B',       // Camel primary
  GOLD_BRIGHT: '#D4AD7C', // Lighter camel
  AMBER: '#8E7045',       // Deep brown secondary
  CREAM: '#2C1A0E',       // Dark brown text (readable on cream bg)
  SIENNA: '#000080',      // Navy accent
  BG_DARK: '#F8EBDE',     // Soft cream
  BG_MID: '#F2E4D4',      // Warm mid
  BG_LIGHT: '#FDF6EF',    // Lightest cream
  TOBACCO: '#ECC299',     // Light camel surface
  MAHOGANY: '#E0B487',    // Slightly deeper surface
  routePrefix: '/camel',
};

/* ── LD — clean blue & white ────────────────────────────── */
export const LD_THEME: GameTheme = {
  name: 'ld',
  mode: 'light',
  GOLD: '#007BFF',        // Bleu LD primary
  GOLD_BRIGHT: '#3D9BFF', // Lighter blue
  AMBER: '#0D47A1',       // Bleu marine secondary
  CREAM: '#0A1628',       // Very dark blue text
  SIENNA: '#0D47A1',      // Bleu marine accent
  BG_DARK: '#F8F9FA',     // Blanc cassé
  BG_MID: '#EFF5FB',      // Very light blue-grey
  BG_LIGHT: '#FFFFFF',    // Pure white
  TOBACCO: '#E3F2FD',     // Gris bleu clair surface
  MAHOGANY: '#D0E8FC',    // Slightly deeper blue surface
  routePrefix: '/ld',
};

/* ── Winston — bold red on deep blue-grey ───────────────── */
export const WINSTON_THEME: GameTheme = {
  name: 'winston',
  mode: 'dark',
  GOLD: '#c0392b',        // Rouge Winston
  GOLD_BRIGHT: '#e74c3c', // Rouge vif
  AMBER: '#a93226',       // Darker red
  CREAM: '#ffffff',       // White text
  SIENNA: '#7b241c',      // Deep red accent
  BG_DARK: '#1a252f',     // Bleu nuit profond
  BG_MID: '#2c3e50',      // Bleu-gris foncé
  BG_LIGHT: '#34495e',    // Gris ardoise
  TOBACCO: '#243342',     // Dark blue-grey surface
  MAHOGANY: '#2c3e50',    // Mid surface
  routePrefix: '/winston',
};

/* ── Default — same as Camel (neutral entry) ────────────── */
export const DEFAULT_THEME: GameTheme = {
  ...CAMEL_THEME,
  name: 'default',
  routePrefix: '',
};

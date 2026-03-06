import { Prize } from './types';

/* ═══════════════════════════════════════════════════════════
   GLOBAL GAME CONFIG — Change these to tune all games at once
   ═══════════════════════════════════════════════════════════ */

/* ── Letter-to-game mapping ────────────────────────────────
   Each letter maps to a game slug. The order of letters in the
   URL controls which games are shown on the home page.
   Example URL: /camel/abcdef → shows games a,b,c,d,e,f
   ──────────────────────────────────────────────────────── */

export interface GameMeta {
  slug: string;
  title: string;
  desc: string;
  letter: string;
}

export const ALL_GAMES: GameMeta[] = [
  { slug: 'spin',         title: 'Spin & Win',   desc: 'Tournez la roue',      letter: 'a' },
  { slug: 'plinko',       title: 'Plinko',        desc: 'Lâchez la bille',      letter: 'b' },
  { slug: 'cannon',       title: 'Cannon',        desc: 'Tirez & détruisez',    letter: 'c' },
  { slug: 'angry-ball',   title: 'Angry Ball',    desc: 'Visez le cadeau',      letter: 'd' },
  { slug: 'pendulum',     title: 'Pendulum',      desc: 'Timing parfait',       letter: 'e' },
  { slug: 'gift-slice',   title: 'Gift Slice',    desc: 'Tranchez les cadeaux', letter: '' },
  { slug: 'stack-tower',  title: 'Stack Tower',   desc: 'Empilez les blocs',    letter: '' },
  { slug: 'whac-a-mole',  title: 'Whac-a-Mole',  desc: 'Tapez les taupes',     letter: '' },
];

/** Get ordered list of games for a letters string (e.g. "abcdef") */
export function getGamesForLetters(letters: string): GameMeta[] {
  if (!letters) return [];
  const sorted = [...new Set(letters.toLowerCase().split(''))].sort();
  return sorted
    .map(l => ALL_GAMES.find(g => g.letter === l))
    .filter((g): g is GameMeta => !!g);
}

/* ── Background image opacity per theme ────────────────────
   Images must be in /public: camel.png, ld.png, winston.png
   Adjust values to taste (0 = invisible, 1 = fully opaque)
   ──────────────────────────────────────────────────────── */

export const BG_IMAGE_OPACITY: Record<string, number> = {
  camel:   0.1,
  ld:      0.1,
  winston: 0.1,
  default: 0.1,
};

/** Number of prize slots to display per game (default for all games) */
export const DEFAULT_DISPLAY_SLOTS = 5;

/** Per-game overrides (optional — falls back to DEFAULT_DISPLAY_SLOTS) */
export const GAME_DISPLAY_SLOTS: Record<string, number> = {
  plinko: 14,
  cannon: 6,
  pendulum: 6,
  'angry-ball': 6,
  'gyro-maze': 4,
  'spin': 0, // spin uses raw prize list (proportional wheel)
  // 'gift-slice': 10,
  // 'stack-tower': 10,
  // 'whac-a-mole': 10,
};

/** Get the display slot count for a given game */
export function getDisplaySlots(game: string): number {
  return GAME_DISPLAY_SLOTS[game] ?? DEFAULT_DISPLAY_SLOTS;
}

/* ═══════════════════════════════════════════════════════════
   PROPORTIONAL PRIZE DISTRIBUTION
   
   Given a list of prizes and a target total, returns an array
   of N prizes distributed proportionally to their quantities.
   
   Uses the "largest remainder" method to guarantee:
   - The returned array length === totalSlots (exactly)
   - Each prize appears proportionally to its quantity
   - Every prize with qty > 0 gets at least 1 slot
     (if there are more unique prizes than slots, the ones
      with the smallest quantities are dropped)
   
   Examples (totalSlots = 10):
     Casquette:20, Briquet:20  →  5 + 5 = 10
     Casquette:10, Briquet:100 →  1 + 9 = 10
     A:1, B:1, C:1, D:1, E:1, F:1, G:1, H:1, I:1, J:1, K:1
       → 11 products but 10 slots → smallest qty dropped
   ═══════════════════════════════════════════════════════════ */

export function distributeProportionally(
  prizes: Prize[],
  totalSlots: number,
): Prize[] {
  const available = prizes.filter(p => p.quantity > 0);
  if (available.length === 0) return [];
  if (totalSlots <= 0) return [];

  // — Edge case: only 1 product
  if (available.length === 1) {
    return new Array(totalSlots).fill(available[0]);
  }

  // — Edge case: more unique products than slots
  //   Pick randomly, weighted by quantity (proportional lottery)
  let candidates = available;
  if (candidates.length > totalSlots) {
    const totalQtyAll = available.reduce((s, p) => s + p.quantity, 0);
    const pool = [...available];
    const picked: Prize[] = [];
    for (let n = 0; n < totalSlots && pool.length > 0; n++) {
      const poolTotal = pool.reduce((s, p) => s + p.quantity, 0);
      let rand = Math.random() * poolTotal;
      let chosen = pool.length - 1;
      for (let k = 0; k < pool.length; k++) {
        rand -= pool[k].quantity;
        if (rand <= 0) { chosen = k; break; }
      }
      picked.push(pool[chosen]);
      pool.splice(chosen, 1); // remove so no duplicate type
    }
    candidates = picked;
  }

  const totalQty = candidates.reduce((sum, p) => sum + p.quantity, 0);

  // — Step 1: Calculate exact proportions & floor allocations
  const allocations = candidates.map(p => {
    const exact = (p.quantity / totalQty) * totalSlots;
    return { prize: p, exact, floored: Math.floor(exact) };
  });

  // — Step 2: Guarantee each product gets at least 1
  allocations.forEach(a => {
    if (a.floored === 0) a.floored = 1;
  });

  // — Step 3: If we over-allocated due to minimum-1 rule, trim
  let currentTotal = allocations.reduce((s, a) => s + a.floored, 0);
  if (currentTotal > totalSlots) {
    // Remove excess from the largest allocations first
    const sorted = [...allocations].sort((a, b) => b.floored - a.floored);
    let excess = currentTotal - totalSlots;
    for (const a of sorted) {
      if (excess <= 0) break;
      const canRemove = Math.min(excess, a.floored - 1); // keep at least 1
      a.floored -= canRemove;
      excess -= canRemove;
    }
  }

  // — Step 4: Distribute remaining slots using largest remainder
  currentTotal = allocations.reduce((s, a) => s + a.floored, 0);
  let remaining = totalSlots - currentTotal;
  if (remaining > 0) {
    const byRemainder = [...allocations].sort(
      (a, b) => (b.exact - b.floored) - (a.exact - a.floored),
    );
    for (const a of byRemainder) {
      if (remaining <= 0) break;
      a.floored += 1;
      remaining -= 1;
    }
  }

  // — Step 5: Build the expanded array
  const result: Prize[] = [];
  allocations.forEach(a => {
    for (let i = 0; i < a.floored; i++) {
      result.push(a.prize);
    }
  });

  return result;
}

/* ═══════════════════════════════════════════════════════════
   SHUFFLE UTILITY
   Fisher-Yates shuffle — reusable across all games
   ═══════════════════════════════════════════════════════════ */

export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

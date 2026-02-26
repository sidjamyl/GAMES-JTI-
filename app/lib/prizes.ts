import { Prize, PrizesResponse, ClaimPayload } from './types';

/* ═══════════════════════════════════════════════════════════
   Mock data — swap USE_MOCK to false for real backend
   ═══════════════════════════════════════════════════════════ */

const MOCK_PRIZES: Prize[] = [
  { name: 'Briquet', quantity: 10, emoji: '🔥' },
  { name: 'AirPods', quantity: 2, emoji: '🎧' },
  { name: 'Sacoche Banane', quantity: 5, emoji: '👜' },
  { name: 'Enceinte Bluetooth', quantity: 3, emoji: '🔊' },
  { name: 'Casquette', quantity: 8, emoji: '🧢' },
  { name: 'Porte-clés', quantity: 15, emoji: '🔑' },
];

const USE_MOCK = true;
const API_URL = process.env.NEXT_PUBLIC_PRIZES_API_URL || '/api/prizes';

/*
 * ── Recommended JSON format ───────────────────────────────
 *
 * GET response:
 * {
 *   "prizes": [
 *     { "name": "Briquet", "quantity": 10, "emoji": "🔥" },
 *     { "name": "AirPods", "quantity": 2, "emoji": "🎧" }
 *   ]
 * }
 *
 * POST body:
 * { "prize": "AirPods", "quantity": 1 }
 */

export async function fetchPrizes(): Promise<Prize[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return MOCK_PRIZES.map((p) => ({ ...p }));
  }
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Failed to fetch prizes');
  const data: PrizesResponse = await res.json();
  return data.prizes;
}

export async function claimPrize(prizeName: string): Promise<void> {
  const payload: ClaimPayload = { prize: prizeName, quantity: 1 };
  if (USE_MOCK) {
    console.log('[MOCK] Prize claimed:', payload);
    return;
  }
  await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Weighted random pick based on available quantity */
export function selectRandomPrize(prizes: Prize[]): Prize {
  const available = prizes.filter((p) => p.quantity > 0);
  if (available.length === 0) return prizes[0];
  const total = available.reduce((s, p) => s + p.quantity, 0);
  let r = Math.random() * total;
  for (const p of available) {
    r -= p.quantity;
    if (r <= 0) return p;
  }
  return available[0];
}

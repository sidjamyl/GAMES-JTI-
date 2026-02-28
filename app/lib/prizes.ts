import { Prize, ClaimPayload } from './types';
import { getSessionUserId, getSessionSecondId } from './session';

/* ═══════════════════════════════════════════════════════════
   Prizes — fetches via local proxy to avoid CORS
   ═══════════════════════════════════════════════════════════ */

const PROXY = '/api/prizes';

/*
 * ── JSON formats ──────────────────────────────────────────
 *
 * GET response (from external API):
 * [
 *   { "id": 1, "name": "Briquet", "quantity": 10, "emoji": "🔥" },
 *   { "id": 2, "name": "AirPods", "quantity": 2, "emoji": "🎧" }
 * ]
 *
 * POST body (sent to external API):
 * { "id": 2, "quantity": 1, "gid": "20" }
 */

export async function fetchPrizes(): Promise<Prize[]> {
  const s = getSessionUserId();
  const qs = new URLSearchParams();
  if (s) qs.set('s', s);

  const res = await fetch(`${PROXY}?${qs}`);
  if (!res.ok) throw new Error('Failed to fetch prizes');
  const data = await res.json();

  /* Handle both { prizes: [...] } and raw array responses */
  const list: Prize[] = Array.isArray(data) ? data : data.prizes ?? data;
  if (!Array.isArray(list)) throw new Error('Unexpected prizes format');
  return list;
}

export async function claimPrize(prizeId: number): Promise<void> {
  const s = getSessionUserId();
  const g = getSessionSecondId();
  const qs = new URLSearchParams();
  if (s) qs.set('s', s);

  const payload: ClaimPayload = { id: prizeId, quantity: 1, ...(g && { gid: g }) };
  await fetch(`${PROXY}?${qs}`, {
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

/** Select a premium prize (everything except Briquet) */
export function selectPremiumPrize(prizes: Prize[]): Prize {
  const premium = prizes.filter((p) => p.quantity > 0 && p.name !== 'Briquet');
  if (premium.length === 0) return selectRandomPrize(prizes);
  const total = premium.reduce((s, p) => s + p.quantity, 0);
  let r = Math.random() * total;
  for (const p of premium) {
    r -= p.quantity;
    if (r <= 0) return p;
  }
  return premium[0];
}

/** Get the consolation / default prize (Briquet) */
export function getConsolationPrize(prizes: Prize[]): Prize {
  return prizes.find((p) => p.name === 'Briquet') || prizes[prizes.length - 1];
}

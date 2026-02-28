import { Prize, ClaimPayload } from './types';
import { getSessionUserId, getSessionSecondId } from './session';

/* ═══════════════════════════════════════════════════════════
   Prizes — fetched via WL.Execute("STOCK") from WebDev
   Fallback to API proxy when not in WebDev context
   ═══════════════════════════════════════════════════════════ */

const PROXY = '/api/prizes';

/*
 * ── JSON format (returned by STOCK / API) ─────────────────
 * [
 *   { "id": 1, "name": "Briquet", "quantity": 10, "emoji": "🔥" },
 *   { "id": 2, "name": "AirPods", "quantity": 2, "emoji": "🎧" }
 * ]
 */

/* ── Global callback for WebDev → JS communication ── */
declare global {
  interface Window {
    receiveStock?: (json: string) => void;
    WL?: { Execute?: (...args: string[]) => void };
  }
}

/* ── Debug toast overlay ── */
function showDebugToast(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
  if (typeof document === 'undefined') return;
  const colors = { info: '#3b82f6', success: '#22c55e', error: '#ef4444', warn: '#f59e0b' };
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
  const el = document.createElement('div');
  el.textContent = `${icons[type]} ${message}`;
  Object.assign(el.style, {
    position: 'fixed', bottom: '0', left: '0', right: '0',
    padding: '10px 16px', zIndex: '9999',
    background: colors[type], color: '#fff',
    fontFamily: 'monospace', fontSize: '11px',
    textAlign: 'center', transition: 'opacity 0.5s',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 600); }, 4000);
}

/**
 * Fetch prizes via WL.Execute("STOCK") if in WebDev context,
 * otherwise fallback to the API proxy.
 */
export async function fetchPrizes(): Promise<Prize[]> {
  // Try WebDev WL.Execute("STOCK") first
  if (typeof window !== 'undefined' && window.WL?.Execute) {
    showDebugToast('WL détecté → appel WL.Execute("STOCK")...', 'info');
    try {
      const data = await fetchPrizesFromWebDev() as Record<string, unknown>;
      console.log('[PRIZES] Got stock from WebDev:', data);
      const list: Prize[] = Array.isArray(data) ? data : (data.prizes as Prize[]) ?? data;
      if (Array.isArray(list)) {
        showDebugToast(`STOCK reçu ! ${list.length} produit(s) : ${list.map(p => p.name).join(', ')}`, 'success');
        return list;
      }
    } catch (e) {
      console.warn('[PRIZES] WebDev STOCK failed, falling back to API:', e);
      showDebugToast(`STOCK échoué : ${e instanceof Error ? e.message : e}`, 'error');
    }
  } else if (typeof window !== 'undefined') {
    showDebugToast('WL non détecté → fallback API proxy', 'warn');
  }

  // Fallback: fetch via API proxy
  console.log('[PRIZES] Using API proxy fallback');
  const s = getSessionUserId();
  const qs = new URLSearchParams();
  if (s) qs.set('s', s);

  const res = await fetch(`${PROXY}?${qs}`);
  if (!res.ok) throw new Error('Failed to fetch prizes');
  const data = await res.json();

  const list: Prize[] = Array.isArray(data) ? data : data.prizes ?? data;
  if (!Array.isArray(list)) throw new Error('Unexpected prizes format');
  showDebugToast(`API fallback : ${list.length} produit(s) reçus`, 'success');
  return list;
}

/**
 * Call WL.Execute("STOCK") and wait for WebDev to call back
 * via window.receiveStock(jsonString)
 */
function fetchPrizesFromWebDev(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete window.receiveStock;
      reject(new Error('STOCK timeout — WebDev did not respond in 5s'));
    }, 5000);

    // WebDev will call: ExécuteJS(HTM_ChampHTML, "window.receiveStock('...')")
    window.receiveStock = (json: string) => {
      clearTimeout(timeout);
      delete window.receiveStock;
      try {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        resolve(data);
      } catch {
        reject(new Error('Failed to parse STOCK response'));
      }
    };

    console.log('[PRIZES] Calling WL.Execute("STOCK")...');
    window.WL!.Execute!('STOCK');
  });
}

export async function claimPrize(prizeId: number): Promise<void> {
  // Claim is now handled via WL.Execute("GAIN") in VictoryScreen
  // Keep API fallback for non-WebDev contexts
  if (typeof window !== 'undefined' && window.WL?.Execute) {
    console.log('[PRIZES] Claim handled by WL.Execute("GAIN") in VictoryScreen');
    return;
  }

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

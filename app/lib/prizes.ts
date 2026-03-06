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
    receiveStock?: (data: string) => string;
    WL?: { Execute?: (...args: string[]) => void };
  }
}

/* ── Debug log — console only, no on-screen overlay ── */
function debugLog(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
  if (typeof window === 'undefined') return;
  const icons = { info: '🔵', success: '✅', error: '❌', warn: '⚠️' };
  console.log(`[WL-DEBUG] ${icons[type]} ${message}`);
}

/* ── Mock data for testing outside WebDev ── */
const MOCK_PRIZES: Prize[] = [
  { id: 1, name: 'Briquet', quantity: 50, emoji: '🔥' },
  { id: 2, name: 'AirPods', quantity: 5, emoji: '🎧' },
  { id: 3, name: 'Power Bank', quantity: 10, emoji: '🔋' },
  { id: 4, name: 'Casquette', quantity: 20, emoji: '🧢' },
  { id: 5, name: 'Enceinte BT', quantity: 3, emoji: '🔊' },
];

/**
 * Fetch prizes via WL.Execute("STOCK") if in WebDev context,
 * otherwise return mock data for testing.
 */
export async function fetchPrizes(stockCommand: string = 'STOCK'): Promise<Prize[]> {
  debugLog('fetchPrizes() démarré', 'info');

  // Try WebDev WL.Execute(stockCommand) first
  if (typeof window !== 'undefined' && window.WL?.Execute) {
    debugLog(`WL détecté ✓ → appel WL.Execute("${stockCommand}")...`, 'info');
    try {
      const data = await fetchPrizesFromWebDev(stockCommand) as Record<string, unknown>;
      debugLog('Réponse reçue de WebDev !', 'success');
      const list: Prize[] = Array.isArray(data) ? data : (data.prizes as Prize[]) ?? data;
      if (Array.isArray(list)) {
        debugLog(`STOCK OK → ${list.length} produit(s) : ${list.map(p => `${p.name}(${p.quantity})`).join(', ')}`, 'success');
        return list;
      }
    } catch (e) {
      debugLog(`STOCK échoué : ${e instanceof Error ? e.message : e}`, 'error');
    }
  } else if (typeof window !== 'undefined') {
    debugLog('WL non détecté (hors WebDev) → mock data', 'warn');
  }

  // Fallback: mock data for testing outside WebDev
  debugLog(`Mock data → ${MOCK_PRIZES.length} produit(s) : ${MOCK_PRIZES.map(p => `${p.name}(${p.quantity})`).join(', ')}`, 'success');
  return MOCK_PRIZES;
}

/**
 * Call WL.Execute("STOCK") and wait for WebDev to call back
 * via window.receiveStock(jsonString)
 */
function fetchPrizesFromWebDev(stockCommand: string = 'STOCK'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    debugLog('Attente réponse WebDev (timeout 5s)...', 'info');

    const timeout = setTimeout(() => {
      delete window.receiveStock;
      debugLog('TIMEOUT — WebDev n\'a pas répondu en 5s', 'error');
      reject(new Error('STOCK timeout — WebDev did not respond in 5s'));
    }, 5000);

    // WebDev will call: ExécuteJS(HTM_ChampHTML, "window.receiveStock('id;name;qty;emoji*id;name;qty;emoji')")
    window.receiveStock = (raw: string): string => {
      clearTimeout(timeout);
      debugLog(`receiveStock() appelé ! Type: ${typeof raw}, Longueur: ${typeof raw === 'string' ? raw.length : '?'}`, 'success');
      debugLog(`Contenu brut: ${typeof raw === 'string' ? raw.substring(0, 300) : JSON.stringify(raw)}`, 'info');
      try {
        if (typeof raw !== 'string' || !raw.trim()) {
          debugLog('Données vides ou non-string', 'error');
          delete window.receiveStock;
          reject(new Error('receiveStock: données vides'));
          return 'ERREUR - données vides';
        }

        // Parse format: id;name;quantity;emoji  séparés par *
        const lines = raw.trim().split('*').filter(l => l.length > 0);
        debugLog(`${lines.length} ligne(s) détectée(s)`, 'info');

        const prizes: Prize[] = lines.map((line, i) => {
          const parts = line.split(';');
          debugLog(`  Ligne ${i + 1}: [${parts.join(' | ')}]`, 'info');
          return {
            id: parseInt(parts[0], 10) || 0,
            name: parts[1] || 'Inconnu',
            quantity: parseInt(parts[2], 10) || 0,
            emoji: parts[3] || '🧢',
          };
        });

        debugLog(`Parse OK → ${prizes.length} produit(s) : ${prizes.map(p => `${p.name}(${p.quantity})`).join(', ')}`, 'success');
        delete window.receiveStock;
        resolve(prizes);
        return 'OK - ' + prizes.length + ' produits reçus';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog(`Erreur parsing: ${msg}`, 'error');
        delete window.receiveStock;
        reject(new Error('Failed to parse STOCK: ' + msg));
        return 'ERREUR - ' + msg;
      }
    };

    debugLog(`→ WL.Execute("${stockCommand}") envoyé !`, 'info');
    window.WL!.Execute!(stockCommand);
  });
}

export async function claimPrize(prizeId: number): Promise<void> {
  // Claim is handled via WL.Execute("GAIN") in VictoryScreen
  // Outside WebDev context, this is a no-op (mock mode)
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

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
    receiveStock?: (json: string) => string;
    WL?: { Execute?: (...args: string[]) => void };
  }
}

/* ── Debug panel overlay — shows step-by-step log on screen ── */
function getDebugPanel(): HTMLDivElement {
  if (typeof document === 'undefined') return null as unknown as HTMLDivElement;
  let panel = document.getElementById('wl-debug-panel') as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'wl-debug-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      maxHeight: '40vh', overflowY: 'auto', zIndex: '99999',
      background: 'rgba(0,0,0,0.85)', color: '#fff',
      fontFamily: 'monospace', fontSize: '11px',
      padding: '8px 12px', lineHeight: '1.6',
      borderTop: '2px solid #f59e0b',
    });
    document.body.appendChild(panel);
  }
  return panel;
}

function debugLog(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
  if (typeof document === 'undefined') return;
  const icons = { info: '🔵', success: '✅', error: '❌', warn: '⚠️' };
  const colors = { info: '#93c5fd', success: '#86efac', error: '#fca5a5', warn: '#fde68a' };
  const panel = getDebugPanel();
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span style="color:#888">[${time}]</span> ${icons[type]} <span style="color:${colors[type]}">${message}</span>`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  console.log(`[WL-DEBUG] ${message}`);
}

/**
 * Fetch prizes via WL.Execute("STOCK") if in WebDev context,
 * otherwise fallback to the API proxy.
 */
export async function fetchPrizes(): Promise<Prize[]> {
  debugLog('fetchPrizes() démarré', 'info');

  // Try WebDev WL.Execute("STOCK") first
  if (typeof window !== 'undefined' && window.WL?.Execute) {
    debugLog('WL détecté ✓ → appel WL.Execute("STOCK")...', 'info');
    try {
      const data = await fetchPrizesFromWebDev() as Record<string, unknown>;
      debugLog('Réponse reçue de WebDev !', 'success');
      console.log('[PRIZES] Got stock from WebDev:', data);
      const list: Prize[] = Array.isArray(data) ? data : (data.prizes as Prize[]) ?? data;
      if (Array.isArray(list)) {
        debugLog(`STOCK OK → ${list.length} produit(s) : ${list.map(p => `${p.name}(${p.quantity})`).join(', ')}`, 'success');
        return list;
      }
    } catch (e) {
      console.warn('[PRIZES] WebDev STOCK failed, falling back to API:', e);
      debugLog(`STOCK échoué : ${e instanceof Error ? e.message : e}`, 'error');
    }
  } else if (typeof window !== 'undefined') {
    debugLog('WL non détecté (hors WebDev) → fallback API', 'warn');
  }

  // Fallback: fetch via API proxy
  debugLog('Appel API proxy /api/prizes...', 'info');
  const s = getSessionUserId();
  const qs = new URLSearchParams();
  if (s) qs.set('s', s);

  const res = await fetch(`${PROXY}?${qs}`);
  if (!res.ok) {
    debugLog(`API erreur HTTP ${res.status}`, 'error');
    throw new Error('Failed to fetch prizes');
  }
  const data = await res.json();

  const list: Prize[] = Array.isArray(data) ? data : data.prizes ?? data;
  if (!Array.isArray(list)) throw new Error('Unexpected prizes format');
  debugLog(`API OK → ${list.length} produit(s) : ${list.map((p: Prize) => `${p.name}(${p.quantity})`).join(', ')}`, 'success');
  return list;
}

/**
 * Call WL.Execute("STOCK") and wait for WebDev to call back
 * via window.receiveStock(jsonString)
 */
function fetchPrizesFromWebDev(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    debugLog('Attente réponse WebDev (timeout 5s)...', 'info');

    const timeout = setTimeout(() => {
      delete window.receiveStock;
      debugLog('TIMEOUT — WebDev n\'a pas répondu en 5s', 'error');
      reject(new Error('STOCK timeout — WebDev did not respond in 5s'));
    }, 5000);

    // WebDev will call: ExécuteJS(HTM_ChampHTML, "window.receiveStock('...')")
    window.receiveStock = (json: string): string => {
      clearTimeout(timeout);
      debugLog(`receiveStock() appelé ! Type: ${typeof json}, Longueur: ${typeof json === 'string' ? json.length : '?'}`, 'success');
      debugLog(`Contenu brut: ${typeof json === 'string' ? json.substring(0, 200) : JSON.stringify(json)}`, 'info');
      try {
        let raw = json;
        // Si c'est déjà un objet/array (pas une string), on le prend tel quel
        if (typeof raw !== 'string') {
          debugLog('Données reçues directement en objet', 'success');
          delete window.receiveStock;
          resolve(raw);
          return 'OK';
        }
        // Nettoyer : retirer d'éventuels retours à la ligne, BOM, etc.
        raw = raw.trim().replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        debugLog(`Parse OK → ${Array.isArray(data) ? data.length + ' éléments' : typeof data}`, 'success');
        delete window.receiveStock;
        resolve(data);
        return 'OK - receiveStock reçu avec succès';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog(`Erreur parsing JSON: ${msg}`, 'error');
        debugLog(`Les 100 premiers chars: "${typeof json === 'string' ? json.substring(0, 100) : '???'}"`, 'error');
        delete window.receiveStock;
        reject(new Error('Failed to parse STOCK response: ' + msg));
        return 'ERREUR - parsing JSON échoué: ' + msg;
      }
    };

    debugLog('→ WL.Execute("STOCK") envoyé !', 'info');
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

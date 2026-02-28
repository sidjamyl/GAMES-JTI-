/* ═══════════════════════════════════════════════════════════
   Session helper — captures IDs from the URL
   ═══════════════════════════════════════════════════════════
   The external app redirects here with query params:
     https://ton-app.com/camel?s=abc123&g=xyz789

   s = user ID   (1st path segment of external API URL)
   g = second ID (2nd path segment — sent back in POST)
   ═══════════════════════════════════════════════════════════ */

const SK_UID = 'uid';
const SK_GID = 'gid';

/**
 * Read `?s=…` and `?g=…` from the URL and persist them
 * in sessionStorage for the duration of the tab.
 */
export function captureSession(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('s');
  const gid = params.get('g');
  if (uid) sessionStorage.setItem(SK_UID, uid);
  if (gid) sessionStorage.setItem(SK_GID, gid);
}

/** User ID (1st path segment) */
export function getSessionUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SK_UID) ?? readParam('s');
}

/** Second ID (2nd path segment) */
export function getSessionSecondId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SK_GID) ?? readParam('g');
}

/** Fallback: read directly from URL if sessionStorage empty */
function readParam(key: string): string | null {
  const val = new URLSearchParams(window.location.search).get(key);
  if (val) sessionStorage.setItem(key === 's' ? SK_UID : SK_GID, val);
  return val;
}

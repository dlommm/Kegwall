// Display-token client storage (native-display epic, sub-project A). A browser wall/tablet
// pairs once (POST /api/public/display/pair), stores the returned per-display token here, and
// presents it on every gated request: as an `X-Display-Token` header (REST, attached by
// api.ts's request()) and as a `?displayToken=` query param on the /ws socket (browsers can't
// set headers on a WebSocket). Enforcement is server-side + off by default, so an unpaired
// browser keeps working until an operator turns enforcement on.

const KEY = 'kegwall.displayToken';

export function getDisplayToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage disabled (private mode / sandbox) — behave as unpaired
  }
}

export function setDisplayToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch { /* storage unavailable — the token just won't persist */ }
}

export function clearDisplayToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to clear */ }
}

/** Appends `?displayToken=` (or `&displayToken=`) to a WS/SSE URL when a token is stored, so
 * a WebSocket/EventSource that can't set headers still authenticates. No-op when unpaired. */
export function withDisplayTokenQuery(url: string): string {
  const token = getDisplayToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}displayToken=${encodeURIComponent(token)}`;
}

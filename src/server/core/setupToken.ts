import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// First-run admin-claim token. The server binds 0.0.0.0 and starts at boot, and
// `POST /api/auth/setup` creates the first (admin) account — gated only by "no admin
// exists yet". On a fresh install that leaves a race: whoever on the LAN reaches the port
// before the owner becomes permanent admin and locks the owner out. This token closes that
// window: on a no-admin boot the server writes a random token to DATA_DIR and prints it to
// the console; setup requires it. The owner reads it from `docker logs` / journald; a
// stranger on the LAN cannot. Consumed (deleted) once setup succeeds.
// ---------------------------------------------------------------------------

const TOKEN_FILE = 'setup-claim-token';

function tokenPath(dataDir: string): string {
  return join(dataDir, TOKEN_FILE);
}

/** Ensures a claim token exists on disk (only meaningful before the first admin exists) and
 * returns it. Idempotent — an existing token survives restarts until setup consumes it, so
 * a crash-looping first boot doesn't invalidate the value the operator already copied. */
export function ensureSetupClaimToken(dataDir: string): string {
  const path = tokenPath(dataDir);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const token = randomBytes(24).toString('hex');
  writeFileSync(path, token, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best-effort on platforms without POSIX modes */ }
  return token;
}

/** The current token, or null if none is staged (e.g. setup already completed). */
export function readSetupClaimToken(dataDir: string): string | null {
  const path = tokenPath(dataDir);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

/** Constant-time comparison of `provided` against the staged token (over SHA-256 digests,
 * so the compare never leaks length and never throws on a mismatch). False when no token
 * is staged or `provided` is empty. */
export function setupTokenMatches(dataDir: string, provided: string | undefined): boolean {
  const expected = readSetupClaimToken(dataDir);
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

/** Deletes the staged token — called once setup succeeds so it can never be reused. */
export function consumeSetupClaimToken(dataDir: string): void {
  try { unlinkSync(tokenPath(dataDir)); } catch { /* already gone */ }
}

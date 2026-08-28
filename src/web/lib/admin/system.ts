// --- System: version + in-app updates (Settings → System) --------------------
import { request, type ApiResult } from '../adminHttp';

export function getSystemVersion(): Promise<ApiResult<{ version: string }>> {
  return request('/api/system/version');
}

export type UpdateCheck =
  | { ok: true; current: string; latest: string; updateAvailable: boolean; notesUrl: string }
  | { ok: false; current: string; message: string };

export function checkForUpdates(): Promise<ApiResult<UpdateCheck>> {
  return request('/api/system/update-check', { method: 'POST', body: JSON.stringify({}) });
}

export function triggerUpdate(version?: string): Promise<ApiResult<{ mode: 'watchtower' | 'native'; message?: string }>> {
  return request('/api/system/update', {
    method: 'POST', body: JSON.stringify(version ? { version } : {}),
  });
}

/** Version poller for the update-in-progress screen. Deliberately a RAW fetch, NOT
 * `request()`: during the restart window the server can answer with anything (401
 * from a half-up process, 502 from a proxy, connection refused), and `request()`'s
 * 401 handling would hard-redirect the admin to the login page mid-update. Every
 * failure here just means "still restarting" → null. */
export async function pollSystemVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/system/version', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

// --- System: host stats, install URLs, OS actions (Pi monitoring epic) --------
// Shapes mirror routes/system.ts but are defined HERE (the UpdateCheck precedent):
// importing types from a routes file would drag Fastify's module augmentation into
// tsconfig.web.json's program — see ./beers.ts's lookupTypes import comment.

export interface SystemStats {
  cpu: { loadPct: number; cores: number };
  memory: { totalBytes: number; availableBytes: number; usedPct: number };
  disk: { totalBytes: number; availableBytes: number; usedPct: number } | null;
  uptimeSec: number;
  cpuTempC: number | null;
  throttle: {
    undervoltedNow: boolean; freqCappedNow: boolean; throttledNow: boolean;
    undervoltedSinceBoot: boolean; freqCappedSinceBoot: boolean; throttledSinceBoot: boolean;
  } | null;
  watts: number | null;
  rebootRequired: boolean;
  osManaged: boolean;
}

export function getSystemStats(): Promise<ApiResult<SystemStats>> {
  return request('/api/system/stats');
}

export interface SystemUrls {
  port: number;
  hostname: string;
  addresses: string[];
  install: 'native' | 'docker' | 'unknown';
}

export function getSystemUrls(): Promise<ApiResult<SystemUrls>> {
  return request('/api/system/urls');
}

export function triggerOsUpdate(): Promise<ApiResult<{ message: string }>> {
  return request('/api/system/os-update', { method: 'POST', body: JSON.stringify({}) });
}

export function triggerReboot(): Promise<ApiResult<{ message: string }>> {
  return request('/api/system/reboot', { method: 'POST', body: JSON.stringify({}) });
}

/** Native-update phase poller for the updating banner — RAW fetch for the same
 * reason as pollSystemVersion above: mid-restart failures (or the brief window
 * where the new process is up but the session re-auth hasn't settled) must read
 * as "no phase info", never as a login redirect. */
export async function pollUpdateStatus(): Promise<string | null> {
  try {
    const res = await fetch('/api/system/update-status', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json() as { phase?: string | null };
    return typeof body.phase === 'string' && body.phase !== '' ? body.phase : null;
  } catch {
    return null;
  }
}

/** One bucketed host-health history point (GET /api/system/stats/history). */
export interface HostStatsHistoryPoint {
  ts: string;
  cpuPct: number;
  memPct: number;
  diskPct: number | null;
  tempC: number | null;
  watts: number | null;
}

export function getHostStatsHistory(hours = 24): Promise<ApiResult<{ points: HostStatsHistoryPoint[] }>> {
  return request(`/api/system/stats/history?hours=${hours}`);
}

export function triggerKioskRestart(): Promise<ApiResult<{ message: string }>> {
  return request('/api/system/kiosk-restart', { method: 'POST', body: JSON.stringify({}) });
}

/** Fire a simulated pour on the live wall (POST /api/system/test-pour) — validates the takeover +
 * push latency on a real display, records nothing. Optional tapId; server picks an active tap. */
export function testPour(tapId?: number): Promise<ApiResult<{ tapId: number }>> {
  return request('/api/system/test-pour', { method: 'POST', body: JSON.stringify(tapId != null ? { tapId } : {}) });
}

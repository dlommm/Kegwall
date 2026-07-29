import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import type { Pour } from '../../server/db/kegs.js';
import type { VolumeUnits } from './units';

/** A public wall's identity + config as returned by GET /api/public/wall/:slug. */
export interface WallResponse {
  wall: { slug: string; name: string; config: WallConfig };
  taps: TapState[];
  /** The taproom's configured display units (global settings' `displayUnits`). */
  units: VolumeUnits;
}

/** GET /api/public/menu. */
export interface MenuResponse {
  siteName: string;
  taps: TapState[];
  /** The taproom's configured display units (global settings' `displayUnits`). */
  units: VolumeUnits;
}

/** The public-facing projection of a drinker (see listDrinkers + publicRoutes). */
export interface PublicDrinker {
  id: number;
  displayName: string;
  avatarColor: string | null;
}

/** The public-facing projection of a recent, unclaimed pour. */
export interface RecentPour {
  id: number;
  ts: string;
  volumeMl: number;
  tapNumber: number | null;
  beerName: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status code, or 0 when the request never reached the server (network error). */
  status: number;
  message: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // Phase 5 final-review fix wave (I1): mirrors adminApi.ts's request() fix (commit
      // 90d6871) -- 'Content-Type: application/json' must only be set when a real JSON
      // body is actually being sent. Stamping it on a BODYLESS request (or a FormData one)
      // makes Fastify's default JSON body parser reject the empty body outright
      // (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400), which this app's generic error handler
      // doesn't recognize and maps to an opaque 500 -- invisible to every test here since
      // they all mock `fetch` itself rather than exercising a real server's body parsing.
      // Latent today (every GET call below has no body; the one POST, claimPour, always
      // sends one), but the identical landmine, so it gets the identical fix.
      headers: {
        ...(init?.body !== undefined && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : res.statusText || `Request failed with status ${res.status}`;
    return { ok: false, status: res.status, message };
  }

  return { ok: true, data: body as T };
}

export function getWall(slug: string): Promise<ApiResult<WallResponse>> {
  return request<WallResponse>(`/api/public/wall/${encodeURIComponent(slug)}`);
}

export function getMenu(): Promise<ApiResult<MenuResponse>> {
  return request<MenuResponse>('/api/public/menu');
}

export function getDrinkers(): Promise<ApiResult<PublicDrinker[]>> {
  return request<PublicDrinker[]>('/api/public/drinkers');
}

export function getRecentPours(): Promise<ApiResult<RecentPour[]>> {
  return request<RecentPour[]>('/api/public/recent-pours');
}

export function claimPour(pourId: number, drinkerId: number): Promise<ApiResult<Pour>> {
  return request<Pour>('/api/public/claim', {
    method: 'POST',
    body: JSON.stringify({ pourId, drinkerId }),
  });
}

// --- Pour Wall overhaul Phase 3: pourers, tablet arming, leaderboard ---------

/** A pourer on the tablet's avatar grid: a PublicDrinker + lifetime pour count. */
export interface PublicPourer extends PublicDrinker {
  pourCount: number;
}

export interface TabletArmStatus {
  armed: boolean;
  drinkerId?: number;
  expiresAt?: string;
}

export interface LeaderboardEntryPublic {
  drinkerId: number;
  displayName: string;
  avatarColor: string | null;
  pourCount: number;
  volumeMl: number;
  avgQuality: number | null;
  qualityCount: number;
}

export interface LeaderboardResponse {
  window: 'week' | 'month' | 'all';
  entries: LeaderboardEntryPublic[];
  superlatives: {
    mostPours: { displayName: string; pourCount: number } | null;
    smoothest: { displayName: string; avgQuality: number | null } | null;
    biggestPour: { drinkerId: number; displayName: string; volumeMl: number; ts: string } | null;
  };
}

export function getPourers(): Promise<ApiResult<PublicPourer[]>> {
  return request<PublicPourer[]>('/api/public/pourers');
}

export function createPourer(name: string, color?: string): Promise<ApiResult<PublicDrinker>> {
  return request<PublicDrinker>('/api/public/pourers', {
    method: 'POST',
    body: JSON.stringify(color ? { name, color } : { name }),
  });
}

export function armTablet(drinkerId: number): Promise<ApiResult<TabletArmStatus>> {
  return request<TabletArmStatus>('/api/public/tablet/arm', {
    method: 'POST',
    body: JSON.stringify({ drinkerId }),
  });
}

export function disarmTablet(): Promise<ApiResult<TabletArmStatus>> {
  return request<TabletArmStatus>('/api/public/tablet/arm', { method: 'DELETE' });
}

// --- Pour Wall overhaul Phase 5: display pairing (design 7c) ----------------

export interface DisplayView {
  id: number;
  name: string;
  wallSlug: string | null;
  overrides: { look?: string; themeId?: string; takeoverStyle?: string };
}

export function pairDisplay(code: string): Promise<ApiResult<DisplayView>> {
  return request<DisplayView>('/api/public/display/pair', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function getDisplayView(id: number): Promise<ApiResult<DisplayView>> {
  return request<DisplayView>(`/api/public/display/${id}`);
}

export function getLeaderboard(
  window: 'week' | 'month' | 'all' = 'month',
): Promise<ApiResult<LeaderboardResponse>> {
  return request<LeaderboardResponse>(`/api/public/leaderboard?window=${window}`);
}

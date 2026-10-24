import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import type { Pour } from '../../server/db/kegs.js';
import type { VolumeUnits } from './units';
import { getDisplayToken } from './displayToken';
import { httpRequest, type ApiResult } from './http';

/** A public tap: the shared TapState plus the ONE public money value — the computed per-pint
 *  display price (redesign 4k), present (non-null) only when pricing is enabled. Owner cost is
 *  never included. Optional so an older payload without the field is still a valid PublicTap. */
export type PublicTap = TapState & { pricePerPintCents?: number | null };

/** A public wall's identity + config as returned by GET /api/public/wall/:slug. */
export interface WallResponse {
  wall: { slug: string; name: string; config: WallConfig };
  taps: PublicTap[];
  /** The tap ids this wall may show — taps bound to the wall's assigned Kegtron
   * devices (strict: `[]` = show nothing). The client must re-apply this to every
   * `/ws` snapshot, which is global rather than per-wall. Optional so an older
   * server payload (no field) means "no device filtering". */
  allowedTapIds?: number[];
  /** The taproom's configured display units (global settings' `displayUnits`). */
  units: VolumeUnits;
  /** One serving in mL (settings' `servingSizeMl`); V2 walls count keg level in servings.
   * Optional so an older server payload falls back to a US pint. */
  servingSizeMl?: number;
}

/** GET /api/public/menu. */
export interface MenuResponse {
  siteName: string;
  taps: PublicTap[];
  /** The taproom's configured display units (global settings' `displayUnits`). */
  units: VolumeUnits;
  /** One serving in mL (settings' `servingSizeMl`). Optional so an older payload falls back
   * to a US pint. */
  servingSizeMl?: number;
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

// The typed-result shapes live in ./http.ts (the ONE shared transport — see that file's
// doc comment for the drift story that motivated the extraction) and are re-exported here
// so every existing `import { ApiResult } from '../lib/api'` site keeps working unchanged.
export type { ApiSuccess, ApiFailure, ApiResult } from './http';

/** The public client: shared transport (see http.ts — including the FST_ERR_CTP_EMPTY_
 * JSON_BODY Content-Type handling that used to be duplicated here verbatim) plus this
 * client's one specialization, the display-token header. No 401 handling: public pages
 * have no session to lose (a gated read failing while unpaired renders in place). */
function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  return httpRequest<T>(path, init, {
    // Display-token auth: attach the paired token when present so gated reads
    // (wall/menu/leaderboard/passport) authenticate. Absent → unpaired, which is fine
    // while server-side enforcement is off. See lib/displayToken.ts.
    extraHeaders: (): Record<string, string> => {
      const token = getDisplayToken();
      return token ? { 'X-Display-Token': token } : {};
    },
  });
}

export function getWall(slug: string): Promise<ApiResult<WallResponse>> {
  return request<WallResponse>(`/api/public/wall/${encodeURIComponent(slug)}`);
}

export function getMenu(): Promise<ApiResult<MenuResponse>> {
  return request<MenuResponse>('/api/public/menu');
}

/** GET /api/public/game — the live wall GAME STRIP (redesign 5c), or null when idle. */
export function getGameStrip(): Promise<ApiResult<import('../../server/db/games.js').GameStrip | null>> {
  return request('/api/public/game');
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

/** A pourer on the tablet's avatar grid: a PublicDrinker + lifetime pour count + last-pour
 *  timestamp (feeds the RECENT jumbo tiles, redesign 2d). */
export interface PublicPourer extends PublicDrinker {
  pourCount: number;
  lastPourAt?: string | null;
  /** What they last poured; optional so an older payload is still valid. */
  lastBeer?: { name: string; srm: number | null } | null;
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
  /** Most-poured beers first; optional so an older payload is still valid. */
  beers?: { beerId: number; srm: number | null; pours: number }[];
}

export interface LeaderboardResponse {
  window: 'week' | 'month' | 'all';
  entries: LeaderboardEntryPublic[];
  superlatives: {
    mostPours: { displayName: string; pourCount: number } | null;
    smoothest: { displayName: string; avgQuality: number | null } | null;
    biggestPour: { drinkerId: number; displayName: string; volumeMl: number; ts: string } | null;
    /** The week's most recent game winner (redesign 5d) — games decorate this board, never fork it. */
    gameWinner?: { gameName: string; displayName: string; endedAt: string } | null;
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
  /** Present ONLY on the pair response (POST /display/pair) — the per-display token the
   * client stores and presents thereafter. Absent on the GET /display/:id refresh. */
  token?: string;
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

export interface AmbientSensorReading {
  sensorId: string;
  name: string;
  tempC: number | null;
  humidity: number | null;
  ts: string;
}

export function getSensors(): Promise<ApiResult<AmbientSensorReading[]>> {
  return request<AmbientSensorReading[]>('/api/public/sensors');
}

export function ratePourPublic(
  pourId: number,
  rating: number,
  tags: string[],
  drinkerId: number,
): Promise<ApiResult<Pour>> {
  return request<Pour>(`/api/public/pours/${pourId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ rating, tags, drinkerId }),
  });
}

export interface PassportResponse {
  drinker: { id: number; displayName: string; avatarColor: string | null };
  pourCount: number;
  volumeMl: number;
  stylesTried: number;
  avgQuality: number | null;
  badges: string[];
  recent: { id: number; ts: string; volumeMl: number; rating: number | null; beerName: string }[];
}

export function getPassport(drinkerId: number): Promise<ApiResult<PassportResponse>> {
  return request<PassportResponse>(`/api/public/passport/${drinkerId}`);
}

export interface SessionSnapshotResponse {
  name: string;
  startedAt: string;
  members: { drinkerId: number; name: string; color: string | null }[];
  totals: { drinkerId: number; name: string; color: string | null; pourCount: number; volumeMl: number }[];
}

export function startSession(name?: string): Promise<ApiResult<SessionSnapshotResponse>> {
  return request<SessionSnapshotResponse>('/api/public/session/start', {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
}

export function joinSession(drinkerId: number): Promise<ApiResult<SessionSnapshotResponse>> {
  return request<SessionSnapshotResponse>('/api/public/session/join', {
    method: 'POST',
    body: JSON.stringify({ drinkerId }),
  });
}

export function getSession(): Promise<ApiResult<SessionSnapshotResponse | { active: false }>> {
  return request('/api/public/session');
}

export function endSession(): Promise<ApiResult<SessionSnapshotResponse>> {
  return request<SessionSnapshotResponse>('/api/public/session/end', { method: 'POST' });
}

export function getLeaderboard(
  window: 'week' | 'month' | 'all' = 'month',
): Promise<ApiResult<LeaderboardResponse>> {
  return request<LeaderboardResponse>(`/api/public/leaderboard?window=${window}`);
}

// --- Task 9 (presence/display-power): public wake endpoint ------------------

/**
 * Fire-and-forget POST to /api/presence/wake — a user tapping the screensaver/off
 * overlay, or a camera-driven wake. `wall` is omitted from the body entirely when
 * undefined, which the server treats as "wake every zone" (Task 12's admin wake-all
 * button relies on this). Callers don't need to inspect the result (`request` never
 * throws, so this always resolves), matching this endpoint's public, best-effort trust
 * level -- see routes/presence.ts.
 */
export function postPresenceWake(wall: string | undefined, source: 'touch' | 'camera'): Promise<void> {
  return request('/api/presence/wake', {
    method: 'POST',
    body: JSON.stringify(wall !== undefined ? { wall, source } : { source }),
  }).then(() => undefined);
}

// --- Task 7 (face sign-in, Plan B): tablet face directory + enrollment ------

/** One enrolled face row as the server returns it on enrollment. `embedding` is the
 * on-device descriptor (Task 6's `computeEmbedding`); image bytes never reach the server —
 * and the corpus is never sent back to any client (matching is server-side). */
export interface EnrolledFaceDto { id: number; drinkerId: number; embedding: number[] }

/** GET /api/public/faces — only whether the feature is enabled. The enrolled vectors NEVER
 * leave the server (irrevocable biometric data); the tablet posts probes to `matchFace`. */
export interface FaceDirectory { enabled: boolean }

export function getFaces(): Promise<ApiResult<FaceDirectory>> {
  return request<FaceDirectory>('/api/public/faces');
}

/** Server-side match: post a probe embedding, get back the matched drinker (or null). */
export function matchFace(embedding: number[]): Promise<ApiResult<{ match: { drinkerId: number; score: number } | null }>> {
  return request('/api/public/faces/match', {
    method: 'POST',
    body: JSON.stringify({ embedding }),
  });
}

/** Whether a specific drinker already has a face enrolled (a boolean only — no vectors) —
 * feeds the enroll screen's "you've added your face" state. */
export function isFaceEnrolled(drinkerId: number): Promise<ApiResult<{ enrolled: boolean }>> {
  return request(`/api/public/faces/enrolled/${drinkerId}`);
}

export function enrollFace(drinkerId: number, embedding: number[]): Promise<ApiResult<EnrolledFaceDto>> {
  return request<EnrolledFaceDto>('/api/public/faces', {
    method: 'POST',
    body: JSON.stringify({ drinkerId, embedding }),
  });
}

/** Self-service delete at the kiosk (bound to the armed pourer, server-side). */
export function deleteFaces(drinkerId: number): Promise<ApiResult<{ deleted: number }>> {
  return request<{ deleted: number }>(`/api/public/faces/drinker/${drinkerId}`, { method: 'DELETE' });
}

/** Admin-initiated face-data deletion (Users page) — admin-gated route, not the kiosk one. */
export function deleteFacesAdmin(drinkerId: number): Promise<ApiResult<{ deleted: number }>> {
  return request<{ deleted: number }>(`/api/faces/drinker/${drinkerId}`, { method: 'DELETE' });
}

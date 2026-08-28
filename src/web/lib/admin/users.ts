// --- Task 8: users (+ Task 9 Plan B: admin face-data management) ---
import type { Role, User } from '../../../server/db/users.js';
import { request, type ApiResult } from '../adminHttp';

export function listUsers(): Promise<ApiResult<User[]>> {
  return request('/api/users');
}

/** POST /api/users for a real login account (username + password + role). The server
 * branches on `drinkerOnly` (see routes/crud.ts) — omitted here, unlike
 * `createDrinkerProfile` below, so this always takes the login-user path. */
export function createLoginUser(input: {
  username: string; displayName: string; password: string; role: Role;
}): Promise<ApiResult<User>> {
  return request('/api/users', { method: 'POST', body: JSON.stringify(input) });
}

/** POST /api/users for a drinker-only profile (no login, `role: null`) — the leaderboard/
 * claim-a-pour identity with no admin access. `drinkerOnly: true` is what routes the
 * server to `createDrinker` instead of `createUser` (see routes/crud.ts). */
export function createDrinkerProfile(input: {
  displayName: string; avatarColor?: string;
}): Promise<ApiResult<User>> {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ ...input, drinkerOnly: true }),
  });
}

/** PATCH /api/users/:id — edits a login user's display name/role/password (password
 * optional: omit to leave the hash untouched) or a drinker profile's display
 * name/avatar/`isDrinker` flag. 409 (`ApiFailure`) when demoting the last admin — see
 * db/users.ts's `updateUser`. */
export function updateUser(id: number, input: {
  displayName?: string; role?: Role; password?: string;
  avatarColor?: string | null; isDrinker?: boolean;
}): Promise<ApiResult<User>> {
  return request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/users/:id — 204 on success; 409 (`ApiFailure`, message "cannot delete the
 * last admin") when `id` is the sole remaining admin — see db/users.ts's `deleteUser`. */
export function deleteUser(id: number): Promise<ApiResult<null>> {
  return request(`/api/users/${id}`, { method: 'DELETE' });
}

// --- Task 9 (Plan B, face sign-in): admin face-data management ---------------

/** One drinker's enrolled face-sample count, as `GET /api/faces/counts` (admin role)
 * returns it — feeds the Users page's "N face samples" + "Delete face data" affordance.
 * A drinker with zero samples is simply absent from the array (see
 * countFaceEmbeddingsByDrinker, db/faceEmbeddings.ts), never a `{count: 0}` row. Defined
 * locally rather than type-imported from db/faceEmbeddings.ts's `Map`-returning function —
 * a `Map` isn't JSON-serializable, so there's no shared server type for this shape anyway. */
export interface FaceCount { drinkerId: number; count: number }

export function getFaceCounts(): Promise<ApiResult<FaceCount[]>> {
  return request('/api/faces/counts');
}

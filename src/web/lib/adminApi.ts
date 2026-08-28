/**
 * COMPATIBILITY BARREL — the admin API client, split by domain.
 *
 * This file used to hold every authed API function (~1150 lines). It is now a pure
 * re-export surface so the whole admin SPA's existing
 * `import { ... } from '../../lib/adminApi'` sites keep working unchanged:
 *
 * - `./adminHttp.ts` — the ONE authed transport (session credentials, the 401 ->
 *   `/admin/login?next=…` redirect, `sanitizeNextPath`), built on `./http.ts`'s shared
 *   `httpRequest`. Every module below builds on its `request`; nothing reimplements it.
 * - `./admin/<domain>.ts` — the per-domain endpoint wrappers + their local types.
 *
 * New admin endpoints belong in the matching `./admin/` module (or a new one), re-exported
 * here. Keep exports across those modules collision-free: `export *` silently drops a name
 * exported by two modules, which would break importers of this barrel.
 */
export * from './adminHttp';
export * from './admin/auth';
export * from './admin/dashboard';
export * from './admin/pours';
export * from './admin/beers';
export * from './admin/suppliers';
export * from './admin/games';
export * from './admin/taps';
export * from './admin/monitors';
export * from './admin/walls';
export * from './admin/displays';
export * from './admin/users';
export * from './admin/settings';
export * from './admin/stats';
export * from './admin/automations';
export * from './admin/logs';
export * from './admin/system';
export * from './admin/doctor';
export * from './admin/presence';

import type { Settings } from '../db/settings.js';

/**
 * Settings keys whose value actually changes which ingest sources should be running (see
 * `ingest/bootstrap.ts`'s `registerConfiguredSources`) — a PATCH touching any of these
 * triggers a live stop/reconfigure/restart cycle of `ctx.sources` (`routes/crud.ts`'s
 * `PATCH /api/settings`), and drives the admin Settings page's "Sources restarted to apply
 * changes" notice.
 *
 * Lives in `core/` — a module with only a TYPE import (of `db/settings.ts`, itself
 * dependency-free beyond zod/`core/errors.ts`) — rather than as a private constant inside
 * `routes/crud.ts`, so it can be imported as a real VALUE from both the server route and
 * the web admin client (`AdminLayout.tsx`) without dragging any Fastify request/reply
 * augmentation into `tsconfig.web.json`'s program. Same pattern as `core/lookupTypes.ts`
 * (see that file's doc comment) — this is the fix for the Phase 4 Task 8 report's
 * "hand-duplicated `SOURCE_RESTART_KEYS`" carry-over: before this module existed, the two
 * copies (`routes/crud.ts` and `SettingsPage.tsx`) had to be kept in sync by hand because a
 * type-only import of the ROUTES file would have pulled its Fastify augmentations into the
 * web tsconfig's program and broken typecheck there.
 */
export const SOURCE_RESTART_KEYS: readonly (keyof Settings)[] = [
  'kegtronApiKey', 'udpEnabled', 'mqtt', 'bleDirectEnabled',
];

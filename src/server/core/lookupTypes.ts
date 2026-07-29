/**
 * Result shapes for Task 4's lookup proxies (`routes/lookup.ts`). Kept in `core/` — a
 * module with NO imports of its own — rather than defined directly in `routes/lookup.ts`,
 * for the same reason `TapState` lives in `core/state.ts` and not a routes file: the web
 * client type-imports these (`web/lib/adminApi.ts`, per this repo's "types via type-only
 * server imports" convention), and `tsconfig.web.json` compiles that import's WHOLE
 * module graph, not just the named types. `routes/lookup.ts` itself imports `requireRole`
 * from `./auth.js` and helpers from `./uploads.js` — both of which use Fastify request/
 * reply properties (`req.cookies`, `app.ctx`, `reply.setCookie`) that only typecheck
 * inside the SERVER project, where `app.ts`'s `declare module 'fastify'` augmentation and
 * `@fastify/cookie`'s own augmentation are also part of the program. Pulling `routes/
 * lookup.ts` into the web project's compile (as a type-only import from a routes file
 * would) drags those in too and breaks typecheck with no such augmentation present there.
 * A dependency-free `core/` module sidesteps that entirely.
 */

export interface BreweryLookupResult {
  name: string;
  city: string | null;
  state: string | null;
}

# syntax=docker/dockerfile:1.7

# Kegwall — production image.
#
# There is no server BUILD step: the app runs its TypeScript server source
# directly under tsx at container start (see the runtime stage's CMD). Only
# the web SPA is compiled ahead of time (`vite build` -> dist/web), which
# `src/server/routes/static.ts` serves alongside the API. tsx therefore has
# to be resolvable at runtime, so it lives in "dependencies" (not
# "devDependencies") in package.json — see that file's comment-free move;
# the reasoning is recorded here since it's not obvious from a `package.json`
# diff alone. Without that move, the runtime stage's `npm ci --omit=dev`
# below would prune tsx and the image simply wouldn't start.
#
# ---------------------------------------------------------------------------
# Optional native dependency handling (@abandonware/noble, direct-BLE Gen1
# ingest): it's listed under package.json's `optionalDependencies` precisely
# because its transitive native binding (bluetooth-hci-socket -> usb, which
# needs libusb headers) is not guaranteed to compile on every
# platform/arch this image targets — the node:24-slim base has no libusb-dev,
# and cross-building e.g. linux/arm64 on an amd64 builder (or vice versa) can
# fail outright. `npm ci` is documented to treat a failed OPTIONAL dependency
# as non-fatal, but to not bet the whole image build on that behavior being
# honored consistently across npm/platform combinations, every `npm ci` in
# this file uses an explicit `|| npm ci ... --omit=optional` fallback: try the
# full install first (so noble/direct-BLE works when it CAN build), and if
# that install fails for ANY reason, retry once without optional deps so the
# build always completes. better-sqlite3 (a required, non-optional
# dependency) is unaffected by this fallback either way — the base build
# toolchain installed below (python3/make/g++) exists so IT always succeeds.
# ---------------------------------------------------------------------------

########################################################################
# Stage 1: deps — full dependency install (incl. devDependencies), with the
# native build toolchain better-sqlite3 needs. Reused by the "web" stage
# below to run `vite build` (needs vite/@vitejs/plugin-react/tailwindcss,
# all devDependencies).
########################################################################
FROM node:24-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci || npm ci --omit=optional

########################################################################
# Stage 2: web — compile the Vite SPA to dist/web.
########################################################################
FROM deps AS web
WORKDIR /app

COPY tsconfig.web.json vite.config.ts ./
# The web app is NOT fully decoupled from the server tree: most cross-imports
# (types like TapState, WallConfig, Beer, ...) are `import type` and get
# erased by esbuild before Rollup ever needs to resolve them, but a few
# modules under src/server/core are imported as real VALUES from the web
# side too — e.g. SettingsPage.tsx imports SOURCE_RESTART_KEYS from
# server/core/restartKeys.js, and wallEditorConfig.ts/WallEditor.tsx import
# the wallConfigSchema zod schema from server/core/wallConfig.js — by design
# (see those files' doc comments: kept dependency-free of the rest of the
# server so sharing them with the web build's module graph is safe). There
# is no separate src/shared directory; src/server plays that role for this
# handful of files. Copying the whole tree (rather than hand-picking just
# those few files) is the robust choice here — it can never drift out of
# sync with which cross-imports exist, and it costs nothing in the final
# image since this build stage's output is only dist/web (see the runtime
# stage's `COPY --from=web` below), not this stage itself.
COPY src/server ./src/server
COPY src/web ./src/web
RUN npm run build

########################################################################
# Stage 3: runtime — production-only deps + server source, no build
# toolchain, non-root user.
########################################################################
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/dist/web \
    PORT=8080

# Multi-stage builds don't share node_modules across FROM lines, so
# better-sqlite3 needs rebuilding here too. The install-build-tools /
# npm-ci / purge-build-tools sequence is deliberately ONE RUN instruction
# (one layer): Docker layers are additive, so purging apt packages in a
# LATER RUN would only mark them deleted in a new layer while the earlier
# "apt-get install" layer's ~270MB of compiler/toolchain data stays baked
# into the image underneath it. Doing it all in a single layer is the only
# way the build toolchain doesn't end up shipped in the final image.
#
# better-sqlite3 bundles PREBUILT binaries for common platform/arch pairs
# (node_modules/better-sqlite3/prebuilds/*.node) and prefers one of those
# over compiling from source whenever a matching file is present — found the
# hard way in local testing (on node:22-slim/bookworm): its linux-arm64
# prebuild was built against a newer glibc (2.38) than the base image shipped
# (2.36), so the container crashed at startup with `dlopen` ERR_DLOPEN_FAILED
# ("GLIBC_2.38 not found") despite `npm ci` itself reporting success. This
# is exactly why the build toolchain above exists — force a real from-source
# compile against THIS image's actual glibc, instead of trusting whichever
# prebuild happens to be bundled: delete the bundled prebuilds (so
# `lib/binding.js`'s prebuild lookup can't find one — see that file, it
# prefers a prebuild unconditionally when present, even next to a freshly
# built binary) and compile fresh.
#
# Why direct node-gyp and not `npm rebuild better-sqlite3 --build-from-source`:
# better-sqlite3 has no explicit install script (it ships prebuilds instead).
# npm 10 (node 22) would still run the IMPLICIT `node-gyp rebuild` that
# binding.gyp packages get — that's what made this block work historically.
# npm 11 (node 24) gates install scripts behind allowScripts and silently
# SKIPS that implicit step, exiting 0 with "rebuilt successfully" while
# compiling nothing — the image then crashes at startup with MODULE_NOT_FOUND
# because the prebuilds are already deleted. Invoking npm's own bundled
# node-gyp directly sidesteps script gating deterministically; the smoke-test
# `node -e` below fails the BUILD if the binary is ever missing again. The
# obj.target/.deps intermediates and the test extension are stripped to keep
# the layer lean.
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && (npm ci --omit=dev || npm ci --omit=dev --omit=optional) \
    && rm -rf node_modules/better-sqlite3/prebuilds \
    && (cd node_modules/better-sqlite3 \
        && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild \
        && rm -rf build/Release/obj.target build/Release/.deps build/Release/test_extension.node) \
    && node -e "require('better-sqlite3')(':memory:').exec('select 1')" \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Server source (run directly by tsx, no build step) + migrations (loaded by
# path relative to src/server/db/migrate.ts, so they must ship as files, not
# be bundled) + the ONE operational script the image runs (`npx tsx scripts/seed.ts`,
# run ad hoc against a live /data volume). No src/shared directory exists in this
# repo — the server tree is self-contained. Only seed.ts is copied — the dev/audit
# scripts (e2eAudit.ts, phase5AuditScreenshots.ts, host installers) have no business in
# a production image.
COPY src/server ./src/server
COPY scripts/seed.ts ./scripts/seed.ts
COPY --from=web /app/dist/web ./dist/web

# Deliberately NOT `chown -R node:node /app`: overlayfs has to copy-up any
# file whose ownership changes out of a read-only lower layer, so a
# recursive chown over the ~250MB node_modules/dist/web tree above would
# silently double the image's size in a new layer for no functional gain.
# The 'node' user only needs to READ app code/deps (default npm/apt file
# perms — root-owned, world-readable — already allow that) and WRITE to
# /data (the actual runtime state — SQLite DB, uploads, staged restores),
# so only /data's ownership needs changing, and it's empty at build time
# (cheap: nothing to copy up).
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME /data
EXPOSE 8080

# curl isn't present on node:24-slim; use Node's built-in fetch instead so the
# healthcheck doesn't need an extra apt package.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/server/index.ts"]

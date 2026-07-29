# Changelog

## Unreleased

- **Added:** Pour Wall overhaul Phase 1 — the wall "look" system (design handoff
  `design_handoff_pourwall_overhaul`). New per-wall `look` axis alongside themes:
  `Classic grid` (unchanged default), `Ledger` (1a, row-per-tap data ledger), `Gallery`
  (1b, 3-across card grid) and `Tap columns` (1c, tap-handle columns with page-cycle
  dots). Four dynamic SVG data glyphs drive the looks: style-matched SRM glassware
  (pint/nonic/tulip/flute/goblet/mug auto-picked from the beer style), an IBU-filled hop
  cone, ABV mini-pint strength glasses, and a keg-type-matched keg level silhouette —
  each in a per-wall `flat`/`outline`/`duotone` glyph style. Six new themes (Midnight
  Slate — the new default for new walls — Cream, Cellar Teal, Taproom Green, Amber Glow,
  Arcade) in Barlow/Barlow Condensed, with status/border/faint-text tokens added to the
  theme system; the four pre-overhaul themes remain for existing walls. Looks carry the
  full wall chrome in their own voice: NEW ON TAP / ALMOST GONE / live POURING badges,
  % remaining everywhere, header announcement line (`header.subtitle`), KEGTRON sensor
  chip, footer marquee ticker, in-chrome menu QR, and page-cycle dots. Wall editor gains
  Look, Glyph style and Announcement fields with the live preview.

- **Removed:** the Untappd integration (beer search/lookup and label-art import, plus its
  Settings → Integrations credentials fields) — Untappd's v4 API no longer grants new
  developer credentials, making the feature unusable for any new install. The Kegtron Pro
  device import's own label-art download (decoding a device's own configured label id,
  unrelated to the removed search API) is unaffected. Open Brewery DB brewery autocomplete
  is unaffected.
- **Added:** a keg cutaway fill style for walls — per-wall "Fill style" option (`Beer-colored
  liquid` or `Keg cutaway`) rendering photorealistic cutaway keg art matched to the keg's
  size (½/¼/sixtel/50L/corny/slim-quarter/mini, auto-matched from Kegtron's keg size with a
  manual "Keg type" override on kegs), a traffic-light level color (green → yellow → red as
  the keg empties) and a live percent readout centered in the keg.
- **Added:** an offline BJCP-2021-style autocomplete for the beers form's style field
  (`StyleAutocomplete`) — a local, no-network suggestion list (`src/web/data/beerStyles.ts`)
  that fills the gap left by the removed Untappd style autofill, working the same on day
  one for every install with no API key required.
- **Fixed:** the Kegtron Pro cloud source's notify WebSocket now sends an `Origin` header
  on the handshake (matching Kegtron's own Node.js example) — mdash.net 403s the
  connection without one, which was silently degrading every install to 5-minute polling
  instead of live push updates.
- **Added:** catalog.beer beer search (optional, own API key) — a `BeerSearchSheet` in the
  beers form (Settings → Integrations → Catalog.beer) fills name/brewery/style/ABV/IBU/
  description from a search-on-submit lookup against catalog.beer's `/beer/search`. No
  label art (catalog.beer's API has none) and a 1,000 requests/month free-tier cap, which
  is why searches fire only on Enter/button, never per keystroke.

## v0.1.0 — initial release

First shippable version of Kegtron Dashboard: a self-hosted, standalone-first tap wall
for Kegtron keg monitors with optional Home Assistant integration. Built across six
phases (`docs/superpowers/plans/`); this entry summarizes what shipped, not a commit log.

### Server core

- Fastify server (REST under `/api`, WebSocket at `/ws`, static SPA hosting), SQLite via
  better-sqlite3 in WAL mode with embedded, checked-at-boot migrations.
- Typed internal event bus + state manager: every ingest source emits normalized events
  (`volume_update`, `pour_started`/`pour_progress`/`pour_completed`, `telemetry`,
  `device_discovered`/`online`/`offline`, `source_status`); the state manager is the sole
  writer to the DB and broadcaster to WebSocket clients.
- Multi-user accounts with three roles (viewer/editor/admin), session-cookie auth, a
  first-run setup wizard, and a role matrix enforced on every route.
- Backup/restore: one-click consistent-snapshot download, staged (restart-to-apply)
  restore with an automatic `.bak` safety copy, and a documented manual crash-loop
  recovery procedure.

### Kegtron ingest

- Kegtron Pro cloud source (mdash.net REST + WebSocket notify channel, 5-minute polling
  fallback) plus optional local UDP multicast for sub-second pour updates.
- Kegtron Gen 1 (KT-100/KT-200) direct Bluetooth LE source — a verified, byte-exact port
  of the `kegtron-ble` Home Assistant integration's parser.
- Kegtron Gen 1 MQTT-bridge source (OpenMQTTGateway/Theengs) for devices out of direct BLE
  range — a documented best-effort payload parser (no confirmed Kegtron Theengs profile
  exists to verify against; see the Gen 1 doc for the exact accepted keys).
- Pour deduplication across sources, historical servings backfill, and automatic monitor
  discovery feeding the admin Monitors page.

### Wall + menu

- Public, unauthenticated wall (`/wall/:slug`) — configurable columns, card density,
  multi-page rotation, four built-in themes with token overrides, a raw custom-CSS escape
  hatch (trust model documented), live pour animation, optional ticker/QR code, and an
  OLED-friendly idle screensaver.
- Public mobile menu (`/menu/:slug`) with a claim-your-pour flow feeding the leaderboard.

### Admin UI

- Beers (Untappd + Open Brewery DB lookup, label upload with SRM-color preview), taps/kegs
  with a guided swap wizard, monitor binding, a live-preview wall editor, users, settings,
  and a stats page (pours/day, busiest hours, per-keg depletion + projected kick date,
  volume by beer, temperature history, leaderboard by week/month/all-time).

### Alerts, automations + Home Assistant

- Rule-based alert engine (keg-low, kicked, temperature threshold, source offline,
  scheduled...) with a notification center and one-click templates.
- Delivery channels: in-app, ntfy/Pushover, email (SMTP), Discord/Slack webhooks, MQTT.
- Automation rule builder (triggers + actions) with run-now testing.
- Optional Home Assistant MQTT discovery publisher (per-tap and per-monitor entities,
  Last-Will-based availability) plus two non-retained event topics for HA automations;
  fully opt-in and not required for the app to function.

### Packaging

- Multi-stage Dockerfile (deps → web build → runtime), non-root user, `/data` volume,
  `HEALTHCHECK` on `/api/health`; a single production image, live-verified via
  `docker build`/`docker run`/`docker compose up`.
- `deploy/docker-compose.yml` (bridge network) and
  `deploy/docker-compose.host-network.yml` (for UDP broadcast / direct BLE).
- GitHub Actions CI (typecheck, unit tests, build, Chromium E2E on every push/PR) and a
  release workflow (multi-arch GHCR image build on `v*` tags) — both written and
  YAML-validated; unexercised until this repository has a GitHub remote.
- Seven user-facing docs (Docker/NAS, Raspberry Pi, ESP32/Gen 1 MQTT, Kegtron Pro cloud
  setup, Home Assistant setup, backup/recovery, wall customization) plus this README.

### Known limitations

See the README's [Current limitations](README.md#current-limitations-read-before-you-rely-on-this)
section: Gen 1 MQTT payload shape unverified against real hardware, Untappd lookup
requires your own API credentials, session cookie has no `Secure` flag (by design for
plain-HTTP LAN use), and Raspberry Pi bare-metal/direct-BLE steps are unverified against
physical hardware. Native TV apps and two-way Kegtron cloud sync are backlogged, not
started.

### Testing

1570 unit tests (Vitest) and 6 Playwright E2E tests green at release; full local gate
(`npm test && npm run typecheck && npm run build && npm run test:e2e`) run repeatedly
throughout Phase 6 to catch packaging-introduced regressions.

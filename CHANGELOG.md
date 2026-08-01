# Changelog

## [0.15.0](https://github.com/dlommm/Kegwall/compare/v0.14.1...v0.15.0) (2026-08-01)

## [0.14.1](https://github.com/dlommm/Kegwall/compare/v0.14.0...v0.14.1) (2026-08-01)

## [0.14.0](https://github.com/dlommm/Kegwall/compare/v0.13.0...v0.14.0) (2026-08-01)

## [0.13.0](https://github.com/dlommm/Kegwall/compare/v0.12.0...v0.13.0) (2026-07-31)

## [0.12.0](https://github.com/dlommm/Kegwall/compare/v0.11.3...v0.12.0) (2026-07-31)

## [0.11.3](https://github.com/dlommm/Kegwall/compare/v0.11.2...v0.11.3) (2026-07-31)

## [0.11.2](https://github.com/dlommm/Kegwall/compare/v0.11.1...v0.11.2) (2026-07-31)

## [0.11.1](https://github.com/dlommm/Kegwall/compare/v0.11.0...v0.11.1) (2026-07-31)

## [0.11.0](https://github.com/dlommm/Kegwall/compare/v0.10.0...v0.11.0) (2026-07-31)

## [0.10.0](https://github.com/dlommm/Kegwall/compare/v0.9.0...v0.10.0) (2026-07-31)

## [0.9.0](https://github.com/dlommm/Kegwall/compare/v0.8.2...v0.9.0) (2026-07-31)

## [0.8.2](https://github.com/dlommm/Kegwall/compare/v0.8.1...v0.8.2) (2026-07-30)

## [0.8.1](https://github.com/dlommm/Kegwall/compare/v0.8.0...v0.8.1) (2026-07-30)

## [0.8.0](https://github.com/dlommm/Kegwall/compare/v0.7.2...v0.8.0) (2026-07-30)

## [0.7.2](https://github.com/dlommm/Kegwall/compare/v0.7.1...v0.7.2) (2026-07-30)

## [0.7.1](https://github.com/dlommm/Kegwall/compare/v0.7.0...v0.7.1) (2026-07-30)

## [0.7.0](https://github.com/dlommm/Kegwall/compare/v0.6.0...v0.7.0) (2026-07-30)

- **Added:** Govee sensors are first-class devices now. Each discovered sensor becomes
  a real monitor row: a card on the Monitors page (rename, Enable/Disable — disabling
  stops its cloud polling entirely and drops its wall chip, while the card stays for
  re-enabling), readings persisted to the telemetry store, and a per-sensor
  temperature/humidity chart in Analytics next to the Kegtron devices. The wall-chip
  endpoint hides disabled sensors. **Removed:** the internal `govee.names` settings
  map (it never had a UI) — sensor names now live on the Monitors page.
- **Added:** hidden taps. A per-tap "Hide from wall & menu" toggle (Taps admin) drops
  the tap from the public wall, QR menu, and Home Assistant (existing entities are
  tombstoned automatically) while it stays in the admin with a HIDDEN badge — for
  multi-port Kegtrons with fewer kegs than ports.

## v0.6.0 — 2026-07-29

The last hand-cut release: from here on, releases are automated — conventional commits
on main drive semantic-release (version, changelog entry, tag, GitLab release), and the
tag pipeline publishes the registry image as the version tag + `latest`.

- **Added:** Kegtron devices are now first-class. Monitor ports group into physical
  devices everywhere: the admin Monitors page shows one card per device (editable
  device name, firmware/online, one WiFi check, one temp/humidity panel) with a port
  table where each port still binds to a tap; the Analytics temperature picker lists
  one entry per device instead of one identical option per port; Home Assistant gets
  one discovery device per physical Kegtron (anchored on the port-0 row so common-case
  topics/unique_ids don't move) instead of N null-temp clones; and the cleaning-due
  automation fires once per device, not once per port.
- **Fixed:** temperature now reads device-wide. Kegtron reports temp once per device
  (always recorded against port 0), so taps bound to ports 1-3 showed nothing — the
  wall header, dashboard keg-room card, telemetry endpoints, and HA state payloads now
  resolve the whole device's telemetry.
- **Added (breaking):** device→wall assignment (`wall_devices`, migration 011). Each
  wall is assigned specific Kegtron devices and shows only taps bound to their ports;
  a device can feed multiple walls. **Strict: a wall with no assigned devices shows NO
  taps — after upgrading, open each wall in the editor and check its devices, or your
  TVs render an empty wall.** The wall editor gains a Devices panel; hand-picked pages
  now choose within the assigned devices' tap pool.
- **Removed (breaking):** the Locations feature (migration 010 drops the `locations`
  table and every `location_id` column — stored location data is deleted). The admin
  sidebar switcher and the Locations half of the Displays page are gone; Displays and
  pairing are unchanged. Wall/device assignment replaces room scoping.
- **Changed:** Home Assistant entity topology — per-port temp/humidity entities for
  ports > 0 are no longer published. Retained discovery configs from a pre-upgrade
  process aren't auto-tombstoned; if stale HA entities linger, delete their retained
  `homeassistant/sensor/kegtron_monitor_*/config` topics on the broker once.
- **Fixed:** a fresh install with no API keys no longer boots into auto-created error
  notifications — a source that is merely *unconfigured* (Kegtron cloud / Govee key not
  set) now logs its unhealthy status as a warning; real failures of configured sources
  still error and notify.
- **Added:** the keg swap wizard's Size / Starting volume fields now prefill from what
  the bound Kegtron device itself reports (the keg size and starting volume set in
  Kegtron's own app arrive on every volume update), falling back to the beer's last keg
  as before; a note flags device prefills. Both mL inputs also show a live "≈ X.XX gal"
  readout, and `GET /api/monitors` now carries the device-reported config as `deviceKeg`.

## v0.5.0 — 2026-07-29

The Pour Wall overhaul release (Phases 1–6) plus the rename to **Kegwall**, new project
branding (banner/logo/favicon), GitLab CI with container-registry publishing
(`ghcr.io/dlommm/kegwall`, tagged `latest` + version), and an Unraid
Compose file (`deploy/docker-compose.unraid.yml`).

- **Changed:** Project renamed from **Kegtron Dashboard** to **Kegwall**. Package name,
  Docker image/container names (`kegwall`), systemd unit examples, backup filename
  (`kegwall-backup-YYYY-MM-DD.db`), web page title, HA device manufacturer, and the wall
  rotation chip label (now `KEGWALL`) all follow. **Breaking for MQTT/HA installs using
  the default topic prefix:** `appTopicPrefix` now defaults to `kegwall`, so state/event
  topics move from `kegtron-dashboard/...` to `kegwall/...` unless you had saved a custom
  prefix in Settings. Set `appTopicPrefix` back to `kegtron-dashboard` to keep old topics.
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
- **Added:** Pour Wall overhaul Phase 2 — pour takeover. A per-wall `takeover` setting
  (Off default / Full screen / Spotlight row / Split panel / Bottom dock / Screen fill,
  designs 2a·2b·9a·9b·9c) with a configurable trigger volume (default 60 mL ≈ 2 oz) so
  foam blips don't flash the TV. Driven by the live UDP pour counter over the existing
  `/ws` snapshot feed: enters when a pour passes the threshold, live-counts every packet,
  and exits ~2.5 s after the pour ends with a "pour complete" splash showing the final
  volume. Full shows the beer identity, giant accent counter, keg-remaining readout and a
  pour stream filling a style-matched glass; Spotlight dims the other rows/cards (works
  on classic and all looks); Split squeezes the wall left under a 640 px inverted panel
  with a progress hairline; Dock is a 110 px bottom bar; Fill floods the screen with the
  beer's real SRM liquid + foam band under a 220 px counter. All theme-token driven, all
  motion gated by prefers-reduced-motion.
- **Added:** Pour Wall overhaul Phase 3 — who's-pouring. A kegerator tablet kiosk at
  `/tablet/:slug` (wall-themed) with the passwordless 4-screen flow: avatar grid with
  pour counts → name + color signup (no email, no password) → armed ("You're up — pour
  from any tap") with automatic tap detection and the live counter → done screen
  ("Cheers — N oz of X logged · pour #N") with a 5 s auto sign-out. Arming is
  server-side (`/api/public/tablet/arm`, 10-min TTL, one pour per arming) so the pour
  attributes even if the tablet sleeps; an armed pourer beats a tap's default drinker.
  Pour quality score 0–100 from UDP flow-rate consistency, stored per pour and surfaced
  as the admin leaderboard's new Quality column. New public leaderboard endpoint + a
  standalone `/board` TV view with rank bars, gal/L volume, quality, and footer
  superlatives (most pours / smoothest pour / biggest pour). Phone QR claim flow now
  matches design 3b: 10-minute claim window (was 15), inline name-only "join & claim"
  signup, and "your phone remembers you" (localStorage) for one-tap claims.
- **Added:** Pour Wall overhaul Phase 4 — admin overhaul. New shell per design 5a: 230 px
  sidebar (brand + site name, a location-switcher slot, nav with copper active state and
  3 px left border, appearance picker, avatar user chip) and a 62 px topbar (page title,
  ⌘K quick-nav search, notification bell, "View wall ↗"). Three admin looks selectable
  like wall themes: Midnight Slate (default dark), Workshop (light) and Console
  (terminal green, IBM Plex Mono). Dashboard rebuilt to design 5a: four stat cards
  (Today's pours, On tap with almost-gone/kicked, Keg room temp, Sources healthy) over
  live tap rows with real SRM swatches + status-colored level bars, a KEGTRON sensor
  mini-card, source health, and the activity feed. Taps & kegs page becomes keg cards
  (design 5b): keg-type silhouette glyph, badges, style · ABV · keg type, remaining
  oz/pints, and a "Kicks in ~N days at current pace" forecast. New unified Logs page
  (design 5d) backed by a new `logs` table and `LogService`: one stream for
  app/kegtron/wall/tablet/sensors/automations/pours events with source + level filter
  chips (live warn/error counts), search, time ranges, a 2 s live tail, expandable error
  details, JSON/CSV export, configurable retention (default 30 days, pruned at boot) and
  errors auto-creating an in-app notification. New Pourers page (11c first cut): pourer
  card grid with pours · volume · quality and an invite QR. Sidebar gains
  Pourers/Analytics/Logs; Stats is now labeled Analytics.
- **Added:** Pour Wall overhaul Phase 5 — rotation, displays, locations. View rotation
  (design 4a/4b): a per-wall playlist (Pour wall / Leaderboard, each with its own
  seconds and on/off) cycling with the wall's transition, a playlist bar along the TV
  bottom showing position, and a live pour ALWAYS interrupting back to the wall view;
  walls with more than 6 taps auto-chunk into 6-per-page cycles on the overhaul looks.
  Displays (design 7c): paired physical screens — an admin creates one on the new
  Displays & locations page (minting a short pairing code), the TV opens `/display` and
  types the code once, and from then on renders its assigned wall with optional
  per-display look/takeover overrides; last-seen tracked per display. Locations (design
  11a): first-class places with CRUD; monitors gain a friendly name + location, taps and
  walls gain a location, and the admin sidebar's location switcher now scopes the
  Dashboard/Taps tap lists (persisted per browser).
- **Added:** Pour Wall overhaul Phase 6 (part 1) — the turn-8 look library, completing
  all 10 wall looks: Chalkboard (8a, Caveat hand-lettering, chalk-outline glassware,
  dashed dividers, dotted price leaders), Editorial (8b, Playfair Display serif,
  numbered 01–06, notes column, hairline "P% REMAINS" bar), Neon Arcade (8c, glow
  borders/text-shadows, gradient level bars, big ABV), Terminal (8d, IBM Plex Mono,
  `[██████░░░░]` ASCII bars, box-drawing frame), Poster (8e, each row's background IS
  the beer's real SRM hex with luminance-picked ink), Departures (8f, split-flap board
  with a POURING/LOW/ON TIME status column) and Zen (8g, SRM dot + hairline level).
  Every look shows % remaining, renders badges/pour-spotlight state in its own voice,
  and supports page-cycle dots; colors read through theme tokens so all 10 looks pair
  with any theme. Caveat + Playfair Display added via Fontsource.
- **Added:** Pour Wall overhaul Phase 6 (part 2) — the data & feature pack.
  **Govee sensors:** cloud API poller (~60 s) as a real ingest source with an API key in
  Settings → Integrations, named chips on the wall header strip and a >2.5 °F
  cross-sensor spread warning into Logs; a Govee freshness check in the doctor.
  **Kegtron-first beers (6g):** the shadow differ now emits `beer_seen` and unseen device
  beers auto-import into the library (name/brewery/style/ABV/IBU/SRM straight from the
  device) with a "saved to library" wall banner; toggleable in Settings. (The handoff's
  Untappd metadata pull is N/A — Untappd was removed; catalog.beer remains the manual
  enrichment path.) **Rate-after-claim + passport (6a):** 5-star + quick-tag rating on
  the claim-success sheet (10-min claim, 24 h rating window), per-beer ★ average on the
  Ledger/Gallery looks, and a passport card on the menu for a remembered phone — pours /
  gallons / styles / quality, badges (First pour, Century Club, First to try, Style
  explorer, Smooth operator) and recent pours with ratings. **Session mode (6c):** a
  group tab started on the tablet — members join by tapping their avatar, live
  per-member bars poll every 5 s, End session shows a recap. **Cost tracking + KPIs
  (6d/10a):** kegs take a cost; the Stats page is now Analytics with a KPI row (pours,
  volume, kegs kicked, cost/pint, value-on-tap, avg quality), a day×hour busiest-hours
  heatmap, and Export all (JSON). **Line cleaning + next-up (6e):** per-tap cleaning log
  (due after 15 gal or 4 weeks) with a CLEANING DUE badge + Log cleaning button on Taps
  & kegs, and a NEXT UP chip on the wall when a low tap has an on-deck keg queued.
  **Milestones + screensaver (6f):** every 100th pour and every keg kick celebrate via a
  wall banner; the screensaver gains a big dim clock. **Connection doctor (11e):**
  /admin/doctor — Kegtron cloud auth/device-count/latency test, a 10 s live-path listen
  with per-monitor event counts ("pour now to prove the live path"), Govee freshness,
  and a Docker network-mode check that explains the host-network fix for UDP; results
  land in Logs, linked from Settings.

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

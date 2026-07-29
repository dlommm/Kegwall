# Kegwall

[![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/ci.yml)
[![Release](https://github.com/<owner>/<repo>/actions/workflows/release.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A self-hosted, PourWall-style digital tap wall for [Kegtron](https://kegtron.com) keg
monitors — live keg levels, beer metadata, and pour animation on any TV browser. It's
**standalone-first**: it runs fully on its own, with an entirely optional Home Assistant
integration on top. One Docker image, one SQLite database, no cloud account required to
operate (only to talk to Kegtron's own hardware API).

Where [PourWall](https://pourwall.info)'s Kegtron integration only syncs keg level percent,
this app pulls full metadata — beer name, brewery, style, ABV, IBU, temperature, pour
history — and layers on live pour animation (from Kegtron's local UDP stream), alerts,
automations, and deep wall customization.

![Tap wall on a TV display, showing four taps with beer name, brewery, style, ABV, and IBU](docs/images/wall.png)

## Screenshots

| Admin stats | Mobile QR menu |
|---|---|
| ![Admin stats page with pours-per-day chart, keg depletion, volume by beer, and leaderboard](docs/images/admin-stats.png) | ![Mobile menu page with tap list and a claim-your-pour prompt](docs/images/menu.png) |

## What it does

- **Ingests from both Kegtron hardware lines** — Pro (cloud REST + WebSocket, plus optional
  local UDP multicast for sub-second pour updates) and Gen 1 KT-100/KT-200 (direct
  Bluetooth LE, or via an MQTT bridge for devices out of range).
- **Public wall + QR menu** — a TV-friendly grid of tap cards (`/wall/:slug`, no login) with
  live pour animation, page rotation, four built-in themes, per-field visibility, and a
  raw custom-CSS escape hatch; a mobile menu page (`/menu/:slug`) drinkers can scan to and
  claim their pour for the leaderboard.
- **Admin UI** — beers (Open Brewery DB brewery lookup, offline BJCP-style autocomplete,
  optional catalog.beer beer search with your own API key), taps/kegs with a guided
  keg-swap flow, monitor binding, a live-preview wall editor, multi-user accounts with
  roles (viewer/editor/admin), and stats (pours/day, busiest hours, keg depletion, volume
  by beer, temperature history, leaderboard).
- **Alerts + automations** — a rule engine (keg-low, kicked, temperature, offline source,
  scheduled...) with delivery over in-app notifications, ntfy/Pushover, email (SMTP),
  Discord/Slack webhooks, and MQTT — plus a notification center and one-click templates.
- **Optional Home Assistant integration** — publishes tap and monitor sensors via MQTT
  discovery (entities appear automatically, no HA YAML) and two event topics for pour/alert
  automations. The app works completely without it.
- **Backup + recovery** — one-click backup download and staged restore from the admin UI,
  with a documented manual recovery path if a restore ever goes wrong.

## Current limitations (read before you rely on this)

- **catalog.beer beer search is optional and limited.** It's a bring-your-own-API-key
  integration (Settings → Integrations) — nothing is searchable until you set one.
  catalog.beer's own coverage is roughly 60,000 beers (far short of Untappd's catalog),
  it has no label-art field at all (search results never include an image — add a label
  separately after picking a result), and its free tier caps out at 1,000 requests/month,
  which is why the search box only fires on submit (Enter/button), never per keystroke.
- **Gen 1 MQTT payload shape is unverified against real hardware.** Theengs Decoder has no
  built-in Kegtron device profile, so the MQTT-bridge parser is a documented best-effort
  inference (not a confirmed real-world payload) — see
  [docs/install/esp32-gen1.md](docs/install/esp32-gen1.md) for the exact accepted keys and
  how to check your bridge's output against them. The **direct-BLE** path for Gen 1 devices
  (no MQTT bridge needed) *is* a byte-exact port of a real, verified parser and is the
  preferred route if you can put the app within Bluetooth range — see
  [docs/install/raspberry-pi.md](docs/install/raspberry-pi.md#direct-ble-setup-gen-1-devices).
- **No Secure flag on the session cookie.** Deliberate, for plain-HTTP LAN deployments —
  see [docs/install/docker.md#reverse-proxy-and-https](docs/install/docker.md#reverse-proxy-and-https)
  before exposing this beyond a trusted LAN.
- **Raspberry Pi bare-metal and direct-BLE steps are unverified against physical hardware**
  (no Pi or real Kegtron Gen 1 device was available while writing these docs) — the Docker
  path *was* built and boot-tested live. Flagged explicitly in the Pi doc itself.
- **On the backlog, not started:** native TV apps (Android TV / Apple TV — browser + kiosk
  mode covers all TVs today) and two-way beer-metadata sync back to Kegtron's cloud (import
  is one-way in this version).

## Quickstart (Docker)

```sh
git clone https://github.com/<owner>/kegwall.git
cd kegwall/deploy
docker compose up -d
```

Open `http://localhost:8080` — first visit takes you to a one-time admin setup screen
(there is no default login). That's it; everything else (Kegtron API key, MQTT, alert
channels, walls...) is configured from the admin UI's Settings page.

No published image exists yet (see [Continuous integration](#continuous-integration)
below), so this builds the image locally from the repo's `Dockerfile` — the first `up -d`
takes a few minutes, subsequent ones are fast. Full reference — environment variables,
bridge vs. host networking (needed for Kegtron's UDP broadcast or direct BLE), reverse
proxy/HTTPS, and backup/updating — is in [docs/install/docker.md](docs/install/docker.md).

## Documentation

| Doc | Covers |
|---|---|
| [docs/install/docker.md](docs/install/docker.md) | Docker/NAS install, env vars, networking modes, reverse proxy + HTTPS, backups |
| [docs/install/raspberry-pi.md](docs/install/raspberry-pi.md) | Docker or bare-metal on a Pi, direct-BLE setup, kiosk-mode wall display |
| [docs/install/esp32-gen1.md](docs/install/esp32-gen1.md) | Gen 1 (KT-100/KT-200) via an ESP32 BLE-to-MQTT bridge, incl. the payload-shape caveat above |
| [docs/setup/kegtron-cloud.md](docs/setup/kegtron-cloud.md) | Kegtron Pro API key + optional UDP for faster local updates |
| [docs/setup/home-assistant.md](docs/setup/home-assistant.md) | MQTT discovery, entities published, event topics for automations |
| [docs/recovery.md](docs/recovery.md) | Backup, restore, and manual crash-loop recovery |
| [docs/customization.md](docs/customization.md) | Wall layout, themes, custom CSS trust model, screensaver |

## Tech stack

Single Node 22 / TypeScript process (ESM, strict): Fastify (REST + WebSocket + static
files), better-sqlite3 (WAL mode, embedded migrations), React 18 for the web frontend.
No separate server build step — the server runs its TypeScript source directly under
`tsx`; only the SPA is compiled ahead of time (`vite build`). See
[docs/superpowers/specs/2026-07-27-kegwall-design.md](docs/superpowers/specs/2026-07-27-kegwall-design.md)
for the full architecture writeup.

## Continuous integration

`.github/workflows/ci.yml` runs typecheck, the unit suite, the web build, and a Chromium
E2E smoke suite on every push/PR. `.github/workflows/release.yml` builds and pushes a
multi-arch (amd64 + arm64) image to GHCR on a `v*` tag. Both are written and validated
(YAML-lint clean, steps reviewed against each action's docs) but **not yet exercised on a
real run** — this repository doesn't have a GitHub remote yet, so the badges above are
placeholders. Replace `<owner>/<repo>` in this file (and in both workflow files' header
comments) with the real path once one exists.

## Running from source (without Docker)

```sh
npm ci
npm run build
npm start
```

Requires Node >= 22 and a C++ toolchain for better-sqlite3's native build (see
[docs/install/raspberry-pi.md#bare-metal-path](docs/install/raspberry-pi.md#bare-metal-path)
for the exact packages on Debian/Raspberry Pi OS). `npm run dev` runs the server under
`tsx watch` plus a separate `npm run dev:web` Vite dev server for frontend work.

```sh
npm test          # unit suite (Vitest)
npm run typecheck # tsc --noEmit, server + web projects
npm run test:e2e  # Playwright, against a production build
```

## Contributing

No formal process yet — this is a young project. Bug reports and pull requests are
welcome; for anything nontrivial, opening an issue first to discuss the approach is
appreciated. Run the full local gate before sending a PR:

```sh
npm test && npm run typecheck && npm run build && npm run test:e2e
```

## License

MIT — see [LICENSE](LICENSE). Full changelog: [CHANGELOG.md](CHANGELOG.md).

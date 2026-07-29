# Install with Docker

The supported way to run Kegtron Dashboard. One image, one persistent volume.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose version` should work). Docker
  Desktop on macOS/Windows or a Linux host both work for the basic path below.
- A Linux host if you need Kegtron Cloud's UDP broadcast discovery or the Gen 1
  direct-Bluetooth source — see [Networking: bridge vs. host mode](#networking-bridge-vs-host-mode).

## Quickstart

```sh
git clone <this repo's URL> kegtron-dashboard
cd kegtron-dashboard/deploy
docker compose up -d
```

Then open `http://<host>:8080`. First visit sends you to a one-time admin setup screen
(pick a username/password — there is no default login).

This builds the image locally from the `Dockerfile` in the repo root (`deploy/docker-compose.yml`
sets `build.context: ..`). No image is currently published to a registry — see
`.github/workflows/release.yml` for the multi-arch GHCR build, which needs a GitHub remote
to actually run (not yet true for this repo — see that workflow's header comment). Once a
tag is published there, swap the `build:` block for `image: ghcr.io/<owner>/<repo>:latest`.

## What's in the container

- Single production image (multi-stage build: deps -> web build -> runtime). No dev
  dependencies, no Playwright, no build toolchain in the final layer — see the
  `Dockerfile`'s own comments for the full reasoning. Built image is roughly 644MB.
- Runs as a non-root `node` user.
- `HEALTHCHECK` polls `GET /api/health` (`{"status":"ok"}` when the server is up) every 30s.
- Everything the app needs to persist — the SQLite database (`app.db`), uploaded beer
  label images, and any staged backup/restore file — lives under `/data`, declared as a
  `VOLUME`. `deploy/docker-compose.yml` mounts a named volume there
  (`kegtron-data`) so it survives `docker compose down` / image upgrades.

## Configuration

Everything is environment variables — there is no config file. All have sane defaults
baked into the image (`Dockerfile`'s `ENV` block); you only need to override them if you
have a reason to.

| Variable | Default (in-image) | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port the server listens on. |
| `DATA_DIR` | `/data` | Where `app.db`, uploads, and staged restores live. |
| `WEB_DIR` | `/app/dist/web` | Built SPA assets `routes/static.ts` serves. |
| `NODE_ENV` | `production` | Disables Fastify's dev-mode pretty logger. |

Everything else (site name, Kegtron API key, MQTT broker, alert channels...) is
configured from the admin UI's Settings page after first login, not via
environment variables — see [docs/setup/kegtron-cloud.md](../setup/kegtron-cloud.md) and
[docs/setup/home-assistant.md](../setup/home-assistant.md).

## Networking: bridge vs. host mode

`deploy/docker-compose.yml` uses Docker's default bridge network, which is fine for every
MQTT-based ingest path (Kegtron Cloud's WebSocket notify channel, Home Assistant
publishing, an external BLE-to-MQTT bridge) since those are outbound TCP connections the
container makes to a broker/server.

Two things need `deploy/docker-compose.host-network.yml` instead:

1. **Kegtron Cloud's UDP broadcast/multicast relay** (`Settings -> Sources -> "Listen for
   Kegtron UDP broadcasts"`) — Docker's bridge network NATs the container onto an isolated
   subnet, so LAN broadcast/multicast traffic never reaches it. Host networking puts the
   container directly on the host's network namespace, the same as a non-containerized
   process.
2. **The Gen 1 direct-Bluetooth source** (`Settings -> Sources -> "Listen for Kegtron Gen 1
   Bluetooth adverts directly"`) — talks to the host's Bluetooth adapter over a raw HCI
   socket, a host kernel resource bridge networking doesn't mediate at all. This also needs
   `--privileged` (or `--cap-add=NET_ADMIN --cap-add=NET_RAW`) and the adapter reachable
   inside the container — see [docs/install/raspberry-pi.md](raspberry-pi.md) for the full
   BLE setup.

`network_mode: host` only behaves as documented on a Linux host (bare metal or a Raspberry
Pi). Docker Desktop on macOS/Windows runs containers inside a Linux VM, so "host"
networking there is the VM's network, not your actual LAN — UDP discovery will not work
under Docker Desktop regardless of this setting.

```sh
cd deploy
docker compose -f docker-compose.host-network.yml up -d
```

## Reverse proxy and HTTPS

Kegtron Dashboard has no built-in TLS — it's meant to sit behind a reverse proxy (Caddy,
nginx, Traefik) if you want HTTPS, or to stay on a trusted LAN over plain HTTP.

Be aware of one specific thing before exposing it beyond a trusted LAN: the session cookie
(`src/server/routes/auth.ts`) is set `httpOnly` + `sameSite: 'lax'` but **does not set the
`Secure` flag**, and the server does not inspect `X-Forwarded-Proto` to decide whether to
add it. That's deliberate for LAN-over-plain-HTTP use (a `Secure` cookie would simply not
be sent at all over HTTP, breaking login for the common "just run it on the taproom LAN"
case) — but it does mean the cookie has no browser-enforced guarantee against being sent
over an unintended plaintext hop.

Practical guidance:

- If you terminate TLS at a reverse proxy, make sure **every** hop the browser can reach is
  HTTPS (redirect HTTP -> HTTPS at the proxy, don't leave a bare HTTP listener reachable in
  parallel) — the proxy terminating TLS doesn't retroactively protect a cookie that could
  still be sent to a plaintext endpoint if one exists.
- Prefer restricting access to a VPN or trusted LAN over exposing the login page directly
  to the public internet, since there's no additional cookie-level defense-in-depth here
  beyond what the proxy provides.
- The container itself doesn't need to know it's behind TLS — the proxy just needs to
  forward requests to `http://<container>:8080` as usual; no extra `PORT`/env
  configuration is required on the app side for a reverse-proxy setup.

## Backing up and restoring

The admin UI's Settings page has a Backup panel (download a consistent snapshot, or
upload+stage a restore). Full details, including the crash-loop recovery procedure if a
restore goes wrong, are in [docs/recovery.md](../recovery.md) — read that before you ever
need it, not after.

You can also back up the whole `/data` volume directly from the host, independent of the
app:

```sh
docker run --rm -v deploy_kegtron-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/kegtron-data-backup.tar.gz -C /data .
```

(Volume name may differ — check `docker volume ls`; Compose prefixes it with the project
directory name, e.g. `deploy_kegtron-data` when run from `deploy/`.)

## Updating

```sh
cd deploy
docker compose pull   # only if you switched to a published ghcr.io image
docker compose build  # only if still building locally from source
docker compose up -d
```

The named volume is untouched by an image rebuild/pull — your data persists across
upgrades. Database schema migrations run automatically on server startup
(`src/server/db/migrate.ts`).

## See also

- [docs/install/raspberry-pi.md](raspberry-pi.md) — Docker or bare-metal on a Pi, plus
  direct-BLE and kiosk-mode wall setup.
- [docs/install/esp32-gen1.md](esp32-gen1.md) — Gen 1 (KT-100/KT-200) devices via an ESP32
  BLE-to-MQTT bridge.
- [docs/recovery.md](../recovery.md) — backup/restore, including manual crash-loop recovery.
- [docs/customization.md](../customization.md) — walls, themes, custom CSS, screensaver.

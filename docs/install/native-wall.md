# Native wall client (flutter-pi) — PREVIEW

Kegwall can drive a wall screen two ways. This page covers the **native** one and how to tell
which mode a screen is in.

| Mode | What runs on the screen | Installer | Status |
| --- | --- | --- | --- |
| **Chromium kiosk** | `cage` (Wayland) + chromium showing `/wall/main` | `pi-install.sh --kiosk` | Supported ([Raspberry Pi guide](raspberry-pi.md)) |
| **Native** | [`flutter-pi`](https://github.com/ardera/flutter-pi) rendering `apps/wall-native` directly on DRM/KMS — no browser, no desktop | `pi-install.sh --native-wall` | **Preview** — needs on-device validation |

The native client talks to the same public API as every other display (`GET /api/public/wall/:slug`
+ `/ws`), presenting the per-display token, so nothing about the server changes. It works on both
**Raspberry Pi (arm64)** and **amd64 mini-PCs / Intel NUCs** — the same DRM/KMS path on each.

Why it exists: no browser means less RAM, a faster cold boot, no chromium update churn, and pour
animations rendered by Flutter instead of a web view.

## Which mode is this screen in?

One authoritative signal — the marker file the installers stamp:

```
cat /etc/kegwall/display-mode      # → chromium | native | (absent = no managed display)
```

The server surfaces the same value for the admin/first-run wizard:

```
GET /api/system/urls   →   { ..., "displayMode": "chromium" | "native" | "none" }
```

And the systemd unit name is the belt-and-braces tell:

```
systemctl status kegwall-kiosk    # chromium kiosk (cage + chromium)
systemctl status kegwall-wall     # native flutter-pi client
```

A server-only box (or a Docker host, or a browser you opened by hand) has no marker → `none`.

## Install

Fresh install, native from the start:

```bash
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh | sudo bash -s -- --native-wall
```

Or, on a box that already runs the server, point its screen at the native client:

```bash
sudo /opt/kegwall/scripts/native-wall-setup.sh --dir /opt/kegwall --port 8080 --slug main
```

`native-wall-setup.sh` flags: `--dir` (repo checkout), `--port`, `--slug`, `--base-url`
(defaults to `http://localhost:<port>`), `--token` (per-display token), `--bundle <dir>` (a
prebuilt `flutter_assets`), `--force`.

### What the installer does automatically

- Installs the flutter-pi runtime deps (libdrm/libgbm/libinput/mesa/…), arch-detected.
- Creates the `kegwall-kiosk` seat user (shared with the chromium kiosk) in `video,render,input`.
- Writes `/etc/kegwall-wall/config.json` — the `{ baseUrl, wallSlug, displayToken }` the Dart app
  reads (`apps/wall-native/lib/config.dart`).
- Installs the `kegwall-wall.service` unit (flutter-pi on tty1, DRM master via a logind seat).

### The two artifacts it can't build for you (preview)

A working native screen needs, in addition to the wiring above:

1. **A `flutter-pi` binary** — build it from source ([ardera/flutter-pi](https://github.com/ardera/flutter-pi))
   and put it on `PATH` or at `/usr/local/bin/flutter-pi`.
2. **The app bundle** (`flutter_assets`) — either build it (`cd apps/wall-native && flutter build bundle`),
   pass `--bundle <dir>`, or let the installer pull the `wall-native` CI artifact.

**Fail-safe:** if either artifact is missing, the installer leaves `kegwall-wall.service`
**disabled**, does **not** disable the tty1 console, and prints exactly what's needed — so a screen
can never end up black. The marker only flips to `native` once the service is actually enabled to
run, so `displayMode` never lies.

## Switch back to chromium

```bash
sudo systemctl disable --now kegwall-wall
sudo /opt/kegwall/scripts/pi-tablet-setup.sh --local --force "http://localhost:8080/wall/main"
```

That re-stamps the marker to `chromium`.

## Uninstall (back to a plain console)

```bash
sudo systemctl disable --now kegwall-wall
sudo rm -f /etc/systemd/system/kegwall-wall.service /etc/kegwall/display-mode
sudo rm -rf /etc/kegwall-wall /opt/kegwall-wall
sudo systemctl enable --now getty@tty1
```

## Roadmap

The native client is milestone-tracked in `apps/wall-native/README.md`. Milestone 1 (foundation:
config/token, models, REST+WS data layer, theme port, the Classic look, CI build) has landed;
the remaining looks, pour takeovers, rotation/screensaver, and per-arch AOT packaging are the
work that turns this from preview into a supported mode.

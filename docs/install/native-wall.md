# Native wall client (cog / WPE WebKit)

Kegwall can drive a wall screen two ways. Both render the **same web wall** (`/wall/:slug`, every
look/theme/takeover) — they differ only in the engine.

| Mode | Engine on the screen | Installer | Systemd unit |
| --- | --- | --- | --- |
| **Chromium kiosk** | `cage` (Wayland) + **chromium** | `pi-install.sh --kiosk` | `kegwall-kiosk.service` |
| **Native** | `cage` + **cog (WPE WebKit)** | `pi-install.sh --native-wall` | `kegwall-wall.service` |

The "native" client is [`cog`](https://github.com/Igalia/cog), the WPE WebKit launcher. It renders
the exact same web wall as the chromium kiosk, but in the much lighter WPE engine instead of
Blink — **smaller footprint, faster boot, no chromium update churn** — with **no second UI to
maintain** (one web codebase powers every display). Works on both **Raspberry Pi (arm64)** and
**amd64 mini-PCs / Intel NUCs**.

> Earlier previews explored a from-scratch [flutter-pi](https://github.com/ardera/flutter-pi) Dart
> client (`apps/wall-native/`). That path was shelved: it duplicated the entire wall UI in Dart for
> no rendering benefit over WPE. The Dart scaffold stays in-tree for reference but isn't wired to
> any installer.

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
systemctl status kegwall-wall     # native cog / WPE
```

## Install

Fresh install, native from the start:

```bash
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh | sudo bash -s -- --native-wall
```

Or, on a box that already runs the server, point its screen at the native client:

```bash
sudo /opt/kegwall/scripts/native-wall-setup.sh --port 8080 --slug main
```

`native-wall-setup.sh` flags: `--port`, `--slug`, `--base-url` (defaults to
`http://localhost:<port>`), `--token` (per-display token, appended as `?displayToken=…`),
`--url` (full override), `--force` (skip the display-manager-disable confirmation).

### What the installer does

- `apt install cog cage` (WPE WebKit + the tiny kiosk compositor).
- Creates the `kegwall-kiosk` seat user (shared with the chromium kiosk) in `video,render,input`.
- Installs `kegwall-wall.service` — `cage -d -- cog <wall url>` on tty1, owning the screen via a
  logind seat, waiting for `/api/health` first. `cage -d` hides the pointer; the wall CSS also
  sets `cursor: none`, so no mouse shows.
- Stamps `/etc/kegwall/display-mode = native`.

It's fast — no compile, no SDK. If a desktop display manager (lightdm/gdm3/sddm) is enabled, it
asks before disabling it (or pass `--force`).

## Restart / repoint

- **Restart the display**: the admin UI's "Restart kiosk display" button works for native too (it
  restarts whichever display unit is active). Over SSH: `sudo systemctl restart kegwall-wall`.
- **Repoint** to a different wall/URL: re-run `native-wall-setup.sh --slug <slug>` (or `--url`).

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
sudo systemctl enable --now getty@tty1
```

## Troubleshooting

- **Nothing on screen / cog exits**: `journalctl -u kegwall-wall -f`. The unit waits for
  `/api/health`, so a not-yet-ready server just delays start.
- **`cog` not found after install**: on some Debian releases the WPE runtime is split — also
  install `libwpewebkit-1.1-0` and/or `wpewebkit-driver`.
- **Mouse cursor visible**: the wall page sets `cursor: none`; if you're on an older build, add
  `* { cursor: none !important; }` to the wall's Custom CSS (Walls → edit).

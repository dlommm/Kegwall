# Raspberry Pi

A Pi at the kegerator is the sweet spot for Kegwall: perfect reception for Kegtron's
UDP pour multicast (same network segment, no VLAN questions), onboard Bluetooth for
direct Gen 1 BLE, and enough CPU for the whole stack. Two install styles are
first-class — pick one:

- **Docker** — pull the published multi-arch image; updates via the Watchtower
  sidecar and the admin UI's Update button.
- **Native (bare metal)** — one installer script sets up Node, the app, and systemd
  units including a self-updater the admin UI can trigger.

A **separate** Pi with a touchscreen can run the pourer tablet as a dedicated kiosk
(see [Touchscreen kiosk Pi](#touchscreen-kiosk-pi)), and the server Pi's own HDMI
output can show a wall on the TV it sits behind.

> **Honesty note:** the Docker image is built and boot-tested for arm64 in CI. The
> installer and kiosk scripts are source-reviewed but have **not** been exercised on
> physical Pi hardware yet, and the labwc/Wayfire/X11 autostart matrix on Raspberry
> Pi OS varies by release — both scripts print exactly what they detected and wrote.
> The direct-BLE decoder is a byte-exact port of a verified parser; the surrounding
> Pi steps share this same caveat.

## Docker path

```sh
mkdir -p ~/kegwall && cd ~/kegwall
curl -fsSLO https://raw.githubusercontent.com/dlommm/Kegwall/main/deploy/docker-compose.pi.yml
openssl rand -hex 16      # your Watchtower API token — paste into the compose file
docker compose -f docker-compose.pi.yml up -d
```

Open `http://<pi-ip>:8080`, create the admin account, then **Settings → System**:
mode **Docker — Watchtower sidecar**, URL `http://127.0.0.1:8090`, and the same
token. From then on **Update now** pulls the newest release and swaps the container
in the background — no SSH. (The compose file's comments explain the host-network /
loopback-sidecar topology; general Docker reference lives in
[docker.md](docker.md).)

## Native path (bare metal)

One command on a fresh Raspberry Pi OS (64-bit):

```sh
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh \
  | sudo bash -s --            # flags optional, see below
```

Flags: `--dir /opt/kegwall` (install location; data in `<dir>/data`), `--port 8080`,
`--with-ble` (BlueZ + capability grant for direct Gen 1 BLE), `--wall-slug main`
(also boot this Pi's display into a fullscreen wall — the server-behind-the-TV
setup).

What it installs: Node 22 (NodeSource) + build toolchain, a `kegwall` system user,
the app checked out at its **latest release tag**, and three systemd units —
`kegwall.service` (the server), `kegwall-update.service` + `kegwall-update.path`
(the self-updater: the admin UI's Update button writes a trigger file into the data
directory; the path unit notices and runs the privileged updater, which fetches the
requested release tag, rebuilds, restarts the service, and rolls back on failure —
the app process itself needs zero privileges).

After install: open `http://<pi-ip>:8080`, create the admin account, then
**Settings → System** → mode **Bare metal — Pi installer**. Done — the Update
button now works.

Uninstall: `sudo systemctl disable --now kegwall kegwall-update.path`, remove
`/etc/systemd/system/kegwall*.{service,path}` and
`/usr/local/bin/kegwall-update.sh`, `sudo deluser kegwall`, and delete the install
dir (back up `<dir>/data` first — that's the database and label images).

## Updating

Normal path: **Settings → System → Check for updates → Update now**. The UI shows
progress and confirms the new version when the server is back (typically under a
minute on Docker, a few minutes for a native rebuild).

Manual fallbacks:
- Docker: `docker compose -f docker-compose.pi.yml pull && docker compose -f docker-compose.pi.yml up -d`
- Native: `cd /opt/kegwall && sudo -u kegwall git fetch --tags && sudo -u kegwall git checkout --force <vX.Y.Z> && sudo -u kegwall npm ci && sudo -u kegwall npm run build && sudo systemctl restart kegwall`

## TV wall on the server Pi

The `--wall-slug <slug>` installer flag (or running
`sudo /opt/kegwall/scripts/pi-kiosk-setup.sh http://localhost:8080/wall/<slug>`
yourself, Docker installs included) boots the Pi's attached display into a chromium
kiosk showing that wall. Requires Raspberry Pi OS **with** a desktop; create a wall
with that slug in the admin UI. The script handles the labwc (Bookworm default) /
Wayfire / X11 autostart differences and disables screen blanking.

## Touchscreen kiosk Pi

A second Pi with the official touchscreen makes a great dedicated pourer tablet:

```sh
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-kiosk-setup.sh \
  | sudo bash -s -- http://<server-ip>:8080/tablet/<wall-slug>
sudo reboot
```

Fullscreen, touch-enabled, autologin, no blanking. Re-run with a new URL to repoint
it. (An Android tablet is the other option for this role — see
[android-tablet.md](android-tablet.md).)

## Migrating an existing install to the Pi

1. On the old server: **Settings → Backup → Download backup** (a `.db` file).
2. On the fresh Pi install: **Settings → Backup → Restore**, upload it, restart —
   the restore is staged and applied atomically at the next boot. This carries the
   whole database: beers, taps, kegs, pours, users, and all settings incl. secrets.
3. **Label images are NOT in the .db** — copy them from the old data directory
   (`/data` in Docker, `appdata` on Unraid) into the Pi's data directory by hand.
4. Re-check Settings → System afterwards: the update mode came over with the old
   settings and probably names the OLD deployment style — set it for this box.

## Direct BLE setup (Gen 1 devices)

This is the **verified** path for Kegtron Gen 1 (KT-100/KT-200) support — the BLE
advertisement decoder in `src/server/ingest/gen1/bleSource.ts` is a byte-exact port of the
real `kegtron-ble` Home Assistant integration's parser
(`github.com/Bluetooth-Devices/kegtron-ble`), not an inference. Compare with
[docs/install/esp32-gen1.md](esp32-gen1.md)'s MQTT-bridge path, which is explicitly
best-effort and unverified against real hardware — prefer this direct-BLE path if you have
a Linux host (a Pi qualifies) within Bluetooth range of your devices.

1. Direct BLE uses `@abandonware/noble`, an `optionalDependency` (it may or may not have
   installed successfully — see the Dockerfile's comment on why it's optional). It needs
   BlueZ (Raspberry Pi OS ships this already) and its headers — the installer's
   `--with-ble` flag does this, or by hand:

   ```sh
   sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev
   ```

2. Running as a non-root user needs a one-time capability grant on the Node binary (noble
   opens a raw HCI socket, which normally requires root):

   ```sh
   sudo setcap cap_net_raw+eip $(eval readlink -f "$(which node)")
   ```

   (Re-run this after any Node version upgrade — the capability is bound to that specific
   binary path/inode. `--with-ble` runs it once for you.)

3. In the admin UI: **Settings -> Sources -> "Listen for Kegtron Gen 1 Bluetooth adverts
   directly"**. No broker, no extra config — it scans directly.

4. If you're also running the MQTT-bridge path (`docs/install/esp32-gen1.md`) for other
   Gen 1 devices out of this host's Bluetooth range, both can run at once: BLE wins for any
   device it's actively hearing (a live sighting within the last 5 minutes), MQTT is the
   fallback for everything else — see `bleSource.ts`/`mqttSource.ts`'s "BLE/MQTT DEDUPE"
   comments for the exact handoff logic.

## See also

- [docker.md](docker.md) — general Docker reference: env vars, networking modes,
  reverse proxy + HTTPS, backups.
- [kegtron-cloud.md](../setup/kegtron-cloud.md) — API key + the UDP live-pour path.
- [android-tablet.md](android-tablet.md) — the Android alternative for the tablet.

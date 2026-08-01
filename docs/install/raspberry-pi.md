# Raspberry Pi

A Pi at the kegerator is the sweet spot for Kegwall: perfect reception for Kegtron's
UDP pour multicast (same network segment, no VLAN questions), onboard Bluetooth for
the Kegtron BLE fallback (Gen 1 **and** Pro), and enough CPU for the whole stack.
Recommended hardware: **Pi 5 (4GB+)** — the only model whose PMIC can report power
draw in the admin dashboard; a Pi 4 (4GB) works fine minus the watts readout; a
Pi 3B is only suitable as a tablet-mode display.

## The three modes

- **Server mode** — `pi-install.sh`, no kiosk: the server runs headless; HDMI (if
  plugged in) shows the normal login terminal.
- **Kiosk mode** — `pi-install.sh` with kiosk enabled: the same server, plus this
  Pi's screen boots straight into the tap wall (cage + chromium — works on Pi OS
  **Lite**, no desktop needed).
- **Tablet mode** — a SEPARATE touchscreen Pi running only a browser pointed at the
  server's `/tablet` page (`pi-tablet-setup.sh`): no Node, no server components.

Two server install styles are first-class — pick one:

- **Docker** — pull the published multi-arch image; updates via the Watchtower
  sidecar and the admin UI's Update button.
- **Native (bare metal)** — one guided installer sets up Node, the app, and systemd
  units: a self-updater, an OS updater, and a reboot trigger the admin UI can fire.

## Docker path

```sh
mkdir -p ~/kegwall && cd ~/kegwall
curl -fsSLO https://raw.githubusercontent.com/dlommm/Kegwall/main/deploy/docker-compose.pi.yml
openssl rand -hex 16      # your Watchtower API token — paste into the compose file
docker compose -f docker-compose.pi.yml up -d
```

Open `http://<pi-ip>:8080`, create the admin account, and follow the guided setup —
it picks the Watchtower update mode for you and ends with every URL for the box.
Paste the token in **Settings → System** afterwards. (The compose file's comments
explain the host-network / loopback-sidecar topology; general Docker reference lives
in [docker.md](docker.md).) In Docker the dashboard's SERVER card shows CPU/RAM/disk
but no SoC temperature or watts, and the OS-update controls stay hidden — those are
native-install features.

## Native path (bare metal)

One command on a fresh Raspberry Pi OS (64-bit, Lite is fine):

```sh
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh | sudo bash
```

The installer is **interactive**: it asks for the port, the Bluetooth fallback,
kiosk mode ("show the tap wall on this screen at boot?"), and OS auto-updates —
Enter accepts every default. Every question also exists as a flag for automation
(`--port`, `--with-ble`, `--kiosk`, `--os-updates off|auto`, `--auto-reboot`,
`--non-interactive`, `--dir`, `--repo-url`); a passed flag is not asked about.

What it installs: Node 24 (NodeSource) + build toolchain, a `kegwall` system user,
the app checked out at its **latest release tag**, and these systemd units:

| Unit | Job |
| --- | --- |
| `kegwall.service` | the server (`KEGWALL_INSTALL=native` tells the app it can offer OS controls) |
| `kegwall-update.{service,path}` | app self-update — Settings → System → Update now |
| `kegwall-os-update.{service,path}` | OS apt update — Settings → System → Update OS now |
| `kegwall-reboot.{service,path}` | reboot from the dashboard's banner |
| `kegwall-kiosk.service` | kiosk mode only — cage + chromium on tty1 |

The admin UI writes a trigger file into the data directory; the matching path unit
runs the privileged work. The app process itself needs zero privileges, and each
updater removes its trigger before doing anything (loop-guard) and rolls back on
failure.

After install: open `http://<pi-ip>:8080`, create the admin account, and the guided
first-run setup does the rest — site name, Kegtron key, your first wall (created
automatically, with any known Kegtron devices attached; the server also auto-attaches
the first Kegtron that ever reports to an empty wall), update mode (native is
preselected), and a final screen listing every URL for the box.

Uninstall: `sudo systemctl disable --now kegwall kegwall-update.path
kegwall-os-update.path kegwall-reboot.path kegwall-kiosk 2>/dev/null`, re-enable the
console with `sudo systemctl enable --now getty@tty1`, remove
`/etc/systemd/system/kegwall*.{service,path}` and `/usr/local/bin/kegwall-*.sh`,
`sudo deluser kegwall; sudo deluser kegwall-kiosk`, and delete the install dir (back
up `<dir>/data` first — that's the database and label images).

## Updating

**Kegwall itself**: **Settings → System → Check for updates → Update now**. The UI
shows progress and confirms the new version when the server is back (typically under
a minute on Docker, a few minutes for a native rebuild).

**The OS (native installs only)**: **Settings → System → Operating system**:

- **Manual** — an "Update OS now" button runs `apt full-upgrade` in the background
  (output in `journalctl -u kegwall-os-update`). If the update needs a reboot, the
  dashboard shows an amber banner with a Reboot-now button — with an explicit
  warning, because the wall goes dark for a minute or two and pours during the
  window are lost unless they sync back from Kegtron cloud.
- **Automatic** — unattended-upgrades (provisioned by the installer's OS-updates
  question; re-run the installer if you skipped it). The auto-reboot toggle decides
  whether the Pi may reboot itself (04:00) when required.

Manual fallbacks:
- Docker: `docker compose -f docker-compose.pi.yml pull && docker compose -f docker-compose.pi.yml up -d`
- Native: `cd /opt/kegwall && sudo -u kegwall git fetch --tags && sudo -u kegwall git checkout --force <vX.Y.Z> && sudo -u kegwall npm ci && sudo -u kegwall npm run build && sudo systemctl restart kegwall`

## Pi health in the admin

The dashboard's SERVER card polls `GET /api/system/stats`: CPU load, RAM, disk,
uptime, SoC temperature, and — **Pi 5 only** — live power draw in watts (older Pis
have no power-measurement hardware). Undervoltage is checked on every poll,
including the sticky "happened at some point since boot" firmware flag: a red banner
appears and a warning is logged, because chronic undervoltage corrupts SD cards. Use
the official PSU (27 W / 5 A on a Pi 5).

## Kiosk mode (tap wall on the server Pi's screen)

Enabled by the installer's kiosk question (or `--kiosk`). It installs
`kegwall-kiosk.service`: a **cage** (Wayland kiosk compositor) session on tty1
running chromium fullscreen at `http://localhost:8080/wall/main` — no desktop stack,
works on Pi OS Lite, waits for the server's `/api/health` before starting the
browser, hides the cursor, and restarts itself if chromium ever dies. The login
terminal on tty1 is disabled (that's the point); `sudo systemctl disable --now
kegwall-kiosk && sudo systemctl enable --now getty@tty1` brings it back.

To repoint it (different wall slug, different port):
`sudo /opt/kegwall/scripts/pi-tablet-setup.sh --local --force http://localhost:8080/wall/<slug>`

## Tablet mode (dedicated touchscreen Pi)

A second Pi with the official touchscreen makes a great dedicated pourer tablet.
It runs ONLY the browser — install nothing else on it:

```sh
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-tablet-setup.sh | sudo bash -s -- http://<server-ip>:8080/tablet/main
sudo reboot
```

Same cage service as kiosk mode (Lite-friendly, fullscreen, touch-enabled,
self-restarting) but pointed at the remote server, with the cursor left visible.
Re-run with a new URL to repoint it. On a desktop image the script asks before
disabling the display manager (`--desktop` keeps the old in-desktop autostart
instead; `--force` skips the question). An Android tablet is the other option for
this role — see [android-tablet.md](android-tablet.md).

## Migrating an existing install to the Pi

1. On the old server: **Settings → Backup → Download backup** (a `.db` file).
2. On the fresh Pi install: **Settings → Backup → Restore**, upload it, restart —
   the restore is staged and applied atomically at the next boot. This carries the
   whole database: beers, taps, kegs, pours, users, and all settings incl. secrets.
3. **Label images are NOT in the .db** — copy them from the old data directory
   (`/data` in Docker, `appdata` on Unraid) into the Pi's data directory by hand.
4. Re-check Settings → System afterwards: the update mode came over with the old
   settings and probably names the OLD deployment style — set it for this box.

## Bluetooth fallback (Kegtron Gen 1 + Pro)

The installer's BLE question (or `--with-ble`) installs BlueZ and grants the raw-
socket capability. Two independent toggles then exist in **Settings → Sources**:

- **Gen 1 (KT-100/KT-200)** — the **verified** path: the decoder in
  `src/server/ingest/gen1/bleSource.ts` is a byte-exact port of the real
  `kegtron-ble` Home Assistant parser (`github.com/Bluetooth-Devices/kegtron-ble`).
- **Pro (KT-220/KT-420)** — our own reverse-engineered advertisement format
  ([docs/kegtron/pro-ble-format.md](../kegtron/pro-ble-format.md), captured live
  from a KT-420 and validated with a real pour). **Pros only transmit the new total
  at the END of a pour** — this path records finished pours within seconds without
  UDP or cloud, but live pour progress on the wall still requires UDP. That's a
  transmitter-side limitation, not a receiver one.

Manual setup (what `--with-ble` automates):

```sh
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev
sudo setcap cap_net_raw+eip $(eval readlink -f "$(which node)")
```

(Re-run the `setcap` after any Node upgrade — the capability binds to the binary
inode.) BLE uses `@abandonware/noble`, an `optionalDependency` — if its native build
failed at install time, the Sources dashboard shows the import error.

Running the MQTT-bridge path ([esp32-gen1.md](esp32-gen1.md)) at the same time is
fine: BLE wins for any Gen 1 device it's actively hearing (a live sighting within
the last 5 minutes), MQTT is the fallback — see `bleSource.ts`/`mqttSource.ts`'s
"BLE/MQTT DEDUPE" comments.

## See also

- [docker.md](docker.md) — general Docker reference: env vars, networking modes,
  reverse proxy + HTTPS, backups.
- [kegtron-cloud.md](../setup/kegtron-cloud.md) — API key + the UDP live-pour path.
- [android-tablet.md](android-tablet.md) — the Android alternative for the tablet.

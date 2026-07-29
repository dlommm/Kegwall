# Install on a Raspberry Pi

Two ways to run it on a Pi: Docker (recommended — see
[docs/install/docker.md](docker.md) first, this page only adds Pi-specific notes) or
bare metal. Either way, a Pi 4 or 5 (arm64) is assumed; this hasn't been tested against
a 32-bit Pi OS install.

**Honesty note:** everything in this document has been verified by reading the source
(`Dockerfile`, `src/server/ingest/gen1/bleSource.ts`, `package.json`) and, for the Docker
path, by actually building and running the image (see the phase 6 packaging ledger — the
image was built and boot-smoke-tested locally, on Linux/arm64). The bare-metal npm/BlueZ
steps below and the direct-BLE behavior have **not** been verified against physical
Raspberry Pi + Kegtron Gen 1 hardware in this environment — there was no Pi or real
Kegtron device available to test against. If something here doesn't match your Pi OS
version, treat this as a starting point, not gospel.

## Docker path

Follow [docs/install/docker.md](docker.md)'s quickstart. On a Pi, the multi-arch release
image (once published — see that doc) pulls the `linux/arm64` variant automatically; a
local build compiles `better-sqlite3` from source for your actual architecture either way.

If you want Kegtron Cloud's UDP broadcast discovery or the direct-BLE source (below), use
`docker-compose.host-network.yml` instead of the default — see docker.md's "Networking:
bridge vs. host mode" section. For direct-BLE specifically, also add:

```yaml
services:
  kegwall:
    cap_add:
      - NET_ADMIN
      - NET_RAW
```

to that compose file (or `--privileged` if the narrower capabilities don't work for your
Docker/kernel combination), and make sure the container can see the host's Bluetooth
adapter (host networking alone gets you the network namespace, not automatic device
access).

## Bare-metal path

```sh
# Node 22 (NodeSource, or use nvm if you prefer)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# better-sqlite3's native build needs a compiler toolchain
sudo apt-get install -y python3 make g++

git clone <this repo's URL> kegwall
cd kegwall
npm ci
npm run build
DATA_DIR=./data npm start
```

`npm start` runs the server directly under `tsx` (no separate compile step for the
server — only the web SPA is built ahead of time via `npm run build`, into `dist/web`).
Open `http://<pi-hostname>:8080`.

For a persistent install, wrap the start command in a systemd unit, e.g.
`/etc/systemd/system/kegwall.service`:

```ini
[Unit]
Description=Kegwall
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/kegwall
Environment=DATA_DIR=/home/pi/kegwall/data
Environment=PORT=8080
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now kegwall
```

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
   BlueZ (Raspberry Pi OS ships this already) and its headers:

   ```sh
   sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev
   ```

2. Running as a non-root user needs a one-time capability grant on the Node binary (noble
   opens a raw HCI socket, which normally requires root):

   ```sh
   sudo setcap cap_net_raw+eip $(eval readlink -f "$(which node)")
   ```

   (Re-run this after any Node version upgrade — the capability is bound to that specific
   binary path/inode.) Alternatively, run the process as root — simpler, less isolated.

3. In the admin UI: **Settings -> Sources -> "Listen for Kegtron Gen 1 Bluetooth adverts
   directly"**. No broker, no extra config — it scans directly.

4. If you're also running the MQTT-bridge path (`docs/install/esp32-gen1.md`) for other
   Gen 1 devices out of this host's Bluetooth range, both can run at once: BLE wins for any
   device it's actively hearing (a live sighting within the last 5 minutes), MQTT is the
   fallback for everything else — see `bleSource.ts`/`mqttSource.ts`'s "BLE/MQTT DEDUPE"
   comments for the exact handoff logic.

## Kiosk-mode wall

To turn a Pi + attached display into a dedicated tap wall:

```sh
# Raspberry Pi OS with Chromium pre-installed
chromium-browser --noerrdialogs --disable-infobars --kiosk \
  "http://localhost:8080/wall/<your-wall-slug>"
```

Autostart it (Raspberry Pi OS desktop, `~/.config/autostart/kegtron-wall.desktop`):

```ini
[Desktop Entry]
Type=Application
Name=Kegwall
Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:8080/wall/<slug>
X-GNOME-Autostart-enabled=true
```

Disable screen blanking so the display doesn't sleep mid-shift (X11):

```sh
xset s off
xset -dpms
xset s noblank
```

The app has its own OLED-friendly idle mode for the wall itself (dims the logo and rotates
a highlighted tap after an idle period) — that's a separate, complementary concern from the
OS/display blanking above. See
[docs/customization.md#screensaver](../customization.md#screensaver).

## See also

- [docs/install/docker.md](docker.md) — full Docker reference (env vars, reverse proxy,
  backups).
- [docs/install/esp32-gen1.md](esp32-gen1.md) — the MQTT-bridge alternative for Gen 1
  devices out of direct Bluetooth range.
- [docs/customization.md](../customization.md) — wall layout, themes, screensaver.

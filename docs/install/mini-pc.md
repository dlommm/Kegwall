# Install on a mini PC (amd64 / Intel NUC) — native, Debian 13

Kegwall runs natively on any amd64 mini PC (Intel NUC, Beelink, etc.) on Debian 13
("trixie") — no Docker, no Pi required. The server is the same app that runs on a
Raspberry Pi; only the host hardware differs.

Use a mini PC when you want more headroom than a Pi (more taps, BLE + cloud + analytics
at once, faster rebuilds) or you already have an x86 box on hand.

## What differs from a Pi

Everything works the same except the Pi-only hardware sensors:

| Feature | Raspberry Pi | amd64 mini PC |
|---|---|---|
| CPU / RAM / disk / uptime | ✅ | ✅ |
| CPU temperature | ✅ `thermal_zone0` | ✅ via `coretemp` (Intel) / `k10temp` (AMD) |
| Power draw (watts) | ✅ Pi 5 PMIC (whole-board) | ✅ RAPL (CPU-package power) |
| Undervoltage / throttle flags | ✅ `vcgencmd` | — not applicable (no PMIC); the panel reads "unavailable" |
| App self-update, OS apt update, UI reboot | ✅ | ✅ (same systemd units) |
| Kiosk mode (cage + chromium) | ✅ | ✅ |
| Native wall client (cog / WPE, `--native-wall`) | ✅ | ✅ — lighter than chromium |

Tonight's **This server** row and the analytics **Server** tab both degrade
gracefully: CPU/RAM/disk/temp/watts show real numbers; the undervoltage panel just says
it's unavailable on x86.

## Install

Fresh Debian 13 amd64, then:

```bash
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh | sudo bash
```

(The script is arch-agnostic — it detects the amd64 host and installs natively. From a
local checkout you can also run `sudo bash scripts/install.sh`, a symlink to the same
script.) It installs Node 24 (NodeSource), a `kegwall` system user, the app at its latest
release tag, and the systemd units (`kegwall.service` + the app-update / OS-update / reboot
path units). Answer the prompts (install dir, port, BLE fallback, kiosk vs server mode, OS
updates) or pass the flags — see the [Raspberry Pi guide](raspberry-pi.md) for the full flag
list and the systemd/OS-update details, which are identical here. If this mini PC also drives a
screen, kiosk mode offers chromium (default) or the lighter native cog/WPE client
(`--native-wall`) — see [native-wall.md](native-wall.md).

Then open `http://<mini-pc-ip>:<port>` and run the first-run wizard.

## Notes

- **Debian 13 (trixie):** NodeSource `setup_24.x` supports trixie; the install toolchain
  (`python3 make g++`) builds `better-sqlite3` if a prebuilt binary isn't available for your
  glibc.
- **RAPL watts** need two samples to compute a rate, so the watts figure on Tonight
  appears from the second stats poll onward (a few seconds after boot).
- **BLE:** pass `--with-ble` if you're using Gen 1 / Pro BLE transports; it installs `bluez`,
  powers the adapter on (and sets BlueZ `AutoEnable=true` so it survives reboots — some NUCs ship
  it off), and grants the server the `cap_net_raw` capability it needs to open a raw HCI socket. A
  USB Bluetooth dongle works on a mini PC that has none built in.
  - The **unattended installer ISO** and the default prompts install **without** BLE. If the
    admin shows `WAITING FOR BLUETOOTH ADAPTER (STATE: POWEREDOFF)`, enable it after the fact —
    either re-run the installer with `--with-ble`, or manually:
    ```bash
    sudo apt-get install -y bluetooth bluez libbluetooth-dev
    sudo rfkill unblock bluetooth
    sudo systemctl enable --now bluetooth
    sudo bluetoothctl power on
    sudo setcap cap_net_raw+eip "$(readlink -f "$(command -v node)")"
    sudo systemctl restart kegwall
    ```

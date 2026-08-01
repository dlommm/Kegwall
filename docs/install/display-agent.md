# Display agent

The server offers a soft-off: screensavers and black screens in the browser. But modern
displays also need *real* power-off — backlight cuts, HDMI handshake drops, or the TV's
backlight LED goes dark — to truly sleep the panel and save power. The display agent is a
zero-dependency script that listens to the server's presence stream and runs actual
screen on/off commands: HDMI-CEC TV control, X11 DPMS (kiosk mode), Wayland output
on/off, Pi touchscreen backlight sysfs, or any shell command you provide.

The server's `/api/presence/stream` endpoint emits SSE events for each wall:
`data: {"state":"active|screensaver|off"}`. The agent subscribes with a wall slug and
token (from **Settings → Integrations → Presence card**), reconnects on network hiccup
(screens stay ON as a safe default while unreachable), and runs your command recipes
when the wall's presence state changes — motion wakes the display, idle triggers the
screensaver, and older idle turns it off completely.

Screensaver is an ON state: the browser shows a dark slide or fade but the backlight
stays live. Only OFF drives the power command. The agent deduplicates: if the server
says OFF and the display is already off, no redundant command runs.

## Install

1. **Get the script:**
   ```sh
   sudo mkdir -p /opt/kegwall
   sudo curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/deploy/display-agent.sh \
     -o /opt/kegwall/display-agent.sh
   sudo chmod +x /opt/kegwall/display-agent.sh
   ```

2. **Copy the systemd unit and configure it:**
   ```sh
   sudo curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/deploy/display-agent.service \
     -o /etc/systemd/system/display-agent.service
   sudo systemctl daemon-reload
   ```

3. **Edit the environment variables** — choose your display recipe (see below):
   ```sh
   sudo systemctl edit display-agent.service
   ```
   Paste or uncomment the `Environment=` block that matches your setup. At minimum:
   - `KEGWALL_URL` — the server's HTTP URL (e.g. `http://192.168.1.50:8080`)
   - `KEGWALL_WALL` — the wall slug (default: `main`)
   - `KEGWALL_TOKEN` — your presence token from the admin UI's Integrations card
   - `SCREEN_ON_CMD` and `SCREEN_OFF_CMD` — the recipes below for your hardware

4. **Enable and start the service:**
   ```sh
   sudo systemctl enable --now display-agent.service
   ```

5. **Check it's running:**
   ```sh
   systemctl status display-agent.service
   journalctl -u display-agent.service -n 50  # last 50 log lines
   ```

## Display recipes

Pick the pair of commands that matches your hardware. Replace values in `<angle brackets>`.

### TV over HDMI-CEC

Requires: `v4l-utils` package (`sudo apt-get install v4l-utils`).

```
Environment=SCREEN_ON_CMD=cec-ctl --to 0 --image-view-on
Environment=SCREEN_OFF_CMD=cec-ctl --to 0 --standby
```

Talks to the TV's HDMI port 0 (HDMI-1 on most TVs) via the CEC bus. Does not require
any privileges (CEC is a shared bus; `/dev/cec*` is usually world-readable on Pi OS).
If the first port is not your TV, try `cec-ctl --to 1`, `--to 2`, etc. Run
`cec-ctl --help` to confirm your TV's address.

### X11 kiosk (xset DPMS)

Requires: `x11-utils` package (usually pre-installed on desktop Pi OS).

```
Environment=SCREEN_ON_CMD=xset dpms force on
Environment=SCREEN_OFF_CMD=xset dpms force off
```

Works on X11-based kiosks and desktops. DPMS (Display Power Management Signaling) is
the X standard for screen blanking. No special privileges required, but it only works
if `DISPLAY=:0` is set. If you're running the agent under a user-level systemd unit
(`.config/systemd/user/`), omit the `sudo` commands above, set `User=<username>` in the
service, and set `Environment=DISPLAY=:0` in the unit to point at your X session.

### Wayland output (wlr-randr)

Requires: `wlr-randr` package (available on most Wayland compositors; Fedora/Ubuntu
desktops: `sudo apt-get install wlr-randr`).

```
Environment=SCREEN_ON_CMD=wlr-randr --output <OUTPUT> --on
Environment=SCREEN_OFF_CMD=wlr-randr --output <OUTPUT> --off
```

List available outputs with `wlr-randr` (usually `HDMI-A-1`, `DP-1`, `eDP-1` on
laptops). Replace `<OUTPUT>` with your display's name. DPMS is deprecated on Wayland;
output on/off is the native mechanism. Requires the same user context as your Wayland
session (compositor typically runs under your user; set `User=<username>` in the
service).

### Raspberry Pi touchscreen backlight

The official Pi 7-inch touchscreen is a GPIO-controlled backlight with no power
sequencing — no HDMI-CEC, no DPMS, just a sysfs knob.

```
Environment=SCREEN_ON_CMD=echo 0 > /sys/class/backlight/rpi_backlight/bl_power
Environment=SCREEN_OFF_CMD=echo 1 > /sys/class/backlight/rpi_backlight/bl_power
```

Requires **root privileges** (the agent runs as `root` when started with `sudo
systemctl`). If you want to avoid root, create a udev rule instead:

1. Create `/etc/udev/rules.d/99-backlight.rules`:
   ```
   SUBSYSTEM=="backlight", KERNEL=="rpi_backlight", MODE="0666"
   ```

2. Reload udev: `sudo udevadm control --reload`

3. Reconnect the display or reboot.

4. Run the agent as a user with `systemctl --user` (your home directory, not system):
   ```sh
   systemctl --user enable --now display-agent.service
   ```

Note: user-level services on Pi OS need `systemd --user` mode enabled. If the service
doesn't start, check `systemctl --user status display-agent.service`.

## Fully Kiosk (Android tablet)

If your kegerator tablet runs [Fully Kiosk](https://www.fullykiosk.com/), you can
integrate the display power stream by automating a webhook call to Fully's REST API.

On the Kegwall server, create **two** automation rules — one for each state:

**Rule 1: Turn tablet screen OFF**
1. **Admin UI → Automations → New rule**
   - Trigger: `display_power_changed`
   - State filter: `off` (the AutomationBuilder exposes "State filter (blank = any transition)")
2. Action: `webhook`
   - URL: `http://<tablet-ip>:2323/?cmd=screenOff&password=<admin-pin>`

**Rule 2: Turn tablet screen ON**
1. **Admin UI → Automations → New rule**
   - Trigger: `display_power_changed`
   - State filter: `active`
2. Action: `webhook`
   - URL: `http://<tablet-ip>:2323/?cmd=screenOn&password=<admin-pin>`

Replace `<tablet-ip>` with the tablet's LAN IP and `<admin-pin>` with your Fully admin
PIN (from the left panel menu → Settings → Admin PIN). The State filter ensures each
rule fires only on the correct transition.

Fully's other options: `cmd=enableScreensaver` (black screen), `cmd=loadStart` (refresh
the browser tab). See the Fully Kiosk documentation for the full API.

## Home Assistant alternative

If you run Home Assistant, subscribe to the display power event published by Kegwall
via MQTT instead of running the bash agent:

- **Display power event:** `kegwall/event/display_power` (JSON: `{"wall": "...", "state": "active|screensaver|off", "ts": "..."}`)

Create an HA automation to call a service (e.g., a `switch.turn_off` for a smart
plug or an IR receiver command) when this event fires. This lets you use HA's own
automation engine and services — no shell scripts needed. See
[docs/setup/home-assistant.md](../setup/home-assistant.md) for the full MQTT setup.

For motion integration (if you want HA automations to trigger on motion), instead
point an HA automation at the server's `POST /api/presence/motion?token=…` endpoint
(requires a presence token from Settings → Integrations), or configure an MQTT
motion topic in the admin UI (Settings → Sources → MQTT motion topics) for any
motion sensor you're running separately.

## See also

- [raspberry-pi.md](raspberry-pi.md#kiosk-mode-tap-wall-on-the-server-pis-screen) —
  Pi kiosk setup, which often pairs with the display agent for real backlight control.
- [docs/setup/home-assistant.md](../setup/home-assistant.md) — MQTT discovery and event topics.
- [docs/customization.md](../customization.md) — screensaver configuration and timing.

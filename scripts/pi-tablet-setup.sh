#!/usr/bin/env bash
# Kegwall display setup — boots a Raspberry Pi's attached screen straight into a
# Kegwall page via a cage (Wayland kiosk compositor) + chromium systemd service.
# Works on Raspberry Pi OS LITE — no desktop needed. Used two ways:
#
#   TABLET MODE — a dedicated touchscreen Pi running the pourer tablet against a
#   remote server (this Pi runs NOTHING else — no Node, no Kegwall server):
#       sudo ./pi-tablet-setup.sh http://<server>:8080/tablet/main
#
#   KIOSK MODE — the server Pi's own HDMI output showing its wall; pi-install.sh's
#   kiosk-mode branch calls this with --local http://localhost:8080/wall/main
#   (--local adds the kegwall.service dependency so the display waits for the local
#   server unit).
#
# Re-run with a new URL any time to repoint the display. The cursor is hidden for
# /wall pages (TV) and kept for everything else (touch UIs paint no cursor anyway,
# but a mouse on a tablet page should be visible).
#
# --desktop keeps the LEGACY behavior for existing desktop-image installs
# (labwc/Wayfire/X11 autostart chain, requires a desktop + autologin) instead of the
# cage service. --force skips the "disable your display manager?" confirmation.
#
# Uninstall (cage mode): systemctl disable --now kegwall-kiosk;
#   systemctl enable --now getty@tty1; rm /etc/systemd/system/kegwall-kiosk.service;
#   deluser kegwall-kiosk
set -euo pipefail

URL=""
DESKTOP=0
FORCE=0
LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --desktop) DESKTOP=1; shift ;;
    --force) FORCE=1; shift ;;
    --local) LOCAL=1; shift ;;
    http://*|https://*) URL="$1"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$URL" =~ ^https?:// ]] || { echo "Usage: sudo $0 [--desktop] [--force] [--local] <http(s)://server:8080/tablet/main>" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

echo "==> Installing chromium"
apt-get update -qq
apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser
CHROMIUM=$(command -v chromium || command -v chromium-browser)

# ---------------------------------------------------------------------------------
# LEGACY desktop path — the pre-cage behavior, for installs that already run the
# full desktop and want the browser inside it.
# ---------------------------------------------------------------------------------
if [ "$DESKTOP" -eq 1 ]; then
  KIOSK_USER=$(awk -F: '$3 == 1000 {print $1; exit}' /etc/passwd)
  [ -n "$KIOSK_USER" ] || { echo "No uid-1000 desktop user found." >&2; exit 1; }
  KIOSK_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)

  command -v raspi-config >/dev/null && {
    raspi-config nonint do_boot_behaviour B4 || true # desktop, autologin
    raspi-config nonint do_blanking 1 || true        # blanking off
  }

  KIOSK_CMD="$CHROMIUM --kiosk --noerrdialogs --disable-infobars --touch-events=enabled \"$URL\""

  # Autostart, by compositor: labwc (Pi OS Bookworm default) → Wayfire → X11 .desktop.
  if [ -d "$KIOSK_HOME/.config/labwc" ] || [ "$(grep -si 'labwc' /etc/xdg/autostart/* 2>/dev/null | head -1)" ] || command -v labwc >/dev/null; then
    mkdir -p "$KIOSK_HOME/.config/labwc"
    AUTOSTART="$KIOSK_HOME/.config/labwc/autostart"
    grep -sv 'kegwall-kiosk' "$AUTOSTART" > "$AUTOSTART.tmp" 2>/dev/null || true
    echo "$KIOSK_CMD & # kegwall-kiosk" >> "$AUTOSTART.tmp"
    mv "$AUTOSTART.tmp" "$AUTOSTART"
    chown -R "$KIOSK_USER:" "$KIOSK_HOME/.config/labwc"
    echo "==> Wrote labwc autostart: $AUTOSTART"
  elif command -v wayfire >/dev/null; then
    INI="$KIOSK_HOME/.config/wayfire.ini"
    touch "$INI"
    grep -q '^\[autostart\]' "$INI" || printf '\n[autostart]\n' >> "$INI"
    sed -i '/^kegwall_kiosk *=/d' "$INI"
    sed -i "/^\[autostart\]/a kegwall_kiosk = $KIOSK_CMD" "$INI"
    chown "$KIOSK_USER:" "$INI"
    echo "==> Wrote Wayfire autostart: $INI"
  else
    apt-get install -y -qq unclutter || true
    mkdir -p "$KIOSK_HOME/.config/autostart"
    DESKTOP_FILE="$KIOSK_HOME/.config/autostart/kegwall-kiosk.desktop"
    cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Kegwall kiosk
Exec=sh -c 'xset s off; xset -dpms; unclutter -idle 0 & $KIOSK_CMD'
EOF
    chown -R "$KIOSK_USER:" "$KIOSK_HOME/.config/autostart"
    echo "==> Wrote X11 autostart: $DESKTOP_FILE"
  fi
  echo "Desktop kiosk configured for $KIOSK_USER → $URL — reboot to start it."
  exit 0
fi

# ---------------------------------------------------------------------------------
# DEFAULT: cage service on tty1 (works on Lite AND desktop images).
# ---------------------------------------------------------------------------------
echo "==> Installing cage"
apt-get install -y -qq cage

# A desktop image's display manager owns the seat — cage on tty1 conflicts with it.
# Detected, never assumed: require explicit consent (or --force) before disabling.
for DM in lightdm gdm3 sddm; do
  if systemctl is-enabled "$DM" >/dev/null 2>&1; then
    if [ "$FORCE" -ne 1 ]; then
      if { exec 3</dev/tty; } 2>/dev/null; then
        printf 'Display manager %s is enabled (this image has a desktop). Disable it so the kiosk owns the screen? [y/N]: ' "$DM" >/dev/tty
        IFS= read -r ans <&3 || ans=''
        exec 3<&-
        case "$ans" in [yY]*) ;; *) echo "Aborted — re-run with --desktop to use the desktop autostart instead." >&2; exit 1 ;; esac
      else
        echo "Display manager $DM is enabled; re-run with --force to disable it (or --desktop to keep the desktop)." >&2
        exit 1
      fi
    fi
    systemctl disable --now "$DM" || true
    echo "==> Disabled $DM"
  fi
done

id kegwall-kiosk >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin kegwall-kiosk
# Belt-and-braces beside the PAM/logind seat session the unit opens.
usermod -aG video,render,input kegwall-kiosk

# Hide the cursor on /wall pages (a TV), keep it elsewhere.
CAGE_FLAGS=""
case "$URL" in *"/wall/"*) CAGE_FLAGS="-d" ;; esac

# Health-wait target: chromium pointed at a not-yet-listening server shows an error
# page forever, so the unit waits for /api/health first (local server or remote).
ORIGIN=$(printf '%s' "$URL" | sed -E 's#^(https?://[^/]+).*#\1#')
HEALTH_URL="$ORIGIN/api/health"

LOCAL_DEPS=""
if [ "$LOCAL" -eq 1 ]; then
  LOCAL_DEPS="kegwall.service"
fi

systemctl disable --now getty@tty1.service 2>/dev/null || true

cat > /etc/systemd/system/kegwall-kiosk.service <<UNIT
[Unit]
Description=Kegwall kiosk display (cage + chromium)
After=systemd-user-sessions.service network-online.target getty@tty1.service $LOCAL_DEPS
Wants=network-online.target $LOCAL_DEPS
Conflicts=getty@tty1.service
ConditionPathExists=/dev/tty1

[Service]
User=kegwall-kiosk
# PAMName=login opens a real logind seat session on tty1 (Debian's login PAM stack
# includes pam_systemd) — that's what grants DRM/input access; no seatd, no
# autologin hack.
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
UtmpIdentifier=tty1
UtmpMode=user
Restart=always
RestartSec=5
# npm-start on a Pi can take a while — don't let the default 90s kill the wait.
TimeoutStartSec=300
ExecStartPre=/bin/sh -c 'until curl -fso /dev/null $HEALTH_URL; do sleep 2; done'
ExecStart=/usr/bin/cage $CAGE_FLAGS -- $CHROMIUM --kiosk --noerrdialogs --disable-infobars \\
  --ozone-platform=wayland --no-first-run --disable-session-crashed-bubble \\
  --touch-events=enabled --user-data-dir=/home/kegwall-kiosk/.kegwall-kiosk "$URL"

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable kegwall-kiosk

# Stamp the display-mode marker so the server (GET /api/system/urls → displayMode) and any
# operator can tell this screen runs the chromium kiosk, not the native flutter-pi client.
# Single source of truth — see readDisplayMode() in src/server/routes/system.ts.
install -d -m 755 /etc/kegwall
printf 'chromium\n' > /etc/kegwall/display-mode

echo
echo "Kiosk service installed → $URL"
echo "Start now: sudo systemctl start kegwall-kiosk   (or just reboot)"
echo "Repoint: re-run this script with a new URL."

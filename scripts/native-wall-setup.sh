#!/usr/bin/env bash
# Kegwall NATIVE wall display setup — boots a device's attached screen straight into the tap wall
# using cog (WPE WebKit) on a cage Wayland compositor, no desktop. This renders the SAME web wall
# (`/wall/:slug`, all 11 looks/themes/takeovers) as the chromium kiosk, but in the lightweight
# WPE engine instead of the heavy Blink one — smaller footprint, faster boot, no chromium churn,
# and it reuses the whole existing UI (no second codebase).
#
# The "native" counterpart to pi-tablet-setup.sh (cage + chromium). Arch-agnostic — Raspberry Pi
# (arm64) and amd64 mini-PCs / Intel NUCs alike. Normally invoked by `pi-install.sh --native-wall`;
# can also be run standalone to (re)point an existing native display:
#     sudo ./native-wall-setup.sh --port 8080 --slug main
#
# It installs its own systemd unit (kegwall-wall.service) and stamps the display-mode marker
# (/etc/kegwall/display-mode = native) so the server (GET /api/system/urls → displayMode) and any
# operator can tell this screen runs the native WPE client, not chromium. See
# docs/install/native-wall.md.
#
# Uninstall: systemctl disable --now kegwall-wall; rm /etc/systemd/system/kegwall-wall.service;
#   rm -f /etc/kegwall/display-mode; systemctl enable --now getty@tty1
set -euo pipefail

DIR=/opt/kegwall     # kept for --native-wall call compatibility; unused by the cog path
PORT=8080
SLUG=main
BASE_URL=""          # server origin for the health-wait; defaults to http://localhost:$PORT
TOKEN=""             # optional per-display token, appended as ?displayToken=… to the wall URL
URL=""               # full override; wins over PORT/SLUG/TOKEN when given
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -n "$BASE_URL" ] || BASE_URL="http://localhost:$PORT"
if [ -z "$URL" ]; then
  URL="$BASE_URL/wall/$SLUG"
  [ -n "$TOKEN" ] && URL="$URL?displayToken=$TOKEN"
fi

echo "==> Native wall (cog / WPE WebKit) → $URL"

# --- Install cog + WPE WebKit + cage ----------------------------------------------------------
echo "==> Installing cog (WPE WebKit) and cage"
apt-get update -qq
# cog pulls WPE WebKit + the fdo (Wayland) backend. cage is the tiny kiosk compositor that owns
# the screen and the seat, exactly as in the chromium path.
apt-get install -y -qq cog cage curl ca-certificates 2>/dev/null \
  || { echo "!! Could not install cog/cage. On some Debian releases the package is 'cog' + 'libwpewebkit-1.1-0'/'wpewebkit-driver'." >&2; exit 1; }
COG=$(command -v cog || true)
[ -n "$COG" ] || { echo "!! cog not on PATH after install." >&2; exit 1; }

# A desktop image's display manager owns the seat — cage on tty1 conflicts with it. Require
# explicit consent (or --force) before disabling, same as pi-tablet-setup.sh.
for DM in lightdm gdm3 sddm; do
  if systemctl is-enabled "$DM" >/dev/null 2>&1; then
    if [ "$FORCE" -ne 1 ]; then
      if { exec 3</dev/tty; } 2>/dev/null; then
        printf 'Display manager %s is enabled. Disable it so the kiosk owns the screen? [y/N]: ' "$DM" >/dev/tty
        IFS= read -r ans <&3 || ans=''; exec 3<&-
        case "$ans" in [yY]*) ;; *) echo "Aborted." >&2; exit 1 ;; esac
      else
        echo "Display manager $DM is enabled; re-run with --force to disable it." >&2; exit 1
      fi
    fi
    systemctl disable --now "$DM" || true
    echo "==> Disabled $DM"
  fi
done

# --- Kiosk seat user (shared with the chromium kiosk — one screen owner) -----------------------
id kegwall-kiosk >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin kegwall-kiosk
usermod -aG video,render,input kegwall-kiosk

# Health-wait target: cog pointed at a not-yet-listening server would show an error page; wait for
# /api/health first (local or remote server).
ORIGIN=$(printf '%s' "$URL" | sed -E 's#^(https?://[^/]+).*#\1#')

# --- Install the service unit -----------------------------------------------------------------
# cage -d hides the pointer (this is a TV). `cage -- cog "$URL"` runs cog as the single Wayland
# client fullscreen; cog auto-selects the fdo/Wayland platform under cage.
systemctl disable --now getty@tty1.service 2>/dev/null || true
cat > /etc/systemd/system/kegwall-wall.service <<UNIT
[Unit]
Description=Kegwall native wall (cog / WPE WebKit on cage)
After=systemd-user-sessions.service network-online.target getty@tty1.service kegwall.service
Wants=network-online.target kegwall.service
Conflicts=getty@tty1.service
ConditionPathExists=/dev/tty1

[Service]
User=kegwall-kiosk
# PAMName=login opens a real logind seat session on tty1 — that's what grants DRM/input access.
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
TimeoutStartSec=300
ExecStartPre=/bin/sh -c 'until curl -fso /dev/null $ORIGIN/api/health; do sleep 2; done'
ExecStart=/usr/bin/cage -d -- $COG "$URL"

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable kegwall-wall
# Start it now so the wall appears without a reboot. --no-block: don't wait on the ExecStartPre
# health loop (it returns once cog is launching); cog takes tty1, the SSH session is unaffected.
systemctl restart --no-block kegwall-wall 2>/dev/null || true

# Stamp the display-mode marker (single source of truth — readDisplayMode() in
# src/server/routes/system.ts). 'native' == the cog/WPE client.
install -d -m 755 /etc/kegwall
printf 'native\n' > /etc/kegwall/display-mode

echo
echo "Native wall service installed → $URL"
echo "Start now: sudo systemctl start kegwall-wall   (or just reboot)"
echo "Logs: journalctl -u kegwall-wall -f   ·   Repoint: re-run with --url/--slug."

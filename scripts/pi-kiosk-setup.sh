#!/usr/bin/env bash
# Kegwall kiosk setup for a Raspberry Pi with an attached display — used two ways:
#   - a dedicated TOUCHSCREEN Pi running the pourer tablet:
#       sudo ./pi-kiosk-setup.sh http://<server>:8080/tablet/main
#   - the server Pi's own HDMI output showing a wall (pi-install.sh --wall-slug
#     calls this with http://localhost:8080/wall/<slug>).
# Re-run with a new URL any time to repoint the kiosk. Requires Raspberry Pi OS
# WITH a desktop (not Lite). Reboot to take effect.
set -euo pipefail

URL="${1:-}"
[[ "$URL" =~ ^https?:// ]] || { echo "Usage: sudo $0 <http(s)://server:8080/tablet/slug-or-wall/slug>" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

# The desktop autologin user (usually 'pi', but not assumed).
KIOSK_USER=$(awk -F: '$3 == 1000 {print $1; exit}' /etc/passwd)
[ -n "$KIOSK_USER" ] || { echo "No uid-1000 desktop user found." >&2; exit 1; }
KIOSK_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)

echo "==> Installing chromium"
apt-get update -qq
apt-get install -y -qq chromium-browser 2>/dev/null || apt-get install -y -qq chromium
CHROMIUM=$(command -v chromium-browser || command -v chromium)

echo "==> Desktop autologin + screen blanking off"
command -v raspi-config >/dev/null && {
  raspi-config nonint do_boot_behaviour B4 || true # desktop, autologin
  raspi-config nonint do_blanking 1 || true        # blanking off
}

KIOSK_CMD="$CHROMIUM --kiosk --noerrdialogs --disable-infobars --touch-events=enabled \"$URL\""

# Autostart, by compositor: labwc (Pi OS Bookworm default) → Wayfire → X11 .desktop.
# Not exercised on physical hardware for every combination — the script prints what
# it detected and wrote so a mismatch is easy to spot.
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
  DESKTOP="$KIOSK_HOME/.config/autostart/kegwall-kiosk.desktop"
  cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Kegwall kiosk
Exec=sh -c 'xset s off; xset -dpms; unclutter -idle 0 & $KIOSK_CMD'
EOF
  chown -R "$KIOSK_USER:" "$KIOSK_HOME/.config/autostart"
  echo "==> Wrote X11 autostart: $DESKTOP"
fi

echo
echo "Kiosk configured for $KIOSK_USER → $URL"
echo "Reboot to start it: sudo reboot"

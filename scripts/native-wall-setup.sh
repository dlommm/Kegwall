#!/usr/bin/env bash
# Kegwall NATIVE wall display setup — boots a device's attached screen straight into the
# flutter-pi native wall client (apps/wall-native) on DRM/KMS, no browser, no desktop.
# The native counterpart to pi-tablet-setup.sh (which does the cage + chromium kiosk).
#
# Arch-agnostic: works on Raspberry Pi 4/5 (arm64) AND amd64 mini-PCs / Intel NUCs. Normally
# invoked by `pi-install.sh --native-wall`; can also be run standalone to (re)point an existing
# native display:
#     sudo ./native-wall-setup.sh --dir /opt/kegwall --port 8080 --slug main
#
# PREVIEW: the flutter-pi runtime + app bundle are not yet packaged by CI, so this script does
# all the deterministic host wiring (kiosk seat user, deps, /etc/kegwall-wall/config.json, the
# kegwall-wall.service unit, the display-mode marker) and then looks for two artifacts:
#   1. a flutter-pi binary  (built from source, or supplied on PATH)
#   2. the app bundle        (flutter_assets — --bundle DIR, the repo build, or a CI artifact)
# It NEVER disables the tty1 console or auto-starts a service it can't run: if either artifact is
# missing it installs the unit DISABLED and prints exactly how to finish, so the box can't end up
# black-screened. See docs/install/native-wall.md.
#
# Uninstall: systemctl disable --now kegwall-wall; rm /etc/systemd/system/kegwall-wall.service;
#   rm -rf /etc/kegwall-wall /opt/kegwall-wall /etc/kegwall/display-mode;
#   systemctl enable --now getty@tty1
set -euo pipefail

DIR=/opt/kegwall
PORT=8080
SLUG=main
BASE_URL=""       # defaults to http://localhost:$PORT
TOKEN=""          # per-display token (optional; empty when token enforcement is off)
BUNDLE=""         # prebuilt flutter_assets dir (else the repo build, else a CI artifact)
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -n "$BASE_URL" ] || BASE_URL="http://localhost:$PORT"

ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
case "$ARCH" in
  arm64|aarch64|amd64|x86_64) echo "==> Native wall setup for $ARCH" ;;
  *) echo "!! Unsupported arch '$ARCH' for the native wall client (arm64 / amd64 only)." >&2; exit 2 ;;
esac

# --- Runtime deps for flutter-pi (DRM/KMS + input) --------------------------------------------
echo "==> Installing flutter-pi runtime dependencies"
apt-get update -qq
# libgl1-mesa-dri covers the GLES driver on both Pi (v3d) and amd64 (i965/iris) via mesa.
apt-get install -y -qq \
  libdrm2 libgbm1 libinput10 libudev1 libxkbcommon0 libgl1-mesa-dri libegl1 libgles2 \
  fonts-dejavu-core curl ca-certificates 2>/dev/null || \
  echo "!! Some runtime deps failed to install — flutter-pi may still work if they're already present."

# --- Kiosk seat user (shared with the chromium kiosk — one screen owner) ----------------------
id kegwall-kiosk >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin kegwall-kiosk
usermod -aG video,render,input kegwall-kiosk

# --- config.json the Dart app reads (apps/wall-native/lib/config.dart) ------------------------
install -d -m 755 /etc/kegwall-wall
cat > /etc/kegwall-wall/config.json <<JSON
{
  "baseUrl": "$BASE_URL",
  "wallSlug": "$SLUG",
  "displayToken": "$TOKEN"
}
JSON
chmod 640 /etc/kegwall-wall/config.json
chown root:kegwall-kiosk /etc/kegwall-wall/config.json
echo "==> Wrote /etc/kegwall-wall/config.json (server $BASE_URL, wall '$SLUG')"

# --- Locate the flutter-pi binary -------------------------------------------------------------
# Preference: already on PATH, or our own /usr/local/bin build. Building the engine from source
# is out of scope for a one-shot installer (it needs the Flutter engine lib per arch); we detect
# and instruct rather than pretend.
FLUTTERPI=""
if command -v flutter-pi >/dev/null 2>&1; then
  FLUTTERPI=$(command -v flutter-pi)
elif [ -x /usr/local/bin/flutter-pi ]; then
  FLUTTERPI=/usr/local/bin/flutter-pi
fi

# --- Locate the app bundle (flutter_assets) ---------------------------------------------------
BUNDLE_SRC=""
if [ -n "$BUNDLE" ] && [ -d "$BUNDLE" ]; then
  BUNDLE_SRC="$BUNDLE"
elif [ -d "$DIR/apps/wall-native/build/flutter_assets" ]; then
  BUNDLE_SRC="$DIR/apps/wall-native/build/flutter_assets"
else
  # Best-effort: pull the wall-native CI artifact (the job publishes flutter_assets). Non-fatal.
  ART="https://github.com/api/v4/projects/2/jobs/artifacts/main/download?job=wall-native"
  echo "==> No local bundle; trying the wall-native CI artifact"
  if curl -fsSL "$ART" -o /tmp/kegwall-wall-bundle.zip 2>/dev/null && command -v unzip >/dev/null 2>&1; then
    rm -rf /tmp/kegwall-wall-bundle && mkdir -p /tmp/kegwall-wall-bundle
    unzip -qo /tmp/kegwall-wall-bundle.zip -d /tmp/kegwall-wall-bundle 2>/dev/null || true
    FOUND=$(find /tmp/kegwall-wall-bundle -type d -name flutter_assets | head -1 || true)
    [ -n "$FOUND" ] && BUNDLE_SRC="$FOUND"
  fi
fi

BUNDLE_DIR=/opt/kegwall-wall/bundle
if [ -n "$BUNDLE_SRC" ]; then
  install -d -m 755 /opt/kegwall-wall
  rm -rf "$BUNDLE_DIR" && cp -a "$BUNDLE_SRC" "$BUNDLE_DIR"
  chown -R kegwall-kiosk: /opt/kegwall-wall
  echo "==> Deployed app bundle → $BUNDLE_DIR"
fi

# --release when the bundle carries an AOT app.so; JIT otherwise.
RELEASE_FLAG=""
[ -n "$BUNDLE_SRC" ] && [ -f "$BUNDLE_DIR/app.so" ] && RELEASE_FLAG="--release"

# --- Install the service unit (enabled only when it can actually run) -------------------------
cat > /etc/systemd/system/kegwall-wall.service <<UNIT
[Unit]
Description=Kegwall native wall (flutter-pi on DRM/KMS)
After=systemd-user-sessions.service network-online.target getty@tty1.service kegwall.service
Wants=network-online.target
Conflicts=getty@tty1.service
ConditionPathExists=/dev/tty1
ConditionPathExists=$BUNDLE_DIR

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
ExecStartPre=/bin/sh -c 'until curl -fso /dev/null $BASE_URL/api/health; do sleep 2; done'
ExecStart=${FLUTTERPI:-/usr/local/bin/flutter-pi} $RELEASE_FLAG $BUNDLE_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

install -d -m 755 /etc/kegwall

if [ -n "$FLUTTERPI" ] && [ -n "$BUNDLE_SRC" ]; then
  # Both artifacts present — safe to own the screen.
  systemctl disable --now getty@tty1.service 2>/dev/null || true
  systemctl enable kegwall-wall
  printf 'native\n' > /etc/kegwall/display-mode
  echo
  echo "Native wall service installed → $BASE_URL (wall '$SLUG')"
  echo "Start now: sudo systemctl start kegwall-wall   (or just reboot)"
else
  # Missing a piece — install DISABLED, keep the console, and say exactly what's needed.
  # Marker stays 'chromium'/absent, never a false 'native'.
  echo
  echo "!! Native wall unit installed but NOT enabled — the tty1 console is untouched." >&2
  [ -z "$FLUTTERPI" ] && echo "   • Missing the flutter-pi binary. Build it (github.com/ardera/flutter-pi) and put it on PATH or at /usr/local/bin/flutter-pi." >&2
  [ -z "$BUNDLE_SRC" ] && echo "   • Missing the app bundle. Build 'flutter build bundle' in apps/wall-native, or pass --bundle <flutter_assets dir>." >&2
  echo "   Then: sudo $0 --dir $DIR --port $PORT --slug $SLUG   (re-runs and enables it)." >&2
  echo "   See docs/install/native-wall.md." >&2
fi

#!/usr/bin/env bash
# Kegwall native Raspberry Pi installer — one shot, idempotent-ish.
#
#   curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh \
#     | sudo bash -s -- [--dir /opt/kegwall] [--port 8080] [--with-ble] [--wall-slug main]
#
# Installs: Node 24 (NodeSource) + build toolchain, a `kegwall` system user, the app
# checked out at its LATEST RELEASE TAG under --dir, and three systemd units:
#   kegwall.service          the server
#   kegwall-update.service   oneshot updater (fetch latest tag, rebuild, restart)
#   kegwall-update.path      watches DATA_DIR/update-requested — written by the admin
#                            UI's "Update now" button (Settings → System, mode
#                            "Bare metal") — and fires the updater. The app itself
#                            needs no privileges.
# Optional: --with-ble adds BlueZ + the cap_net_raw grant for direct Gen 1 BLE;
# --wall-slug <slug> additionally boots this Pi's attached display into a fullscreen
# wall (chromium kiosk) — for the "server Pi lives behind the TV" setup.
#
# Uninstall: systemctl disable --now kegwall kegwall-update.path; rm
# /etc/systemd/system/kegwall*.{service,path} /usr/local/bin/kegwall-update.sh;
# deluser kegwall; rm -rf <dir> (DATA lives in <dir>/data — back it up first).
set -euo pipefail

DIR=/opt/kegwall
PORT=8080
REPO_URL=https://github.com/dlommm/Kegwall.git
WITH_BLE=0
WALL_SLUG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --with-ble) WITH_BLE=1; shift ;;
    --wall-slug) WALL_SLUG="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

echo "==> Installing packages"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates python3 make g++
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
if [ "$WITH_BLE" -eq 1 ]; then
  apt-get install -y -qq bluetooth bluez libbluetooth-dev libudev-dev
fi

echo "==> Creating kegwall user + checkout"
id kegwall >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin kegwall
if [ ! -d "$DIR/.git" ]; then
  # FULL clone on purpose — the updater resolves release tags.
  git clone "$REPO_URL" "$DIR"
fi
chown -R kegwall: "$DIR"
cd "$DIR"
# Install a RELEASE, not main — the reported version then matches the release feed
# the in-app update check reads. Skip prerelease tags (they contain '-').
TAG=$(sudo -u kegwall git tag -l 'v*' --sort=-v:refname | grep -v -- - | head -1)
[ -n "$TAG" ] || { echo "No release tags found in $REPO_URL" >&2; exit 1; }
echo "==> Checking out $TAG"
sudo -u kegwall git checkout --force "$TAG"
sudo -u kegwall npm ci || sudo -u kegwall npm ci --omit=optional
sudo -u kegwall npm run build
sudo -u kegwall mkdir -p "$DIR/data"

if [ "$WITH_BLE" -eq 1 ]; then
  # Direct Gen 1 BLE needs raw-socket capability on the node binary. NOTE: a Node
  # upgrade replaces the binary — re-run this setcap afterwards.
  setcap cap_net_raw+eip "$(readlink -f "$(command -v node)")"
fi

echo "==> Installing systemd units"
cat > /etc/systemd/system/kegwall.service <<UNIT
[Unit]
Description=Kegwall tap wall server
After=network-online.target
Wants=network-online.target

[Service]
User=kegwall
WorkingDirectory=$DIR
Environment=NODE_ENV=production
Environment=DATA_DIR=$DIR/data
Environment=PORT=$PORT
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /usr/local/bin/kegwall-update.sh <<UPDATER
#!/usr/bin/env bash
# Kegwall native updater — fired by kegwall-update.path when the admin UI writes
# DATA_DIR/update-requested. Runs as root (systemd), does the git/npm work as the
# kegwall user, restarts the service, rolls back on failure.
set -euo pipefail
DIR="$DIR"
TRIGGER="\$DIR/data/update-requested"

[ -f "\$TRIGGER" ] || exit 0
REQ=\$(cat "\$TRIGGER")
# Remove the trigger IMMEDIATELY: a PathExists= unit re-fires whenever the service
# deactivates while the path still exists — leaving it behind on failure would loop.
rm -f "\$TRIGGER"

cd "\$DIR"
sudo -u kegwall git fetch --tags origin

if [ "\$REQ" = "latest" ]; then
  TAG=\$(sudo -u kegwall git tag -l 'v*' --sort=-v:refname | grep -v -- - | head -1)
elif [[ "\$REQ" =~ ^[0-9]+\.[0-9]+\.[0-9]+\$ ]]; then
  TAG="v\$REQ"
else
  echo "kegwall-update: refusing malformed request '\$REQ'" >&2
  exit 1
fi
# Defense in depth alongside the server's zod regex: only a real, existing tag.
sudo -u kegwall git rev-parse -q --verify "refs/tags/\$TAG" >/dev/null \
  || { echo "kegwall-update: no such release tag \$TAG" >&2; exit 1; }

PREV=\$(sudo -u kegwall git rev-parse HEAD)
echo "kegwall-update: updating \$PREV -> \$TAG"

rollback() {
  echo "kegwall-update: FAILED — rolling back to \$PREV" >&2
  sudo -u kegwall git checkout --force "\$PREV" || true
  sudo -u kegwall npm ci || sudo -u kegwall npm ci --omit=optional || true
  # The running process still serves the old in-memory version either way; the
  # rollback just makes the on-disk tree match it again.
}
trap rollback ERR

# --force handles any dirty tree. NEVER 'git clean' here: \$DIR/data (the SQLite
# database and label images) lives INSIDE the checkout and clean -fd would delete it.
sudo -u kegwall git checkout --force "\$TAG"
sudo -u kegwall npm ci || sudo -u kegwall npm ci --omit=optional
sudo -u kegwall npm run build
trap - ERR
systemctl restart kegwall
echo "kegwall-update: done — now on \$TAG"
UPDATER
chmod +x /usr/local/bin/kegwall-update.sh

cat > /etc/systemd/system/kegwall-update.service <<UNIT
[Unit]
Description=Kegwall self-update (fired by kegwall-update.path)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/kegwall-update.sh
UNIT

cat > /etc/systemd/system/kegwall-update.path <<UNIT
[Unit]
Description=Watch for Kegwall update requests from the admin UI

[Path]
PathExists=$DIR/data/update-requested
Unit=kegwall-update.service

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now kegwall kegwall-update.path

if [ -n "$WALL_SLUG" ]; then
  echo "==> Setting up the TV wall kiosk (slug: $WALL_SLUG)"
  KIOSK_URL="http://localhost:$PORT/wall/$WALL_SLUG"
  bash "$DIR/scripts/pi-kiosk-setup.sh" "$KIOSK_URL" || \
    echo "!! Kiosk setup failed (no desktop stack? Pi OS Lite has none) — the server itself is fine."
fi

echo
echo "=========================================================="
echo " Kegwall installed: http://$(hostname -I | awk '{print $1}'):$PORT"
echo " Version: $TAG   Data: $DIR/data"
echo " First visit creates the admin account. Then open"
echo " Settings → System and set update mode to 'Bare metal —"
echo " Pi installer' to enable the one-click Update button."
[ -n "$WALL_SLUG" ] && echo " TV wall: create a wall with slug '$WALL_SLUG' in the admin UI."
echo "=========================================================="

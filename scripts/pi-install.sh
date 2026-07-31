#!/usr/bin/env bash
# Kegwall native Raspberry Pi installer — one shot, idempotent-ish, INTERACTIVE.
#
#   curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh \
#     | sudo bash
#
# Run with no flags it asks a handful of questions on the terminal; every flag it
# would ask about can also be passed directly (automation / re-runs), and any flag
# you pass is simply not asked about:
#   --dir /opt/kegwall     install directory
#   --port 8080            HTTP port
#   --repo-url <url>       git remote
#   --with-ble             Bluetooth fallback for Kegtron devices (Gen 1 + Pro)
#   --kiosk                KIOSK MODE: this Pi's screen boots into the tap wall
#                          (no desktop needed — cage compositor via
#                          pi-tablet-setup.sh --local). Without it: SERVER MODE —
#                          the HDMI output just shows the normal login terminal.
#   --wall-slug <slug>     deprecated alias for --kiosk (slug is always 'main' now —
#                          the first-run wizard creates that wall)
#   --os-updates off|auto  OS (apt) update mode; 'auto' installs unattended-upgrades
#   --auto-reboot          with --os-updates auto: let the OS reboot itself at 04:00
#                          when an update requires it
#   --non-interactive      never prompt; flags/defaults only
#
# Installs: Node 24 (NodeSource) + build toolchain, a `kegwall` system user, the app
# checked out at its LATEST RELEASE TAG under --dir, and these systemd units:
#   kegwall.service            the server
#   kegwall-update.{service,path}     app self-update  (DATA_DIR/update-requested)
#   kegwall-os-update.{service,path}  OS apt update    (DATA_DIR/os-update-requested)
#   kegwall-reboot.{service,path}     UI-requested reboot (DATA_DIR/reboot-requested)
# The three trigger files are written by the admin UI; the path units run the
# privileged work — the app itself needs no privileges. The OS-update/reboot pairs
# are ALWAYS installed (inert until the app writes a trigger; the in-app setting is
# the real gate — conditional installation would only create version skew).
#
# Uninstall: systemctl disable --now kegwall kegwall-update.path
#   kegwall-os-update.path kegwall-reboot.path kegwall-kiosk 2>/dev/null;
#   rm /etc/systemd/system/kegwall*.{service,path} /usr/local/bin/kegwall-*.sh;
#   systemctl enable --now getty@tty1; deluser kegwall; deluser kegwall-kiosk;
#   rm -rf <dir> (DATA lives in <dir>/data — back it up first).
set -euo pipefail

DIR=/opt/kegwall
PORT=8080
REPO_URL=https://github.com/dlommm/Kegwall.git
WITH_BLE=0
KIOSK=0
OS_UPDATES=off
AUTO_REBOOT=0
NON_INTERACTIVE=0
# Track which values arrived as flags — prompts only fill the unset ones.
PORT_SET=0 BLE_SET=0 KIOSK_SET=0 OS_SET=0 REBOOT_SET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; PORT_SET=1; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --with-ble) WITH_BLE=1; BLE_SET=1; shift ;;
    --kiosk) KIOSK=1; KIOSK_SET=1; shift ;;
    --wall-slug) KIOSK=1; KIOSK_SET=1; shift 2 ;; # deprecated alias; slug is 'main'
    --os-updates) OS_UPDATES="$2"; OS_SET=1; shift 2 ;;
    --auto-reboot) AUTO_REBOOT=1; REBOOT_SET=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done
case "$OS_UPDATES" in off|auto) ;; *) echo "--os-updates must be 'off' or 'auto'" >&2; exit 2 ;; esac

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

# --- Interactive prompts -----------------------------------------------------------
# Under `curl | sudo bash` STDIN IS THE SCRIPT — reading it would eat script text and
# `[ -t 0 ]` is false. So: open fd 3 from the controlling terminal once, print
# prompts to /dev/tty (stdout may be piped too), read answers from fd 3. No tty
# (CI, ssh without pty) → silently fall back to flags/defaults and print them.
INTERACTIVE=0
if [ "$NON_INTERACTIVE" -eq 0 ] && { exec 3</dev/tty; } 2>/dev/null; then INTERACTIVE=1; fi

ask() { # ask <prompt> <default> → echoes the answer
  local ans
  printf '%s [%s]: ' "$1" "$2" >/dev/tty
  IFS= read -r ans <&3 || ans=''
  printf '%s' "${ans:-$2}"
}
ask_yn() { # ask_yn <prompt> <Y|N> → echoes 1/0
  local d ans
  d=$([ "$2" = Y ] && echo Y/n || echo y/N)
  ans=$(ask "$1 ($d)" "$2")
  case "$ans" in [yY]*) echo 1 ;; *) echo 0 ;; esac
}

if [ "$INTERACTIVE" -eq 1 ]; then
  echo "Kegwall guided install — press Enter to accept the defaults." >/dev/tty
  [ "$PORT_SET" -eq 0 ] && PORT=$(ask "HTTP port for the server" "$PORT")
  [ "$BLE_SET" -eq 0 ] && WITH_BLE=$(ask_yn "Enable Bluetooth fallback for Kegtron devices (Gen 1 + Pro)?" N)
  [ "$KIOSK_SET" -eq 0 ] && KIOSK=$(ask_yn "Kiosk mode — show the tap wall on THIS screen at boot? (No = server mode, terminal on HDMI)" N)
  [ "$OS_SET" -eq 0 ] && { [ "$(ask_yn "Keep the OS updated automatically (unattended-upgrades)?" N)" -eq 1 ] && OS_UPDATES=auto || OS_UPDATES=off; }
  if [ "$OS_UPDATES" = auto ] && [ "$REBOOT_SET" -eq 0 ]; then
    AUTO_REBOOT=$(ask_yn "Reboot automatically (04:00) when an OS update requires it?" N)
  fi
  {
    echo
    echo "  Install dir:   $DIR"
    echo "  Port:          $PORT"
    echo "  BLE fallback:  $([ "$WITH_BLE" -eq 1 ] && echo yes || echo no)"
    echo "  Display:       $([ "$KIOSK" -eq 1 ] && echo 'kiosk mode (boots into the tap wall)' || echo 'server mode (terminal on HDMI)')"
    echo "  OS updates:    $OS_UPDATES$([ "$OS_UPDATES" = auto ] && [ "$AUTO_REBOOT" -eq 1 ] && echo ' + auto-reboot')"
    echo
  } >/dev/tty
  [ "$(ask_yn "Proceed?" Y)" -eq 1 ] || { echo "Aborted." >&2; exit 1; }
else
  echo "==> Non-interactive: dir=$DIR port=$PORT ble=$WITH_BLE kiosk=$KIOSK os-updates=$OS_UPDATES auto-reboot=$AUTO_REBOOT"
fi

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

# Capability grants on the node binary (one setcap, not systemd AmbientCapabilities:
# file capabilities CLEAR ambient ones at exec, so with BLE's cap_net_raw present an
# ambient bind grant would be silently dropped — one mechanism covers every combo):
#   cap_net_raw           BLE scanning (raw HCI socket)
#   cap_net_bind_service  ports below 1024 (e.g. plain http://pi/ on port 80) — the
#                         kegwall user can't bind them otherwise and the server
#                         crash-loops with EACCES
# NOTE: a Node upgrade replaces the binary — re-run this script (or the setcap)
# afterwards.
NODE_CAPS=""
[ "$WITH_BLE" -eq 1 ] && NODE_CAPS="cap_net_raw"
[ "$PORT" -lt 1024 ] && NODE_CAPS="${NODE_CAPS:+$NODE_CAPS,}cap_net_bind_service"
if [ -n "$NODE_CAPS" ]; then
  setcap "${NODE_CAPS}+eip" "$(readlink -f "$(command -v node)")"
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
Environment=KEGWALL_INSTALL=native
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

# --- OS update + reboot triggers (admin UI → root, same pattern as the updater) ----
cat > /usr/local/bin/kegwall-os-update.sh <<OSUPDATER
#!/usr/bin/env bash
# OS (apt) update — fired by kegwall-os-update.path when the admin UI writes
# DATA_DIR/os-update-requested. Trigger CONTENT carries the auto-reboot decision
# ('run' or 'run-reboot') because this root script can't read app settings.
set -euo pipefail
DIR="$DIR"
TRIGGER="\$DIR/data/os-update-requested"

[ -f "\$TRIGGER" ] || exit 0
REQ=\$(cat "\$TRIGGER")
rm -f "\$TRIGGER" # loop guard FIRST — see kegwall-update.sh
case "\$REQ" in run|run-reboot) ;; *) echo "kegwall-os-update: refusing malformed request '\$REQ'" >&2; exit 1 ;; esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
# Waits out unattended-upgrades' lock instead of failing on contention.
apt-get -o DPkg::Lock::Timeout=600 full-upgrade -y
if [ -f /var/run/reboot-required ] && [ "\$REQ" = "run-reboot" ]; then
  echo "kegwall-os-update: reboot required — rebooting now (auto-reboot on)"
  systemctl reboot
fi
# Otherwise /var/run/reboot-required stays and the admin dashboard shows the banner.
echo "kegwall-os-update: done"
OSUPDATER
chmod +x /usr/local/bin/kegwall-os-update.sh

cat > /etc/systemd/system/kegwall-os-update.service <<UNIT
[Unit]
Description=Kegwall OS update (fired by kegwall-os-update.path)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/kegwall-os-update.sh
UNIT

cat > /etc/systemd/system/kegwall-os-update.path <<UNIT
[Unit]
Description=Watch for OS update requests from the Kegwall admin UI

[Path]
PathExists=$DIR/data/os-update-requested
Unit=kegwall-os-update.service

[Install]
WantedBy=multi-user.target
UNIT

cat > /usr/local/bin/kegwall-reboot.sh <<REBOOTER
#!/usr/bin/env bash
# UI-requested reboot — fired by kegwall-reboot.path. Own trigger + unit pair on
# purpose (no content multiplexing with the OS updater).
set -euo pipefail
DIR="$DIR"
TRIGGER="\$DIR/data/reboot-requested"

[ -f "\$TRIGGER" ] || exit 0
REQ=\$(cat "\$TRIGGER")
rm -f "\$TRIGGER" # loop guard FIRST
[ "\$REQ" = "reboot" ] || { echo "kegwall-reboot: refusing malformed request '\$REQ'" >&2; exit 1; }
shutdown -r +0 "Kegwall admin requested a reboot"
REBOOTER
chmod +x /usr/local/bin/kegwall-reboot.sh

cat > /etc/systemd/system/kegwall-reboot.service <<UNIT
[Unit]
Description=Kegwall UI-requested reboot (fired by kegwall-reboot.path)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/kegwall-reboot.sh
UNIT

cat > /etc/systemd/system/kegwall-reboot.path <<UNIT
[Unit]
Description=Watch for reboot requests from the Kegwall admin UI

[Path]
PathExists=$DIR/data/reboot-requested
Unit=kegwall-reboot.service

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now kegwall kegwall-update.path kegwall-os-update.path kegwall-reboot.path

if [ "$OS_UPDATES" = auto ]; then
  echo "==> Enabling unattended-upgrades"
  apt-get install -y -qq unattended-upgrades
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<CONF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
  cat > /etc/apt/apt.conf.d/52kegwall-unattended <<CONF
Unattended-Upgrade::Automatic-Reboot "$([ "$AUTO_REBOOT" -eq 1 ] && echo true || echo false)";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
CONF
fi

if [ "$KIOSK" -eq 1 ]; then
  echo "==> Kiosk mode: this screen boots into the tap wall"
  # --force: the kiosk answer above IS the consent to own the screen. The wizard
  # creates the 'main' wall on first visit; until then chromium shows the app's
  # not-found page, which resolves itself once the wall exists.
  bash "$DIR/scripts/pi-tablet-setup.sh" --local --force "http://localhost:$PORT/wall/main" || \
    echo "!! Kiosk setup failed — the server itself is fine; re-run scripts/pi-tablet-setup.sh later."
fi

echo
echo "=========================================================="
echo " Kegwall installed: http://$(hostname -I | awk '{print $1}'):$PORT"
echo " Version: $TAG   Data: $DIR/data"
echo " First browser visit creates the admin account, then a"
echo " guided setup walks you through the rest (wall, updates,"
echo " and every URL for this Pi)."
[ "$KIOSK" -eq 1 ] && echo " Kiosk mode: the wall appears on this screen after reboot."
echo "=========================================================="

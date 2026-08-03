#!/usr/bin/env bash
# Kegwall unattended first-boot installer. Dropped onto a machine by the Debian preseed
# (deploy/debian/preseed.cfg) and run ONCE by kegwall-firstboot.service on the first real boot —
# where systemd is running and the network is up, unlike the installer's chroot. It runs the
# normal pi-install.sh and then disarms itself.
#
# Config comes from /etc/kegwall-firstboot.env (written by the preseed), so the same script serves
# any install profile:
#   KEGWALL_ARGS   extra flags passed straight to pi-install.sh (default: --native-wall)
#   KEGWALL_REF    git ref to pull pi-install.sh from (default: main)
set -euo pipefail

# State lives OUTSIDE /opt/kegwall — pi-install `git clone`s into /opt/kegwall and needs it empty or
# absent, so a guard file in there would break the clone.
STATE=/var/lib/kegwall-setup
MARKER="$STATE/done"
RUNGUARD="$STATE/running"
install -d -m 755 "$STATE"
[ -f "$MARKER" ] && { echo "kegwall-firstboot: already done"; exit 0; }

# Re-entry guard: a second SSH login (or a re-run) mustn't launch a parallel install.
if [ -e "$RUNGUARD" ]; then echo "kegwall-firstboot: setup already running (pid $(cat "$RUNGUARD" 2>/dev/null))"; exit 0; fi
echo $$ > "$RUNGUARD"
trap 'rm -f "$RUNGUARD"' EXIT

# shellcheck disable=SC1091
[ -f /etc/kegwall-firstboot.env ] && . /etc/kegwall-firstboot.env
REF="${KEGWALL_REF:-main}"
ARGS="${KEGWALL_ARGS:---native-wall}"

echo "kegwall-firstboot: installing Kegwall (ref=$REF, args=$ARGS)"
# --non-interactive: never prompt. --ref "$REF": install the SAME ref this ISO was built from, so a
# branch ISO tests branch code end to end and a release ISO installs exactly that release.
curl -fsSL "https://raw.githubusercontent.com/dlommm/Kegwall/$REF/scripts/pi-install.sh" \
  | bash -s -- --non-interactive --ref "$REF" $ARGS

# Branded boot/loading splash (Kegwall logo). Best-effort — never fail the install over cosmetics.
{ curl -fsSL "https://raw.githubusercontent.com/dlommm/Kegwall/$REF/deploy/debian/kegwall-plymouth-setup.sh" -o /tmp/kegwall-plymouth-setup.sh \
    && sh /tmp/kegwall-plymouth-setup.sh "$REF"; } || echo "kegwall-firstboot: boot splash skipped"

touch "$MARKER"

# Surface the first-run setup token right here so you can paste it into the wizard without hunting.
# The server writes it on first startup; wait briefly in case it's still booting.
TOKENFILE=/opt/kegwall/data/setup-claim-token
for _ in $(seq 1 30); do [ -s "$TOKENFILE" ] && break; sleep 1; done
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "=================================================================="
echo "  Kegwall ready:          http://$IP/"
if [ -s "$TOKENFILE" ]; then
  echo "  First-run setup token:  $(cat "$TOKENFILE")"
  echo "  Paste that token into the wizard at the URL above."
else
  echo "  Setup token not ready yet — read it with:  sudo cat $TOKENFILE"
fi
echo "=================================================================="

# Disarm: the unit is oneshot + guarded by the marker, but disable it too so it never re-runs.
systemctl disable kegwall-firstboot.service 2>/dev/null || true
echo "kegwall-firstboot: done"

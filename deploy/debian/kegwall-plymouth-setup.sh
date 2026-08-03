#!/usr/bin/env bash
# Clean branded boot: hide kernel/systemd console text and show the Kegwall logo + a spinner while
# the box boots, and hide the GRUB menu. Uses the STOCK Plymouth "spinner" theme (watermark swapped
# for the Kegwall logo) — deliberately conservative, because a non-stock theme or a console= trick
# can HANG boot at plymouth-quit-wait. BEST-EFFORT: never fails its caller. Idempotent via a marker.
#   kegwall-plymouth-setup.sh [git-ref]
set -uo pipefail

REF="${1:-${KEGWALL_REF:-main}}"
LOGO_URL="https://raw.githubusercontent.com/dlommm/Kegwall/$REF/docs/images/logo.png"
DST=/usr/share/plymouth/themes/kegwall
MARKER=/var/lib/kegwall-plymouth-done

# Runs during install (late_command → silent from boot 1) and at first-boot as a fallback; once only.
[ -e "$MARKER" ] && { echo "kegwall-plymouth: already configured"; exit 0; }

command -v plymouth >/dev/null 2>&1 || apt-get install -y -qq plymouth plymouth-themes || {
  echo "kegwall-plymouth: plymouth install failed — skipping"; exit 0; }

# Stock spinner theme + our logo. No custom script module (that's what risked the boot hang).
SRC=/usr/share/plymouth/themes/spinner
[ -d "$SRC" ] || { echo "kegwall-plymouth: no spinner base theme — skipping"; exit 0; }
rm -rf "$DST"; cp -r "$SRC" "$DST"
mv "$DST/spinner.plymouth" "$DST/kegwall.plymouth" 2>/dev/null || true
sed -i 's#/spinner#/kegwall#g; s/^Name=.*/Name=Kegwall/' "$DST/kegwall.plymouth"
curl -fsSL "$LOGO_URL" -o "$DST/watermark.png" 2>/dev/null || echo "kegwall-plymouth: logo fetch failed — default watermark"

command -v plymouth-set-default-theme >/dev/null 2>&1 && {
  plymouth-set-default-theme -R kegwall 2>/dev/null || plymouth-set-default-theme kegwall 2>/dev/null || true
}

# Silent boot — NOTE: no `console=tty3` (it confuses Plymouth's VT handoff and hangs
# plymouth-quit-wait). `quiet splash` + a working theme is what actually hides the text.
CMDLINE="quiet splash loglevel=3 vt.global_cursor_default=0 systemd.show_status=false"
set_grub() { # set_grub KEY VALUE — set or append a GRUB_* key in /etc/default/grub
  if grep -q "^$1=" /etc/default/grub; then
    sed -i "s#^$1=.*#$1=$2#" /etc/default/grub
  else
    echo "$1=$2" >> /etc/default/grub
  fi
}
if [ -f /etc/default/grub ]; then
  set_grub GRUB_CMDLINE_LINUX_DEFAULT "\"$CMDLINE\""
  # Hide the GRUB menu (hold Shift / tap Esc still shows it, for recovery).
  set_grub GRUB_TIMEOUT 0
  set_grub GRUB_TIMEOUT_STYLE hidden
  set_grub GRUB_RECORDFAIL_TIMEOUT 0
  command -v update-grub >/dev/null 2>&1 && update-grub >/dev/null 2>&1 || true
fi
command -v update-initramfs >/dev/null 2>&1 && update-initramfs -u >/dev/null 2>&1 || true
mkdir -p /var/lib && : > "$MARKER"
echo "kegwall-plymouth: silent branded boot installed (stock spinner + logo)"

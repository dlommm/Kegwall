#!/usr/bin/env bash
# Remaster the stock Debian amd64 netinst ISO into an UNATTENDED Kegwall installer ISO.
#
# The result carries only Debian + deploy/debian/preseed.cfg — NOT the app. On first boot the
# preseed's kegwall-firstboot.service pulls the latest pi-install.sh and installs Kegwall, so the
# ISO stays current on its own; CI just re-spins it per release to refresh the Debian base.
#
# Runs in CI (see the iso job in .github/workflows/publish.yml) or locally on a Debian box:
#   sudo apt-get install -y xorriso isolinux curl ca-certificates
#   DEB_VER=12.11.0 bash scripts/build-kegwall-iso.sh
#
# Boot-test the output in a throwaway VM before trusting it (it erases the target disk).
set -euo pipefail

ARCH="${ARCH:-amd64}"
# Stock Debian netinst to base on. Override DEB_VER as Debian publishes point releases; the
# 'current' cdimage path always holds the latest stable, and we discover the exact filename from it.
DEB_VER="${DEB_VER:-}"
MIRROR="${MIRROR:-https://cdimage.debian.org/debian-cd/current/$ARCH/iso-cd}"
WORK="${WORK:-$PWD/.iso-build}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PRESEED="$HERE/../deploy/debian/preseed.cfg"
OUT="${OUT:-$PWD/kegwall-installer-$ARCH.iso}"

[ -f "$PRESEED" ] || { echo "!! preseed not found at $PRESEED" >&2; exit 1; }
command -v xorriso >/dev/null || { echo "!! install xorriso (and isolinux for isohdpfx.bin)." >&2; exit 1; }

# Version every ISO so builds are trackable: a release tag as-is, else <app version>-dev.<sha>.
APPVER=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HERE/../package.json" | head -1)
SHA="${GITHUB_SHA:-local}"
VER="${ISO_VERSION:-${APPVER:-0.0.0}-dev.${SHA:0:7}}"
echo "==> ISO version: $VER"
echo "$VER" > "$(dirname "$OUT")/iso-version.txt"

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

# Resolve the netinst filename (either the pinned DEB_VER or whatever 'current' points at).
if [ -n "$DEB_VER" ]; then
  ISO="debian-$DEB_VER-$ARCH-netinst.iso"
else
  ISO=$(curl -fsSL "$MIRROR/" | grep -oE "debian-[0-9.]+-$ARCH-netinst\.iso" | head -1)
  [ -n "$ISO" ] || { echo "!! could not discover the netinst filename from $MIRROR" >&2; exit 1; }
fi
echo "==> Base ISO: $ISO"
curl -fL --retry 3 -o base.iso "$MIRROR/$ISO"

# Extract the ISO contents.
echo "==> Extracting"
xorriso -osirrox on -indev base.iso -extract / iso >/dev/null
chmod -R u+w iso

# Stamp the version onto the media so a downloaded/booted ISO self-identifies.
printf 'kegwall-installer %s\narch %s\nbase %s\n' "$VER" "$ARCH" "$ISO" > iso/kegwall-version.txt

# Drop the preseed on the media root, pointing its first-boot fetch at the SAME git ref that built
# this ISO (branch or tag), so a test ISO built from a branch pulls that branch's files — not main.
cp "$PRESEED" iso/preseed.cfg
REF="${KEGWALL_REF:-${GITHUB_REF_NAME:-main}}"
if [ "$REF" != "main" ]; then
  echo "==> Pinning first-boot fetch to ref: $REF"
  sed -i "s#/Kegwall/main/deploy/debian#/Kegwall/$REF/deploy/debian#g; s#KEGWALL_REF=main#KEGWALL_REF=$REF#g" iso/preseed.cfg
fi

# Make the AUTOMATED install the default boot entry (no keypress, no boot args). Debian netinst
# ships isolinux (BIOS) + grub (UEFI); patch both to auto-load the preseed from the CD.
# priority=high (not critical): preseeded answers still suppress their prompts, but an un-preseeded
# question — notably WiFi ESSID/passphrase when there's NO wired link — is allowed to appear. With
# ethernet present the network is configured before any wireless question, so it stays unattended.
if [ -f iso/isolinux/isolinux.cfg ]; then
  # Boot the 'auto' installer immediately (timeout in 1/10 s; no menu).
  { echo 'default kegwall'; echo 'timeout 1'; echo 'prompt 0'; \
    echo 'label kegwall'; echo '  menu label ^Kegwall unattended install'; \
    echo '  kernel /install.amd/vmlinuz'; \
    echo '  append auto=true priority=high preseed/file=/cdrom/preseed.cfg vga=788 initrd=/install.amd/initrd.gz --- quiet'; \
  } > iso/isolinux/isolinux.cfg
fi
if [ -f iso/boot/grub/grub.cfg ]; then
  cat > iso/boot/grub/grub.cfg <<'GRUB'
set default=0
set timeout=0
set timeout_style=hidden
menuentry "Kegwall unattended install" {
    set background_color=black
    linux /install.amd/vmlinuz auto=true priority=high preseed/file=/cdrom/preseed.cfg vga=788 --- quiet
    initrd /install.amd/initrd.gz
}
GRUB
fi

# Debian verifies media integrity against md5sum.txt; regenerate it so the added file passes.
if [ -f iso/md5sum.txt ]; then
  ( cd iso && find . -type f ! -name md5sum.txt -exec md5sum {} \; > md5sum.txt )
fi

# Repack as a BIOS+UEFI hybrid bootable ISO (standard Debian remaster incantation).
ISOHDPFX=$(ls /usr/lib/ISOLINUX/isohdpfx.bin /usr/lib/syslinux/isohdpfx.bin 2>/dev/null | head -1 || true)
echo "==> Repacking → $OUT"
xorriso -as mkisofs -r -V 'KEGWALL' -o "$OUT" \
  ${ISOHDPFX:+-isohybrid-mbr "$ISOHDPFX"} \
  -c isolinux/boot.cat -b isolinux/isolinux.bin \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot -e boot/grub/efi.img -no-emul-boot -isohybrid-gpt-basdat \
  iso

echo "==> Done: $OUT"
echo "    Flash to USB (dd/Etcher/Rufus) and boot the target. ⚠ It ERASES the target disk."

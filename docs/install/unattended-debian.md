# Unattended install (custom Debian ISO)

Go from a bare amd64 mini-PC / NUC to a running Kegwall tap wall with **no clicking**: flash one
USB, boot it, walk away. Debian installs itself, reboots, and the first boot installs Kegwall + the
cog wall.

> **amd64 only.** A Raspberry Pi doesn't boot ISOs — it needs an SD-card image (a separate
> build, not made yet). This page is for x86 mini-PCs.

## The idea (why it stays up to date)

The ISO carries **only stock Debian + a preseed** ([`deploy/debian/preseed.cfg`](../../deploy/debian/preseed.cfg)).
Kegwall itself is **not baked in** — on the first boot, `kegwall-firstboot.service` pulls the latest
[`pi-install.sh`](../../scripts/pi-install.sh) and installs it. So:

- Even an old ISO installs **today's** Kegwall — the app is fetched fresh, never frozen.
- CI just re-spins the ISO per release to refresh the Debian base + preseed
  ([`scripts/build-kegwall-iso.sh`](../../scripts/build-kegwall-iso.sh), the `iso` job in the
  Publish workflow).

## Use it

1. **Get the ISO** — every release attaches `kegwall-installer-amd64.iso` (plus a `.sha256`) to
   its [GitHub Release](https://github.com/dlommm/Kegwall/releases). Newest:
   ```
   https://github.com/dlommm/Kegwall/releases/latest/download/kegwall-installer-amd64.iso
   ```
   …or a specific version from that release's page. The ISO also carries `/kegwall-version.txt`.
   To test a branch, run the **Publish** workflow from the Actions tab with no tag — the ISO
   (versioned `<app-version>-dev.<sha>`) lands as a workflow artifact.
   Or build locally on a Debian box:
   ```bash
   sudo apt-get install -y xorriso isolinux curl ca-certificates
   bash scripts/build-kegwall-iso.sh      # → kegwall-installer-amd64.iso
   ```
2. **Flash it** to a USB stick — `dd`, [balenaEtcher](https://etcher.balena.io/), or Rufus:
   ```bash
   sudo dd if=kegwall-installer-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync
   ```
3. **Boot the target from USB.** It installs Debian unattended (with **SSH enabled**) and reboots.
   The box comes up on the network first — the Kegwall install does **not** run at boot.
4. **SSH in → change the password → setup runs.** `ssh kegadmin@<box-ip>` (find the IP from your
   router, or read it off the box's console). The default password is expired, so your **first login
   forces a password change**; once you've set a new one, the install kicks off automatically and you
   watch it happen. SSH stays reachable no matter what — setup is independent of it. Skip with
   Ctrl-C; re-run any time with `sudo kegwall-setup`.

   **No wired network?** With no ethernet link the installer auto-selects the WiFi adapter and
   **prompts for your SSID + passphrase** during install (with ethernet it's fully unattended).
5. When it finishes (native profile shows the wall on the attached screen), open `http://<box-ip>`
   from another device and run the first-run wizard (the [setup token](raspberry-pi.md) is at
   `/opt/kegwall/data/setup-claim-token`).

> Why login-triggered, not boot-triggered: SSH must be reachable *regardless* of the app install, so
> a slow or failed setup can never lock you out. Running setup on login also lets you watch it live.
> For a truly headless, hands-off box (nobody ever logs in), the repo also ships an optional
> `kegwall-firstboot.service` you can enable instead to run setup at boot.

### Defaults

- **Login:** user **`kegadmin`**, password **`changeme`** (this is what you SSH in with). ⚠ Change it
  in `deploy/debian/preseed.cfg` before building an ISO you'll actually deploy, or `passwd` after
  first login.
- **Target disk:** auto-picked — the **largest fixed disk**, **never a removable/USB drive**, and
  never the disk the installer booted from (a `partman/early_command` detects it). No "which disk?"
  prompt. **⚠ It erases that disk** (guided — use entire disk, one partition).
- **Finding the box:** its IP is shown on the physical console login prompt (`Kegwall · … ssh
  kegadmin@<ip>`), so you can read it off the screen to SSH in.
- **Boot splash:** configured **during install**, so even the first boot is clean — GRUB is hidden
  (`quiet splash`, no menu/countdown) and the screen shows the Kegwall logo + a spinner (stock
  Plymouth `spinner` theme, watermark swapped for the logo). At the end of boot it hands off to the
  **wall** (kiosk) or the **login terminal** (server). Deliberately conservative — an over-clever
  theme or a `console=` trick can hang boot at `plymouth-quit-wait`, so this sticks to the stock
  theme. Hold **Shift** / tap **Esc** at boot to reach GRUB for recovery.

### Tuning the install profile

`deploy/debian/preseed.cfg`'s `late_command` writes `/etc/kegwall-firstboot.env`, which controls
what gets installed:

- `KEGWALL_ARGS=--native-wall --os-updates auto` — the default: cog/WPE wall on this screen, plus
  unattended OS updates. Drop `--native-wall` for a **headless server** (no screen). Add
  `--with-ble` for Bluetooth Kegtron.
- `KEGWALL_REF=main` — the git ref the installer is pulled from (pin to a release tag if you want).

## Simpler alternative — no custom ISO

Don't want to build an ISO? Boot the **stock** Debian installer and point it at the preseed over the
network — one boot argument, nothing to remaster. Host `preseed.cfg` at a URL, then at the Debian
installer's boot menu press `Tab`/`e` and append:

```
auto=true priority=critical preseed/url=https://raw.githubusercontent.com/dlommm/Kegwall/main/deploy/debian/preseed.cfg
```

Same result (unattended Debian + first-boot Kegwall), zero ISO tooling — you just type one line.

## Testing

Boot the ISO in a throwaway VM first (QEMU/VirtualBox/UTM) with a blank disk and a network — it's
the fastest way to confirm the preseed + first-boot flow end to end before you flash real hardware.
The ISO remaster + boot path can't be verified in CI, only by booting it.

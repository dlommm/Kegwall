# Moving an existing install to GitHub

Kegwall's source, releases, and container image now live on GitHub:

| What | Where |
| --- | --- |
| Source | `https://github.com/dlommm/Kegwall.git` |
| Releases (notes, tablet APK, installer ISO) | <https://github.com/dlommm/Kegwall/releases> |
| Docker image | `ghcr.io/dlommm/kegwall` (`latest` + each release version, amd64 + arm64) |
| Raw install scripts | `https://raw.githubusercontent.com/dlommm/Kegwall/main/...` |

The in-app **Settings → System → Check for updates** reads the GitHub Releases feed from this
version on, so it keeps working once you're on it. Installs from before the move need a one-time
switch so they pull future updates from GitHub:

## Docker / Compose

Change the image line in your compose file (or `docker run` command) from the old registry to

```yaml
image: ghcr.io/dlommm/kegwall:latest
```

then `docker compose pull && docker compose up -d`. Your `/data` volume is untouched. The
Watchtower "Update now" button follows whatever image the container runs, so nothing else changes.

## Native (bare-metal Pi / mini PC)

Re-run the installer once — it re-points the existing checkout at GitHub, refreshes the release
tags, and installs the newest release. Your database in `/opt/kegwall/data` is kept:

```sh
curl -fsSL https://raw.githubusercontent.com/dlommm/Kegwall/main/scripts/pi-install.sh | sudo bash
```

Add the same flags you installed with (for example `--native-wall`). Release tags were re-created
during the move, so the installer and the in-app updater fetch tags with `--force`; an install
that was never re-run keeps tracking the old remote until you do this.

## Android tablet APK

Download the next APK from the [latest release](https://github.com/dlommm/Kegwall/releases/latest).
A newly configured signing key differs from the old one, so uninstall the old app first if Android
refuses to update over it (your saved tablet URL is the only thing lost).

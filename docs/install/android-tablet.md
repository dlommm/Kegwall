# Android tablet kiosk app

A tiny Android app (see [`android/`](../../android/README.md)) that runs your wall's
tablet page — `/tablet/<wall-slug>` — as a true kiosk: fullscreen, screen always on,
auto-reconnecting when the server restarts. It works for `/wall/<slug>` on an Android
TV stick too.

## Get the APK

Every release pipeline builds it: GitLab → **Build → Pipelines** → open a `vX.Y.Z`
pipeline → the `android-apk` job → **Browse/Download artifacts** →
`kegwall-tablet.apk`. (On any branch pipeline the job exists as a manual "play"
button.)

## Install on the tablet

1. Copy the APK to the tablet (USB, a file-share, or just open the GitLab artifact
   URL in the tablet's browser while logged in).
2. Open the APK from the Files app. Android will ask to allow installs from that
   source ("Install unknown apps") — allow it for the Files app/browser you used.
3. Launch **Kegwall**, enter your tablet URL (e.g. `http://192.168.1.50:8080/tablet/main`),
   tap **Start kiosk**.

Change the URL later: **tap the top-left corner of the screen 5 times within 3
seconds**.

## Camera permission (face sign-in)

If you use [face sign-in](../setup/face-sign-in.md), the app requests the Android
camera permission on first launch — a normal system permission dialog, grant it there.
If you deny it (or the tablet has no camera at all), the tablet page just falls back
to the normal avatar grid; nothing crashes and face sign-in is simply unavailable. If
you change your mind later, grant it from Android's own **Settings → Apps → Kegwall →
Permissions → Camera**; no reinstall needed.

## Make it survive a party (recommended)

- **Screen pinning** (Settings → Security → App pinning): pin Kegwall so Home/Recents
  gestures don't leave the kiosk. Unpin needs the lock PIN.
- Plug the tablet in — the app keeps the screen on, which eats battery otherwise.
- Optional: set Kegwall as the launcher via any "kiosk launcher" app if the tablet is
  fully dedicated.

## Updates

By default CI produces a **debug-signed** APK whose signature changes every build, so
Android refuses to install an update over the old one — **uninstall Kegwall first,
then install the new APK**. (Your saved URL is lost on uninstall; it's one field.)

To make updates install over the top, set up a signing key once:

```sh
keytool -genkeypair -v -keystore kegwall-kiosk.keystore -alias kegwall \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -i kegwall-kiosk.keystore | pbcopy   # macOS; use `base64 -w0` on Linux
```

Then add four CI/CD variables in GitLab (Settings → CI/CD → Variables, all masked
where possible): `ANDROID_KEYSTORE_B64` (the base64 you just copied),
`ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS` (`kegwall`), `ANDROID_KEY_PASS`. From the
next build on, the job produces a release-signed APK with a stable signature. Keep the
keystore file safe — losing it means one final uninstall/reinstall cycle with a new
key.

## Notes

- The app allows plain-HTTP on purpose (`usesCleartextTraffic`) — Kegwall is a
  LAN-first, no-TLS-by-design server (see [docker.md](docker.md#reverse-proxy-and-https)).
- Nothing app-specific is native: it's the same web tablet page, so features arrive
  with normal server updates — the APK only needs updating if the shell itself changes.

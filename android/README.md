# Kegwall tablet kiosk (Android)

A deliberately tiny WebView wrapper that turns any Android tablet into a dedicated
Kegwall kiosk — point it at your wall's `/tablet/<slug>` page (or a `/wall/<slug>`
page for a TV stick) and it runs fullscreen, keeps the screen awake, and quietly
retries when the server is unreachable. Zero library dependencies: one Activity,
framework WebView, ~200 lines of Kotlin.

- **First launch**: type the URL (e.g. `http://192.168.1.50:8080/tablet/main`).
- **Change it later**: tap the top-left corner 5 times within 3 seconds.
- **Build**: CI does it (`android-apk` job in the Publish workflow — every release, or run
  it manually from the Actions tab on any branch) and attaches `kegwall-tablet.apk` to the
  GitHub Release (branch builds: a workflow artifact). Building locally
  needs only a standard Android SDK: `cd android && gradle assembleDebug`.

Install/sideload instructions and the optional stable-signing setup live in
[docs/install/android-tablet.md](../docs/install/android-tablet.md).

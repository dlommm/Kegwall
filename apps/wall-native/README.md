# Kegwall native wall client (`apps/wall-native`) — SHELVED

> **Shelved (2026-08-02).** The supported native display path is now **cog / WPE WebKit**
> (`scripts/native-wall-setup.sh`, `pi-install.sh --native-wall`), which renders the existing web
> wall in a lightweight engine — see [`docs/install/native-wall.md`](../../docs/install/native-wall.md).
> This Flutter scaffold duplicated the whole wall UI in Dart for no rendering benefit over WPE, so
> it's parked here for reference only and isn't wired to any installer. The `wall-native` CI job
> still compile-checks it.

A native, GPU-accelerated Flutter app that renders the Kegwall tap wall directly on DRM/KMS via
[`flutter-pi`](https://github.com/ardera/flutter-pi) — **no browser, no desktop**. It was intended
to replace the cage + chromium kiosk on both **Raspberry Pi (arm64)** and **amd64 mini PCs**.

Design spec: [`docs/superpowers/specs/2026-08-02-native-wall-client-design.md`](../../docs/superpowers/specs/2026-08-02-native-wall-client-design.md).

## What it does

Reads the same public API the browser wall uses — `GET /api/public/wall/:slug` for config + taps,
`/ws` for live tap snapshots — presenting the per-display token (header on REST, `?token=` on the
WebSocket). It renders the wall's configured look, themed from the wall's theme tokens, scaled by
the per-wall `display.uiScale`. Owner cost is never in the public payload, so the client never
sees it.

## Status — milestone 1 (foundation)

Shipped: project scaffold, config/token loader, JSON models, the REST + WS data layer
(reconnecting, device-scoped), the theme system (token port + per-wall UI scale), and the
**classic** look. The `WallLook` dispatcher falls back to classic for looks not yet ported.

Remaining milestones (each compiles green in CI before the next):
2. Ledger / Gallery / Columns looks.
3. The 7 style looks (chalkboard, editorial, neon, terminal, poster, departures, zen).
4. Pour takeovers (full/split/dock/fill/spotlight).
5. Page rotation + leaderboard/game rotation views + screensaver.
6. Installer (`pi-install.sh --kiosk --native-wall`) + `kegwall-wall.service` + docs.

## Build / run

Requires the Flutter SDK (≥ 3.22). CI (`wall-native` job) is the source of truth for
compilation — it runs `flutter analyze`, `flutter test`, and `flutter build bundle`.

```bash
cd apps/wall-native
flutter pub get
flutter analyze
flutter test
# On a flutter-pi device, run the built bundle full-screen on tty1:
#   flutter-pi --release /opt/kegwall-wall/
```

Config is read (in order) from `--dart-define`s, then `/etc/kegwall-wall/config.json`
(`{ "baseUrl", "wallSlug", "displayToken" }`), then defaults (`http://localhost:8080`, `main`).

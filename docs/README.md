# Kegwall documentation

The source-of-truth docs for Kegwall. The
[GitLab Wiki](https://github.com/dlommm/Kegwall/wiki) mirrors this material for
browsing; [CHANGELOG.md](../CHANGELOG.md) describes every released version;
[CONTRIBUTING.md](../CONTRIBUTING.md) has the workflow (including the rule that docs, changelog,
and wiki are updated with every change).

## Install & run the server

| Guide | For |
| --- | --- |
| [install/docker.md](install/docker.md) | Docker / NAS (Unraid), env vars, networking, reverse proxy + HTTPS, backups |
| [install/raspberry-pi.md](install/raspberry-pi.md) | Raspberry Pi 4/5 — Docker or native (bare-metal), direct-BLE, kiosk display |
| [install/mini-pc.md](install/mini-pc.md) | amd64 mini PC / Intel NUC — native install on Debian 13 (no Docker) |
| [install/unattended-debian.md](install/unattended-debian.md) | Turnkey **installer ISO** (amd64) — flash a USB, boot, SSH in; unattended Debian + Kegwall, versioned in the package registry |

## Display the wall on a screen

| Guide | For |
| --- | --- |
| [install/native-wall.md](install/native-wall.md) | **Native** flutter-pi wall client vs the **chromium** kiosk, and how to tell which mode a screen runs (`/etc/kegwall/display-mode`, `GET /api/system/urls`) |
| [install/android-tablet.md](install/android-tablet.md) | Android kiosk APK for the kegerator pourer tablet (CI-built, sideloaded) |
| [install/display-agent.md](install/display-agent.md) | Zero-dependency agent for real screen power-off (DPMS/backlight) driven by presence |

## Devices & integrations

| Guide | For |
| --- | --- |
| [setup/kegtron-cloud.md](setup/kegtron-cloud.md) | Kegtron Pro API key + optional UDP streaming |
| [install/esp32-gen1.md](install/esp32-gen1.md) | Kegtron Gen 1 (KT-100/KT-200) via an ESP32 BLE-to-MQTT bridge |
| [setup/home-assistant.md](setup/home-assistant.md) | MQTT discovery, published entities, event topics |
| [setup/motion-sensors.md](setup/motion-sensors.md) | Motion sensor hardware — mmWave, PIR/GPIO, BLE, Zigbee, HA webhook |
| [setup/face-sign-in.md](setup/face-sign-in.md) | On-device face matching for tablet sign-in + privacy model |

## Operate & customize

| Guide | For |
| --- | --- |
| [customization.md](customization.md) | Wall layout, themes, custom-CSS trust model, screensaver, pairing screens by code |
| [suppliers.md](suppliers.md) | Supplier directory, weekly opening hours, derived price book, who sees keg costs |
| [recovery.md](recovery.md) | Backup, restore, and manual crash-loop recovery |
| [cleaning-and-pours.md](cleaning-and-pours.md) | Line-cleaning reminders, unclaimed pours, and claim windows |
| [admin-dashboard.md](admin-dashboard.md) | Dashboard summaries and mobile admin navigation |

## Reference

- [kegtron/](kegtron/) — vendor Kegtron API/BLE reference (Intro, WebSocket notifications, the
  reverse-engineered Pro BLE advertisement format, the OpenAPI spec, and vendor PDFs).
- [superpowers/specs/](superpowers/specs/) — design specs, one per feature/sub-project.
- [superpowers/plans/](superpowers/plans/) — the implementation roadmap and per-phase plans.

# Kegwall documentation

The source-of-truth docs for Kegwall. The
[GitHub Wiki](https://github.com/dlommm/Kegwall/wiki) mirrors this material for
browsing; [CHANGELOG.md](../CHANGELOG.md) describes every released version;
[CONTRIBUTING.md](../CONTRIBUTING.md) has the workflow (including the rule that docs, changelog,
and wiki are updated with every change).

## Install & run the server

| Guide | For |
| --- | --- |
| [install/docker.md](install/docker.md) | Docker / NAS (Unraid), env vars, networking, reverse proxy + HTTPS, backups |
| [install/raspberry-pi.md](install/raspberry-pi.md) | Raspberry Pi 4/5 — Docker or native (bare-metal), direct-BLE, kiosk display |
| [install/mini-pc.md](install/mini-pc.md) | amd64 mini PC / Intel NUC — native install on Debian 13 (no Docker) |
| [install/unattended-debian.md](install/unattended-debian.md) | Turnkey **installer ISO** (amd64) — flash a USB, boot, SSH in; unattended Debian + Kegwall, attached to every GitHub Release |
| [install/moving-to-github.md](install/moving-to-github.md) | One-time switch of a pre-GitHub install to the GitHub image, remote, and release feed |

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
| [admin-dashboard.md](admin-dashboard.md) | Tonight (what needs doing, taps, pours by hour, hardware), the admin top bar, Search and phone navigation |

## Design proposals

| Doc | For |
| --- | --- |
| [design/kegwall-v2/UI_REDESIGN_BLUEPRINT.md](design/kegwall-v2/UI_REDESIGN_BLUEPRINT.md) | **Approved, in progress.** Kegwall V2 redesign: baseline audit, concepts, screen specs, roadmap |
| [design/kegwall-v2/ADR-0001-frontend-architecture.md](design/kegwall-v2/ADR-0001-frontend-architecture.md) | Accepted frontend architecture decision for V2 |
| [design/kegwall-v2/IMPLEMENTATION_PLAN.md](design/kegwall-v2/IMPLEMENTATION_PLAN.md) | **Approved, in progress.** V2 milestones, decisions, verification and release plan |

## Reference

- [kegtron/pro-ble-format.md](kegtron/pro-ble-format.md) — the reverse-engineered Kegtron Pro BLE
  advertisement format. Kegtron's own API, WebSocket, and UDP streaming docs come from Kegtron and
  aren't redistributed here.

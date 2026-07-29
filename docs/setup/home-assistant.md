# Set up Home Assistant integration

Kegwall can publish live tap state to Home Assistant over MQTT, using HA's
[MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#discovery-messages)
format — entities appear automatically, no HA YAML required. This is a one-way publisher
(`src/server/ingest/haPublisher.ts`) — it doesn't read anything back from HA.

## Prerequisites

- An MQTT broker both Home Assistant and this app can reach (e.g. Mosquitto — often
  already running if you use HA's own MQTT integration).
- Home Assistant's MQTT integration already configured against that same broker.

## Configure the broker connection

**Settings -> Sources**:

- **MQTT broker URL** — `mqtt://host:1883` (or `mqtts://host:8883` for TLS).
- **MQTT username** / password, if your broker requires auth.

This is the same broker connection Gen 1 MQTT ingest uses (see
[docs/install/esp32-gen1.md](../install/esp32-gen1.md)) — one MQTT client config, multiple
uses. You only need this step if you haven't already configured MQTT for Gen 1 devices.

## Turn on Home Assistant publishing

**Settings -> Integrations**:

- **"Publish tap states to Home Assistant over MQTT"** — the toggle that actually starts
  the publisher. It refuses to save unless an MQTT broker URL is already configured under
  Sources.
- **Home Assistant discovery prefix** — default `homeassistant`, matching HA's own default
  MQTT discovery prefix. Only change this if you've customized HA's own
  `discovery_prefix`.

Once enabled, entities should appear in Home Assistant within a few seconds (Settings ->
Devices & Services -> MQTT should show new devices for each tap and any Kegtron Pro
monitor bound to a tap).

## What gets published

**Per tap** (device name "Tap N"):

| Entity | Type | Notes |
|---|---|---|
| Level | sensor, `%` | |
| Remaining | sensor, liters, `device_class: volume` | |
| Beer | sensor (name) | carries `style`/`abv`/`brewery` as JSON attributes |
| Last pour | sensor, mL, `device_class: volume` | |
| Pouring | binary_sensor | ON while a pour is in progress |

**Per Kegtron Pro monitor bound to a tap** (device name "Kegtron Pro {identifier}") —
unbound monitors are skipped, they have no tap to attach the device card to:

| Entity | Type | Notes |
|---|---|---|
| Temperature | sensor, °C | |
| Humidity | sensor, `%` | |

State updates are debounced to at most once per second (coalescing, not a resetting
timer — a steady stream of pour-progress events still gets published at least every
second, it doesn't get postponed indefinitely). Availability is tracked via MQTT's
Last Will and Testament, so entities correctly go "unavailable" in HA if this app crashes
or loses its connection to the broker, not just on a clean shutdown.

## Event topics for automations

Two additional topics carry point-in-time events for use in HA automations (MQTT
triggers) — these are deliberately **not retained**, since a client subscribing later
should not replay a stale event:

- **`{appTopicPrefix}/event/pour`** — JSON: `{tap, beer, volumeMl, ts}`, published whenever
  a pour completes on any tap.
- **`{appTopicPrefix}/event/alert`** — JSON: `{rule, severity, title, body, tap, beer,
  tapId, ts}`, published whenever one of this app's own automation/alert rules fires
  (`tap`/`beer` may be `null` for rules with no tap context, e.g. a startup or scheduled
  rule — `tapId` is included alongside them for the same reason).

`appTopicPrefix` defaults to `kegwall` and is shared with the state topics above
(`{appTopicPrefix}/tap/{tapId}/state`, `{appTopicPrefix}/monitor/{monitorId}/state`,
`{appTopicPrefix}/availability`) — there's no separate setting for it in the current admin
UI; it uses the built-in default unless you've edited raw settings.

Example HA automation trigger:

```yaml
trigger:
  - platform: mqtt
    topic: "kegwall/event/pour"
```

## Known limitation: stale discovery entities after an offline deletion

If you delete a tap or unbind a Kegtron Pro monitor while this app isn't running, its old
discovery config stays retained on the broker (HA keeps showing a frozen, orphaned device)
until the app restarts **and** something else changes the discovery signature again from
there. While the app is running continuously, deletions are cleaned up immediately (an
empty retained payload is published to the stale topic, HA's own documented removal
mechanism). This is a known, accepted gap — there's no cheap way to reconcile against a
broker's full retained-topic set on startup with a standard MQTT client. If you hit this,
manually clear the stale topic from your broker (e.g. `mosquitto_pub -t
'<prefix>/<component>/<node>/<object>/config' -r -n`) or wait for the app to notice on its
own next relevant change.

## See also

- [docs/install/esp32-gen1.md](../install/esp32-gen1.md) — sharing the same MQTT broker
  connection for Gen 1 ingest.
- [docs/setup/kegtron-cloud.md](kegtron-cloud.md) — Kegtron Pro cloud + UDP setup.

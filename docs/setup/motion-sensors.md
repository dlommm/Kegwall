# Motion sensor hardware

The **Displays & Presence** hub (`/admin/presence`) wakes walls from a screensaver or
soft-off state on activity — a tap or pour, a touch on the tablet, and (if you wire one
up) an external motion sensor. This page covers the sensor hardware options: what to
buy, how to wire or pair it, and the matching Kegwall configuration for each.

If you'd rather not buy anything, the kegerator tablet's own front camera can serve as a
motion source with zero extra hardware — see
[docs/customization.md#display-power](../customization.md#display-power) for the
"Camera motion wake" toggle. Camera rows appear in the same Motion sources table as the
hardware sources below, but aren't covered further here.

## Buying guide

| Sensor | Best for | Connects via | Kegwall source type |
|---|---|---|---|
| mmWave (LD2410 on an ESP32, via ESPHome) | Seated stillness — keeps waking the wall while someone's sitting still nearby, unlike PIR | WiFi + MQTT | `mqtt` (JSON match) |
| PIR (HC-SR501 or AM312) | Cheapest, simplest walk-by detection | 3-wire GPIO, direct to the machine running Kegwall | `gpio` |
| Shelly BLU Motion | No wiring, battery powered, works with any BLE-capable host | BLE broadcast (BTHome), read directly | `ble` |
| Zigbee motion sensor, via zigbee2mqtt | Reusing an existing Zigbee mesh/coordinator | Zigbee → zigbee2mqtt → MQTT | `mqtt` (JSON match) |
| A sensor already wired into Home Assistant | You already have HA automating on motion | HA calls a webhook | `webhook` |

Every configured source — whichever type — shows up as a row in **Displays & Presence →
Motion sources**, with a health dot (● OK / ● Down) and a "last motion" timestamp, plus a
live blink when it fires. Add one with the **Add source** button; delete goes through a
confirm dialog and immediately stops whatever was watching it (the MQTT subscription, the
`gpiomon` process, or the BLE match).

## mmWave: LD2410 on an ESP32 (ESPHome)

A PIR sensor only reports *movement* — someone sitting still at the wall for a few
minutes reads as "no activity" and the display can screensaver or go off out from under
them. An mmWave radar module like the Chinese HLK-LD2410(B/C) reports *presence*
(moving **and** still targets), so binding it to `has_target` rather than only
"moving" avoids that false idle-out. It needs an ESP32 (or similar) to talk to over UART
and publish to MQTT — ESPHome is the easiest way to do that without writing firmware.

Minimal ESPHome config (adjust the UART pins, WiFi, and broker for your board):

```yaml
esphome:
  name: kegwall-mmwave

esp32:
  board: esp32dev

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

mqtt:
  broker: 192.168.1.10   # your MQTT broker

uart:
  id: uart_bus
  tx_pin: GPIO18
  rx_pin: GPIO23
  baud_rate: 256000

ld2410:
  uart_id: uart_bus

binary_sensor:
  - platform: ld2410
    has_target:
      name: "Kegwall presence"
      on_state:
        then:
          - mqtt.publish:
              topic: kegwall/mmwave/wall
              payload: !lambda 'return x ? std::string("{\"occupancy\":true}") : std::string("{\"occupancy\":false}");'
```

This publishes a small JSON payload of its own (rather than relying on ESPHome's default
plain `ON`/`OFF` entity state) so the matching Kegwall source can use the same
field-match pattern as the zigbee2mqtt section below:

- **Settings → Sources**: set the **MQTT broker URL** to the same broker (if you haven't
  already for another integration).
- **Displays & Presence → Motion sources → Add source**:
  - **Type**: MQTT
  - **Topic**: `kegwall/mmwave/wall`
  - **Match mode**: JSON field equals
  - **JSON field**: `occupancy`
  - **Equals**: `true` (typed as the bare word `true`, not quoted — it's parsed as a
    real boolean, matching the JSON payload above)

## PIR: HC-SR501 / AM312 on GPIO

The cheap option — a passive infrared sensor wired straight to a GPIO pin, read by
Kegwall's `motion_gpio` transport (`gpiomon` from libgpiod, watching the line for an
edge).

**Wiring** (Raspberry Pi 40-pin header; other boards' headers differ):

| Sensor pin | Connect to | Pi physical pin |
|---|---|---|
| VCC | 5V | Pin 2 |
| GND | Ground | Pin 6 |
| OUT | GPIO4 (BCM) | Pin 7 |

GPIO4 (BCM numbering, physical pin 7) is just a convenient default — any free GPIO line
works, as long as the **Line** field below matches the BCM number you actually wired.

Two notes on the hardware itself:

- **HC-SR501** has two onboard trimmer potentiometers — sensitivity (range, roughly 3–7
  m) and time delay (how long OUT stays high after the last trigger, roughly 5 s–300 s)
  — plus a jumper for single- vs. repeat-trigger mode. Its `OUT` pin swings close to its
  5V supply rail, which is technically above the Pi GPIO's 3.3V-safe input; many
  tutorials run it directly anyway, but a resistor divider or logic-level shifter on
  `OUT` is the safer option if you want one. **AM312** has no trimmers (fixed
  sensitivity, a fixed ~2 s retrigger delay) and can run natively at 3.3V, so it's a
  simpler, GPIO-safe-by-default alternative — check your specific breakout board's
  silkscreen for its pin order, since it isn't standardized the way HC-SR501's is.
- Kegwall's own debounce (a fixed 2000 ms per source, not currently adjustable from the
  modal below) sits on top of whatever the sensor's own retrigger delay does — if `OUT`
  is chattering faster than that, the sensor's own trimmer/delay is generally the better
  place to fix it.

**Kegwall configuration** — **Displays & Presence → Motion sources → Add source**:

- **Type**: GPIO
- **Line**: `4` (or whatever BCM line you wired) — the modal only exposes **Line** and
  **Active low**; the GPIO chip (`gpiochip0`) and the 2000 ms debounce are fixed
  defaults, not editable from the UI.
- **Active low**: leave off for a normal HC-SR501/AM312 (`OUT` goes high on motion). Turn
  it on only if your sensor's output is inverted.

**Docker**: the container needs the chardev mapped in explicitly (`--device
/dev/gpiochip0`, or `devices: [/dev/gpiochip0]` in Compose) — see
[docker.md's GPIO device-mapping section](../install/docker.md#gpio-pir-motion-sensors-device-mapping)
for both compose files. Without it, the Health column reports `motion_gpio` down with a
"gpiomon failed — install libgpiod (v1 or v2) and map /dev/gpiochip0 into the container"
detail (Kegwall tries both libgpiod v1's and v2's `gpiomon` arg syntax before giving up,
so this same detail covers a missing device mapping either way).

**Bare metal**: install libgpiod's userspace tools —

```sh
sudo apt install gpiod
```

— see [raspberry-pi.md's GPIO section](../install/raspberry-pi.md#gpio-pir-motion-sensors)
(the Pi installer script does not automate this step; add it by hand).

## Shelly BLU Motion (BTHome over BLE)

Shelly's BLU Motion is a battery-powered BLE sensor with no wiring — it broadcasts BLE
advertisements in the open BTHome v2 format, which Kegwall's `motion_ble` transport
decodes directly (no gateway, no MQTT bridge needed).

1. **In the Shelly app**, pair the BLU Motion and find its Bluetooth/BTHome settings —
   turn **off** encrypted broadcasts (wording varies by app version; look for "Encrypt
   data" or similar). This step is mandatory, not optional: Kegwall's BTHome decoder has
   no way to store a per-device encryption key yet, so an encrypted advert is silently
   skipped (logged once per MAC to the server log as `skipping encrypted BTHome advert
   from <mac> (no bindkey configured)`) — if you see that in the logs, go back and check
   this setting.
2. **Displays & Presence → Motion sources → Add source**:
   - **Type**: BLE
   - **MAC address**: the sensor's MAC, or leave it blank to match any unencrypted
     BTHome motion advert the host hears (fine for a single sensor; set the MAC if you
     have more than one BTHome device nearby, so they don't cross-trigger each other's
     source rows).

No toggle in **Settings → Sources** needs enabling for this — adding a `ble`-type motion
source is enough on its own to start the shared Bluetooth scanner. The host running
Kegwall does need a working Bluetooth adapter and the same `@abandonware/noble` /
`setcap cap_net_raw+eip` setup Gen 1 direct-BLE uses — see raspberry-pi.md's Bluetooth
setup section if you haven't already configured that for this host.

A sensor's explicit "motion cleared" broadcast is ignored (only an actual motion-detected
reading wakes anything) — there's also no separate debounce for BLE, it relies on the
same ~5 second wake debounce every source type shares.

## Zigbee, via zigbee2mqtt

If you already run a Zigbee coordinator with zigbee2mqtt, any occupancy-capable motion
sensor on it (Aqara/Xiaomi, Sonoff SNZB-03, IKEA Vallhorn, etc.) publishes its state as
JSON to `zigbee2mqtt/<friendly_name>`, including an `occupancy` boolean.

**Displays & Presence → Motion sources → Add source**:

- **Type**: MQTT
- **Topic**: `zigbee2mqtt/<friendly_name>` (your device's actual friendly name)
- **Match mode**: JSON field equals
- **JSON field**: `occupancy`
- **Equals**: `true`

**Don't use "Any non-empty payload" mode here.** zigbee2mqtt sensors also publish
`{"occupancy":false}` when their own no-motion timeout elapses — that's still a
non-empty JSON payload, so the "any" match mode would treat the *clearing* message as
motion too, and a wall would never idle out while the sensor kept periodically
re-reporting "no motion." The JSON field match above (`occupancy` equals `true`) is
specifically what avoids this.

## Home Assistant (webhook)

If your motion sensor is already automating something in Home Assistant, point an HA
automation at Kegwall's motion webhook instead of adding a new transport:

1. **Displays & Presence → Webhook & agent**: click **Generate** if you don't have a
   webhook token yet.
2. **Displays & Presence → Motion sources → Add source**, **Type: Webhook**, give it a
   name, save it. A webhook-type source has no config fields of its own — its identity
   comes from the URL.
3. In the Motion sources table, find that row and expand **Home Assistant snippet** —
   it's a ready-made `rest_command` + `automation` block with your real token and
   per-source URL already filled in, e.g.:

   ```yaml
   rest_command:
     kegwall_motion:
       url: "http://<kegwall-host>:8080/api/presence/motion?token=<your-token>&source=<your-source-id>"
       method: POST

   automation:
     - alias: "Kegwall motion wake"
       trigger:
         - platform: state
           entity_id: binary_sensor.your_motion_sensor
           to: "on"
       action:
         - service: rest_command.kegwall_motion
   ```

Paste that into HA's `configuration.yaml` (or a packages file), restart/reload HA, and
swap `binary_sensor.your_motion_sensor` for your real entity. The `&source=<id>` on the
URL is what attributes each POST back to that specific row's health/last-motion status —
a generic, unattributed webhook URL is also available from the Webhook & agent panel if
you'd rather not create a dedicated source row, but you lose that per-source attribution.

## See also

- [docs/install/raspberry-pi.md](../install/raspberry-pi.md#gpio-pir-motion-sensors) —
  bare-metal `gpiod` install.
- [docs/install/raspberry-pi.md](../install/raspberry-pi.md#bluetooth-fallback-kegtron-gen-1--pro) —
  Bluetooth adapter setup shared with `ble`-type motion sources (Shelly BLU Motion above).
- [docs/install/docker.md](../install/docker.md#gpio-pir-motion-sensors-device-mapping) —
  `/dev/gpiochip0` device mapping for GPIO PIR sensors in a container.
- [docs/install/display-agent.md](../install/display-agent.md) — the flip side of
  presence: actually cutting a display's power once a wall goes to the `off` stage.
- [docs/setup/home-assistant.md](home-assistant.md) — MQTT broker setup shared with the
  mmWave/zigbee2mqtt sources above, plus the `display_power` event topic.
- [docs/customization.md#display-power](../customization.md#display-power) — the
  screensaver/off timing these sources feed into, and the tablet-camera alternative.

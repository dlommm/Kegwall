# Gen 1 devices (KT-100/KT-200) via an ESP32 MQTT bridge

Kegtron Gen 1 (KT-100, KT-200) devices only speak Bluetooth Low Energy — there's no
WiFi/Ethernet/cloud path on the device itself (unlike Kegtron Pro). To get their readings
into Kegwall you need either:

- **A host running this app within direct Bluetooth range** — the verified path. See
  [docs/install/raspberry-pi.md#direct-ble-setup-gen-1-devices](raspberry-pi.md#direct-ble-setup-gen-1-devices).
  Prefer this if you can.
- **An ESP32 (or similar) running a BLE-to-MQTT bridge**, covered on this page — for
  devices out of direct range of the machine running the app, relayed over your existing
  MQTT broker instead.

## Read this before you start: the payload shape is unverified

`src/server/ingest/gen1/mqttSource.ts` carries a long header comment recording exactly
what was checked (2026-07-28): the task brief for this integration asked for the message
shape to be verified against Theengs Decoder's documented Kegtron device profile. That
verification found **Theengs Decoder has no built-in Kegtron device profile at all** —
neither at `decoder.theengs.io/devices/KEGTRON.html` (404s) nor in the decoder's own
GitHub source tree (123 device files checked, none for KT-100/KT-200/Kegtron).

So the parser in this app does not target a real, confirmed Kegtron MQTT payload. Instead
it targets Theengs' *general* MQTT envelope conventions (verified against real Theengs
device definitions) combined with the Kegtron-specific property names used by the
`kegtron-ble` Home Assistant integration's BLE parser (`volume_start`, `volume_dispensed`,
`keg_size`, in liters). **This is a documented best-effort inference, not a confirmed
real-world payload shape.** It has not been tested against a real ESP32 + OpenMQTTGateway
(or Theengs Gateway) + Kegtron Gen 1 deployment. If your bridge's actual JSON doesn't
match what's below, readings simply won't appear — check your broker's raw messages
(`mosquitto_sub -t 'home/TheengsGateway/#' -v` or similar) against the accepted keys, and
see the last section for what a mismatch usually needs.

## What the app accepts

The source subscribes to `{gen1TopicPrefix}/#` (default `home/TheengsGateway`, matching
Theengs Gateway's own default topic — configurable in **Settings -> Sources -> "Gen 1
topic prefix"**) and inspects every JSON message it receives on that tree. A message is
recognized as a Kegtron reading only if **all** of the following hold (cited directly from
`parseKegtronMqttMessage`/`isKegtronMessage`/`numberField` in
`src/server/ingest/gen1/mqttSource.ts`):

1. **Device identification** — one of:
   - top-level `model_id` equal (case-insensitive) to `kt-100`, `kt-200`, `kt100`, or
     `kt200`, **or**
   - top-level `model` containing the substring `kegtron` (case-insensitive), **or**
   - top-level `brand` containing the substring `kegtron` (case-insensitive).
2. **A valid MAC address**, in `mac` (or `id` as a fallback) — either colon-separated
   (`AA:BB:CC:DD:EE:FF`, any case) or 12 bare hex digits with no separators.
3. **Both volume fields present as numbers** — checked in this exact order, first key that
   exists as a finite number wins:
   - Start volume: `volume_start` (assumed **liters**, converted to mL) → falls back to
     `volStartMl`, `vol_start_ml`, `volStart`, `vol_start` (assumed **already mL**, no
     conversion).
   - Dispensed volume: `volume_dispensed` (liters) → falls back to `volDispensedMl`,
     `vol_dispensed_ml`, `volDispensed`, `vol_disp` (mL).

   If either is missing entirely, the message is silently dropped (not treated as an
   error — the topic tree may carry other devices' messages too).

Optional fields:

- **Keg size**: `keg_size` (liters) → falls back to `sizeMl`, `keg_size_ml`, `kegSizeMl`
  (mL). Null if none present.
- **Port index** (0-based; matters for KT-200's two ports): `port_index` or `portIndex`,
  a non-negative integer. Defaults to `0` if absent — correct for KT-100 (genuinely
  single-port) and a reasonable fallback for KT-200.
- **Model name** for display: `model`, falling back to `model_id`.

Example payload the parser accepts:

```json
{
  "model_id": "KT-200",
  "mac": "AA:BB:CC:DD:EE:FF",
  "volume_start": 18.927,
  "volume_dispensed": 2.365,
  "keg_size": 18.927,
  "port_index": 0
}
```

## Setting it up

1. Flash your ESP32 with [OpenMQTTGateway](https://github.com/1technophile/OpenMQTTGateway)
   (BLE-to-MQTT gateway mode) or [Theengs Gateway](https://github.com/theengs/gateway),
   pointed at your MQTT broker. Follow that project's own flashing/config docs — this repo
   doesn't ship firmware.
2. Configure the bridge's MQTT topic prefix to match what you'll set below (or note its
   default and use that as `gen1TopicPrefix` instead — either direction works, they just
   need to match).
3. In Kegwall's admin UI: **Settings -> Sources**:
   - **MQTT broker URL** — `mqtt://host:1883` (or `mqtts://host:8883` for TLS), the same
     broker your bridge publishes to.
   - **MQTT username** / password — if your broker requires auth.
   - **Gen 1 topic prefix** — must match your bridge's publish topic prefix (default
     `home/TheengsGateway`).
4. Save. Check the admin dashboard's source health panel — it reports `subscribed to
   {prefix}/#` once connected, or a specific error (auth failure, connection refused,
   etc.) if not.

## If it doesn't work: adjusting the accepted keys

Because the payload shape is unverified, the most likely failure mode is a real bridge
publishing field names slightly different from what's listed above (e.g. a decoder that
uses `vol_start` in mL instead of `volume_start` in liters is already covered by the
fallback list — but something entirely different, like a nested object instead of flat
fields, is not). If your bridge's JSON has the right *shape* (flat top-level fields) but
different *names*, the fix is a one-line addition to `numberField()`'s key lists in
`src/server/ingest/gen1/mqttSource.ts` — it isn't a structural rewrite. If you get this
working against real hardware, consider that a valuable fact worth recording back into
this file and that source's header comment for the next person.

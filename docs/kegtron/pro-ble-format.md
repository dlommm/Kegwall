# Kegtron Pro BLE advertisement format (reverse-engineered)

Kegtron publishes a BLE spec for Gen 1 (KT-100/200) only; the Pro series
(KT-220/KT-420) broadcast format is undocumented. This layout was reverse-engineered
2026-07-30 from live ESP32 captures (`esp32/kegtron-pro-capture.yaml`) of a KT-420
running firmware-era 2026 hardware, cross-checked against the values shown in the
Kegtron mobile app and validated with a live pour. Same disclaimer as the Gen 1 MQTT
path: best-effort inference, not vendor documentation.

## Transport

- Standard BLE advertisement + **scan response** (active scanning required, like Gen 1).
- Local name: `Kegtron-XXXXXX` (dash — Gen 1 uses `Kegtron XXXXXX` with a space).
- Manufacturer data under company ID `0x0000`; payload is 27 bytes.
- One advertisement per PORT, all from the device's single MAC; ports rotate
  continuously, each port re-advertised roughly every 1-4s.

## Payload layout (27 bytes, volumes big-endian, mL)

| offset | size | field | notes |
|---|---|---|---|
| 0-1 | 2 | keg size | u16 BE, mL (29337 = 7.75 gal, 19558 = sixtel) |
| 2 | 1 | `0x00` | observed constant (possibly volume high byte — u24?) |
| 3-4 | 2 | volume start | u16 BE, mL |
| 5 | 1 | `0x00` | observed constant (as above) |
| 6-7 | 2 | volume dispensed | u16 BE, mL, cumulative |
| 8 | 1 | port byte | high nibble = `0xC + portIndex` (C1/D1/E1/F1 = ports 0-3); low nibble observed `0x1` (likely "port enabled") |
| 9-26 | 18 | port name | ASCII, zero-padded, **truncated at 18** ("Sapporo Premium Be") |

Worked example (port 2): `4c66 00 4c66 00 6d11 e1 42656c6769616e...`
→ size 19558, start 19558, dispensed 27921, port 2, "Belgian White".

## Update semantics (pour-validated)

- `volume dispensed` updates **once, at pour end** (~1-3s after flow stops) — a
  250mL pour appeared as a single 591→841 jump with no intermediate values. There is
  NO live pour progress over BLE; pour detection must synthesize completed pours from
  cumulative-counter jumps (the Gen 1 `pourSynth` model), and the live 200ms takeover
  remains UDP-only.
- `volume dispensed` can exceed `volume start` (observed 27921 > 19558) — the
  counter isn't automatically reset on keg swap; treat it as a raw odometer.

## Open questions

- Bytes 2 and 5: always `0x00` in captures; could be high bytes making the volumes
  u24 BE (indistinguishable below 65,535 mL — no Kegtron keg size exceeds that).
- Port byte low nibble: only `0x1` observed (all ports enabled/active on the test
  device); disabled-port encoding unknown.
- Whether temperature rides a different advertisement variant (not yet observed —
  cloud/UDP carry it; no temp-like field found in this payload).

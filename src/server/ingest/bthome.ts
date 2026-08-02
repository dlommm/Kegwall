// ---------------------------------------------------------------------------
// Displays & Presence hub Task 7: a pure decoder for BTHome v2's service-data payload
// (https://bthome.io/format/) -- the open, unencrypted-by-default advertisement format
// used by the ESPHome/Zigbee2MQTT/Home Assistant ecosystem's cheap BLE motion sensors
// (e.g. an ESPHome-flashed BLE beacon or a Xiaomi/Aqara sensor running a BTHome
// firmware). Deliberately mirrors gen1/bleSource.ts's `decodeKegtronAdvert` shape (a
// pure `Buffer -> reading | null` function, no I/O, no class) -- `bleMotion.ts` is the
// `Source` that owns the scanner subscription and calls this.
//
// Byte layout (BTHome v2 service data, GATT service UUID 0xFCD2):
//   byte 0: device info bit field. Bit 0 (0x01) = encryption flag -- when set, every
//     byte AFTER this one is ciphertext this decoder cannot read (BTHome encryption
//     needs a per-device bindkey this app has no way to configure/store yet), so
//     parsing stops immediately and `{encrypted: true, motion: null}` is returned.
//   bytes 1..N (unencrypted only): a sequence of type-value objects, each starting
//     with a 1-byte object id whose VALUE LENGTH is fixed by the BTHome spec per id --
//     there is no length field in the wire format itself, so a decoder must already
//     know every id's length to walk past it. This decoder only knows the handful of
//     ids relevant to a motion sensor (below); an id it doesn't recognize means every
//     byte after it is unwalkable (its length is unknowable), so parsing stops there
//     and whatever was already found (motion included) is returned as-is -- silently
//     dropping the rest of a valid-but-richer advert rather than misparsing it as
//     something else.
// ---------------------------------------------------------------------------

/** GATT service UUID BTHome v2 adverts carry their service data under, in the SHORT
 * (16-bit) form. noble reports a peripheral's `advertisement.serviceData[].uuid` in
 * whichever form the device advertised -- see `bleMotion.ts`'s `normalizeUuid` for the
 * long-form (`0000fcd2-0000-1000-8000-00805f9b34fb`) equivalence. */
export const BTHOME_SERVICE_UUID = 'fcd2';

export interface BthomeReading {
  encrypted: boolean;
  /** `true`/`false` from a decoded 0x21 (motion) object; `null` when the advert never
   * carried one (either because this sensor doesn't report motion in every advert, or
   * an unknown object id upstream of it truncated the walk). */
  motion: boolean | null;
}

/** Fixed value length (bytes), per BTHome v2 object id, for every id this decoder
 * understands. Object ids not listed here are NOT "assumed variable-length" or
 * skipped by guesswork -- their length is genuinely unknowable without the spec's full
 * id table, so encountering one stops the walk (see the header comment). */
const KNOWN_OBJECT_LENGTHS: Record<number, number> = {
  0x00: 1, // packet id (rolling counter, used for de-dupe by other BTHome consumers)
  0x01: 1, // battery, percent
  0x05: 3, // illuminance, uint24 LE, 0.01 lux/unit
  0x21: 1, // motion, 0x00 = clear, 0x01 = detected
};

const MOTION_OBJECT_ID = 0x21;
const ENCRYPTION_BIT = 0x01;

/**
 * Decodes a BTHome v2 service-data `Buffer` (noble's raw `serviceData[].data`, WITHOUT
 * the uuid -- just the payload noble hands back for that entry) into a `BthomeReading`.
 * Never throws -- an empty buffer, an encrypted advert, or an advert that never
 * mentions motion all produce a defined (non-throwing) result; only a completely empty
 * buffer (no device-info byte at all) returns `null` outright, since there is nothing
 * to decode at all in that case.
 */
export function parseBthomeServiceData(data: Buffer): BthomeReading | null {
  if (data.length < 1) return null;

  const deviceInfo = data[0]!;
  if ((deviceInfo & ENCRYPTION_BIT) === ENCRYPTION_BIT) {
    return { encrypted: true, motion: null };
  }

  let motion: boolean | null = null;
  let offset = 1;
  while (offset < data.length) {
    const objectId = data[offset]!;
    const length = KNOWN_OBJECT_LENGTHS[objectId];
    // Unknown id (or a known id whose value is truncated by a short buffer) -- the
    // rest of the payload is unwalkable; stop and report what's already been found.
    if (length === undefined || offset + 1 + length > data.length) break;
    offset += 1;
    if (objectId === MOTION_OBJECT_ID) motion = data[offset] === 0x01;
    offset += length;
  }

  return { encrypted: false, motion };
}

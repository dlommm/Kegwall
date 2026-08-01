-- UDP receipt timeline (per-minute packet counts per device serial) — the evidence
-- trail for diagnosing intermittent Kegtron UDP (IGMP snooping ageing, AP multicast
-- quirks, device-side toggles). One row per (minute, serial); ~1.4k rows/day/device,
-- pruned at 14 days. Raw payloads are deliberately NOT persisted (~350MB/day of SD
-- wear) — the doctor keeps a small in-memory ring of recent raw datagrams instead.
CREATE TABLE udp_activity (
  minute TEXT NOT NULL,   -- ISO minute bucket, e.g. 2026-07-31T14:32
  serial TEXT NOT NULL,   -- device serialNum, or 'malformed' for unparseable packets
  packets INTEGER NOT NULL,
  PRIMARY KEY (minute, serial)
);

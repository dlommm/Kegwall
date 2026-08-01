import type Database from 'better-sqlite3';

/** Adds `count` packets to a (minute, serial) bucket — app.ts's flusher calls this
 * once a minute per active device, NOT once per packet (4 writes/sec would grind an
 * SD card for no benefit). */
export function bumpUdpActivity(
  db: Database.Database, minute: string, serial: string, count: number,
): void {
  db.prepare(
    `INSERT INTO udp_activity (minute, serial, packets) VALUES (?, ?, ?)
     ON CONFLICT(minute, serial) DO UPDATE SET packets = packets + excluded.packets`,
  ).run(minute, serial, count);
}

export interface UdpActivityRow { minute: string; serial: string; packets: number }

export function listUdpActivity(db: Database.Database, sinceMinute: string): UdpActivityRow[] {
  return db.prepare(
    'SELECT minute, serial, packets FROM udp_activity WHERE minute >= ? ORDER BY minute',
  ).all(sinceMinute) as UdpActivityRow[];
}

export interface UdpDeviceHistory {
  serial: string;
  totalPackets: number;
  firstSeen: string;
  lastSeen: string;
  /** Minutes with at least one packet ÷ minutes between firstSeen and the window
   * end — 100 means an unbroken stream, anything under ~95 means gaps. */
  coveragePct: number;
  /** The largest silent stretches inside [firstSeen, window end], worst first —
   * the smoking gun for "it works, then dies after N quiet minutes" patterns. */
  gaps: { from: string; to: string; minutes: number }[];
}

/** Summarizes the receipt timeline per device over a window ending at `endMinute`
 * (exclusive). Pure computation over the minute buckets — unit-testable without
 * clocks. */
export function summarizeUdpActivity(
  rows: UdpActivityRow[], endMinute: string, maxGaps = 5,
): UdpDeviceHistory[] {
  const bySerial = new Map<string, UdpActivityRow[]>();
  for (const r of rows) {
    const list = bySerial.get(r.serial) ?? [];
    list.push(r);
    bySerial.set(r.serial, list);
  }
  const minuteMs = 60_000;
  const out: UdpDeviceHistory[] = [];
  for (const [serial, list] of bySerial) {
    const firstSeen = list[0]!.minute;
    const lastSeen = list[list.length - 1]!.minute;
    const totalPackets = list.reduce((s, r) => s + r.packets, 0);
    const spanMinutes = Math.max(1, Math.round(
      (new Date(`${endMinute}:00Z`).getTime() - new Date(`${firstSeen}:00Z`).getTime()) / minuteMs,
    ));
    const coveragePct = Math.min(100, Math.round((list.length / spanMinutes) * 100));
    const gaps: UdpDeviceHistory['gaps'] = [];
    for (let i = 1; i < list.length; i++) {
      const prev = new Date(`${list[i - 1]!.minute}:00Z`).getTime();
      const cur = new Date(`${list[i]!.minute}:00Z`).getTime();
      const gapMinutes = Math.round((cur - prev) / minuteMs) - 1;
      if (gapMinutes >= 2) gaps.push({ from: list[i - 1]!.minute, to: list[i]!.minute, minutes: gapMinutes });
    }
    // The stretch from the last packet to NOW is a gap too — the one that matters
    // most when the stream just died.
    const tailGap = Math.round(
      (new Date(`${endMinute}:00Z`).getTime() - new Date(`${lastSeen}:00Z`).getTime()) / minuteMs,
    ) - 1;
    if (tailGap >= 2) gaps.push({ from: lastSeen, to: endMinute, minutes: tailGap });
    gaps.sort((a, b) => b.minutes - a.minutes);
    out.push({
      serial, totalPackets, firstSeen, lastSeen, coveragePct, gaps: gaps.slice(0, maxGaps),
    });
  }
  return out.sort((a, b) => a.serial.localeCompare(b.serial));
}

export function pruneUdpActivity(db: Database.Database, olderThanDays = 14): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString().slice(0, 16);
  return db.prepare('DELETE FROM udp_activity WHERE minute < ?').run(cutoff).changes;
}

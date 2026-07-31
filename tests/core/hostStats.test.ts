import { describe, it, expect } from 'vitest';
import {
  parseMeminfo, parsePmicAdc, parseThrottled, readCpu, readDisk, readHostStats, readMemory,
} from '../../src/server/core/hostStats.js';

// Trimmed from a real Pi's /proc/meminfo — order and spacing preserved.
const MEMINFO_SAMPLE = `MemTotal:        8244640 kB
MemFree:         6122072 kB
MemAvailable:    7689260 kB
Buffers:          104484 kB
Cached:          1481200 kB
SwapCached:            0 kB
`;

// Trimmed from a real Pi 5's `vcgencmd pmic_read_adc` output.
const PMIC_SAMPLE = ` 3V7_WL_SW_A current(0)=0.00976563A
 3V3_SYS_A current(1)=0.03613281A
 VDD_CORE_A current(15)=2.31933593A
 3V7_WL_SW_V volt(16)=3.69140625V
 3V3_SYS_V volt(17)=3.30468750V
 VDD_CORE_V volt(31)=0.72265625V
 EXT5V_V volt(24)=5.13281250V
 BATT_V volt(25)=0.00976563V
`;

describe('parseMeminfo', () => {
  it('extracts MemTotal and MemAvailable in bytes', () => {
    expect(parseMeminfo(MEMINFO_SAMPLE)).toEqual({
      totalBytes: 8244640 * 1024,
      availableBytes: 7689260 * 1024,
    });
  });

  it('returns null when either field is missing', () => {
    expect(parseMeminfo('MemTotal:  100 kB\n')).toBeNull();
    expect(parseMeminfo('')).toBeNull();
    expect(parseMeminfo('garbage')).toBeNull();
  });
});

describe('parseThrottled', () => {
  it('decodes 0x50005 into now + since-boot flags', () => {
    // 0x50005 = bits 0, 2, 16, 18 — the classic "undervolted and throttled, both
    // right now and earlier since boot" pattern from Pi documentation.
    expect(parseThrottled('throttled=0x50005')).toEqual({
      undervoltedNow: true,
      freqCappedNow: false,
      throttledNow: true,
      undervoltedSinceBoot: true,
      freqCappedSinceBoot: false,
      throttledSinceBoot: true,
    });
  });

  it('decodes 0x0 as all-clear', () => {
    const flags = parseThrottled('throttled=0x0')!;
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it('decodes the freq-cap bits (0x20002)', () => {
    const flags = parseThrottled('throttled=0x20002')!;
    expect(flags.freqCappedNow).toBe(true);
    expect(flags.freqCappedSinceBoot).toBe(true);
    expect(flags.undervoltedNow).toBe(false);
    expect(flags.throttledNow).toBe(false);
  });

  it('returns null on garbage', () => {
    expect(parseThrottled('')).toBeNull();
    expect(parseThrottled('error: not supported')).toBeNull();
  });
});

describe('parsePmicAdc', () => {
  it('sums volts×amps per rail, ignoring unpaired rails', () => {
    // Paired rails: 3V7_WL_SW, 3V3_SYS, VDD_CORE. EXT5V/BATT have volt lines only.
    const expected = 3.69140625 * 0.00976563
      + 3.30468750 * 0.03613281
      + 0.72265625 * 2.31933593;
    expect(parsePmicAdc(PMIC_SAMPLE)).toBeCloseTo(Math.round(expected * 100) / 100, 2);
  });

  it('returns null when no rail has both readings', () => {
    expect(parsePmicAdc('')).toBeNull();
    expect(parsePmicAdc(' EXT5V_V volt(24)=5.13V\n')).toBeNull();
    expect(parsePmicAdc('error: no PMIC')).toBeNull();
  });
});

describe('impure readers (portable behavior only)', () => {
  it('readCpu reports cores and a finite percentage', () => {
    const cpu = readCpu();
    expect(cpu.cores).toBeGreaterThan(0);
    expect(Number.isFinite(cpu.loadPct)).toBe(true);
  });

  it('readMemory always produces totals and a 0-100 usedPct', async () => {
    const mem = await readMemory();
    expect(mem.totalBytes).toBeGreaterThan(0);
    expect(mem.usedPct).toBeGreaterThanOrEqual(0);
    expect(mem.usedPct).toBeLessThanOrEqual(100);
  });

  it('readDisk reports the volume holding an existing dir, null for a bogus one', async () => {
    const disk = await readDisk('.');
    expect(disk).not.toBeNull();
    expect(disk!.totalBytes).toBeGreaterThan(0);
    expect(await readDisk('/definitely/not/a/real/path')).toBeNull();
  });

  it('readHostStats aggregates without throwing on a non-Pi host', async () => {
    const stats = await readHostStats('.');
    expect(stats.uptimeSec).toBeGreaterThan(0);
    expect(stats.cpu.cores).toBeGreaterThan(0);
    // On macOS/CI: no vcgencmd → throttle and watts must be null, never an error.
    if (process.platform !== 'linux') {
      expect(stats.throttle).toBeNull();
      expect(stats.watts).toBeNull();
    }
  });
});

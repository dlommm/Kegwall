import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';

/**
 * Host health readers for GET /api/system/stats — CPU load, memory, disk, and the
 * Raspberry-Pi-specific extras (SoC temperature, vcgencmd throttle flags, PMIC watts).
 *
 * Zero dependencies by design: everything comes from node builtins, /proc, /sys, or a
 * best-effort `vcgencmd` exec. Every reader degrades to null when its source is absent
 * (Docker, macOS dev, non-Pi Linux) — the stats endpoint must NEVER 500 because the
 * host isn't a Pi. Pure parsers are exported separately from the impure wrappers so
 * tests exercise real captured samples without mocking the filesystem.
 */

const execFileP = promisify(execFile);

export interface ThrottleFlags {
  undervoltedNow: boolean;
  freqCappedNow: boolean;
  throttledNow: boolean;
  undervoltedSinceBoot: boolean;
  freqCappedSinceBoot: boolean;
  throttledSinceBoot: boolean;
}

export interface HostStats {
  cpu: { loadPct: number; cores: number };
  memory: { totalBytes: number; availableBytes: number; usedPct: number };
  disk: { totalBytes: number; availableBytes: number; usedPct: number } | null;
  uptimeSec: number;
  cpuTempC: number | null;
  throttle: ThrottleFlags | null;
  watts: number | null;
}

/** /proc/meminfo — MemAvailable is the kernel's own "actually usable" estimate
 * (page cache aware), far more honest than os.freemem()'s MemFree. */
export function parseMeminfo(text: string): { totalBytes: number; availableBytes: number } | null {
  const total = /^MemTotal:\s+(\d+) kB/m.exec(text);
  const available = /^MemAvailable:\s+(\d+) kB/m.exec(text);
  if (!total || !available) return null;
  return { totalBytes: Number(total[1]) * 1024, availableBytes: Number(available[1]) * 1024 };
}

/** `vcgencmd get_throttled` → `throttled=0x50005`. Bit meanings are firmware-defined:
 * 0/1/2 = undervolted / freq-capped / throttled RIGHT NOW; 16/17/18 = the same
 * conditions latched since boot. The sticky bits are the interesting ones for a wall
 * that's been up for weeks — a brownout at 3am still shows. */
export function parseThrottled(raw: string): ThrottleFlags | null {
  const m = /throttled=0x([0-9a-fA-F]+)/.exec(raw);
  if (!m) return null;
  const bits = parseInt(m[1]!, 16);
  return {
    undervoltedNow: Boolean(bits & (1 << 0)),
    freqCappedNow: Boolean(bits & (1 << 1)),
    throttledNow: Boolean(bits & (1 << 2)),
    undervoltedSinceBoot: Boolean(bits & (1 << 16)),
    freqCappedSinceBoot: Boolean(bits & (1 << 17)),
    throttledSinceBoot: Boolean(bits & (1 << 18)),
  };
}

/** Pi 5 only — `vcgencmd pmic_read_adc` lists per-rail current and voltage lines:
 *
 *     VDD_CORE_A current(15)=4.32168A
 *     VDD_CORE_V volt(31)=0.7302V
 *
 * Total board draw = Σ (rail voltage × rail current) over rails reporting both.
 * Earlier Pis have no PMIC ADC — vcgencmd errors there and the wrapper returns null,
 * which the UI reads as "watts unavailable" (undervoltage flags still work). */
export function parsePmicAdc(text: string): number | null {
  const amps = new Map<string, number>();
  const volts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const a = /^\s*(\S+)_A\s+current\([^)]*\)=([\d.]+)A/.exec(line);
    if (a) { amps.set(a[1]!, Number(a[2])); continue; }
    const v = /^\s*(\S+)_V\s+volt\([^)]*\)=([\d.]+)V/.exec(line);
    if (v) volts.set(v[1]!, Number(v[2]));
  }
  let watts = 0;
  let paired = 0;
  for (const [rail, a] of amps) {
    const v = volts.get(rail);
    if (v === undefined) continue;
    watts += v * a;
    paired += 1;
  }
  if (paired === 0) return null;
  return Math.round(watts * 100) / 100;
}

/** Best-effort vcgencmd exec: ENOENT (not a Pi / not in PATH), non-zero exit, or a
 * hang past 2s all collapse to null — never an exception, never a 500. */
async function vcgencmd(...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileP('vcgencmd', args, { timeout: 2_000 });
    return stdout;
  } catch {
    return null;
  }
}

export function readCpu(): { loadPct: number; cores: number } {
  const cores = os.cpus().length || 1;
  const loadPct = Math.round(((os.loadavg()[0] ?? 0) / cores) * 100);
  return { loadPct, cores };
}

export async function readMemory(): Promise<{ totalBytes: number; availableBytes: number; usedPct: number }> {
  let parsed: { totalBytes: number; availableBytes: number } | null = null;
  try {
    parsed = parseMeminfo(await readFile('/proc/meminfo', 'utf8'));
  } catch {
    // Not Linux — fall through to the os module (coarser, but never absent).
  }
  const totalBytes = parsed?.totalBytes ?? os.totalmem();
  const availableBytes = parsed?.availableBytes ?? os.freemem();
  return {
    totalBytes,
    availableBytes,
    usedPct: totalBytes > 0 ? Math.round(((totalBytes - availableBytes) / totalBytes) * 100) : 0,
  };
}

export async function readDisk(dataDir: string): Promise<HostStats['disk']> {
  try {
    const s = await statfs(dataDir);
    const totalBytes = s.bsize * s.blocks;
    const availableBytes = s.bsize * s.bavail;
    if (totalBytes <= 0) return null;
    return {
      totalBytes,
      availableBytes,
      usedPct: Math.round(((totalBytes - availableBytes) / totalBytes) * 100),
    };
  } catch {
    return null;
  }
}

export async function readCpuTempC(): Promise<number | null> {
  try {
    const raw = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const milli = Number(raw.trim());
    if (!Number.isFinite(milli)) return null;
    return Math.round(milli / 100) / 10;
  } catch {
    return null;
  }
}

export async function readThrottle(): Promise<ThrottleFlags | null> {
  const out = await vcgencmd('get_throttled');
  return out === null ? null : parseThrottled(out);
}

export async function readWatts(): Promise<number | null> {
  const out = await vcgencmd('pmic_read_adc');
  return out === null ? null : parsePmicAdc(out);
}

export async function readHostStats(dataDir: string): Promise<HostStats> {
  const [memory, disk, cpuTempC, throttle, watts] = await Promise.all([
    readMemory(), readDisk(dataDir), readCpuTempC(), readThrottle(), readWatts(),
  ]);
  return {
    cpu: readCpu(),
    memory,
    disk,
    uptimeSec: Math.round(os.uptime()),
    cpuTempC,
    throttle,
    watts,
  };
}

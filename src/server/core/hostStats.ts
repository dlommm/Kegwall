import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, statfs, readdir } from 'node:fs/promises';
import os from 'node:os';

/**
 * Host health readers for GET /api/system/stats — CPU load, memory, disk, uptime, plus the
 * hardware extras: CPU temperature (Pi `thermal_zone0` OR x86 hwmon coretemp/k10temp — so a
 * mini PC / Intel NUC on amd64 reports temp too), and the Raspberry-Pi-only vcgencmd throttle
 * flags + PMIC watts.
 *
 * Zero dependencies by design: everything comes from node builtins, /proc, /sys, or a
 * best-effort `vcgencmd` exec. Every reader degrades to null when its source is absent
 * (Docker, macOS dev, non-Pi Linux, an amd64 mini PC with no vcgencmd) — the stats endpoint
 * must NEVER 500 because the host isn't a Pi. On amd64 the throttle/watts panels simply read
 * "unavailable"; CPU/RAM/disk/temp all still work. Pure parsers are exported separately from
 * the impure wrappers so tests exercise real captured samples without mocking the filesystem.
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

/** hwmon `name` values that report a CPU package/core temperature. `coretemp` (Intel) and
 *  `k10temp`/`zenpower` (AMD) cover x86 mini PCs (Intel NUC etc.); `cpu_thermal` is the SBC
 *  SoC sensor. Used to pick the right hwmon on hosts with no usable `thermal_zone0`. */
export function isCpuHwmonName(name: string): boolean {
  return ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'].includes(name.trim());
}

/** millidegrees C from a hwmon `tempN_input` string → °C (one decimal), or null. */
function parseMilliTemp(raw: string): number | null {
  const milli = Number(raw.trim());
  if (!Number.isFinite(milli) || milli <= 0) return null;
  return Math.round(milli / 100) / 10;
}

/** x86 mini-PC fallback: scan /sys/class/hwmon for a CPU sensor (coretemp/k10temp/…) and
 *  read its package temperature. Best-effort — null on any absence/error. */
async function readHwmonCpuTemp(): Promise<number | null> {
  try {
    const dirs = await readdir('/sys/class/hwmon');
    for (const dir of dirs) {
      const base = `/sys/class/hwmon/${dir}`;
      let name: string;
      try {
        name = (await readFile(`${base}/name`, 'utf8')).trim();
      } catch {
        continue;
      }
      if (!isCpuHwmonName(name)) continue;
      // coretemp's temp1_input is the package temp; k10temp's is Tctl/Tdie — both are the
      // right "CPU temperature" to surface.
      try {
        const temp = parseMilliTemp(await readFile(`${base}/temp1_input`, 'utf8'));
        if (temp != null) return temp;
      } catch {
        // try the next hwmon
      }
    }
  } catch {
    // /sys/class/hwmon absent (non-Linux / container without it) — nothing to read.
  }
  return null;
}

export async function readCpuTempC(): Promise<number | null> {
  // Pi + many SBCs (and some x86 boards) expose the CPU temp here.
  try {
    const temp = parseMilliTemp(await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8'));
    if (temp != null) return temp;
  } catch {
    // fall through to hwmon
  }
  // Intel NUC / AMD mini PC: CPU temp lives under /sys/class/hwmon (coretemp/k10temp).
  return readHwmonCpuTemp();
}

export async function readThrottle(): Promise<ThrottleFlags | null> {
  const out = await vcgencmd('get_throttled');
  return out === null ? null : parseThrottled(out);
}

/**
 * x86 power via RAPL (Running Average Power Limit): `/sys/class/powercap/intel-rapl:N/
 * energy_uj` is a monotonic microjoule counter per CPU package (Intel + modern AMD). Watts =
 * Δenergy / Δtime across two reads, so we cache the last total and compute the average draw
 * since the previous stats poll. This is CPU-PACKAGE power (not whole-system — that needs an
 * external meter), which is the standard software power reading on a mini PC / NUC.
 */
let raplLast: { uj: number; t: number } | null = null;

/** Sum energy_uj across the top-level RAPL package domains (intel-rapl:0, :1, …), or null. */
async function readRaplTotalUj(): Promise<number | null> {
  let dirs: string[];
  try {
    dirs = await readdir('/sys/class/powercap');
  } catch {
    return null;
  }
  // Top-level package domains only ("intel-rapl:0"), not sub-domains ("intel-rapl:0:0").
  const packages = dirs.filter((d) => /^intel-rapl:\d+$/.test(d));
  let total = 0;
  let any = false;
  for (const pkg of packages) {
    try {
      const uj = Number((await readFile(`/sys/class/powercap/${pkg}/energy_uj`, 'utf8')).trim());
      if (Number.isFinite(uj)) { total += uj; any = true; }
    } catch {
      // package not readable — skip it
    }
  }
  return any ? total : null;
}

export async function readWatts(): Promise<number | null> {
  // Pi 5 PMIC first (whole-board draw); then x86 RAPL (CPU-package draw on a mini PC).
  const pmic = await vcgencmd('pmic_read_adc');
  if (pmic !== null) {
    const w = parsePmicAdc(pmic);
    if (w != null) return w;
  }
  const uj = await readRaplTotalUj();
  if (uj == null) return null;
  const now = Date.now();
  const prev = raplLast;
  raplLast = { uj, t: now };
  if (prev == null) return null; // need two samples to compute a rate
  const deltaUj = uj - prev.uj;
  const deltaSec = (now - prev.t) / 1000;
  // A negative delta means the counter wrapped since the last poll — skip this sample
  // (one dropped reading every few hours) rather than mis-scale it.
  if (deltaUj < 0 || deltaSec <= 0) return null;
  const watts = deltaUj / 1e6 / deltaSec;
  return watts > 0 && watts < 2000 ? Math.round(watts * 10) / 10 : null;
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

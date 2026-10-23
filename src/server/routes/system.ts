import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { requireRole } from './auth.js';
import { readHostStats, readThrottle, type ThrottleFlags } from '../core/hostStats.js';
import { listHostStatsBucketed } from '../db/hostStatsRepo.js';

/**
 * System routes: the running version, the update check (against the project's own
 * GitHub Releases feed), and the update trigger. Two update mechanisms exist —
 * chosen by the `updates` settings key (Settings → System):
 *
 *  - `watchtower` (Docker installs): POST to a Watchtower sidecar's HTTP API, which
 *    pulls the new image and recreates THIS container. Watchtower's endpoint is
 *    synchronous — it doesn't answer until the recreate is done, and the recreate
 *    kills this process — so a timed-out request is treated as SUCCESS (Watchtower
 *    accepted the connection and is working) while an immediate failure (refused,
 *    401) is a real error. The target is deliberately a private address
 *    (127.0.0.1:8090 by default); the SSRF guard is NOT applied on purpose — this is
 *    an admin-role-gated call to an admin-configured, private-by-design service.
 *
 *  - `native` (bare-metal Pi installs): write a trigger file into DATA_DIR; the
 *    installer's systemd path unit (see scripts/pi-install.sh) notices it and runs
 *    the privileged updater. The app itself needs zero privileges. The file content
 *    is a version string interpolated near `git checkout` by a root script, so the
 *    zod regex on `version` below is load-bearing, not cosmetic.
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/** Default path the kiosk installers stamp with the active display mode (see native-wall.md). */
export const DISPLAY_MODE_MARKER = '/etc/kegwall/display-mode';

/**
 * The display mode this device boots into, read from the marker the kiosk installers write:
 *   - `chromium` — the cage + chromium browser kiosk (scripts/pi-tablet-setup.sh)
 *   - `native`   — the flutter-pi native wall client (scripts/native-wall-setup.sh)
 *   - `none`     — no on-device display (server-only box, Docker host, or a browser opened by hand)
 * This is the one authoritative "how do I know which mode a screen runs" signal — see
 * docs/install/native-wall.md. Reading a file (not an env var) means a mode switch needs no
 * app restart to be reflected. The path resolves at call time (env override for tests).
 */
export function readDisplayMode(): 'chromium' | 'native' | 'none' {
  try {
    const path = process.env.KEGWALL_DISPLAY_MODE_MARKER || DISPLAY_MODE_MARKER;
    const v = readFileSync(path, 'utf8').trim();
    if (v === 'chromium' || v === 'native') return v;
  } catch { /* no marker → this box has no Kegwall-managed display */ }
  return 'none';
}

/** Numeric per-segment semver compare — string compare would say 0.9.0 > 0.10.0. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export interface SystemRoutesOptions {
  /** Test-only override for the update-check and watchtower-trigger fetch timeouts. */
  updateTimeoutMs?: number;
  /** The HTTP listen port (index.ts's resolved PORT) — feeds GET /api/system/urls. */
  port?: number;
  /** Test-only override for the vcgencmd throttle reader, so the undervoltage
   * warn-once path is exercisable on machines without vcgencmd. */
  readThrottle?: () => Promise<ThrottleFlags | null>;
  /** Test-only override for the file Debian drops when an update needs a reboot, so the
   * stats shape test doesn't depend on the state of the machine running it. */
  rebootRequiredPath?: string;
}

export async function systemRoutes(
  app: FastifyInstance, dataDir: string, opts: SystemRoutesOptions = {},
) {
  const viewer = { preHandler: requireRole('viewer') };
  const admin = { preHandler: requireRole('admin') };

  // Deliberately NOT folded into the public /api/health — the exact running version
  // stays behind auth.
  app.get('/api/system/version', viewer, async () => ({ version: app.ctx.version }));

  app.post('/api/system/update-check', admin, async () => {
    const base = app.ctx.settings.get('updateCheckBaseUrl');
    const web = app.ctx.settings.get('updateCheckWebUrl');
    const path = app.ctx.settings.get('updateCheckProjectPath');
    const current = app.ctx.version;
    try {
      const res = await fetch(`${base}/repos/${path}/releases`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `kegwall/${current}` },
        signal: AbortSignal.timeout(opts.updateTimeoutMs ?? 10_000),
      });
      if (!res.ok) {
        return { ok: false, current, message: `Release feed answered ${res.status} — check the update source settings.` };
      }
      const releases = await res.json() as { tag_name?: string; draft?: boolean }[];
      const release = releases.find((r) => !r.draft && RELEASE_TAG_PATTERN.test(r.tag_name ?? ''));
      if (!release) {
        return { ok: false, current, message: 'No releases found in the feed.' };
      }
      const latest = release.tag_name!.slice(1);
      return {
        ok: true,
        current,
        latest,
        updateAvailable: isNewerVersion(latest, current),
        // Constructed from our own settings, never trusted from the response body.
        notesUrl: `${web}/${path}/releases/tag/v${latest}`,
      };
    } catch {
      return { ok: false, current, message: `Couldn't reach ${base} — check the network and update source settings.` };
    }
  });

  app.post('/api/system/update', admin, async (req, reply) => {
    const body = z.object({
      version: z.string().regex(VERSION_PATTERN).optional(),
    }).parse(req.body ?? {});
    const cfg = app.ctx.settings.get('updates');

    if (!cfg || cfg.mode === 'off') {
      return reply.code(409).send({
        error: 'conflict',
        message: 'Updates are not configured — pick an update mode in Settings → System first.',
      });
    }

    if (cfg.mode === 'watchtower') {
      if (!cfg.watchtowerUrl || !cfg.watchtowerToken) {
        return reply.code(400).send({
          error: 'validation',
          message: 'Watchtower mode needs both the URL and the token — set them in Settings → System.',
        });
      }
      try {
        const res = await fetch(new URL('/v1/update', cfg.watchtowerUrl), {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.watchtowerToken}` },
          signal: AbortSignal.timeout(opts.updateTimeoutMs ?? 3_000),
        });
        if (res.status === 401) {
          return reply.code(502).send({
            error: 'upstream',
            message: 'Watchtower rejected the token — it must match WATCHTOWER_HTTP_API_TOKEN in your compose file.',
          });
        }
        if (!res.ok) {
          return reply.code(502).send({ error: 'upstream', message: `Watchtower answered ${res.status}.` });
        }
        // Fast 2xx: nothing to pull (already up to date) or a very quick recreate.
      } catch (err) {
        // A timeout means Watchtower ACCEPTED the request and is pulling/recreating —
        // it won't answer until it has replaced this very container. Only an
        // immediate connection error is a real failure.
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        if (!timedOut) {
          return reply.code(502).send({
            error: 'upstream',
            message: "Couldn't reach Watchtower — is the sidecar running and the URL right?",
          });
        }
      }
      app.ctx.log.info('app', `Update triggered via Watchtower (requested ${body.version ?? 'latest'})`);
      return reply.code(202).send({ mode: 'watchtower' });
    }

    // native
    writeFileSync(join(dataDir, 'update-requested'), body.version ?? 'latest');
    app.ctx.log.info('app', `Update trigger file written (requested ${body.version ?? 'latest'})`);
    return reply.code(202).send({
      mode: 'native',
      message: 'Update requested — the Pi installer’s updater applies it in the background and restarts the server.',
    });
  });

  // Native-update progress: the root-side updater (kegwall-update.sh) writes its
  // current phase into DATA_DIR/update-status (fetching → installing → building →
  // restarting, or "failed: …" after a rollback). This runs on the OLD server
  // process — it keeps serving until the updater's final restart — so the UI can
  // show real progress instead of a mute "updating…" banner. The updater removes
  // the file when done; a fresh boot also clears any stale leftover below.
  try {
    if (existsSync(join(dataDir, 'update-status'))) {
      // Stale from a crashed updater run — status is only meaningful mid-update.
      writeFileSync(join(dataDir, 'update-status'), '');
    }
  } catch { /* read-only data dir in some tests — harmless */ }

  app.get('/api/system/update-status', viewer, async () => {
    try {
      const phase = readFileSync(join(dataDir, 'update-status'), 'utf8').trim();
      return { phase: phase || null };
    } catch {
      return { phase: null };
    }
  });

  // ---- Host monitoring + OS-level actions (Pi monitoring epic) ----

  // Warn-once-per-process undervoltage latch — the source_status `lastHealthy` dedupe
  // idiom collapsed to one boolean. A server restart re-warns; that's intentional (a
  // persistent power problem SHOULD renotify after a crash-restart cycle).
  let undervoltWarned = false;
  const readThrottleFlags = opts.readThrottle ?? readThrottle;

  app.get('/api/system/stats', viewer, async () => {
    const stats = await readHostStats(dataDir);
    const throttle = opts.readThrottle ? await readThrottleFlags() : stats.throttle;
    if (throttle && (throttle.undervoltedNow || throttle.undervoltedSinceBoot) && !undervoltWarned) {
      undervoltWarned = true;
      app.ctx.log.warn('app', 'Undervoltage detected — this Pi is not getting enough power. Use the official power supply; undervoltage corrupts SD cards and causes random crashes.');
    }
    return {
      ...stats,
      throttle,
      // Debian drops this file when an installed update needs a reboot.
      rebootRequired: existsSync(opts.rebootRequiredPath ?? '/var/run/reboot-required'),
      // Whether the OS-level buttons (reboot, OS update) can work at all — they ride
      // the native install's trigger-file units.
      osManaged: app.ctx.settings.get('updates')?.mode === 'native',
    };
  });

  // Admin-only: enumerates the host's LAN addresses (topology stays behind auth).
  // The CLIENT composes page URLs from these — this endpoint stays dumb on purpose.
  app.get('/api/system/urls', admin, async () => {
    const addresses: string[] = [];
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
      }
    }
    // KEGWALL_INSTALL is set by pi-install.sh's systemd unit; /.dockerenv is the
    // container tell. The wizard uses this to preselect the right update mode.
    const install = process.env.KEGWALL_INSTALL === 'native' ? 'native'
      : existsSync('/.dockerenv') ? 'docker'
        : 'unknown';
    return { port: opts.port ?? 8080, hostname: os.hostname(), addresses, install, displayMode: readDisplayMode() };
  });

  // Both OS actions clone the native update's trigger-file mechanism: the app writes a
  // file into DATA_DIR, a root systemd path unit (pi-install.sh) reacts. Each action
  // has its OWN trigger + unit pair — no content multiplexing, each root script stays
  // auditable in one screenful. The fixed token contents are validated by regex on the
  // root side; they are the entire protocol.
  app.post('/api/system/os-update', admin, async (_req, reply) => {
    if (app.ctx.settings.get('updates')?.mode !== 'native') {
      return reply.code(409).send({
        error: 'conflict',
        message: 'OS updates are only available on the native Pi install.',
      });
    }
    const osUpdates = app.ctx.settings.get('osUpdates');
    if (!osUpdates || osUpdates.mode === 'off') {
      return reply.code(409).send({
        error: 'conflict',
        message: 'Turn on OS updates in Settings → System first.',
      });
    }
    // 'run-reboot' vs 'run' carries the autoReboot setting to the root script, which
    // cannot read app settings itself.
    writeFileSync(join(dataDir, 'os-update-requested'), osUpdates.autoReboot ? 'run-reboot' : 'run');
    app.ctx.log.info('app', `OS update trigger file written (auto-reboot ${osUpdates.autoReboot ? 'on' : 'off'})`);
    return reply.code(202).send({
      message: 'OS update started in the background — apt output lands in the journal (journalctl -u kegwall-os-update).',
    });
  });

  // Sampled host-health history (app.ts's 60s sampler → migration 014) for the Stats
  // page's server chart. Bucketed server-side so a week of samples doesn't ship 10k
  // JSON rows to draw a 200px chart.
  app.get('/api/system/stats/history', viewer, async (req) => {
    const { hours } = z.object({
      hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
    }).parse(req.query ?? {});
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    return { points: listHostStatsBucketed(app.ctx.db, since) };
  });

  // Kiosk display restart — same trigger-file pattern as os-update/reboot above (own
  // file + own root path unit; kegwall-kiosk-restart.sh). Chromium keeps running the
  // JS bundle it loaded at page-open, so this is the recovery lever when the display
  // wedges (the version-change auto-reload handles normal updates on its own).
  // Fire a simulated pour on the live wall (over /ws) — validates the takeover render + push
  // latency on a real display without a physical pour, and records nothing. Editor-gated.
  app.post('/api/system/test-pour', { preHandler: requireRole('editor') }, async (req) => {
    const { tapId } = z.object({ tapId: z.number().int().positive().optional() }).parse((req.body as unknown) ?? {});
    const res = app.ctx.state.simulatePour(tapId);
    app.ctx.log.info('app', `Test pour fired on tap ${res.tapId} from the admin UI`);
    return res;
  });

  app.post('/api/system/kiosk-restart', admin, async (_req, reply) => {
    if (app.ctx.settings.get('updates')?.mode !== 'native') {
      return reply.code(409).send({
        error: 'conflict',
        message: 'Restarting the kiosk display is only available on the native Pi install.',
      });
    }
    writeFileSync(join(dataDir, 'kiosk-restart-requested'), 'restart');
    app.ctx.log.info('app', 'Kiosk display restart requested from the admin UI');
    return reply.code(202).send({
      message: 'Restarting the kiosk display — the screen goes black for a few seconds. (Needs the installer’s kiosk-restart unit; re-run scripts/pi-install.sh once if this install predates it.)',
    });
  });

  app.post('/api/system/reboot', admin, async (_req, reply) => {
    if (app.ctx.settings.get('updates')?.mode !== 'native') {
      return reply.code(409).send({
        error: 'conflict',
        message: 'Rebooting from the UI is only available on the native Pi install.',
      });
    }
    writeFileSync(join(dataDir, 'reboot-requested'), 'reboot');
    app.ctx.log.warn('app', 'Reboot requested from the admin UI');
    return reply.code(202).send({ message: 'Rebooting — the wall goes dark for a minute or two.' });
  });
}

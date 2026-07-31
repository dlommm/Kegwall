import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireRole } from './auth.js';

/**
 * System routes: the running version, the update check (against the project's own
 * GitLab Releases feed), and the update trigger. Two update mechanisms exist —
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
    const path = app.ctx.settings.get('updateCheckProjectPath');
    const current = app.ctx.version;
    try {
      const res = await fetch(
        `${base}/api/v4/projects/${encodeURIComponent(path)}/releases`,
        { signal: AbortSignal.timeout(opts.updateTimeoutMs ?? 10_000) },
      );
      if (!res.ok) {
        return { ok: false, current, message: `Release feed answered ${res.status} — check the update source settings.` };
      }
      const releases = await res.json() as { tag_name?: string }[];
      const release = releases.find((r) => RELEASE_TAG_PATTERN.test(r.tag_name ?? ''));
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
        notesUrl: `${base}/${path}/-/releases/v${latest}`,
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
}

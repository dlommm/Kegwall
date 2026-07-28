import type { FastifyInstance, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { getMonitorById, type Monitor } from '../db/monitors.js';
import { createBeer } from '../db/beers.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { MdashClient, MdashError } from '../ingest/kegtron/mdashClient.js';
import { parseDeviceShadow, decodeUntappdLabelUrl } from '../ingest/kegtron/shadow.js';
import { downloadAndStoreLabel } from './lookup.js';
import type { HostResolver } from '../core/ssrfGuard.js';

// ---------------------------------------------------------------------------
// Admin bridges onto mdash.net for a single Kegtron Pro monitor:
//   - POST /api/kegtron/import/:monitorId       -> create a beers row from the device's
//     current port config (userName/maker/style/abv/ibu/srm).
//   - POST /api/kegtron/reset-volume/:monitorId -> Kegtron.ResetVolume RPC for that port.
//   - POST /api/kegtron/wifi-rssi/:monitorId    -> Kegtron.GetWiFiRssi RPC (Phase 5 Task
//     0 spec-parity item) — a live, on-demand device round-trip, not device-scoped state
//     already sitting in `monitors.meta`, hence POST + a button on the Monitors page
//     rather than folded into the GET listing (matches ResetVolume's own POST/RPC shape,
//     not GET /api/monitors/:id/telemetry's cheap DB read).
//
// Both resolve the mdash DEVICE_PUBLIC_KEY from `monitors.meta.deviceKey`, which
// cloudSource.ts's emitShadowEvents() stamps onto every `device_discovered` event at
// discovery time (verified — see that file's doc comment on emitShadowEvents). Neither
// route ever puts a device key in a response body or an error message: MdashError's
// own message is already key-free by construction (see mdashClient.ts), and both
// handlers below reply with a fixed, key-free message on any MdashError.
// ---------------------------------------------------------------------------

// `volStartMl` is parsed (so a well-typed client sending it gets a clean 400, not a
// crash) but is REJECTED, not silently dropped — see the 400 check at the call site
// below for why silently accepting-and-ignoring it would be a correctness bug (the
// caller would believe a custom starting volume was set when the device actually reset
// to its configured keg size instead).
const resetVolumeSchema = z.object({
  volStartMl: z.number().nonnegative().optional(),
});

function buildMdashClient(app: FastifyInstance): MdashClient {
  return new MdashClient({
    apiKey: app.ctx.settings.get('kegtronApiKey') ?? '',
    baseUrl: app.ctx.settings.get('kegtronBaseUrl'),
  });
}

/** Resolves and validates the monitor addressed by `:monitorId`: must exist and must be
 * a Kegtron Pro device with a device key stamped at cloud discovery (both RPC calls in
 * this file are mdash-only; Gen 1 monitors have no mdash account at all). */
function requireProMonitor(db: Database.Database, monitorId: number): { monitor: Monitor; deviceKey: string } {
  const monitor = getMonitorById(db, monitorId);
  if (!monitor) throw new NotFoundError('monitor');
  if (monitor.type !== 'kegtron_pro') {
    throw new ValidationError('monitor is not a Kegtron Pro device');
  }
  const deviceKey = monitor.meta?.deviceKey;
  if (typeof deviceKey !== 'string' || deviceKey.length === 0) {
    throw new ValidationError('monitor has no linked mdash device key (not cloud-discovered)');
  }
  return { monitor, deviceKey };
}

/** Uniform, key-free 502 for any MdashError; rethrows anything else so the global error
 * handler (app.ts) still processes unexpected failures normally. */
function sendMdashFailure(reply: FastifyReply, err: unknown, action: string): FastifyReply {
  if (err instanceof MdashError) {
    return reply.code(502).send({
      error: 'mdash_error',
      message: `Failed to ${action} via mdash.net (status ${err.status})`,
    });
  }
  throw err;
}

export interface KegtronRoutesOptions {
  timeoutMs?: number;
  /** Overrides the labelUrl download's SSRF-guard DNS resolver — tests only; forwarded
   * straight to `downloadAndStoreLabel` (see `routes/lookup.ts`). */
  resolveHost?: HostResolver;
  /** Test-only escape hatch for the labelUrl download's SSRF guard — never set outside a
   * test build; same as `LookupRoutesOptions.allowInsecureHosts`. */
  allowInsecureHosts?: boolean;
}

const DEFAULT_LABEL_DOWNLOAD_TIMEOUT_MS = 5_000;

export async function kegtronRoutes(
  app: FastifyInstance,
  dataDir: string,
  opts: KegtronRoutesOptions = {},
) {
  const db = app.ctx.db;
  const editor = { preHandler: requireRole('editor') };
  const labelsDir = join(dataDir, 'labels');
  // Belt-and-suspenders, same rationale as uploads.ts/lookup.ts: app.ts always registers
  // labelsStaticRoutes (which also mkdir's this) first, but a caller wiring kegtronRoutes
  // independently shouldn't 500 on a missing directory.
  mkdirSync(labelsDir, { recursive: true });
  const labelDownloadOpts = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_LABEL_DOWNLOAD_TIMEOUT_MS,
    resolveHost: opts.resolveHost,
    allowInsecureHosts: opts.allowInsecureHosts,
  };

  app.post('/api/kegtron/import/:monitorId', editor, async (req, reply) => {
    const { monitor, deviceKey } = requireProMonitor(db, Number((req.params as any).monitorId));

    let shadow: unknown;
    try {
      shadow = await buildMdashClient(app).getDeviceShadow(deviceKey);
    } catch (err) {
      return sendMdashFailure(reply, err, 'read the device shadow');
    }

    const parsed = parseDeviceShadow(shadow);
    const port = parsed?.ports.find((p) => p.portIndex === monitor.portIndex);
    if (!port || !port.name) {
      throw new ValidationError('device has no beer name configured for this port');
    }

    // Phase 5 Task 0 spec-parity item: decode the port's labelUrl (Untappd label id,
    // per docs/kegtron/kegtron-pro.v2.yaml — see decodeUntappdLabelUrl's doc comment)
    // and download it through the same SSRF-guarded path the Untappd search sheet uses
    // (routes/lookup.ts's downloadAndStoreLabel). A download failure (unreachable,
    // oversized, wrong format, guard rejection, ...) is NOT a reason to fail the whole
    // import — the device config itself is still valid and worth creating a beer from;
    // it just comes in with no label art, exactly like importing a device with no
    // labelUrl set at all.
    let labelImage: string | null = null;
    const decodedLabelUrl = decodeUntappdLabelUrl(port.labelUrl, app.ctx.settings.get('untappdImageBaseUrl'));
    if (decodedLabelUrl) {
      const downloaded = await downloadAndStoreLabel(labelsDir, decodedLabelUrl, labelDownloadOpts);
      if (downloaded.ok) labelImage = downloaded.path;
    }

    const beer = createBeer(db, {
      name: port.name,
      brewery: port.maker,
      style: port.style,
      abv: port.abv,
      ibu: port.ibu,
      srm: port.srm,
      labelImage,
    });
    return reply.code(201).send(beer);
  });

  app.post('/api/kegtron/reset-volume/:monitorId', editor, async (req, reply) => {
    const { monitor, deviceKey } = requireProMonitor(db, Number((req.params as any).monitorId));
    const body = resetVolumeSchema.parse(req.body ?? {});

    // The YAML's Kegtron.ResetVolume RPC schema (docs/kegtron/kegtron-pro.v2.yaml, the
    // `/api/v2/m/device/rpc/Kegtron.ResetVolume` operation) takes ONLY `{port: 0..3}` —
    // calling it always resets config_readonly.porti.{volDisp,pulseCnt} to 0 and
    // volStart to the port's *configured* config.volSize on-device; there is no field on
    // this RPC for an arbitrary starting volume. Setting an explicit custom volStart is
    // a different RPC entirely (Kegtron.UserOverride's
    // state.config_readonly.porti.volStart), out of scope for this endpoint. Silently
    // dropping a caller-provided volStartMl would be a correctness bug (200 OK while the
    // device actually did something else than what was asked), so it's rejected instead.
    if (body.volStartMl !== undefined) {
      throw new ValidationError(
        'volStartMl is not supported by Kegtron.ResetVolume; the device resets to its configured keg size',
      );
    }

    try {
      await buildMdashClient(app).callRpc(deviceKey, 'Kegtron.ResetVolume', { port: monitor.portIndex });
    } catch (err) {
      return sendMdashFailure(reply, err, 'reset volume');
    }
    return reply.code(200).send({ ok: true });
  });

  // Kegtron.GetWiFiRssi's response body is a BARE integer (dBm — e.g. `-47`; see
  // docs/kegtron/kegtron-pro.v2.yaml, larger/less-negative = stronger signal), not an
  // object — wrapped here as `{rssi}` so the client gets a normal JSON object shape like
  // every other endpoint in this app, matching the RPC's own request shape (no `port`
  // param — the spec's GetWiFiRssi takes no params at all, unlike ResetVolume).
  app.post('/api/kegtron/wifi-rssi/:monitorId', editor, async (req, reply) => {
    const { deviceKey } = requireProMonitor(db, Number((req.params as any).monitorId));

    let raw: unknown;
    try {
      raw = await buildMdashClient(app).callRpc(deviceKey, 'Kegtron.GetWiFiRssi');
    } catch (err) {
      return sendMdashFailure(reply, err, 'read WiFi signal strength');
    }
    if (typeof raw !== 'number') {
      // Defensive only — a real device always answers with a bare integer per the spec;
      // this keeps a malformed/unexpected mdash response from crashing into a raw 500.
      return reply.code(502).send({
        error: 'mdash_error',
        message: 'mdash.net returned an unexpected response for WiFi signal strength',
      });
    }
    return reply.code(200).send({ rssi: raw });
  });
}

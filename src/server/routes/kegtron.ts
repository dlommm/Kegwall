import type { FastifyInstance, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { getMonitorById, type Monitor } from '../db/monitors.js';
import { createBeer } from '../db/beers.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { MdashClient, MdashError } from '../ingest/kegtron/mdashClient.js';
import { parseDeviceShadow } from '../ingest/kegtron/shadow.js';

// ---------------------------------------------------------------------------
// Admin bridges onto mdash.net for a single Kegtron Pro monitor:
//   - POST /api/kegtron/import/:monitorId       -> create a beers row from the device's
//     current port config (userName/maker/style/abv/ibu/srm).
//   - POST /api/kegtron/reset-volume/:monitorId -> Kegtron.ResetVolume RPC for that port.
//
// Both resolve the mdash DEVICE_PUBLIC_KEY from `monitors.meta.deviceKey`, which
// cloudSource.ts's emitShadowEvents() stamps onto every `device_discovered` event at
// discovery time (verified — see that file's doc comment on emitShadowEvents). Neither
// route ever puts a device key in a response body or an error message: MdashError's
// own message is already key-free by construction (see mdashClient.ts), and both
// handlers below reply with a fixed, key-free message on any MdashError.
// ---------------------------------------------------------------------------

const resetVolumeSchema = z.object({
  // Accepted per this route's documented request shape, but deliberately NOT forwarded
  // to the RPC call below — see the comment at the call site.
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

export async function kegtronRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const editor = { preHandler: requireRole('editor') };

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

    const beer = createBeer(db, {
      name: port.name,
      brewery: port.maker,
      style: port.style,
      abv: port.abv,
      ibu: port.ibu,
      srm: port.srm,
    });
    return reply.code(201).send(beer);
  });

  app.post('/api/kegtron/reset-volume/:monitorId', editor, async (req, reply) => {
    const { monitor, deviceKey } = requireProMonitor(db, Number((req.params as any).monitorId));
    resetVolumeSchema.parse(req.body ?? {});

    // The YAML's Kegtron.ResetVolume RPC schema (docs/kegtron/kegtron-pro.v2.yaml, the
    // `/api/v2/m/device/rpc/Kegtron.ResetVolume` operation) takes ONLY `{port: 0..3}` —
    // calling it always resets config_readonly.porti.{volDisp,pulseCnt} to 0 and
    // volStart to the port's *configured* config.volSize on-device; there is no field on
    // this RPC for an arbitrary starting volume. Setting an explicit custom volStart is
    // a different RPC entirely (Kegtron.UserOverride's
    // state.config_readonly.porti.volStart), out of scope for this endpoint.
    try {
      await buildMdashClient(app).callRpc(deviceKey, 'Kegtron.ResetVolume', { port: monitor.portIndex });
    } catch (err) {
      return sendMdashFailure(reply, err, 'reset volume');
    }
    return reply.code(200).send({ ok: true });
  });
}

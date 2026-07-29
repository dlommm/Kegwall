import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  createAutomation, listAutomations, getAutomation, updateAutomation, deleteAutomation,
} from '../db/automations.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { TEMPLATES, getTemplate } from '../automation/templates.js';
import { ALERT_CHANNEL_NAMES, type AlertChannelName } from '../notify/channels/index.js';

const fromTemplateSchema = z.object({
  template: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Display labels for the `notify` action's channel multi-select (Task 6) — matches
 * `ALERT_CHANNEL_NAMES`'s order/membership exactly (see notify/channels/index.ts). */
const CHANNEL_LABELS: Record<AlertChannelName, string> = {
  ntfy: 'ntfy', pushover: 'Pushover', smtp: 'Email (SMTP)', discord: 'Discord', slack: 'Slack',
};

/**
 * Phase 5 Task 4: alert templates (GET/from-template) + automations CRUD + the
 * `run-now` test-run endpoint. Per the plan's Global Constraints ("editor manages
 * automations"), reads are `viewer` and every write is `editor` -- matching every other
 * resource in `routes/crud.ts`. Every route that changes a rule's stored shape (create,
 * from-template, update, delete) emits `automations_changed` so the live
 * `AutomationEngine` (already subscribed -- see automation/engine.ts) reloads its rule
 * cache; `GET` routes and `run` (a synthetic-ctx dry-run that deliberately does NOT
 * persist anything -- see `AutomationEngine.runRuleOnce`'s doc comment) do not.
 */
export async function automationsRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };

  const emitChanged = (): void => {
    app.ctx.bus.emit('automations_changed', { ts: new Date().toISOString() });
  };

  // GET /api/automations/templates -- registered before GET /api/automations/:id so
  // Fastify matches the literal "templates" segment first (same discipline as
  // crud.ts's /api/taps/:id/on-deck ahead of /api/taps/:id).
  app.get('/api/automations/templates', viewer, async () =>
    TEMPLATES.map((t) => ({
      id: t.id, label: t.label, description: t.description, params: t.params,
    })));

  app.post('/api/automations/from-template', editor, async (req, reply) => {
    const body = fromTemplateSchema.parse(req.body);
    const tmpl = getTemplate(body.template);
    if (!tmpl) throw new NotFoundError('template');

    const parsedParams = tmpl.paramsSchema.safeParse(body.params ?? {});
    if (!parsedParams.success) {
      throw new ValidationError(parsedParams.error.issues.map((i) => i.message).join('; '));
    }

    const inputs = tmpl.build(parsedParams.data, { servingSizeMl: app.ctx.settings.get('servingSizeMl') });
    const automations = inputs.map((input) => createAutomation(db, input));
    emitChanged();
    return reply.code(201).send({ automations });
  });

  // GET /api/automations/channels -- registered before GET /api/automations/:id for the
  // same reason `templates` is above: `channels` would otherwise match `:id`'s pattern.
  // Task 6's `notify` action editor needs to know which channels currently have config
  // saved (a `notify` action referencing an unconfigured channel silently no-ops at fire
  // time -- see engine.ts's `sendToChannels`), WITHOUT exposing full settings (`GET
  // /api/settings` is admin-only; this page is editor/viewer-accessible) -- so this
  // returns just names + display labels, `inApp` always included (it's always usable, no
  // config to check) plus whichever of `ALERT_CHANNEL_NAMES` has a truthy `alertChannels`
  // entry right now.
  app.get('/api/automations/channels', viewer, async () => {
    const cfg = app.ctx.settings.get('alertChannels');
    const channels: { name: string; label: string }[] = [{ name: 'inApp', label: 'In-app' }];
    for (const name of ALERT_CHANNEL_NAMES) {
      if (cfg[name]) channels.push({ name, label: CHANNEL_LABELS[name] });
    }
    return channels;
  });

  app.get('/api/automations', viewer, async () => listAutomations(db));

  app.get('/api/automations/:id', viewer, async (req) => {
    const rule = getAutomation(db, Number((req.params as any).id));
    if (!rule) throw new NotFoundError('automation');
    return rule;
  });

  app.post('/api/automations', editor, async (req, reply) => {
    const created = createAutomation(db, req.body as any);
    emitChanged();
    return reply.code(201).send(created);
  });

  app.patch('/api/automations/:id', editor, async (req) => {
    const updated = updateAutomation(db, Number((req.params as any).id), req.body as any);
    emitChanged();
    return updated;
  });

  app.delete('/api/automations/:id', editor, async (req, reply) => {
    deleteAutomation(db, Number((req.params as any).id));
    emitChanged();
    return reply.code(204).send();
  });

  app.post('/api/automations/:id/run', editor, async (req) => {
    const rule = getAutomation(db, Number((req.params as any).id));
    if (!rule) throw new NotFoundError('automation');
    const results = await app.ctx.engine.runRuleOnce(rule);
    return { results };
  });
}

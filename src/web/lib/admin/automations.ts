// --- Task 6: automations, notification center, channel send-test ---
// From core/automationSchema.ts, a dependency-free (zod only) module by the same
// deliberate design as core/lookupTypes.ts/core/wallConfig.ts (see ./beers.ts and
// ./walls.ts) — see that file's own top doc comment. `AutomationRuleInput`/
// `AutomationRule` are safe VALUE-free type imports here.
import type { AutomationRuleInput, AutomationRule } from '../../../server/core/automationSchema.js';
// From db/notificationsRepo.ts — a plain db module (only value import is core/errors.ts,
// itself dependency-free), same "types via type-only server imports" precedent as
// `Settings`/`Pour`/etc. in the sibling modules.
import type { Notification } from '../../../server/db/notificationsRepo.js';
import { request, type ApiResult } from '../adminHttp';

export function listAutomations(): Promise<ApiResult<AutomationRule[]>> {
  return request('/api/automations');
}

export function getAutomation(id: number): Promise<ApiResult<AutomationRule>> {
  return request(`/api/automations/${id}`);
}

/** POST /api/automations — `input` is run through `automationForm.ts`'s
 * `parseAutomationForm` (the REAL `AutomationRuleConfigSchema`, imported) client-side
 * BEFORE this is ever called, so a save can never reach the server with a shape it would
 * reject — see that module's doc comment for the round-trip story. */
export function createAutomation(input: AutomationRuleInput): Promise<ApiResult<AutomationRule>> {
  return request('/api/automations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAutomation(
  id: number, input: Partial<AutomationRuleInput>,
): Promise<ApiResult<AutomationRule>> {
  return request(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/automations/:id — 204 on success; the rule's history in `notifications` is
 * kept (`automation_id` nulled, not cascaded — see db/automations.ts's `deleteAutomation`). */
export function deleteAutomation(id: number): Promise<ApiResult<null>> {
  return request(`/api/automations/${id}`, { method: 'DELETE' });
}

export interface AutomationRunResult { type: string; ok: boolean; error?: string }

/** POST /api/automations/:id/run — the builder's "test run" button: dispatches every
 * action against a fabricated synthetic context (no cooldown/runaway/lastFiredAt
 * bookkeeping consumed — see `AutomationEngine.runRuleOnce`'s doc comment) and reports a
 * per-action result. */
export function runAutomation(id: number): Promise<ApiResult<{ results: AutomationRunResult[] }>> {
  return request(`/api/automations/${id}/run`, { method: 'POST' });
}

/** Rendering metadata for one of the 9 one-click alert templates — mirrors
 * `automation/templates.ts`'s `TemplateParamMeta`/the serialized subset of `AlertTemplate`
 * that `GET /api/automations/templates` actually sends (its own `build`/`paramsSchema`
 * are server-only and never serialize — see routes/automations.test.ts's own assertion of
 * that). Defined locally rather than type-imported from templates.ts: that module's own
 * `paramsSchema: z.ZodType<P>` field's generic would need to be typed `any` here anyway,
 * and this page never needs the server type, only the JSON shape the route returns. */
export interface AutomationTemplateSummary {
  id: string;
  label: string;
  description: string;
  params: { name: string; label: string; type: 'number' | 'string'; default?: number | string; min?: number; max?: number }[];
}

export function listAutomationTemplates(): Promise<ApiResult<AutomationTemplateSummary[]>> {
  return request('/api/automations/templates');
}

/** POST /api/automations/from-template — `params` omitted uses every param's own default
 * (see the template's `paramsSchema`). Some templates (temp/humidity out-of-range) create
 * TWO rules from one call — hence `automations: AutomationRule[]`, always an array. */
export function createFromTemplate(
  template: string, params?: Record<string, unknown>,
): Promise<ApiResult<{ automations: AutomationRule[] }>> {
  return request('/api/automations/from-template', {
    method: 'POST',
    body: JSON.stringify(params ? { template, params } : { template }),
  });
}

export interface AutomationChannelOption { name: string; label: string }

/** GET /api/automations/channels — the `notify` action's channel multi-select options:
 * `inApp` always, plus whichever `alertChannels` entries currently have config saved. Not
 * the same as `GET /api/settings` (admin-only; this is editor/viewer-safe — see
 * routes/automations.ts's doc comment on the route). */
export function listAutomationChannels(): Promise<ApiResult<AutomationChannelOption[]>> {
  return request('/api/automations/channels');
}

/** GET /api/notifications?limit=&before= — newest-first, `before` an exclusive `id`
 * cursor (see db/notificationsRepo.ts's `listNotifications`). Both params omitted by
 * default (server applies its own default `limit`). */
export function listNotifications(
  opts: { limit?: number; before?: number } = {},
): Promise<ApiResult<Notification[]>> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.before !== undefined) params.set('before', String(opts.before));
  const qs = params.toString();
  return request(`/api/notifications${qs ? `?${qs}` : ''}`);
}

export function getUnackedCount(): Promise<ApiResult<{ count: number }>> {
  return request('/api/notifications/unacked-count');
}

/** POST /api/notifications/:id/ack — viewer role (see routes/notifications.ts's doc
 * comment on why acking isn't gated above viewer). */
export function ackNotification(id: number): Promise<ApiResult<Notification>> {
  return request(`/api/notifications/${id}/ack`, { method: 'POST' });
}

export function ackAllNotifications(): Promise<ApiResult<{ count: number }>> {
  return request('/api/notifications/ack-all', { method: 'POST' });
}

/** POST /api/channels/:name/test — admin role. Always resolves `ok: true` at the HTTP
 * layer (200) even when the send itself failed — see routes/channels.ts's doc comment;
 * the caller reads `.data.ok`/`.data.message` for the actual send outcome. */
export function testChannel(name: string): Promise<ApiResult<{ ok: boolean; message?: string }>> {
  return request(`/api/channels/${name}/test`, { method: 'POST' });
}

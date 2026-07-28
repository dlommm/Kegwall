import type { NotificationSeverity } from '../../db/notificationsRepo.js';
import type { RetryOptions } from '../retry.js';

/** What every channel's `send()` is handed -- the plan's literal shape
 * `{title, body, severity, meta}`. `meta` is a free-form bag a caller (the route's
 * send-test handler today; Task 3's engine from the next task on) can attach extra
 * context to; the only key any Task 2 sender currently reads is `meta.automationId`
 * (`InAppChannel`, to link the notification row back to the rule that fired it) --
 * everything else just flows through the templated `title`/`body` a caller has already
 * rendered via `renderTemplate` before calling `send()` (this module never templates
 * anything itself). */
export interface ChannelMessage {
  title: string;
  body: string;
  severity: NotificationSeverity;
  meta?: Record<string, unknown>;
}

export interface Channel {
  readonly name: string;
  send(msg: ChannelMessage): Promise<void>;
}

/** Shared constructor-options shape for every EXTERNAL (network) sender: the per-attempt
 * timeout plus `RetryOptions`' backoff/sleep overrides, plus an injectable `fetch`
 * implementation so tests can assert on request shape without a real fake-upstream
 * server where a full Fastify instance would be overkill (most channel tests still spin
 * up a real fake Fastify server per this repo's established convention -- see e.g.
 * `tests/routes/lookup.test.ts` -- `fetchImpl` exists for the couple of unit-level tests,
 * e.g. asserting the exact retry/backoff wiring, that don't need one). `InAppChannel` is
 * the one sender that does NOT take this (a local DB write has no network timeout to
 * configure).
 */
export interface ChannelSendOptions extends RetryOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

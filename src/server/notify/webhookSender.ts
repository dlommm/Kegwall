import { withRetry, HttpSendError, DEFAULT_TIMEOUT_MS } from './retry.js';
import type { ChannelSendOptions } from './channels/types.js';

// ---------------------------------------------------------------------------
// Standalone sender behind the `webhook` automation action (`core/automationSchema.ts`'s
// `ActionSchema`: `{type: 'webhook', url, bodyTemplate}`). NOT one of the settings'
// `alertChannels` (a webhook's URL is per-action, chosen when the rule is authored, not a
// site-wide setting) -- so it doesn't implement the `Channel` interface and has no
// `POST /api/channels/:name/test` entry; Task 3's engine calls it directly with the
// `bodyTemplate` already rendered (via `notify/template.ts`'s `renderTemplate`) into a
// plain string. This module is the "POST these exact bytes" primitive; it does no
// templating or re-encoding of its own.
// ---------------------------------------------------------------------------

export type { ChannelSendOptions };

/**
 * POSTs `body` (a caller-rendered string — typically JSON, since the plan's webhook
 * examples all template a JSON payload, but this sender doesn't parse or validate it) to
 * `url` with `content-type: application/json`, 5s timeout + 2 retries (100ms/500ms
 * backoff, both test-overridable via `opts`). Throws once every attempt fails; the
 * thrown message NEVER includes `url` (a webhook target can carry a secret token in its
 * own query string or path, same redaction discipline as `MdashError`/every Channel
 * sender here) or the response body.
 *
 * `redirect: 'error'` (Task 3 review Fix round 1, Critical/SSRF): `url` is validated by
 * the ENGINE's `assertPublicHost` check before this function is ever called (see
 * `automation/engine.ts`'s `dispatchWebhook`) — but that check only proves `url` ITSELF
 * resolves to a public address; it says nothing about where a 3xx response FROM that url
 * might redirect to. Without this, a legitimate-looking, guard-passing public host could
 * 302 a POST to a private/loopback address (or cloud metadata) and fetch would happily
 * follow it, silently reaching the exact host the guard exists to keep this app off of —
 * the identical "validated-then-redirected" bypass `routes/lookup.ts`'s
 * `downloadAndStoreLabel` already closes the same way. A redirect response therefore
 * makes `fetchImpl` throw (a `TypeError`, same as `downloadAndStoreLabel`'s own
 * `redirect: 'error'` — see that file's `isRedirectRejection`), which the `catch` below
 * folds into the same generic, redacted "request failed" message as every other network
 * failure — a rejected redirect is treated as an ordinary send failure, not a special
 * case the caller needs to distinguish.
 */
export async function sendWebhook(url: string, body: string, opts: ChannelSendOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  await withRetry(async () => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new Error('webhook: request failed (network error or timeout)');
    }
    // Typed so withRetry can classify: permanent 4xx fails fast, 429/5xx retries.
    if (!res.ok) throw new HttpSendError(`webhook: request failed (status ${res.status})`, res.status);
  }, opts);
}

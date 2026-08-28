// ---------------------------------------------------------------------------
// Shared retry helper for Phase 5 Task 2's external senders (ntfy/pushover/discord/
// slack/smtp/webhook/mqtt). Spec: "5s timeout, 2 retries exponential backoff
// (100ms/500ms test-overridable), then throw" -- each sender simply throws once every
// attempt has failed; a caller-side invariant (in-app record persists regardless, the
// caller logs the failure) lands with Task 3's engine, not here.
//
// `withRetry` owns ONLY the retry count + backoff delay. The per-attempt TIMEOUT is
// deliberately NOT this module's job -- it differs by transport (fetch-based senders
// pass `AbortSignal.timeout(timeoutMs)` into `fetch` itself; nodemailer's SMTP transport
// has its own connection/greeting/socket timeout options; mqtt.js's `publishAsync` has
// no built-in per-call timeout, so `mqttSender.ts` races it against a manual timer). Each
// sender is responsible for making its own `fn` passed to `withRetry` respect
// `timeoutMs`; this helper just retries whatever `fn` rejects with.
// ---------------------------------------------------------------------------

/** Per-attempt timeout, shared as a single named constant so every sender's default
 * lines up with the spec's "5s timeout" without repeating the magic number. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Delay (ms) before each of the 2 retries -- `backoffMs.length` retries total, so this
 * array's LENGTH is "how many retries", not just its values. */
export const DEFAULT_BACKOFF_MS: readonly number[] = [100, 500];

/** Backoff multiplier applied when the failure was an HTTP 429: the upstream explicitly
 * said "slow down", so re-hitting it on the ordinary 100/500ms schedule is exactly the
 * behavior a rate limit exists to stop. A multiplier (not a fixed floor) keeps the
 * tests' short injected schedules proportionally short too. */
export const RATE_LIMIT_BACKOFF_MULTIPLIER = 5;

/**
 * Error a sender throws for a non-ok HTTP response, carrying the status code so
 * `withRetry` can classify it (see `isRetryableError`). The senders used to throw plain
 * `Error`s with the status only baked into the message -- which made every failure look
 * transient, so a permanently misconfigured webhook (404/401/400) got the full retry
 * schedule per notification: 3 identical attempts that can never succeed, and -- since
 * a slow-but-delivered attempt can race its own timeout -- the one place a duplicate
 * EXTERNAL notification could be produced. `message` stays the sender's own redacted,
 * humanized text (never a URL/secret -- see each channel's redaction discipline);
 * `status` is metadata for classification only, never re-serialized here.
 */
export class HttpSendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpSendError';
  }
}

/**
 * Retry classification: a 4xx other than 429 is a PERMANENT caller error (bad URL, bad
 * credentials, malformed payload) -- retrying it re-sends the identical request to the
 * identical outcome, so it fails fast on the first attempt. 429 and 5xx are transient
 * (rate limit / upstream trouble) and retry on the backoff schedule. Anything that is
 * not an `HttpSendError` -- network errors, timeouts, non-HTTP transports (SMTP/MQTT
 * throw their own untyped errors) -- stays retryable, preserving those senders'
 * pre-classification behavior.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpSendError) return err.status === 429 || err.status >= 500;
  return true;
}

export interface RetryOptions {
  /** Overrides `DEFAULT_BACKOFF_MS` -- also controls the retry COUNT (its length). Tests
   * pass short delays (or `[]` for "no retries") to run in milliseconds. */
  backoffMs?: readonly number[];
  /** Overrides the real `setTimeout`-based delay -- tests inject a spy to assert on the
   * exact backoff schedule without actually waiting, or a fast stub to keep real-time
   * tests quick. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `fn` up to `1 + backoffMs.length` times, sleeping `backoffMs[attempt]` between a
 * failed attempt and the next one. Non-retryable failures (`isRetryableError`: any
 * `HttpSendError` with a 4xx status other than 429) rethrow immediately -- no further
 * attempts, no sleep -- and a 429's backoff delay is stretched by
 * `RATE_LIMIT_BACKOFF_MULTIPLIER` (the server asked for exactly that). Returns the
 * first successful result; once every attempt has failed, rethrows the LAST error
 * verbatim (not wrapped) -- each sender is responsible for normalizing that into a
 * redacted, humanized message before it escapes the sender (see e.g.
 * `channels/ntfy.ts`), so beyond the `HttpSendError` status this generic helper never
 * needs to know anything about what `fn` does.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      lastErr = err;
      if (attempt < backoffMs.length) {
        const base = backoffMs[attempt]!;
        const rateLimited = err instanceof HttpSendError && err.status === 429;
        await sleep(rateLimited ? base * RATE_LIMIT_BACKOFF_MULTIPLIER : base);
      }
    }
  }
  throw lastErr;
}

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
 * failed attempt and the next one. Returns the first successful result; once every
 * attempt has failed, rethrows the LAST error verbatim (not wrapped) -- each sender is
 * responsible for normalizing that into a redacted, humanized message before it escapes
 * the sender (see e.g. `channels/ntfy.ts`), so this generic helper never needs to know
 * anything about what `fn` does.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < backoffMs.length) await sleep(backoffMs[attempt]!);
    }
  }
  throw lastErr;
}

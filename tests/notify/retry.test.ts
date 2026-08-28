import { describe, it, expect, vi } from 'vitest';
import {
  withRetry, HttpSendError, isRetryableError,
  DEFAULT_BACKOFF_MS, DEFAULT_TIMEOUT_MS, RATE_LIMIT_BACKOFF_MULTIPLIER,
} from '../../src/server/notify/retry.js';

// Phase 5 Task 2 spec: "5s timeout, 2 retries exponential backoff (100ms/500ms
// test-overridable), then throw". `withRetry` owns the retry COUNT + backoff DELAY only
// -- the per-attempt timeout mechanism differs by transport (fetch's AbortSignal vs.
// nodemailer's/mqtt.js's own timeout options) and is each caller's job, not this
// helper's; see retry.ts's doc comment.

describe('withRetry', () => {
  it('returns the result on the first successful attempt, no backoff sleep invoked', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { sleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('defaults to a 100ms/500ms backoff schedule (2 retries -- 3 total attempts)', () => {
    expect(DEFAULT_BACKOFF_MS).toEqual([100, 500]);
  });

  it('defaults to a 5s per-attempt timeout constant', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
  });

  it('retries on failure and returns the result once an attempt succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient');
      return 'ok-on-second';
    });
    const result = await withRetry(fn, { sleep, backoffMs: [10, 20] });
    expect(result).toBe('ok-on-second');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('exhausts all retries and throws the LAST error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const errors = [new Error('e1'), new Error('e2'), new Error('e3')];
    let calls = 0;
    const fn = vi.fn(async () => {
      const err = errors[calls];
      calls += 1;
      throw err;
    });
    await expect(withRetry(fn, { sleep, backoffMs: [10, 20] })).rejects.toThrow('e3');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('uses the default backoff schedule when none is given', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { sleep })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it('a real (unfaked) sleep actually elapses time for a custom short backoff', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('once')).mockResolvedValueOnce('ok');
    const start = Date.now();
    const result = await withRetry(fn, { backoffMs: [30] });
    expect(result).toBe('ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});

// Retry classification: a permanent 4xx (bad URL/credentials/payload) can never succeed
// on a retry -- pre-classification, a misconfigured webhook got 3 identical attempts per
// notification, and 429s were hammered on the same 100/500ms schedule the rate limit
// exists to stop. Only `HttpSendError` (thrown by the HTTP senders' !ok branches)
// carries a status to classify on; untyped errors (network/timeout/SMTP/MQTT) stay
// retryable.
describe('withRetry outcome classification', () => {
  function httpFailure(status: number) {
    return vi.fn().mockRejectedValue(new HttpSendError(`request failed (status ${status})`, status));
  }

  it.each([404, 401, 400])('%i is permanent: exactly ONE attempt, no backoff sleep, error rethrown', async (status) => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = httpFailure(status);
    await expect(withRetry(fn, { sleep })).rejects.toThrow(`status ${status}`);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 IS retried, on a stretched backoff (the server explicitly asked to slow down)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = httpFailure(429);
    await expect(withRetry(fn, { sleep, backoffMs: [10, 20] })).rejects.toThrow('status 429');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10 * RATE_LIMIT_BACKOFF_MULTIPLIER);
    expect(sleep).toHaveBeenNthCalledWith(2, 20 * RATE_LIMIT_BACKOFF_MULTIPLIER);
  });

  it('500 IS retried on the ordinary schedule', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = httpFailure(500);
    await expect(withRetry(fn, { sleep, backoffMs: [10, 20] })).rejects.toThrow('status 500');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('an untyped error (network failure/timeout) IS retried -- classification never reduces coverage for non-HTTP senders', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error('request failed (network error or timeout)'));
    await expect(withRetry(fn, { sleep, backoffMs: [10, 20] })).rejects.toThrow('network error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a permanent 4xx mid-schedule stops retrying immediately (classified per attempt, not just upfront)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient network blip'))
      .mockRejectedValueOnce(new HttpSendError('request failed (status 404)', 404));
    await expect(withRetry(fn, { sleep, backoffMs: [10, 20] })).rejects.toThrow('status 404');
    expect(fn).toHaveBeenCalledTimes(2); // retry after the blip, then fail fast on the 404
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('isRetryableError classifies exactly: 4xx-except-429 permanent, 429/5xx/untyped retryable', () => {
    expect(isRetryableError(new HttpSendError('x', 400))).toBe(false);
    expect(isRetryableError(new HttpSendError('x', 404))).toBe(false);
    expect(isRetryableError(new HttpSendError('x', 429))).toBe(true);
    expect(isRetryableError(new HttpSendError('x', 500))).toBe(true);
    expect(isRetryableError(new HttpSendError('x', 503))).toBe(true);
    expect(isRetryableError(new Error('anything untyped'))).toBe(true);
  });
});

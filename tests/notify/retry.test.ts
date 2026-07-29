import { describe, it, expect, vi } from 'vitest';
import { withRetry, DEFAULT_BACKOFF_MS, DEFAULT_TIMEOUT_MS } from '../../src/server/notify/retry.js';

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

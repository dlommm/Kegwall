import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { httpRequest } from '../../src/web/lib/http';

/**
 * Focused tests for the ONE shared transport (src/web/lib/http.ts) that both api.ts and
 * adminApi.ts build on. The two client test suites (api.test.ts / adminApi.test.ts) pin
 * each client's OBSERVABLE behavior through its exported functions; this suite pins the
 * transport's own contract — Content-Type discipline, error mapping, the never-throw
 * typed-result guarantee, and the option hooks (credentials / extraHeaders /
 * onUnauthorized) that parameterize the genuine per-client differences — so a future
 * transport change can't silently regress one client while the other's suite stays green.
 */

function mockFetchOnce(status: number, body: unknown, statusText = '') {
  const ok = status >= 200 && status < 300;
  const response = {
    ok,
    status,
    statusText: statusText || (ok ? 'OK' : 'Error'),
    json: async () => body,
  } as Response;
  (globalThis.fetch as Mock).mockResolvedValueOnce(response);
}

function lastFetchInit(): RequestInit & { headers: Record<string, string> } {
  const call = (globalThis.fetch as Mock).mock.calls[0]!;
  return call[1] as RequestInit & { headers: Record<string, string> };
}

describe('httpRequest (shared transport)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Content-Type discipline (the FST_ERR_CTP_EMPTY_JSON_BODY fix, now in ONE place) ---

  it('a bodyless request sends no Content-Type header at all', async () => {
    mockFetchOnce(200, { ok: true });
    await httpRequest('/api/thing', { method: 'POST' });
    expect(lastFetchInit().headers['Content-Type']).toBeUndefined();
  });

  it('a JSON body gets Content-Type: application/json', async () => {
    mockFetchOnce(200, { ok: true });
    await httpRequest('/api/thing', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(lastFetchInit().headers['Content-Type']).toBe('application/json');
  });

  it('a FormData body gets no Content-Type (browser sets its own multipart boundary)', async () => {
    mockFetchOnce(200, { ok: true });
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.bin');
    await httpRequest('/api/upload', { method: 'POST', body: form });
    expect(lastFetchInit().headers['Content-Type']).toBeUndefined();
  });

  // --- Option hooks: the parameterized per-client differences -------------------------

  it('passes options.credentials through, and omits the key entirely when unset', async () => {
    mockFetchOnce(200, {});
    await httpRequest('/api/a', undefined, { credentials: 'same-origin' });
    expect(lastFetchInit().credentials).toBe('same-origin');

    (globalThis.fetch as Mock).mockClear();
    mockFetchOnce(200, {});
    await httpRequest('/api/a');
    // The public client relies on fetch's spec default — the transport must not stamp
    // an explicit value (not even undefined) when no override was asked for.
    expect('credentials' in lastFetchInit()).toBe(false);
  });

  it('merges extraHeaders under per-call init.headers (explicit call headers win)', async () => {
    mockFetchOnce(200, {});
    await httpRequest('/api/a', { headers: { 'X-Token': 'call-level' } }, {
      extraHeaders: () => ({ 'X-Token': 'client-level', 'X-Other': 'kept' }),
    });
    expect(lastFetchInit().headers['X-Token']).toBe('call-level');
    expect(lastFetchInit().headers['X-Other']).toBe('kept');
  });

  it('invokes onUnauthorized on a 401 (and still returns the typed failure)', async () => {
    const onUnauthorized = vi.fn();
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    const result = await httpRequest('/api/a', undefined, { onUnauthorized });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, status: 401, message: 'Not logged in' });
  });

  it('does not invoke onUnauthorized for other error statuses or network failures', async () => {
    const onUnauthorized = vi.fn();
    mockFetchOnce(500, { message: 'boom' });
    await httpRequest('/api/a', undefined, { onUnauthorized });
    (globalThis.fetch as Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await httpRequest('/api/a', undefined, { onUnauthorized });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  // --- Error mapping + the never-throw contract ---------------------------------------

  it('prefers the body message, then statusText, then a status fallback', async () => {
    mockFetchOnce(404, { message: 'No such wall' }, 'Not Found');
    expect(await httpRequest('/api/a')).toEqual({ ok: false, status: 404, message: 'No such wall' });

    mockFetchOnce(404, { error: 'no message field' }, 'Not Found');
    expect(await httpRequest('/api/a')).toEqual({ ok: false, status: 404, message: 'Not Found' });

    // No parseable body, no statusText: the synthesized fallback.
    const response = {
      ok: false, status: 502, statusText: '', json: async () => { throw new Error('no body'); },
    } as unknown as Response;
    (globalThis.fetch as Mock).mockResolvedValueOnce(response);
    expect(await httpRequest('/api/a')).toEqual({
      ok: false, status: 502, message: 'Request failed with status 502',
    });
  });

  it('reports network failures as a typed status-0 result instead of throwing', async () => {
    (globalThis.fetch as Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await httpRequest('/api/a')).toEqual({ ok: false, status: 0, message: 'Failed to fetch' });
  });

  it('a 2xx with an unparseable body resolves ok with null data (e.g. a 204)', async () => {
    const response = {
      ok: true, status: 204, statusText: 'No Content', json: async () => { throw new Error('empty'); },
    } as unknown as Response;
    (globalThis.fetch as Mock).mockResolvedValueOnce(response);
    expect(await httpRequest('/api/a', { method: 'DELETE' })).toEqual({ ok: true, data: null });
  });
});

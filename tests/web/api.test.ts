import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import {
  getWall, getMenu, getDrinkers, getRecentPours, claimPour,
} from '../../src/web/lib/api';

function mockFetchOnce(status: number, body: unknown) {
  const ok = status >= 200 && status < 300;
  const response = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
  (globalThis.fetch as Mock).mockResolvedValueOnce(response);
}

describe('web api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getWall parses a successful response into a typed result', async () => {
    const payload = { wall: { slug: 'main', name: 'Main', config: {} }, taps: [], units: 'us' };
    mockFetchOnce(200, payload);

    const result = await getWall('main');

    expect(result).toEqual({ ok: true, data: payload });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/public/wall/main', expect.any(Object));
  });

  it('getWall reports a typed 404 instead of throwing', async () => {
    mockFetchOnce(404, { error: 'not_found', message: 'No such wall' });

    const result = await getWall('nope');

    expect(result).toEqual({ ok: false, status: 404, message: 'No such wall' });
  });

  it('getMenu parses a successful response', async () => {
    const payload = { siteName: 'My Taproom', taps: [], units: 'metric' };
    mockFetchOnce(200, payload);

    const result = await getMenu();

    expect(result).toEqual({ ok: true, data: payload });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/public/menu', expect.any(Object));
  });

  it('getDrinkers parses a successful response', async () => {
    const payload = [{ id: 1, displayName: 'Sam', avatarColor: '#f2c14e' }];
    mockFetchOnce(200, payload);

    const result = await getDrinkers();

    expect(result).toEqual({ ok: true, data: payload });
  });

  it('getRecentPours parses a successful response', async () => {
    const payload = [
      { id: 1, ts: '2026-07-28T00:00:00.000Z', volumeMl: 400, tapNumber: 1, beerName: 'Citra IPA' },
    ];
    mockFetchOnce(200, payload);

    const result = await getRecentPours();

    expect(result).toEqual({ ok: true, data: payload });
  });

  it('claimPour posts pourId/drinkerId and parses the claimed pour', async () => {
    const payload = {
      id: 1, kegId: 1, ts: '2026-07-28T00:00:00.000Z', volumeMl: 400,
      durationMs: null, source: 'cloud', drinkerId: 2,
    };
    mockFetchOnce(200, payload);

    const result = await claimPour(1, 2);

    expect(result).toEqual({ ok: true, data: payload });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/public/claim');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ pourId: 1, drinkerId: 2 });
  });

  it('claimPour reports a typed 409 conflict instead of throwing', async () => {
    mockFetchOnce(409, { error: 'conflict', message: 'Pour already claimed' });

    const result = await claimPour(1, 2);

    expect(result).toEqual({ ok: false, status: 409, message: 'Pour already claimed' });
  });

  it('reports network failures as a typed result instead of throwing', async () => {
    (globalThis.fetch as Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await getMenu();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message).toContain('Failed to fetch');
    }
  });
});

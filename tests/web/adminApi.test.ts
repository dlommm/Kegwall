import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  needsSetup, login, logout, getMe, setup,
  listBeers, createBeer, updateBeer, deleteBeer,
  lookupBreweries, lookupUntappd, importUntappdLabel, uploadLabel,
} from '../../src/web/lib/adminApi';

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

const originalLocation = window.location;
let assignMock: Mock;

function setPathname(pathname: string) {
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, pathname, assign: assignMock },
  });
}

describe('admin api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setPathname('/admin/beers');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('needsSetup parses a successful response', async () => {
    mockFetchOnce(200, { needsSetup: true });
    const result = await needsSetup();
    expect(result).toEqual({ ok: true, data: { needsSetup: true } });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/needs-setup', expect.any(Object));
  });

  it('getMe parses the current user on success', async () => {
    const user = {
      id: 1, username: 'dan', displayName: 'Dan', role: 'admin',
      isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
    };
    mockFetchOnce(200, user);
    const result = await getMe();
    expect(result).toEqual({ ok: true, data: user });
  });

  it('login posts credentials and parses the user on success', async () => {
    const user = {
      id: 1, username: 'dan', displayName: 'Dan', role: 'admin',
      isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
    };
    mockFetchOnce(200, user);
    const result = await login('dan', 'hunter22');
    expect(result).toEqual({ ok: true, data: user });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/auth/login');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ username: 'dan', password: 'hunter22' });
  });

  it('login reports a typed 401 for bad credentials', async () => {
    mockFetchOnce(401, { error: 'unauthorized', message: 'Bad username or password' });
    const result = await login('dan', 'nope');
    expect(result).toEqual({ ok: false, status: 401, message: 'Bad username or password' });
  });

  it('login reports a typed 429 when rate-limited', async () => {
    mockFetchOnce(429, { statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded' });
    const result = await login('dan', 'hunter22');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
  });

  it('logout posts and parses ok', async () => {
    mockFetchOnce(200, { ok: true });
    const result = await logout();
    expect(result).toEqual({ ok: true, data: { ok: true } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/auth/logout');
    expect(call[1].method).toBe('POST');
  });

  it('setup posts the first-admin payload and parses the created user', async () => {
    const user = {
      id: 1, username: 'dan', displayName: 'Dan', role: 'admin',
      isDrinker: true, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
    };
    mockFetchOnce(201, user);
    const result = await setup({ username: 'dan', displayName: 'Dan', password: 'hunter22' });
    expect(result).toEqual({ ok: true, data: user });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/auth/setup');
    expect(JSON.parse(call[1].body)).toEqual({ username: 'dan', displayName: 'Dan', password: 'hunter22' });
  });

  it('setup reports a typed 409 when setup already ran', async () => {
    mockFetchOnce(409, { error: 'conflict', message: 'Setup already completed' });
    const result = await setup({ username: 'dan', displayName: 'Dan', password: 'hunter22' });
    expect(result).toEqual({ ok: false, status: 409, message: 'Setup already completed' });
  });

  it('redirects to /admin/login on a 401 when not already on an auth page', async () => {
    setPathname('/admin/beers');
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    await getMe();
    expect(assignMock).toHaveBeenCalledWith('/admin/login');
  });

  it('does not redirect on a 401 while already on /admin/login (bad login attempt)', async () => {
    setPathname('/admin/login');
    mockFetchOnce(401, { error: 'unauthorized', message: 'Bad username or password' });
    await login('dan', 'nope');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('does not redirect on a 401 while already on /admin/setup', async () => {
    setPathname('/admin/setup');
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    await getMe();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('does not redirect for a non-401 error status', async () => {
    setPathname('/admin/beers');
    mockFetchOnce(500, { error: 'internal', message: 'Something went wrong' });
    await getMe();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('reports network failures as a typed result instead of throwing, without redirecting', async () => {
    setPathname('/admin/beers');
    (globalThis.fetch as Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await getMe();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message).toContain('Failed to fetch');
    }
    expect(assignMock).not.toHaveBeenCalled();
  });

  // --- Task 4: beers + lookup services ---

  const beer = {
    id: 1, name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA', abv: 6.5, ibu: 60,
    srm: 6, description: null, labelImage: null, createdAt: '2026-07-28T00:00:00.000Z',
  };

  it('listBeers GETs /api/beers', async () => {
    mockFetchOnce(200, [beer]);
    const result = await listBeers();
    expect(result).toEqual({ ok: true, data: [beer] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/beers', expect.any(Object));
  });

  it('createBeer POSTs the input and parses the created beer', async () => {
    mockFetchOnce(201, beer);
    const result = await createBeer({ name: 'Citra IPA' });
    expect(result).toEqual({ ok: true, data: beer });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/beers');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Citra IPA' });
  });

  it('updateBeer PATCHes /api/beers/:id', async () => {
    mockFetchOnce(200, beer);
    const result = await updateBeer(1, { abv: 7 });
    expect(result).toEqual({ ok: true, data: beer });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/beers/1');
    expect(call[1].method).toBe('PATCH');
  });

  it('deleteBeer DELETEs /api/beers/:id and reports a 409 conflict', async () => {
    mockFetchOnce(409, { error: 'conflict', message: 'beer 1 is referenced by 1 keg(s)' });
    const result = await deleteBeer(1);
    expect(result).toEqual({ ok: false, status: 409, message: 'beer 1 is referenced by 1 keg(s)' });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/beers/1');
    expect(call[1].method).toBe('DELETE');
  });

  it('lookupBreweries GETs /api/lookup/breweries with an encoded query', async () => {
    mockFetchOnce(200, [{ name: 'Modern Brew Co', city: 'Portland', state: 'Oregon' }]);
    const result = await lookupBreweries('modern brew');
    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/lookup/breweries?q=modern%20brew', expect.any(Object));
  });

  it('lookupUntappd reports a typed 501 when Untappd is not configured', async () => {
    mockFetchOnce(501, { error: 'not_configured', message: 'Untappd is not configured' });
    const result = await lookupUntappd('citra');
    expect(result).toEqual({ ok: false, status: 501, message: 'Untappd is not configured' });
  });

  it('lookupUntappd parses results when configured', async () => {
    const hit = {
      name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA', abv: 6.5, ibu: 60, labelUrl: 'https://x/label.png',
    };
    mockFetchOnce(200, [hit]);
    const result = await lookupUntappd('citra');
    expect(result).toEqual({ ok: true, data: [hit] });
  });

  it('importUntappdLabel POSTs the labelUrl and parses the stored path', async () => {
    mockFetchOnce(201, { path: '/labels/abc.png' });
    const result = await importUntappdLabel('https://x/label.png');
    expect(result).toEqual({ ok: true, data: { path: '/labels/abc.png' } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/lookup/untappd/import');
    expect(JSON.parse(call[1].body)).toEqual({ labelUrl: 'https://x/label.png' });
  });

  it('uploadLabel sends a FormData body without forcing a JSON content-type header', async () => {
    mockFetchOnce(201, { path: '/labels/xyz.jpg' });
    const file = new File(['fake-bytes'], 'label.jpg', { type: 'image/jpeg' });
    const result = await uploadLabel(file);
    expect(result).toEqual({ ok: true, data: { path: '/labels/xyz.jpg' } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/uploads/label');
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBeInstanceOf(FormData);
    expect(call[1].body.get('file')).toBe(file);
    expect(call[1].headers['Content-Type']).toBeUndefined();
  });
});

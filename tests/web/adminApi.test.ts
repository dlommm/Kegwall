import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  needsSetup, login, logout, getMe, setup,
  listBeers, createBeer, updateBeer, deleteBeer,
  lookupBreweries, uploadLabel, getLookupConfig,
  listSuppliers, getSupplierStats, getSupplierPriceBook, createSupplier, deleteSupplier,
  getGames, getActiveGame, startGameSession, endGameSession,
  listTaps, createTap, updateTap, deleteTap,
  listKegs, createKeg, removeOnDeckKeg, listOnDeck, swapTap,
  listMonitors, importKegtronBeer, resetKegtronVolume, bindMonitor, getMonitorTelemetry,
  getMonitorWifiRssi,
  listWalls, createWall, updateWall, deleteWall,
  listUsers, createLoginUser, createDrinkerProfile, updateUser, deleteUser,
  getSettings, patchSettings, uploadRestore,
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume, getSensors,
  getMonthlySpend, getPourHistory, getBeerHistory, getPourerHistory,
  getStatsTemps, getLeaderboard,
  listRecentPours, setPourDrinker, setPoursDrinker,
  listAutomations, getAutomation, createAutomation, updateAutomation, deleteAutomation,
  runAutomation, listAutomationTemplates, createFromTemplate, listAutomationChannels,
  listNotifications, getUnackedCount, ackNotification, ackAllNotifications, testChannel,
  getSystemVersion, checkForUpdates, triggerUpdate, pollSystemVersion,
  sanitizeNextPath, resetLoginRedirectForTests,
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
    // The 401 redirect latch is module state a real browser clears by unloading the
    // page on navigation; jsdom never navigates, so reset it between tests.
    resetLoginRedirectForTests();
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

  // Phase 5 Task 7: a real bug an actual browser round trip (Playwright's real Chromium
  // `fetch`, not this mocked one) caught — every bodyless POST/DELETE (logout, ack, run,
  // delete-*, etc.) unconditionally got `Content-Type: application/json` stamped on it
  // with NO body, which Fastify's default JSON parser rejects
  // (`FST_ERR_CTP_EMPTY_JSON_BODY`, statusCode 400 — mapped to an opaque 500 by this app's
  // generic error handler, since it isn't one of the recognized error classes). No prior
  // test caught this: every other `adminApi.test.ts` case here mocks `fetch` itself, so
  // none of them ever exercised a real server's body-parsing behavior. Fixed in
  // `request()`: the JSON content-type header is only set when a JSON body is actually
  // being sent — a request with no body has no content type to declare in the first
  // place, matching the FormData carve-out's own reasoning just above.
  it('a bodyless POST (e.g. logout) sends no Content-Type header at all', async () => {
    mockFetchOnce(200, { ok: true });
    await logout();
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[1].body).toBeUndefined();
    expect(call[1].headers['Content-Type']).toBeUndefined();
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

  it('redirects to /admin/login with the current page in ?next= on a 401', async () => {
    setPathname('/admin/beers');
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    await getMe();
    expect(assignMock).toHaveBeenCalledWith('/admin/login?next=%2Fadmin%2Fbeers');
  });

  it('redirects at most ONCE when several in-flight calls 401 together', async () => {
    setPathname('/admin/beers');
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    await Promise.all([getMe(), getSettings(), listBeers()]);
    expect(assignMock).toHaveBeenCalledTimes(1);
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

  it('sanitizeNextPath accepts only same-origin relative paths (open-redirect guard)', () => {
    expect(sanitizeNextPath('/admin/beers')).toBe('/admin/beers');
    expect(sanitizeNextPath('/admin/stats?days=30#kegs')).toBe('/admin/stats?days=30#kegs');
    // Everything below must fall back to null (LoginPage then lands on /admin).
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath('')).toBeNull();
    expect(sanitizeNextPath('https://evil.example/phish')).toBeNull();
    expect(sanitizeNextPath('//evil.example/phish')).toBeNull();
    // Browsers normalize backslashes to slashes, so /\evil.example is //evil.example.
    expect(sanitizeNextPath('/\\evil.example/phish')).toBeNull();
    expect(sanitizeNextPath('admin/beers')).toBeNull();
    expect(sanitizeNextPath('javascript:alert(1)')).toBeNull();
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

  it('getLookupConfig GETs /api/lookup/config', async () => {
    mockFetchOnce(200, { catalogBeerConfigured: false, autoImportBeers: true });
    await getLookupConfig();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/lookup/config', expect.any(Object));
  });

  it('listSuppliers GETs /api/suppliers', async () => {
    mockFetchOnce(200, []);
    await listSuppliers();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/suppliers', expect.any(Object));
  });

  it('getGames and getActiveGame hit the games endpoints', async () => {
    mockFetchOnce(200, []);
    await getGames();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/games', expect.any(Object));
    mockFetchOnce(200, null);
    await getActiveGame();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/games/active', expect.any(Object));
  });

  it('startGameSession POSTs and endGameSession POSTs to /end', async () => {
    mockFetchOnce(201, null);
    await startGameSession({ gameId: 5 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/games/sessions', expect.objectContaining({ method: 'POST' }));
    mockFetchOnce(200, { id: 9 });
    await endGameSession(9);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/games/sessions/9/end', expect.objectContaining({ method: 'POST' }));
  });

  it('getSupplierStats and getSupplierPriceBook hit their endpoints', async () => {
    mockFetchOnce(200, { supplierCount: 0, kegsPurchased: 0, ytdSpendCents: 0 });
    await getSupplierStats();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/suppliers/stats', expect.any(Object));
    mockFetchOnce(200, []);
    await getSupplierPriceBook(5);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/suppliers/5/pricebook', expect.any(Object));
  });

  it('createSupplier POSTs and deleteSupplier DELETEs', async () => {
    mockFetchOnce(201, { id: 1, name: 'Joes' });
    await createSupplier({ name: 'Joes' });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/suppliers', expect.objectContaining({ method: 'POST' }));
    mockFetchOnce(204, null);
    await deleteSupplier(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/suppliers/1', expect.objectContaining({ method: 'DELETE' }));
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

  // --- Task 5: taps & kegs ---

  const tap = { id: 1, number: 1, name: 'Left', defaultDrinkerId: null };
  const keg = {
    id: 5, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0,
    dateTapped: null, status: 'on_tap', createdAt: '2026-07-28T00:00:00.000Z',
  };

  it('listTaps GETs /api/taps', async () => {
    mockFetchOnce(200, [tap]);
    const result = await listTaps();
    expect(result).toEqual({ ok: true, data: [tap] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/taps', expect.any(Object));
  });

  it('createTap POSTs the input', async () => {
    mockFetchOnce(201, tap);
    const result = await createTap({ number: 1, name: 'Left' });
    expect(result).toEqual({ ok: true, data: tap });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/taps');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ number: 1, name: 'Left' });
  });

  it('updateTap PATCHes /api/taps/:id', async () => {
    mockFetchOnce(200, tap);
    const result = await updateTap(1, { name: 'Right' });
    expect(result).toEqual({ ok: true, data: tap });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/taps/1');
    expect(call[1].method).toBe('PATCH');
  });

  it('createTap/updateTap forward defaultDrinkerId (Phase 5 Task 0)', async () => {
    mockFetchOnce(201, { ...tap, defaultDrinkerId: 9 });
    await createTap({ number: 1, defaultDrinkerId: 9 });
    expect(JSON.parse((globalThis.fetch as Mock).mock.calls[0]![1].body)).toEqual({ number: 1, defaultDrinkerId: 9 });

    mockFetchOnce(200, { ...tap, defaultDrinkerId: null });
    await updateTap(1, { defaultDrinkerId: null });
    expect(JSON.parse((globalThis.fetch as Mock).mock.calls[1]![1].body)).toEqual({ defaultDrinkerId: null });
  });

  it('deleteTap DELETEs /api/taps/:id and reports a 409 conflict', async () => {
    mockFetchOnce(409, { error: 'conflict', message: "tap 1 has keg history (2 keg(s) on record) and can't be deleted" });
    const result = await deleteTap(1);
    expect(result).toEqual({ ok: false, status: 409, message: "tap 1 has keg history (2 keg(s) on record) and can't be deleted" });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/taps/1');
    expect(call[1].method).toBe('DELETE');
  });

  it('listKegs GETs /api/kegs with no status filter by default', async () => {
    mockFetchOnce(200, [keg]);
    const result = await listKegs();
    expect(result).toEqual({ ok: true, data: [keg] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/kegs', expect.any(Object));
  });

  it('listKegs GETs /api/kegs?status=... when a status filter is given', async () => {
    mockFetchOnce(200, []);
    await listKegs({ status: 'kicked' });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/kegs?status=kicked', expect.any(Object));
  });

  it('createKeg POSTs the input, including on-deck status', async () => {
    mockFetchOnce(201, { ...keg, status: 'on_deck' });
    const result = await createKeg({
      beerId: 1, sizeMl: 19000, volStartMl: 19000, tapId: 1, status: 'on_deck',
    });
    expect(result.ok).toBe(true);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/kegs');
    expect(JSON.parse(call[1].body)).toEqual({
      beerId: 1, sizeMl: 19000, volStartMl: 19000, tapId: 1, status: 'on_deck',
    });
  });

  it('removeOnDeckKeg DELETEs /api/kegs/:id and reports a 400 for a non-on_deck keg', async () => {
    mockFetchOnce(400, { error: 'validation', message: 'keg 5 is not on-deck (status: on_tap) and cannot be removed this way' });
    const result = await removeOnDeckKeg(5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/kegs/5');
    expect(call[1].method).toBe('DELETE');
  });

  it('listOnDeck GETs /api/taps/:id/on-deck', async () => {
    mockFetchOnce(200, [keg]);
    const result = await listOnDeck(1);
    expect(result).toEqual({ ok: true, data: [keg] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/taps/1/on-deck', expect.any(Object));
  });

  it('swapTap POSTs a new-keg payload to /api/taps/:id/swap', async () => {
    mockFetchOnce(201, keg);
    const result = await swapTap(1, { beerId: 1, sizeMl: 19000, volStartMl: 19000 });
    expect(result).toEqual({ ok: true, data: keg });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/taps/1/swap');
    expect(JSON.parse(call[1].body)).toEqual({ beerId: 1, sizeMl: 19000, volStartMl: 19000 });
  });

  it('swapTap POSTs a fromKegId payload for the promote path', async () => {
    mockFetchOnce(201, keg);
    await swapTap(1, { fromKegId: 5 });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(JSON.parse(call[1].body)).toEqual({ fromKegId: 5 });
  });

  it('listMonitors GETs /api/monitors', async () => {
    const monitor = {
      id: 1, type: 'kegtron_pro', identifier: 'device1', serial: 'SN1', portIndex: 0,
      tapId: 1, lastSeen: null, meta: {},
    };
    mockFetchOnce(200, [monitor]);
    const result = await listMonitors();
    expect(result).toEqual({ ok: true, data: [monitor] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/monitors', expect.any(Object));
  });

  it('importKegtronBeer POSTs /api/kegtron/import/:monitorId', async () => {
    mockFetchOnce(201, beer);
    const result = await importKegtronBeer(3);
    expect(result).toEqual({ ok: true, data: beer });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/kegtron/import/3');
    expect(call[1].method).toBe('POST');
  });

  it('resetKegtronVolume POSTs /api/kegtron/reset-volume/:monitorId and reports a gentle 502', async () => {
    mockFetchOnce(502, { error: 'mdash_error', message: 'Failed to reset volume via mdash.net (status 503)' });
    const result = await resetKegtronVolume(3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/kegtron/reset-volume/3');
    expect(call[1].method).toBe('POST');
  });

  it('bindMonitor POSTs /api/monitors/:id/bind with a numeric tapId', async () => {
    const monitor = {
      id: 1, type: 'kegtron_pro', identifier: 'device1', serial: 'SN1', portIndex: 0,
      tapId: 4, lastSeen: null, meta: {},
    };
    mockFetchOnce(200, monitor);
    const result = await bindMonitor(1, 4);
    expect(result).toEqual({ ok: true, data: monitor });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/monitors/1/bind');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ tapId: 4 });
  });

  it('bindMonitor POSTs a null tapId to unbind', async () => {
    const monitor = {
      id: 1, type: 'kegtron_pro', identifier: 'device1', serial: 'SN1', portIndex: 0,
      tapId: null, lastSeen: null, meta: {},
    };
    mockFetchOnce(200, monitor);
    await bindMonitor(1, null);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(JSON.parse(call[1].body)).toEqual({ tapId: null });
  });

  it('getMonitorTelemetry GETs /api/monitors/:id/telemetry with an hours param, defaulting to 24', async () => {
    const points = [{ ts: '2026-07-27T20:00:00.000Z', temp: 4.2, humidity: 50 }];
    mockFetchOnce(200, points);
    const result = await getMonitorTelemetry(1);
    expect(result).toEqual({ ok: true, data: points });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/monitors/1/telemetry?hours=24', expect.any(Object));
  });

  it('getMonitorTelemetry passes a custom hours value through', async () => {
    mockFetchOnce(200, []);
    await getMonitorTelemetry(1, 48);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/monitors/1/telemetry?hours=48', expect.any(Object));
  });

  it('getMonitorWifiRssi POSTs /api/kegtron/wifi-rssi/:monitorId (Phase 5 Task 0)', async () => {
    mockFetchOnce(200, { rssi: -52 });
    const result = await getMonitorWifiRssi(1);
    expect(result).toEqual({ ok: true, data: { rssi: -52 } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/kegtron/wifi-rssi/1');
    expect(call[1].method).toBe('POST');
  });

  // --- Task 7: walls ---

  const wall = {
    id: 1, slug: 'main-bar', name: 'Main bar', config: { columns: 2 },
  };

  it('listWalls GETs /api/walls', async () => {
    mockFetchOnce(200, [wall]);
    const result = await listWalls();
    expect(result).toEqual({ ok: true, data: [wall] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/walls', expect.any(Object));
  });

  it('createWall POSTs the input', async () => {
    mockFetchOnce(201, wall);
    const result = await createWall({ slug: 'main-bar', name: 'Main bar' });
    expect(result).toEqual({ ok: true, data: wall });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/walls');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ slug: 'main-bar', name: 'Main bar' });
  });

  it('updateWall PATCHes /api/walls/:id with slug/name/config', async () => {
    mockFetchOnce(200, wall);
    const result = await updateWall(1, { name: 'Front bar', config: { columns: 3 } });
    expect(result).toEqual({ ok: true, data: wall });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/walls/1');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Front bar', config: { columns: 3 } });
  });

  it('deleteWall DELETEs /api/walls/:id', async () => {
    mockFetchOnce(204, null);
    const result = await deleteWall(1);
    expect(result).toEqual({ ok: true, data: null });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/walls/1');
    expect(call[1].method).toBe('DELETE');
  });

  // --- Task 8: users, settings, backup ---

  const loginUser = {
    id: 2, username: 'ed', displayName: 'Ed', role: 'editor',
    isDrinker: false, avatarColor: '#ff8800', createdAt: '2026-07-28T00:00:00.000Z',
  };
  const drinker = {
    id: 3, username: null, displayName: 'Drinker Dan', role: null,
    isDrinker: true, avatarColor: '#00aaff', createdAt: '2026-07-28T00:00:00.000Z',
  };

  it('listUsers GETs /api/users', async () => {
    mockFetchOnce(200, [loginUser, drinker]);
    const result = await listUsers();
    expect(result).toEqual({ ok: true, data: [loginUser, drinker] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/users', expect.any(Object));
  });

  it('createLoginUser POSTs username/password/role, no drinkerOnly flag', async () => {
    mockFetchOnce(201, loginUser);
    const result = await createLoginUser({
      username: 'ed', displayName: 'Ed', password: 'password1', role: 'editor',
    });
    expect(result).toEqual({ ok: true, data: loginUser });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/users');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({
      username: 'ed', displayName: 'Ed', password: 'password1', role: 'editor',
    });
    expect(body.drinkerOnly).toBeUndefined();
  });

  it('createDrinkerProfile POSTs displayName/avatarColor with drinkerOnly: true', async () => {
    mockFetchOnce(201, drinker);
    const result = await createDrinkerProfile({ displayName: 'Drinker Dan', avatarColor: '#00aaff' });
    expect(result).toEqual({ ok: true, data: drinker });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/users');
    expect(JSON.parse(call[1].body)).toEqual({
      displayName: 'Drinker Dan', avatarColor: '#00aaff', drinkerOnly: true,
    });
  });

  it('updateUser PATCHes /api/users/:id', async () => {
    mockFetchOnce(200, { ...loginUser, displayName: 'Edward' });
    const result = await updateUser(2, { displayName: 'Edward' });
    expect(result.ok).toBe(true);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/users/2');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ displayName: 'Edward' });
  });

  it('deleteUser DELETEs /api/users/:id and reports the last-admin 409 clearly', async () => {
    mockFetchOnce(409, { error: 'conflict', message: 'cannot delete the last admin' });
    const result = await deleteUser(1);
    expect(result).toEqual({ ok: false, status: 409, message: 'cannot delete the last admin' });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/users/1');
    expect(call[1].method).toBe('DELETE');
  });

  const settings = {
    siteName: 'My Taproom', siteLogo: null, displayUnits: 'us', servingSizeMl: 473,
    kegtronApiKey: '••••ikey', kegtronBaseUrl: 'https://mdash.net',
    openBreweryBaseUrl: 'https://api.openbrewerydb.org',
    backfillCursors: {}, udpEnabled: false, bleDirectEnabled: false, mqtt: null,
    quietHours: null,
  };

  it('getSettings GETs /api/settings', async () => {
    mockFetchOnce(200, settings);
    const result = await getSettings();
    expect(result).toEqual({ ok: true, data: settings });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/settings', expect.any(Object));
  });

  it('patchSettings PATCHes only the keys passed in', async () => {
    mockFetchOnce(200, { ...settings, siteName: 'Renamed' });
    const result = await patchSettings({ siteName: 'Renamed' });
    expect(result.ok).toBe(true);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/settings');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ siteName: 'Renamed' });
  });

  it('uploadRestore sends a FormData body without forcing a JSON content-type header', async () => {
    mockFetchOnce(200, { ok: true, message: 'Restore staged. Restart the server to apply it.' });
    const file = new File(['fake-db-bytes'], 'backup.db', { type: 'application/octet-stream' });
    const result = await uploadRestore(file);
    expect(result).toEqual({
      ok: true, data: { ok: true, message: 'Restore staged. Restart the server to apply it.' },
    });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/admin/restore');
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBeInstanceOf(FormData);
    expect(call[1].body.get('file')).toBe(file);
    expect(call[1].headers['Content-Type']).toBeUndefined();
  });

  it('uploadRestore reports a typed 400 for a bad magic header', async () => {
    mockFetchOnce(400, { error: 'validation', message: "That file doesn't look like a SQLite database (bad header)" });
    const file = new File(['not a db'], 'fake.db');
    const result = await uploadRestore(file);
    expect(result).toEqual({
      ok: false, status: 400, message: "That file doesn't look like a SQLite database (bad header)",
    });
  });

  // --- Task 9: stats ---

  it('getPoursByDay GETs /api/stats/pours with a days param', async () => {
    const rows = [{ date: '2026-07-27', count: 3, volumeMl: 900 }];
    mockFetchOnce(200, rows);
    const result = await getPoursByDay(7);
    expect(result).toEqual({ ok: true, data: rows });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/pours?days=7', expect.any(Object));
  });

  it('getHourHistogram GETs /api/stats/hours', async () => {
    mockFetchOnce(200, []);
    await getHourHistogram();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/hours', expect.any(Object));
  });

  it('getActiveKegStats GETs /api/stats/kegs', async () => {
    mockFetchOnce(200, []);
    await getActiveKegStats();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/kegs', expect.any(Object));
  });

  it('getMonthlySpend and getPourHistory hit the analytics endpoints', async () => {
    mockFetchOnce(200, []);
    await getMonthlySpend();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/monthly-spend', expect.any(Object));
    mockFetchOnce(200, []);
    await getPourHistory(30);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/pour-history?days=30', expect.any(Object));
  });

  it('getBeerHistory and getPourerHistory hit their endpoints', async () => {
    mockFetchOnce(200, []);
    await getBeerHistory();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/beer-history', expect.any(Object));
    mockFetchOnce(200, []);
    await getPourerHistory();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/pourer-history', expect.any(Object));
  });

  it('getSensors GETs /api/sensors', async () => {
    mockFetchOnce(200, []);
    await getSensors();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/sensors', expect.any(Object));
  });

  it('getBeersByVolume GETs /api/stats/beers with a days param', async () => {
    mockFetchOnce(200, []);
    await getBeersByVolume(90);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/beers?days=90', expect.any(Object));
  });

  it('getStatsTemps GETs /api/stats/temps with monitorId and hours, defaulting hours to 48', async () => {
    mockFetchOnce(200, []);
    await getStatsTemps(5);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/temps?monitorId=5&hours=48', expect.any(Object));
  });

  it('getStatsTemps passes a custom hours value through', async () => {
    mockFetchOnce(200, []);
    await getStatsTemps(5, 72);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/temps?monitorId=5&hours=72', expect.any(Object));
  });

  it('getLeaderboard GETs /api/stats/leaderboard with a window param', async () => {
    mockFetchOnce(200, []);
    await getLeaderboard('month');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats/leaderboard?window=month', expect.any(Object));
  });

  // --- Phase 5 Task 0: pours admin (reassign/unclaim) ---

  it('listRecentPours GETs /api/pours?limit=100', async () => {
    const pour = {
      id: 1, kegId: 1, ts: '2026-07-28T00:00:00.000Z', volumeMl: 400,
      durationMs: null, source: 'cloud', drinkerId: null,
    };
    mockFetchOnce(200, [pour]);
    const result = await listRecentPours();
    expect(result).toEqual({ ok: true, data: [pour] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/pours?limit=100', expect.any(Object));
  });

  it('listRecentPours encodes filters and the load-more cursor', async () => {
    mockFetchOnce(200, []);
    await listRecentPours({
      unclaimed: true, drinkerId: 7, since: '2026-09-01T04:00:00.000Z', beforeId: 42, limit: 50,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/pours?limit=50&unclaimed=true&drinkerId=7&since=2026-09-01T04%3A00%3A00.000Z&beforeId=42',
      expect.any(Object),
    );
  });

  it('setPoursDrinker PATCHes the bulk endpoint', async () => {
    mockFetchOnce(200, []);
    await setPoursDrinker([1, 2], null);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/pours/drinker', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ pourIds: [1, 2], drinkerId: null }),
    }));
  });

  it('setPourDrinker PATCHes /api/pours/:id/drinker', async () => {
    const pour = {
      id: 1, kegId: 1, ts: '2026-07-28T00:00:00.000Z', volumeMl: 400,
      durationMs: null, source: 'cloud', drinkerId: 9,
    };
    mockFetchOnce(200, pour);
    const result = await setPourDrinker(1, 9);
    expect(result).toEqual({ ok: true, data: pour });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/pours/1/drinker');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ drinkerId: 9 });
  });

  it('setPourDrinker(id, null) unclaims', async () => {
    const pour = {
      id: 1, kegId: 1, ts: '2026-07-28T00:00:00.000Z', volumeMl: 400,
      durationMs: null, source: 'cloud', drinkerId: null,
    };
    mockFetchOnce(200, pour);
    await setPourDrinker(1, null);
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(JSON.parse(call[1].body)).toEqual({ drinkerId: null });
  });

  // --- Task 6: automations + notification center + channel send-test ---

  const rule = {
    id: 1, name: 'Keg low', enabled: true, isAlert: true,
    trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
    conditions: [], actions: [], alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
    lastFiredAt: null,
  };

  it('listAutomations GETs /api/automations', async () => {
    mockFetchOnce(200, [rule]);
    const result = await listAutomations();
    expect(result).toEqual({ ok: true, data: [rule] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/automations', expect.any(Object));
  });

  it('getAutomation GETs /api/automations/:id', async () => {
    mockFetchOnce(200, rule);
    const result = await getAutomation(1);
    expect(result).toEqual({ ok: true, data: rule });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/automations/1', expect.any(Object));
  });

  it('createAutomation POSTs the rule input', async () => {
    mockFetchOnce(201, rule);
    const input = { name: 'Keg low', trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' } };
    const result = await createAutomation(input as any);
    expect(result).toEqual({ ok: true, data: rule });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/automations');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual(input);
  });

  it('updateAutomation PATCHes /api/automations/:id', async () => {
    mockFetchOnce(200, rule);
    const result = await updateAutomation(1, { enabled: false });
    expect(result).toEqual({ ok: true, data: rule });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/automations/1');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ enabled: false });
  });

  it('deleteAutomation DELETEs /api/automations/:id', async () => {
    mockFetchOnce(204, null);
    const result = await deleteAutomation(1);
    expect(result).toEqual({ ok: true, data: null });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/automations/1');
    expect(call[1].method).toBe('DELETE');
  });

  it('runAutomation POSTs /api/automations/:id/run', async () => {
    mockFetchOnce(200, { results: [{ type: 'wall_banner', ok: true }] });
    const result = await runAutomation(1);
    expect(result).toEqual({ ok: true, data: { results: [{ type: 'wall_banner', ok: true }] } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/automations/1/run');
    expect(call[1].method).toBe('POST');
  });

  it('listAutomationTemplates GETs /api/automations/templates', async () => {
    mockFetchOnce(200, [{ id: 'keg_low', label: 'Keg low', description: 'x', params: [] }]);
    const result = await listAutomationTemplates();
    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/automations/templates', expect.any(Object));
  });

  it('createFromTemplate POSTs /api/automations/from-template', async () => {
    mockFetchOnce(201, { automations: [rule] });
    const result = await createFromTemplate('keg_low', { thresholdPct: 25 });
    expect(result).toEqual({ ok: true, data: { automations: [rule] } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/automations/from-template');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ template: 'keg_low', params: { thresholdPct: 25 } });
  });

  it('listAutomationChannels GETs /api/automations/channels', async () => {
    mockFetchOnce(200, [{ name: 'inApp', label: 'In-app' }]);
    const result = await listAutomationChannels();
    expect(result).toEqual({ ok: true, data: [{ name: 'inApp', label: 'In-app' }] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/automations/channels', expect.any(Object));
  });

  const notification = {
    id: 1, automationId: null, ts: '2026-07-28T00:00:00.000Z', severity: 'info', title: 'X', body: null, acked: false,
  };

  it('listNotifications GETs /api/notifications with no params by default', async () => {
    mockFetchOnce(200, [notification]);
    const result = await listNotifications();
    expect(result).toEqual({ ok: true, data: [notification] });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notifications', expect.any(Object));
  });

  it('listNotifications forwards limit/before as query params', async () => {
    mockFetchOnce(200, [notification]);
    await listNotifications({ limit: 10, before: 5 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notifications?limit=10&before=5', expect.any(Object));
  });

  it('getUnackedCount GETs /api/notifications/unacked-count', async () => {
    mockFetchOnce(200, { count: 3 });
    const result = await getUnackedCount();
    expect(result).toEqual({ ok: true, data: { count: 3 } });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notifications/unacked-count', expect.any(Object));
  });

  it('ackNotification POSTs /api/notifications/:id/ack', async () => {
    mockFetchOnce(200, { ...notification, acked: true });
    const result = await ackNotification(1);
    expect(result).toEqual({ ok: true, data: { ...notification, acked: true } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/notifications/1/ack');
    expect(call[1].method).toBe('POST');
  });

  it('ackAllNotifications POSTs /api/notifications/ack-all', async () => {
    mockFetchOnce(200, { count: 2 });
    const result = await ackAllNotifications();
    expect(result).toEqual({ ok: true, data: { count: 2 } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/notifications/ack-all');
    expect(call[1].method).toBe('POST');
  });

  it('testChannel POSTs /api/channels/:name/test', async () => {
    mockFetchOnce(200, { ok: true });
    const result = await testChannel('ntfy');
    expect(result).toEqual({ ok: true, data: { ok: true } });
    const call = (globalThis.fetch as Mock).mock.calls[0]!;
    expect(call[0]).toBe('/api/channels/ntfy/test');
    expect(call[1].method).toBe('POST');
  });

  it('getSystemVersion GETs, checkForUpdates and triggerUpdate POST the system routes', async () => {
    mockFetchOnce(200, { version: '1.2.3' });
    await getSystemVersion();
    expect((globalThis.fetch as Mock).mock.calls[0]![0]).toBe('/api/system/version');

    mockFetchOnce(200, { ok: true, current: '1.2.3', latest: '1.3.0', updateAvailable: true, notesUrl: 'x' });
    await checkForUpdates();
    let call = (globalThis.fetch as Mock).mock.calls[1]!;
    expect(call[0]).toBe('/api/system/update-check');
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBe('{}');

    mockFetchOnce(202, { mode: 'native' });
    await triggerUpdate('1.3.0');
    call = (globalThis.fetch as Mock).mock.calls[2]!;
    expect(call[0]).toBe('/api/system/update');
    expect(JSON.parse(call[1].body)).toEqual({ version: '1.3.0' });
  });

  it('pollSystemVersion swallows every failure as null (raw fetch, no 401 redirect)', async () => {
    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('down'));
    expect(await pollSystemVersion()).toBeNull();

    mockFetchOnce(401, { message: 'nope' });
    expect(await pollSystemVersion()).toBeNull();

    mockFetchOnce(200, { version: '1.3.0' });
    expect(await pollSystemVersion()).toBe('1.3.0');
  });
});

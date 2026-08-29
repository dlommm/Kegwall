import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { getPoursSince } from '../../../src/web/lib/admin/dashboard';

/** Minimal wire-shaped pour row (only the fields pagination itself reads). */
function makePour(id: number, ts: string, volumeMl = 400) {
  return {
    id, kegId: 1, ts, volumeMl, durationMs: 8000, source: 'udp', drinkerId: null, quality: null, rating: null, ratingTags: null,
  };
}

function mockFetchOnce(body: unknown, status = 200) {
  const ok = status >= 200 && status < 300;
  (globalThis.fetch as Mock).mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response);
}

const SINCE = '2026-08-29T00:00:00.000Z';

describe('getPoursSince (dashboard "today\'s pours" pagination)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a single page when the day fits under the 2000-row endpoint cap', async () => {
    const pours = [makePour(2, '2026-08-29T12:00:00.000Z'), makePour(1, '2026-08-29T09:00:00.000Z')];
    mockFetchOnce(pours);

    const result = await getPoursSince(SINCE);
    expect(result).toEqual({ ok: true, data: pours });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = (globalThis.fetch as Mock).mock.calls[0]![0] as string;
    expect(url).toContain('/api/pours?');
    expect(url).toContain(`since=${encodeURIComponent(SINCE)}`);
    expect(url).toContain('limit=2000');
    expect(url).not.toContain('until=');
  });

  it('walks past the 2000-row cap via `until` and de-duplicates the boundary row', async () => {
    // Page 1: a FULL page, newest-first, ids 4000..2001; the oldest row sets `until`.
    const page1 = Array.from({ length: 2000 }, (_, i) =>
      makePour(4000 - i, new Date(Date.UTC(2026, 7, 29, 12, 0, 0, 100_000 - i)).toISOString()));
    const boundaryTs = page1[page1.length - 1]!.ts;
    // Page 2: starts with the boundary row again (inclusive `until`), then older rows.
    const page2 = [
      makePour(2001, boundaryTs), // duplicate of page 1's oldest — must not double-count
      makePour(2000, '2026-08-29T05:00:00.000Z'),
      makePour(1999, '2026-08-29T04:00:00.000Z'),
    ];
    mockFetchOnce(page1);
    mockFetchOnce(page2);

    const result = await getPoursSince(SINCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 2000 unique from page 1 + 2 new from page 2 (boundary row de-duplicated by id).
    expect(result.data).toHaveLength(2002);
    expect(new Set(result.data.map((p) => p.id)).size).toBe(2002);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const secondUrl = (globalThis.fetch as Mock).mock.calls[1]![0] as string;
    expect(secondUrl).toContain(`since=${encodeURIComponent(SINCE)}`);
    expect(secondUrl).toContain(`until=${encodeURIComponent(boundaryTs)}`);
  });

  it('stops when a full page cannot advance the cursor (all rows share one timestamp)', async () => {
    const sameTs = '2026-08-29T10:00:00.000Z';
    mockFetchOnce(Array.from({ length: 2000 }, (_, i) => makePour(i + 1, sameTs)));
    mockFetchOnce(Array.from({ length: 2000 }, (_, i) => makePour(i + 1, sameTs)));

    const result = await getPoursSince(SINCE);
    expect(result.ok).toBe(true);
    // Two calls (initial + one until-page), then the unmoved cursor bails the loop.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails the whole read when any page fails, so stale totals are kept instead of understated ones', async () => {
    mockFetchOnce(Array.from({ length: 2000 }, (_, i) =>
      makePour(4000 - i, new Date(Date.UTC(2026, 7, 29, 12, 0, 0, 100_000 - i)).toISOString())));
    mockFetchOnce({ error: 'boom' }, 500);

    const result = await getPoursSince(SINCE);
    expect(result.ok).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

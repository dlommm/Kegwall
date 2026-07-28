import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../src/web/lib/api', () => ({ getWall: vi.fn() }));
vi.mock('../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));

import { getWall } from '../../src/web/lib/api';
import { useTapStates } from '../../src/web/lib/useTapStates';
import { useWallData } from '../../src/web/lib/useWallData';

const baseTapStatesResult = {
  taps: [], stale: false, connected: true, reconnectCount: 0,
};

describe('useWallData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useTapStates as Mock).mockReturnValue(baseTapStatesResult);
  });

  it('fetches wall config and seeds initial taps via getWall', async () => {
    const taps = [{ tapId: 1 }];
    const wall = { slug: 'main', name: 'Main', config: {} };
    (getWall as Mock).mockResolvedValue({ ok: true, data: { wall, taps } });

    const { result } = renderHook(() => useWallData('main'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.wall).toEqual(wall);
    expect(result.current.error).toBeNull();
    expect(getWall).toHaveBeenCalledWith('main');
    expect(getWall).toHaveBeenCalledTimes(1);
  });

  it('surfaces a typed error without throwing when getWall 404s', async () => {
    (getWall as Mock).mockResolvedValue({ ok: false, status: 404, message: 'No such wall' });

    const { result } = renderHook(() => useWallData('nope'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.wall).toBeNull();
    expect(result.current.error).toBe('No such wall');
  });

  it('refetches wall config when useTapStates reports a reconnect', async () => {
    const wall1 = { slug: 'main', name: 'Main', config: { theme: { id: 'taproom' } } };
    const wall2 = { slug: 'main', name: 'Main Renamed', config: { theme: { id: 'taproom' } } };
    (getWall as Mock)
      .mockResolvedValueOnce({ ok: true, data: { wall: wall1, taps: [] } })
      .mockResolvedValueOnce({ ok: true, data: { wall: wall2, taps: [] } });

    const { result, rerender } = renderHook(() => useWallData('main'));
    await waitFor(() => expect(result.current.wall).toEqual(wall1));
    expect(getWall).toHaveBeenCalledTimes(1);

    (useTapStates as Mock).mockReturnValue({ ...baseTapStatesResult, reconnectCount: 1 });
    rerender();

    await waitFor(() => expect(result.current.wall).toEqual(wall2));
    expect(getWall).toHaveBeenCalledTimes(2);
  });

  it('does not refetch on the initial render even though reconnectCount starts at 0', async () => {
    (getWall as Mock).mockResolvedValue({
      ok: true, data: { wall: { slug: 'main', name: 'Main', config: {} }, taps: [] },
    });

    renderHook(() => useWallData('main'));

    await waitFor(() => expect(getWall).toHaveBeenCalledTimes(1));
    // give any spurious effect a chance to fire before asserting it never grew
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getWall).toHaveBeenCalledTimes(1);
  });

  it('exposes live taps/stale/connected straight from useTapStates', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [{ tapId: 1 }], stale: true, connected: false, reconnectCount: 0,
    });
    (getWall as Mock).mockResolvedValue({
      ok: true, data: { wall: { slug: 'main', name: 'Main', config: {} }, taps: [] },
    });

    const { result } = renderHook(() => useWallData('main'));

    expect(result.current.taps).toEqual([{ tapId: 1 }]);
    expect(result.current.stale).toBe(true);
    expect(result.current.connected).toBe(false);
  });

  it('refetches when the slug changes', async () => {
    const wallMain = { slug: 'main', name: 'Main', config: {} };
    const wallPatio = { slug: 'patio', name: 'Patio', config: {} };
    (getWall as Mock).mockImplementation((slug: string) => Promise.resolve({
      ok: true,
      data: { wall: slug === 'main' ? wallMain : wallPatio, taps: [] },
    }));

    const { result, rerender } = renderHook(({ slug }) => useWallData(slug), {
      initialProps: { slug: 'main' },
    });
    await waitFor(() => expect(result.current.wall).toEqual(wallMain));

    rerender({ slug: 'patio' });
    await waitFor(() => expect(result.current.wall).toEqual(wallPatio));
    expect(getWall).toHaveBeenCalledWith('patio');
  });
});

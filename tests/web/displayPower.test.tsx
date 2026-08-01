import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  postPresenceWake: vi.fn(),
}));

import { postPresenceWake } from '../../src/web/lib/api';
import { isDisplayPowerMessage, useDisplayPower } from '../../src/web/lib/displayPower';

describe('isDisplayPowerMessage', () => {
  it('recognizes a well-formed display_power frame', () => {
    expect(isDisplayPowerMessage({ type: 'display_power', wallSlug: 'main', state: 'off' })).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    ['nope'],
    [{ type: 'banner' }],
    [{ type: 'display_power', wallSlug: 'main' }], // missing state
    [{ type: 'display_power', state: 'off' }], // missing wallSlug
    [{ type: 'display_power', wallSlug: 'main', state: 'sideways' }], // invalid state
  ])('rejects %j', (msg) => {
    expect(isDisplayPowerMessage(msg)).toBe(false);
  });
});

describe('useDisplayPower', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (postPresenceWake as Mock).mockResolvedValue(undefined);
  });

  it('starts in the "active" stage', () => {
    const { result } = renderHook(() => useDisplayPower('main'));
    expect(result.current.stage).toBe('active');
  });

  it('flips stage on a matching-slug display_power WS frame', () => {
    const { result } = renderHook(() => useDisplayPower('main'));

    act(() => {
      result.current.onWsMessage({ type: 'display_power', wallSlug: 'main', state: 'off' });
    });
    expect(result.current.stage).toBe('off');

    act(() => {
      result.current.onWsMessage({ type: 'display_power', wallSlug: 'main', state: 'screensaver' });
    });
    expect(result.current.stage).toBe('screensaver');
  });

  it('ignores a display_power frame for a different wall slug', () => {
    const { result } = renderHook(() => useDisplayPower('main'));

    act(() => {
      result.current.onWsMessage({ type: 'display_power', wallSlug: 'patio', state: 'off' });
    });
    expect(result.current.stage).toBe('active');
  });

  it('ignores messages of an unrecognized shape without throwing', () => {
    const { result } = renderHook(() => useDisplayPower('main'));
    expect(() => {
      act(() => { result.current.onWsMessage({ type: 'banner', text: 'hi' }); });
    }).not.toThrow();
    expect(result.current.stage).toBe('active');
  });

  it('onWsMessage has a stable identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useDisplayPower('main'));
    const first = result.current.onWsMessage;
    rerender();
    expect(result.current.onWsMessage).toBe(first);
  });

  it('wake() defaults to a "touch" source and posts for the current wall slug', () => {
    const { result } = renderHook(() => useDisplayPower('main'));
    act(() => { result.current.wake(); });
    expect(postPresenceWake).toHaveBeenCalledWith('main', 'touch');
  });

  it('wake() forwards an explicit source', () => {
    const { result } = renderHook(() => useDisplayPower('main'));
    act(() => { result.current.wake('camera'); });
    expect(postPresenceWake).toHaveBeenCalledWith('main', 'camera');
  });

  it('wake() posts wall=undefined when the hook has no slug (e.g. admin wake-all)', () => {
    const { result } = renderHook(() => useDisplayPower(undefined));
    act(() => { result.current.wake(); });
    expect(postPresenceWake).toHaveBeenCalledWith(undefined, 'touch');
  });
});

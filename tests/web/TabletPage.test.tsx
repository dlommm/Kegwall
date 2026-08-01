import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TabletPage, POURER_COLORS } from '../../src/web/routes/TabletPage';
import { useWallData, type UseWallDataResult } from '../../src/web/lib/useWallData';
import {
  armTablet, createPourer, disarmTablet, getFaces, getPourers, postPresenceWake,
} from '../../src/web/lib/api';
import { startCameraMotion } from '../../src/web/lib/cameraMotion';
import { startFacePipeline } from '../../src/web/lib/faceRecognition';
import { wallConfigSchema } from '../../src/server/core/wallConfig';
import type { TapState } from '../../src/server/core/state';

vi.mock('../../src/web/lib/useWallData', () => ({ useWallData: vi.fn() }));
vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  getPourers: vi.fn(),
  createPourer: vi.fn(),
  armTablet: vi.fn(),
  disarmTablet: vi.fn(),
  postPresenceWake: vi.fn(),
  getFaces: vi.fn(),
  enrollFace: vi.fn(),
  deleteFaces: vi.fn(),
}));
// Task 11: jsdom has no getUserMedia/canvas ImageData worth fighting — the pure
// diffFraction logic is covered by tests/web/cameraMotion.test.ts. Here we only need
// to assert TabletPage's wiring: starts when the config flag is on, never starts when
// it's off, disposes on unmount.
vi.mock('../../src/web/lib/cameraMotion', () => ({ startCameraMotion: vi.fn() }));
// Task 7: same rationale as cameraMotion above — the real pipeline (getUserMedia,
// @vladmandic/human) is covered by tests/web/faceRecognition.test.ts. Here we only
// assert TabletPage's wiring: when it starts the pipeline, how it resolves a candidate
// into the confirm sheet, and the abort-on-unmount contract.
vi.mock('../../src/web/lib/faceRecognition', () => ({ startFacePipeline: vi.fn() }));

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: {
      id: tapId, name: 'Morning Line', brewery: null, style: 'Pilsner', abv: 4.9, ibu: 32, srm: 3, description: null, labelImage: null, createdAt: '',
    },
    keg: {
      id: tapId, beerId: tapId, tapId, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000,
    },
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

const wall = {
  slug: 'main',
  name: 'Main',
  config: wallConfigSchema.parse({}),
};

// Task 11 + Task 7 share this fixture: a wall with the camera-motion opt-in flag on —
// Task 11's detector tests use it to assert `startCameraMotion` wiring, Task 7's face
// pipeline tests reuse it since motion is the pipeline's primary trigger.
const cameraWall = {
  ...wall,
  config: wallConfigSchema.parse({ displayPower: { cameraMotion: true } }),
};

function mockWallData(overrides: Partial<UseWallDataResult> = {}): { onMessage?: (msg: unknown) => void } {
  const captured: { onMessage?: (msg: unknown) => void } = {};
  (useWallData as Mock).mockImplementation((_slug: string, options?: { onMessage?: (msg: unknown) => void }) => {
    captured.onMessage = options?.onMessage;
    return {
      wall, taps: [], units: 'us', stale: false, connected: true, loading: false, error: null, notFound: false, ...overrides,
    };
  });
  return captured;
}

function renderTablet() {
  return render(
    <MemoryRouter initialEntries={['/tablet/main']}>
      <Routes>
        <Route path="/tablet/:slug" element={<TabletPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Task 7's harness for "the camera detected motion": TabletPage hands
 * `startCameraMotion` a persistent `onMotion` closure once (Task 11's effect), reused
 * for every subsequent motion event — so grabbing it off the mock's first call and
 * invoking it again here is exactly what a real motion event does. Requires the wall
 * passed to `mockWallData` to have `displayPower.cameraMotion: true` (e.g.
 * `cameraWall`), the same precondition `startCameraMotion` itself has. */
async function triggerCameraMotion() {
  const { onMotion } = (startCameraMotion as Mock).mock.calls[0]![0];
  await act(async () => {
    onMotion();
  });
}

describe('TabletPage (design 3a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: [
        { id: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127 },
        { id: 2, displayName: 'JT', avatarColor: '#5FD9BC', pourCount: 94 },
      ],
    });
    (armTablet as Mock).mockResolvedValue({ ok: true, data: { armed: true, drinkerId: 1 } });
    (disarmTablet as Mock).mockResolvedValue({ ok: true, data: { armed: false } });
    (createPourer as Mock).mockResolvedValue({
      ok: true, data: { id: 9, displayName: 'Drew', avatarColor: '#94C25C' },
    });
    (postPresenceWake as Mock).mockResolvedValue(undefined);
    (startCameraMotion as Mock).mockResolvedValue(null);
    // Task 7: disabled-by-default so every pre-existing test above (none of which
    // knows about face sign-in) never trips the pipeline's directory-enabled guard.
    (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: false, threshold: 0.6, faces: [] } });
    (startFacePipeline as Mock).mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('screen 1: shows the avatar grid with pour counts and the sign-up CTA', async () => {
    mockWallData();
    renderTablet();
    await flush();
    expect(screen.getByText('Who’s pouring?')).toBeInTheDocument();
    const avatars = screen.getAllByTestId('tablet-avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveTextContent('Sam');
    expect(avatars[0]).toHaveTextContent('127 pours');
    expect(screen.getByTestId('tablet-signup-button')).toHaveTextContent('I’M NEW — SIGN ME UP');
  });

  it('tapping an avatar arms the pourer and shows the armed screen', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    expect(armTablet).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('tablet-armed')).toHaveTextContent('You’re up, Sam — pour from any tap');
    expect(screen.getByTestId('tablet-waiting')).toBeInTheDocument();
  });

  it('screen 2: signup takes a name + color only, then arms the new pourer', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getByTestId('tablet-signup-button'));
    expect(screen.getByTestId('tablet-signup')).toHaveTextContent('Just a name — no email, no password.');
    expect(screen.getAllByTestId('tablet-signup-color')).toHaveLength(POURER_COLORS.length);

    fireEvent.change(screen.getByTestId('tablet-signup-name'), { target: { value: 'Drew' } });
    fireEvent.click(screen.getAllByTestId('tablet-signup-color')[4]!);
    fireEvent.click(screen.getByTestId('tablet-signup-submit'));
    await flush();
    expect(createPourer).toHaveBeenCalledWith('Drew', POURER_COLORS[4]);
    expect(armTablet).toHaveBeenCalledWith(9);
    expect(screen.getByTestId('tablet-armed')).toHaveTextContent('Drew');
  });

  it('screen 3: shows the auto-detected tap and live counter while pouring', async () => {
    mockWallData({ taps: [makeTap(2, { pouring: true, curServMl: 250 })] });
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    expect(screen.getByTestId('tablet-detected')).toHaveTextContent('DETECTED · TAP 2 · MORNING LINE');
    expect(screen.getByTestId('tablet-counter')).toHaveTextContent('8.5');
  });

  it('screen 4: a pour_attributed WS message flips to the done screen; countdown signs out', async () => {
    vi.useFakeTimers();
    const captured = mockWallData();
    renderTablet();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 1, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'Morning Line', volumeMl: 372.6, pourCount: 128, ts: 'now',
      });
    });
    const done = screen.getByTestId('tablet-done');
    expect(done).toHaveTextContent('Cheers, Sam');
    expect(done).toHaveTextContent('12.6 oz of Morning Line');
    expect(done).toHaveTextContent('pour #128');
    expect(screen.getByTestId('tablet-countdown')).toHaveTextContent('Signing out in 5s — tap to stay');

    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    expect(disarmTablet).toHaveBeenCalled();
    expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
  });

  it("ignores pour_attributed for a different pourer's drinkerId", async () => {
    const captured = mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 99, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'X', volumeMl: 100, pourCount: 1, ts: 'now',
      });
    });
    expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
    expect(screen.queryByTestId('tablet-done')).toBeNull();
  });

  it('tap-to-stay on the done screen re-arms instead of signing out', async () => {
    const captured = mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 1, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'Morning Line', volumeMl: 372.6, pourCount: 128, ts: 'now',
      });
    });
    (armTablet as Mock).mockClear();
    fireEvent.click(screen.getByTestId('tablet-done'));
    await flush();
    expect(armTablet).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
  });

  it('sign out disarms and returns to the grid', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    fireEvent.click(screen.getByTestId('tablet-signout'));
    await flush();
    expect(disarmTablet).toHaveBeenCalled();
    expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
  });

  // Task 10: server-driven screensaver/off stages (useDisplayPower) ride the SAME /ws
  // socket as pour_attributed above — onWsMessage is chained into the callback TabletPage
  // already hands useWallData.
  describe('server-driven display power stage (WS messages)', () => {
    it('shows the off overlay on a display_power frame and wakes on tap', async () => {
      const captured = mockWallData();
      renderTablet();
      await flush();
      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'main', state: 'off', wallId: 1, ts: 'now',
        });
      });
      expect(await screen.findByTestId('screen-off-overlay')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('screen-off-overlay'));
      expect(postPresenceWake).toHaveBeenCalledWith('main', 'touch');

      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'main', state: 'active', wallId: 1, ts: 'now',
        });
      });
      await waitFor(() => expect(screen.queryByTestId('screen-off-overlay')).toBeNull());
    });

    it('ignores a display_power frame for a different wall slug', async () => {
      const captured = mockWallData();
      renderTablet();
      await flush();
      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'patio', state: 'off', wallId: 2, ts: 'now',
        });
      });
      expect(screen.queryByTestId('screen-off-overlay')).toBeNull();
    });

    it('throttles the page-root pointerdown wake to once per 30s so normal pouring does not spam the endpoint', async () => {
      vi.useFakeTimers();
      mockWallData();
      renderTablet();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      expect(postPresenceWake).toHaveBeenCalledTimes(1);
      expect(postPresenceWake).toHaveBeenCalledWith('main', 'touch');

      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      expect(postPresenceWake).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      expect(postPresenceWake).toHaveBeenCalledTimes(2);
    });

    it("a tap that lands on the off overlay always wakes, even mid-throttle-window", async () => {
      vi.useFakeTimers();
      const captured = mockWallData();
      renderTablet();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Exhaust the page-root throttle first.
      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      expect(postPresenceWake).toHaveBeenCalledTimes(1);

      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'main', state: 'off', wallId: 1, ts: 'now',
        });
      });
      fireEvent.click(screen.getByTestId('screen-off-overlay'));
      expect(postPresenceWake).toHaveBeenCalledTimes(2);
    });

    // F3 fix: same dead-server fallback as WallPage -- a dead server can't push a fresh
    // display_power frame, so a stale 'off' would otherwise black out the kegerator
    // tablet indefinitely (and the wake tap would just POST into the same dead server).
    // TabletPage falls back to 'active' whenever the connection is stale/disconnected.
    it('falls back to active (overlay gone) when the connection goes stale after stage was pushed off', async () => {
      const live = { stale: false, connected: true };
      const captured = mockWallData(live);
      const { rerender } = renderTablet();
      await flush();
      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'main', state: 'off', wallId: 1, ts: 'now',
        });
      });
      expect(await screen.findByTestId('screen-off-overlay')).toBeInTheDocument();

      live.stale = true;
      rerender(
        <MemoryRouter initialEntries={['/tablet/main']}>
          <Routes>
            <Route path="/tablet/:slug" element={<TabletPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('screen-off-overlay')).toBeNull();
    });

    it('falls back to active (overlay gone) when the connection disconnects after stage was pushed off', async () => {
      const live = { stale: false, connected: true };
      const captured = mockWallData(live);
      const { rerender } = renderTablet();
      await flush();
      act(() => {
        captured.onMessage?.({
          type: 'display_power', wallSlug: 'main', state: 'off', wallId: 1, ts: 'now',
        });
      });
      expect(await screen.findByTestId('screen-off-overlay')).toBeInTheDocument();

      live.connected = false;
      rerender(
        <MemoryRouter initialEntries={['/tablet/main']}>
          <Routes>
            <Route path="/tablet/:slug" element={<TabletPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('screen-off-overlay')).toBeNull();
    });
  });

  // Task 11: the browser camera motion detector is opt-in per wall
  // (`displayPower.cameraMotion`). `startCameraMotion` itself (getUserMedia, canvas
  // frame-differencing) is unit-tested in tests/web/cameraMotion.test.ts against real
  // pixel buffers — jsdom has no getUserMedia/canvas ImageData worth fighting here, so
  // the module is mocked and these tests only assert TabletPage's wiring.
  describe('camera motion input (Task 11)', () => {
    it('starts the camera motion detector when displayPower.cameraMotion is true', async () => {
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      expect(startCameraMotion).toHaveBeenCalledTimes(1);
      expect(startCameraMotion).toHaveBeenCalledWith(
        expect.objectContaining({ onMotion: expect.any(Function) }),
      );
    });

    it('never starts the camera motion detector when displayPower.cameraMotion is false', async () => {
      mockWallData(); // default wall config: displayPower.cameraMotion is false
      renderTablet();
      await flush();
      expect(startCameraMotion).not.toHaveBeenCalled();
    });

    it('disposes the camera motion detector on unmount', async () => {
      const stop = vi.fn();
      (startCameraMotion as Mock).mockResolvedValue(stop);
      mockWallData({ wall: cameraWall });
      const { unmount } = renderTablet();
      await flush();
      expect(stop).not.toHaveBeenCalled();
      unmount();
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  // Task 7 (face sign-in, Plan B): the browser face-match pipeline (`faceRecognition.ts`,
  // mocked above for the same reason `cameraMotion` is — jsdom has no real camera/model
  // to exercise). These tests only assert TabletPage's wiring: when it starts the
  // pipeline, how a candidate resolves into the one-tap confirm sheet, the "at most one
  // pipeline" ref guard, and the abort-on-unmount contract.
  describe('face sign-in pipeline (Task 7)', () => {
    const ENROLLED_DIRECTORY = {
      ok: true,
      data: {
        enabled: true,
        threshold: 0.6,
        faces: [{ id: 1, drinkerId: 1, embedding: [1, 0, 0] }],
      },
    } as const;

    it('starts the face pipeline on motion when enabled, and arms on confirm', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);
      const { onCandidate } = (startFacePipeline as Mock).mock.calls[0]![0];
      act(() => onCandidate({ drinkerId: 1, score: 0.9 }));
      expect(await screen.findByTestId('face-confirm-sheet')).toBeInTheDocument();
      expect(screen.getByTestId('face-confirm-sheet')).toHaveTextContent('You pouring, Sam?');
      fireEvent.click(screen.getByTestId('face-confirm-yes'));
      await waitFor(() => expect(armTablet).toHaveBeenCalledWith(1));
    });

    it('"Not me" dismisses without arming', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      const { onCandidate } = (startFacePipeline as Mock).mock.calls[0]![0];
      act(() => onCandidate({ drinkerId: 1, score: 0.9 }));
      expect(await screen.findByTestId('face-confirm-sheet')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('face-confirm-no'));
      await waitFor(() => expect(screen.queryByTestId('face-confirm-sheet')).toBeNull());
      expect(armTablet).not.toHaveBeenCalled();
    });

    it('never starts the pipeline when the directory is disabled or empty', async () => {
      (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: false, threshold: 0.6, faces: [] } });
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      expect(startFacePipeline).not.toHaveBeenCalled();
    });

    it('ignores a candidate for an unknown drinkerId (stale directory) silently', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      const { onCandidate } = (startFacePipeline as Mock).mock.calls[0]![0];
      act(() => onCandidate({ drinkerId: 999, score: 0.9 }));
      expect(screen.queryByTestId('face-confirm-sheet')).toBeNull();
    });

    // Fix round 1: a pipeline started on the grid screen can still be "running"
    // (mocked here as never resolving/self-stopping on its own) when someone arms
    // manually in the meantime. A late onCandidate must not pop the confirm sheet over
    // the armed screen -- confirming it would call armTablet with a *different*
    // drinkerId than whoever's actually armed, silently replacing the armed slot
    // (core/tabletArm.ts) and mis-attributing the next pour.
    it('drops a stale candidate once the tablet has left the grid screen', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      const { onCandidate } = (startFacePipeline as Mock).mock.calls[0]![0];

      // Manually arm a pourer via the avatar path while the pipeline is still active.
      fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!); // Sam, id 1
      await flush();
      expect(armTablet).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();

      // The pipeline's late match (for a DIFFERENT pourer) arrives after the screen
      // already moved on.
      act(() => onCandidate({ drinkerId: 2, score: 0.9 })); // JT, id 2
      expect(screen.queryByTestId('face-confirm-sheet')).toBeNull();
      expect(armTablet).toHaveBeenCalledTimes(1);
    });

    it('never starts a second pipeline while one is already running (ref guard)', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      (startFacePipeline as Mock).mockResolvedValue(vi.fn()); // resolves with a live disposer -- stays "running"
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      await triggerCameraMotion();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);
    });

    it('after "Not me", a fresh pipeline run can prompt again (no permanent lockout)', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      await triggerCameraMotion();
      const first = (startFacePipeline as Mock).mock.calls[0]![0];
      act(() => first.onCandidate({ drinkerId: 1, score: 0.9 }));
      fireEvent.click(await screen.findByTestId('face-confirm-no'));
      await waitFor(() => expect(screen.queryByTestId('face-confirm-sheet')).toBeNull());

      await triggerCameraMotion();
      expect(startFacePipeline).toHaveBeenCalledTimes(2);
      const second = (startFacePipeline as Mock).mock.calls[1]![0];
      act(() => second.onCandidate({ drinkerId: 1, score: 0.9 }));
      expect(await screen.findByTestId('face-confirm-sheet')).toBeInTheDocument();
    });

    it('falls back to starting the pipeline on pointerdown when camera motion is off', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData(); // default wall: displayPower.cameraMotion is false
      renderTablet();
      await flush();
      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      await flush();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);
    });

    it('does not fall back to pointerdown when camera motion is enabled', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      fireEvent.pointerDown(screen.getByTestId('tablet-page'));
      await flush();
      expect(startFacePipeline).not.toHaveBeenCalled();
    });

    it('refetches the face directory on a WS faces_changed message', async () => {
      (getFaces as Mock).mockResolvedValueOnce({ ok: true, data: { enabled: false, threshold: 0.6, faces: [] } });
      const captured = mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();
      expect(getFaces).toHaveBeenCalledTimes(1);

      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      act(() => {
        captured.onMessage?.({ type: 'faces_changed' });
      });
      await flush();
      expect(getFaces).toHaveBeenCalledTimes(2);

      await triggerCameraMotion();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);
    });

    it('unmounting while the pipeline is still starting aborts its signal (belt and braces)', async () => {
      let resolvePipeline: ((disposer: (() => void) | null) => void) | undefined;
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      (startFacePipeline as Mock).mockImplementation(() => new Promise((resolve) => {
        resolvePipeline = resolve;
      }));
      mockWallData({ wall: cameraWall });
      const { unmount } = renderTablet();
      await flush();
      await triggerCameraMotion();

      const { signal } = (startFacePipeline as Mock).mock.calls[0]![0];
      expect(signal.aborted).toBe(false);
      unmount();
      expect(signal.aborted).toBe(true);

      // Resolve after unmount (a disposer arriving late) -- must not throw, matching
      // the "still call the resolved disposer if one arrived" half of the contract.
      const disposer = vi.fn();
      resolvePipeline?.(disposer);
      await flush();
    });
  });
});

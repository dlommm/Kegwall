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
  armTablet, createPourer, disarmTablet, getFaces, getPourers,
  matchFace, isFaceEnrolled, postPresenceWake,
} from '../../src/web/lib/api';
import { startCameraMotion } from '../../src/web/lib/cameraMotion';
import { computeEmbedding, loadHuman, startFacePipeline } from '../../src/web/lib/faceRecognition';
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
  matchFace: vi.fn(),
  isFaceEnrolled: vi.fn(),
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
// Task 8: extends this same mock (not a re-mock) with `loadHuman`/`computeEmbedding` --
// the two faceRecognition.ts exports the armed screen's own enrollment capture loop
// calls directly (it doesn't go through startFacePipeline, which is match-only).
vi.mock('../../src/web/lib/faceRecognition', () => ({
  startFacePipeline: vi.fn(),
  loadHuman: vi.fn(async () => ({})),
  computeEmbedding: vi.fn(),
}));

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
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
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

/** Task 8's harness for "the tablet is on the armed screen, certain who's pouring":
 * grid → tap the first avatar (Sam, `getPourers`'s first fixture entry) → armed.
 * Returns the `render`
 * result so callers that need `unmount` (camera-release-on-unmount tests) can get it;
 * callers that don't (most) just `await armViaGrid();` and ignore the return value. */
async function armViaGrid() {
  mockWallData();
  const utils = renderTablet();
  await flush();
  fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
  await flush();
  return utils;
}

/** Task 8's `navigator.mediaDevices.getUserMedia` stub -- same "fake stream with an
 * inspectable, stoppable track" shape `faceRecognition.test.ts`'s `fakeStream` uses,
 * so camera-release assertions here read `track.stop` the same way that file's do. */
function fakeMediaStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
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
    (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: false } });
    (matchFace as Mock).mockResolvedValue({ ok: true, data: { match: null } });
    (isFaceEnrolled as Mock).mockResolvedValue({ ok: true, data: { enrolled: false } });
    (startFacePipeline as Mock).mockResolvedValue(null);
    // Task 8: a default camera stub so the armed screen's enrollment panel (gated
    // behind `directory.enabled`, so untouched by every test above) never throws on a
    // real `navigator.mediaDevices` lookup jsdom doesn't provide. Individual
    // enrollment tests below replace this with their own inspectable stream/track.
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeMediaStream().stream) },
      configurable: true,
    });
    (loadHuman as Mock).mockResolvedValue({});
    (computeEmbedding as Mock).mockResolvedValue(null);
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

  it('big roster: shows a search field that filters the grid by name (redesign 2g)', async () => {
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1, displayName: i === 0 ? 'Samantha' : `Pourer ${i + 1}`, avatarColor: null, pourCount: i,
      })),
    });
    mockWallData();
    renderTablet();
    await flush();
    const search = screen.getByTestId('tablet-pourer-search');
    expect(search).toHaveAttribute('placeholder', 'Find your name — 12 pourers');
    expect(screen.getAllByTestId('tablet-avatar')).toHaveLength(12);
    fireEvent.change(search, { target: { value: 'saman' } });
    const filtered = screen.getAllByTestId('tablet-avatar');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toHaveTextContent('Samantha');
  });

  it('shows RECENT jumbo tiles for the two most-recently-active pourers (redesign 2d)', async () => {
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: [
        { id: 1, displayName: 'Sam', avatarColor: null, pourCount: 5, lastPourAt: '2026-08-01T10:00:00Z' },
        { id: 2, displayName: 'JT', avatarColor: null, pourCount: 3, lastPourAt: '2026-08-01T11:00:00Z' },
        { id: 3, displayName: 'Kim', avatarColor: null, pourCount: 1, lastPourAt: null },
      ],
    });
    mockWallData();
    renderTablet();
    await flush();
    const tiles = screen.getAllByTestId('tablet-recent-tile');
    expect(tiles).toHaveLength(2);
    // Most recent first: JT (11:00) before Sam (10:00).
    expect(tiles[0]).toHaveTextContent('JT');
    expect(tiles[0]).toHaveTextContent('poured');
  });

  it('shows an A–Z rail for a big roster (redesign 2g)', async () => {
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: Array.from({ length: 14 }, (_, i) => ({
        id: i + 1, displayName: String.fromCharCode(65 + i) + 'name', avatarColor: null, pourCount: i,
      })),
    });
    mockWallData();
    renderTablet();
    await flush();
    const letters = screen.getAllByTestId('tablet-az-letter');
    expect(letters.length).toBeGreaterThan(10);
    expect(letters[0]).toHaveTextContent('A');
  });

  // WCAG 4.1.2: the rail is aria-hidden (a redundant visual affordance -- every pourer
  // it jumps to is already a real button in the grid), so its buttons must also be out
  // of the keyboard focus order; focusable content inside an aria-hidden subtree lets
  // screen-reader/switch users land on something the a11y tree says doesn't exist.
  it('the aria-hidden A–Z rail buttons are removed from the tab order (WCAG 4.1.2)', async () => {
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: Array.from({ length: 14 }, (_, i) => ({
        id: i + 1, displayName: String.fromCharCode(65 + i) + 'name', avatarColor: null, pourCount: i,
      })),
    });
    mockWallData();
    renderTablet();
    await flush();
    expect(screen.getByTestId('tablet-az-rail')).toHaveAttribute('aria-hidden', 'true');
    const letters = screen.getAllByTestId('tablet-az-letter');
    expect(letters.length).toBeGreaterThan(10);
    for (const letter of letters) {
      expect(letter).toHaveAttribute('tabindex', '-1');
    }
    // The rail's pointer affordance is untouched: a tap still jumps the grid.
    expect(letters[0]).toHaveTextContent('A');
  });

  it('shows a FACE SIGN-IN ON chip when the directory is enabled (redesign 2d)', async () => {
    (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: true } });
    mockWallData();
    renderTablet();
    await flush();
    expect(screen.getByTestId('tablet-face-chip')).toHaveTextContent('FACE SIGN-IN ON');
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

  // Race fix: "tap to stay" must stop the auto-sign-out countdown BEFORE its armTablet
  // POST goes out -- with <250ms left, the interval's next tick would otherwise fire
  // disarmTablet() mid-flight, so the server processed arm -> disarm (actually
  // disarmed) while the resolved arm's `.ok` flipped the UI to "You're up", and the
  // next pour went unattributed.
  it('tap-to-stay with <250ms left kills the countdown before the disarm tick can fire mid-arm', async () => {
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

    // Run the countdown down into its final sub-250ms window (the tick at 5000ms
    // elapsed is the one that would disarm).
    await act(async () => { await vi.advanceTimersByTimeAsync(4_900); });
    expect(disarmTablet).not.toHaveBeenCalled();

    // The re-arm POST is deliberately slow: it resolves only AFTER the moment the old
    // countdown's disarm tick would have fired. mockReset (not mockClear):
    // beforeEach's queued resolved value must not leak into this deferred
    // implementation.
    let resolveArm: ((r: unknown) => void) | undefined;
    (armTablet as Mock).mockReset();
    (armTablet as Mock).mockImplementation(() => new Promise((resolve) => { resolveArm = resolve; }));
    fireEvent.click(screen.getByTestId('tablet-done'));

    // The would-be disarm tick moment (>=5000ms elapsed) passes while the POST is
    // still in flight -- the countdown must already be dead: no disarm, no grid flip.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(disarmTablet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tablet-grid')).toBeNull();

    await act(async () => { resolveArm?.({ ok: true, data: { armed: true, drinkerId: 1 } }); });
    expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
    // Server and UI agree: armed, with no disarm ever sent behind the arm's back.
    expect(disarmTablet).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a failed re-arm after tap-to-stay disarms and returns to the grid instead of stranding the user', async () => {
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

    (armTablet as Mock).mockReset();
    (armTablet as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' });
    fireEvent.click(screen.getByTestId('tablet-done'));
    await flush();

    // The countdown was stopped synchronously on tap, so the failed arm must itself
    // restore a coherent state: disarm (the pour's original arm may still be live
    // server-side) and land on the grid -- never a frozen done screen or a grid that
    // silently attributes the next pour.
    expect(disarmTablet).toHaveBeenCalled();
    expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
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
      data: { enabled: true },
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

    it('never starts the pipeline when face sign-in is disabled', async () => {
      (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: false } });
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

    // Fix round 2 (F1): the pipeline must not keep the camera + human.detect loop alive
    // once the screen leaves 'grid' -- an unenrolled drinker (or anyone) lingering in
    // frame with no match must not pin the camera open through a manual arm/signup.
    // Covers both shapes a "live" attempt can be in: still starting (camera/model not
    // yet resolved -- its controller must abort) and already running with a resolved
    // disposer (its dispose() must be called) -- see the teardown effect's own comment
    // in TabletPage.tsx for why these two states never overlap.
    it('tears down an active pipeline when the screen leaves the grid (manual arm)', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();

      // Stage 1: the pipeline is still starting (camera/model not yet resolved) when
      // the screen leaves grid -- the teardown effect must abort its controller's
      // signal immediately, per faceRecognition.ts's `signal` contract, rather than
      // waiting for the attempt to settle.
      let resolveFirst: ((disposer: (() => void) | null) => void) | undefined;
      (startFacePipeline as Mock).mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }));
      await triggerCameraMotion();
      const { signal: firstSignal } = (startFacePipeline as Mock).mock.calls[0]![0];
      expect(firstSignal.aborted).toBe(false);

      fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!); // manual arm -- leaves grid
      await flush();
      expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
      expect(firstSignal.aborted).toBe(true);

      // Let the stale attempt settle harmlessly (matches the unmount test's "must not
      // throw" contract for a disposer arriving late).
      resolveFirst?.(null);
      await flush();

      // Back to grid -- a fresh pipeline can start clean (the ref guard isn't stuck).
      fireEvent.click(screen.getByTestId('tablet-signout'));
      await flush();
      expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();

      // Stage 2: this time the pipeline has already resolved and is actively running
      // (a live disposer) when the screen leaves grid again -- the teardown effect must
      // call that disposer.
      const secondDisposer = vi.fn();
      (startFacePipeline as Mock).mockResolvedValueOnce(secondDisposer);
      await triggerCameraMotion();
      await flush();
      expect(startFacePipeline).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!); // manual arm again
      await flush();
      expect(secondDisposer).toHaveBeenCalledTimes(1);
    });

    it('tears down an active pipeline when the directory goes disabled mid-run (faces_changed)', async () => {
      (getFaces as Mock).mockResolvedValue(ENROLLED_DIRECTORY);
      const captured = mockWallData({ wall: cameraWall });
      renderTablet();
      await flush();

      const disposer = vi.fn();
      (startFacePipeline as Mock).mockResolvedValueOnce(disposer);
      await triggerCameraMotion();
      await flush();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);

      // Admin disables face sign-in mid-run -- faces_changed's refetch comes back
      // disabled, so `getEnrolled()` could never match again even if the pipeline kept
      // running. The teardown effect must call the running pipeline's disposer.
      (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: false, threshold: 0.6, faces: [] } });
      act(() => {
        captured.onMessage?.({ type: 'faces_changed' });
      });
      await flush();
      expect(disposer).toHaveBeenCalledTimes(1);

      // Still on grid, but disabled -- fresh motion must not restart it, proving the
      // ref guard was actually cleared (not left "stuck active") rather than the
      // directory-enabled check alone coincidentally blocking a restart.
      await triggerCameraMotion();
      expect(startFacePipeline).toHaveBeenCalledTimes(1);
    });
  });

  // Task 8 (face sign-in, Plan B): tablet enrollment on the armed screen. The capture
  // loop itself (`startFaceEnrollment` + the panel's state machine) now lives in
  // src/web/lib/useFaceEnrollment.ts + components/FaceEnrollPanel.tsx and is exercised
  // by tests/web/FaceEnrollPanel.test.tsx -- what stays here is TabletPage's own
  // wiring: the directory-disabled gate on the armed screen, and the screen-change
  // reset (Sign out mid-capture) that only the real screen machine can drive.
  describe('face enrollment (Task 8)', () => {
    it('never shows an enrollment affordance when the face directory is disabled', async () => {
      // beforeEach's default getFaces (enabled: false) applies unchanged here.
      await armViaGrid();
      expect(screen.queryByTestId('face-enroll-start')).toBeNull();
      expect(screen.queryByTestId('face-enroll-delete')).toBeNull();
    });

    // Camera-release tracing for the one early-end path only TabletPage can drive: a
    // screen change away from 'armed' (Sign out mid-capture) resets the enrollment
    // state machine, which must release the camera. The other release paths (success,
    // retry-timeout, try-again, cancel, unmount) live in
    // tests/web/FaceEnrollPanel.test.tsx. Stubs its own inspectable stream/track
    // (rather than relying on beforeEach's shared default) so `track.stop` can be
    // asserted directly.
    describe('camera release', () => {
      it('releases the camera when the tablet signs out mid-capture', async () => {
        const { stream, track } = fakeMediaStream();
        Object.defineProperty(navigator, 'mediaDevices', {
          value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
          configurable: true,
        });
        (getFaces as Mock).mockResolvedValue({ ok: true, data: { enabled: true, threshold: 0.6, faces: [] } });
        (computeEmbedding as Mock).mockResolvedValue(null);
        await armViaGrid();
        fireEvent.click(screen.getByTestId('face-enroll-start'));
        const video = (await screen.findByTestId('face-enroll-preview')) as HTMLVideoElement;
        await waitFor(() => expect(video.srcObject).toBe(stream));

        fireEvent.click(screen.getByTestId('tablet-signout'));
        await flush();
        expect(track.stop).toHaveBeenCalled();
        expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
      });
    });
  });
});

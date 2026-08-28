import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { FaceEnrollPanel } from '../../src/web/components/FaceEnrollPanel';
import { useFaceEnrollment } from '../../src/web/lib/useFaceEnrollment';
import {
  deleteFaces, enrollFace, isFaceEnrolled, type FaceDirectory,
} from '../../src/web/lib/api';
import { computeEmbedding, loadHuman } from '../../src/web/lib/faceRecognition';

vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  isFaceEnrolled: vi.fn(),
  enrollFace: vi.fn(),
  deleteFaces: vi.fn(),
}));
// Task 8: the real capture loop's two faceRecognition.ts inputs are faked -- the real
// pipeline (getUserMedia, @vladmandic/human) is covered by
// tests/web/faceRecognition.test.ts, same rationale as TabletPage.test.tsx's mock.
vi.mock('../../src/web/lib/faceRecognition', () => ({
  loadHuman: vi.fn(async () => ({})),
  computeEmbedding: vi.fn(),
}));

// Task 8: the drinker every enrollment test below captures for -- mirrors the first
// `getPourers` fixture entry TabletPage.test.tsx's grid arms into, so `drinkerId`
// assertions don't hardcode a bare `1`.
const PourerFixture = { id: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127 };

const ENABLED_DIRECTORY: FaceDirectory = { enabled: true };

/** The armed screen's enrollment surface, extracted from TabletPage: the hook drives
 * the state machine/camera lifecycle, the panel renders it. `screenKind: 'armed'` is
 * fixed here -- the screen-change reset path (Sign out mid-capture) stays covered by
 * TabletPage.test.tsx, where the real screen machine drives it. */
function EnrollHost({ armedDrinkerId = PourerFixture.id, faces = ENABLED_DIRECTORY }: {
  armedDrinkerId?: number | null;
  faces?: FaceDirectory;
}) {
  const enrollment = useFaceEnrollment({ armedDrinkerId, screenKind: 'armed', faces });
  return <FaceEnrollPanel enabled={faces.enabled} enrollment={enrollment} />;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Task 8's harness for "the tablet is on the armed screen, certain who's pouring" --
 * here that's just mounting the host (TabletPage.test.tsx's `armViaGrid` walks the
 * real grid → armed path instead). Returns the `render` result so callers that need
 * `unmount` (camera-release-on-unmount tests) can get it. */
async function renderEnroll(props: { armedDrinkerId?: number | null; faces?: FaceDirectory } = {}) {
  const utils = render(<EnrollHost {...props} />);
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

// Task 8 (face sign-in, Plan B): tablet enrollment on the armed screen. Unlike Task
// 7's pipeline (TabletPage.test.tsx), this exercises the REAL `startFaceEnrollment`
// capture loop (useFaceEnrollment.ts, not a mocked module) -- only its two inputs,
// `loadHuman`/`computeEmbedding` (faceRecognition.ts) and
// `navigator.mediaDevices.getUserMedia` (no module to intercept, so a global stub),
// are faked.
describe('FaceEnrollPanel + useFaceEnrollment (Task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isFaceEnrolled as Mock).mockResolvedValue({ ok: true, data: { enrolled: false } });
    // A default camera stub so mounting the panel never throws on a real
    // `navigator.mediaDevices` lookup jsdom doesn't provide. Individual tests below
    // replace this with their own inspectable stream/track.
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

  it('enrolls three captures and posts them', async () => {
    vi.useFakeTimers();
    (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]);
    (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
    await renderEnroll();
    fireEvent.click(screen.getByTestId('face-enroll-start'));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(enrollFace).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('already-enrolled drinker sees delete instead of add, and delete calls the api', async () => {
    // The armed drinker already has a face on file (server boolean, no vectors).
    (isFaceEnrolled as Mock).mockResolvedValue({ ok: true, data: { enrolled: true } });
    (deleteFaces as Mock).mockResolvedValue({ ok: true, data: { deleted: 1 } });
    await renderEnroll();
    expect(screen.queryByTestId('face-enroll-start')).toBeNull();
    fireEvent.click(screen.getByTestId('face-enroll-delete'));
    await waitFor(() => expect(deleteFaces).toHaveBeenCalledWith(PourerFixture.id));
  });

  it('a null embedding does not count toward the 3-capture target and retries', async () => {
    vi.useFakeTimers();
    (computeEmbedding as Mock)
      .mockResolvedValueOnce(null) // tick 1: no face -- doesn't count
      .mockResolvedValue([1, 0, 0]); // ticks 2-4: a face every time after
    (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
    await renderEnroll();
    fireEvent.click(screen.getByTestId('face-enroll-start'));
    // 4 ticks needed now (1 null + 3 real) instead of 3 -- one extra 700ms interval.
    await vi.advanceTimersByTimeAsync(2_900);
    expect(enrollFace).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  // Camera-release tracing (brief: "released the instant the panel closes/unmounts
  // -- all paths: success, retry-timeout, cancel, unmount"). Each test below stubs
  // its own inspectable stream/track (rather than relying on beforeEach's shared
  // default) so `track.stop` can be asserted directly. The remaining early-end path
  // -- a screen change away from 'armed' (Sign out mid-capture) -- stays in
  // TabletPage.test.tsx, where the real screen machine drives the reset.
  describe('camera release', () => {
    it('releases the camera the instant the 3rd capture completes (success)', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]);
      (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      expect(track.stop).not.toHaveBeenCalled();
      // Wrapped in `act()` (unlike the brief's own snippet above) because THIS test
      // asserts on the committed DOM, not just a mock call count -- React's update
      // scheduled from the interval tick's `.then()` needs `act()` to flush
      // deterministically before the assertion below runs (see TabletPage.test.tsx's
      // "screen 4" and its identical
      // `act(async () => { await vi.advanceTimersByTimeAsync(...) })`).
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
      expect(track.stop).toHaveBeenCalled();
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('releases the camera and shows retry after 15s without a face', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue(null); // never a face
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      expect(track.stop).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(track.stop).toHaveBeenCalled();
      expect(screen.getByTestId('face-enroll-retry')).toBeInTheDocument();
      expect(screen.getByText('No face found — try again')).toBeInTheDocument();
      expect(enrollFace).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('tapping "try again" after a timeout re-acquires the camera and can still succeed', async () => {
      vi.useFakeTimers();
      const first = fakeMediaStream();
      const second = fakeMediaStream();
      const getUserMedia = vi.fn()
        .mockResolvedValueOnce(first.stream)
        .mockResolvedValueOnce(second.stream);
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
      (computeEmbedding as Mock).mockResolvedValue(null);
      (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(first.track.stop).toHaveBeenCalled();
      expect(screen.getByTestId('face-enroll-retry')).toBeInTheDocument();

      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]);
      fireEvent.click(screen.getByTestId('face-enroll-retry'));
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
      expect(enrollFace).toHaveBeenCalledTimes(3);
      expect(second.track.stop).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('releases the camera when Cancel is tapped mid-capture', async () => {
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue(null); // never resolves on its own
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      const video = (await screen.findByTestId('face-enroll-preview')) as HTMLVideoElement;
      await waitFor(() => expect(video.srcObject).toBe(stream));
      expect(track.stop).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('face-enroll-cancel'));
      expect(track.stop).toHaveBeenCalled();
      expect(screen.queryByTestId('face-enroll-panel')).toBeNull();
      expect(screen.getByTestId('face-enroll-start')).toBeInTheDocument();
    });

    it('releases the camera on unmount mid-capture', async () => {
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue(null);
      const { unmount } = await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      const video = (await screen.findByTestId('face-enroll-preview')) as HTMLVideoElement;
      await waitFor(() => expect(video.srcObject).toBe(stream));
      expect(track.stop).not.toHaveBeenCalled();

      unmount();
      expect(track.stop).toHaveBeenCalled();
    });
  });

  // Fix round 1, F1: a stale `startFaceEnrollment` resolution (settling AFTER the
  // attempt it belongs to was cancelled or superseded) must never touch `enrollState`
  // -- reproduced by the reviewer via a deferred `getUserMedia` that resolves only
  // after Cancel has already fired.
  describe('stale-attempt currency (fix round 1, F1)', () => {
    it('cancelling before getUserMedia resolves does not reopen the panel when it settles later', async () => {
      let resolveGetUserMedia: ((stream: MediaStream) => void) | undefined;
      const { stream, track } = fakeMediaStream();
      const getUserMedia = vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveGetUserMedia = resolve;
      }));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
      await renderEnroll();

      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await flush(); // let the effect kick off startFaceEnrollment -- getUserMedia now pending

      fireEvent.click(screen.getByTestId('face-enroll-cancel'));
      expect(screen.getByTestId('face-enroll-start')).toBeInTheDocument(); // back to idle

      // The deferred getUserMedia now settles LATE, after the cancel.
      await act(async () => {
        resolveGetUserMedia?.(stream);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });

      // Must still be idle -- no stale resolution reopening the panel in 'retry' or
      // 'camera-error'.
      expect(screen.getByTestId('face-enroll-start')).toBeInTheDocument();
      expect(screen.queryByTestId('face-enroll-panel')).toBeNull();
      expect(track.stop).toHaveBeenCalled(); // the late stream is still released, though
    });

    it('cancel-then-restart: a stale first attempt cannot clobber the live second attempt', async () => {
      let resolveFirst: ((stream: MediaStream) => void) | undefined;
      const first = fakeMediaStream();
      const second = fakeMediaStream();
      const getUserMedia = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce(second.stream);
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
      await renderEnroll();

      fireEvent.click(screen.getByTestId('face-enroll-start')); // attempt 1 -- stuck on getUserMedia
      await flush();
      fireEvent.click(screen.getByTestId('face-enroll-cancel')); // cancel attempt 1
      fireEvent.click(screen.getByTestId('face-enroll-start')); // attempt 2 -- starts fresh

      const video = (await screen.findByTestId('face-enroll-preview')) as HTMLVideoElement;
      await waitFor(() => expect(video.srcObject).toBe(second.stream)); // attempt 2's own stream

      // The stale first attempt's getUserMedia now settles LATE -- must not clobber
      // attempt 2's live state.
      await act(async () => {
        resolveFirst?.(first.stream);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });

      expect(screen.getByTestId('face-enroll-panel')).toBeInTheDocument();
      expect(video.srcObject).toBe(second.stream); // unclobbered -- still attempt 2's stream
      expect(first.track.stop).toHaveBeenCalled(); // the stale attempt released ITS OWN camera
      expect(screen.queryByTestId('face-enroll-camera-error')).toBeNull();
      expect(screen.queryByTestId('face-enroll-retry')).toBeNull();
    });
  });

  // Fix round 1, F2: a "done" state must mean the server actually has the embedding,
  // not just that a face was detected locally.
  describe('save verification (fix round 1, F2)', () => {
    it('every save failing shows save-failed, not done', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]); // a face every tick
      (enrollFace as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' }); // every save fails
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

      expect(screen.getByTestId('face-enroll-save-failed')).toBeInTheDocument();
      expect(screen.getByText('Couldn’t save — try again')).toBeInTheDocument();
      expect(screen.queryByTestId('face-enroll-delete')).toBeNull(); // not done
      // The "Try again" button IS present here too (shared with 'retry' -- same
      // handler, honest copy is carried by the message above, not the button), but
      // the dishonest "No face found" copy specifically must not be.
      expect(screen.getByTestId('face-enroll-retry')).toBeInTheDocument();
      expect(screen.queryByText('No face found — try again')).toBeNull();
      expect(track.stop).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('a partial success (1-of-3 attempts failing) still reaches done at the timeout', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock)
        .mockResolvedValueOnce([1, 0, 0]) // tick 1: a face
        .mockResolvedValueOnce([1, 0, 0]) // tick 2: a face
        .mockResolvedValueOnce([1, 0, 0]) // tick 3: a face
        .mockResolvedValue(null); // tick 4+: no more faces -- can't reach 3 successes
      (enrollFace as Mock)
        .mockResolvedValueOnce({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } }) // tick 1 saves
        .mockResolvedValueOnce({ ok: false, status: 500, message: 'nope' }) // tick 2 fails
        .mockResolvedValue({ ok: true, data: { id: 2, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } }); // tick 3 saves
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

      // 2 of 3 attempts saved (captured=2, never reached the 3-target) -- the 15s
      // timeout still lands on 'done' since partial success is acceptable success.
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument();
      expect(enrollFace).toHaveBeenCalledTimes(3);
      expect(track.stop).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('enrolls three captures and posts them still passes when every save succeeds (no regression)', async () => {
      vi.useFakeTimers();
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]);
      (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
      expect(enrollFace).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  // Fix round 1, F3: a genuinely unavailable camera/model can never be fixed by
  // "try again" the way a no-face timeout can -- the panel must say so honestly
  // instead of reusing 'retry's "No face found" copy.
  describe('camera/model unavailable (fix round 1, F3)', () => {
    it('a rejecting getUserMedia shows camera-error, not retry', async () => {
      const getUserMedia = vi.fn().mockRejectedValue(new Error('permission denied'));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await flush();

      expect(screen.getByTestId('face-enroll-camera-error')).toBeInTheDocument();
      expect(screen.getByText('Camera unavailable — check the tablet’s camera permission')).toBeInTheDocument();
      expect(screen.queryByTestId('face-enroll-retry')).toBeNull();
      expect(screen.queryByTestId('face-enroll-save-failed')).toBeNull();

      fireEvent.click(screen.getByTestId('face-enroll-cancel'));
      expect(screen.getByTestId('face-enroll-start')).toBeInTheDocument();
    });
  });

  // Fix round 1, Minor: a failed delete must not silently claim success.
  describe('delete failure handling (fix round 1, Minor)', () => {
    it('a failed delete leaves the done-state panel open instead of closing it', async () => {
      vi.useFakeTimers();
      const { stream } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]);
      (enrollFace as Mock).mockResolvedValue({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument(); // done state reached
      vi.useRealTimers();

      (deleteFaces as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' });
      fireEvent.click(screen.getByTestId('face-enroll-delete'));
      await waitFor(() => expect(deleteFaces).toHaveBeenCalledWith(PourerFixture.id));
      await flush();

      // Still in the done-state panel -- did NOT silently revert to idle/"Add my face".
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument();
      expect(screen.queryByTestId('face-enroll-start')).toBeNull();
    });
  });

  // Fix round 2: the 15s budget must be a WALL-CLOCK deadline, not an accumulator
  // that only advances when a tick's `enrollFace` POST completes -- `api.ts`'s
  // `request()` has no fetch timeout, so a hung POST could otherwise pin the camera
  // open indefinitely. Ticks are also single-flight: a slow-but-resolving POST must
  // never let a second `computeEmbedding`/`enrollFace` round-trip start on top of it.
  describe('wall-clock budget & single-flight ticks (fix round 2)', () => {
    it('a hung enrollFace POST does not block the wall-clock deadline', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]); // a face every tick
      (enrollFace as Mock).mockImplementation(() => new Promise(() => {})); // never resolves
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));

      // Without a wall-clock deadline, this would hang forever (the accumulator only
      // advanced when a tick's POST resolved) -- advancing past 15s must still reach
      // a terminal state even though the very first POST never settles.
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

      // A face WAS detected (sawFace) but the save never completed (captured stays
      // 0) -- honest "couldn't save", not "no face found".
      expect(screen.getByTestId('face-enroll-save-failed')).toBeInTheDocument();
      expect(track.stop).toHaveBeenCalled();
      // Single-flight also means only the FIRST tick's round-trip ever started --
      // every later 700ms tick saw `inFlight` still true (the hung POST) and skipped.
      expect(enrollFace).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('slow-but-resolving POSTs (1500ms each) never overlap, and the session still terminates within budget', async () => {
      vi.useFakeTimers();
      const { stream, track } = fakeMediaStream();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      });
      (computeEmbedding as Mock).mockResolvedValue([1, 0, 0]); // a face every tick

      let inFlightCount = 0;
      let maxInFlight = 0;
      (enrollFace as Mock).mockImplementation(() => {
        inFlightCount += 1;
        maxInFlight = Math.max(maxInFlight, inFlightCount);
        return new Promise((resolve) => {
          // A real `setTimeout` here is the SAME fake-timer-controlled clock `vi
          // .advanceTimersByTimeAsync` below drives -- this is how the mock
          // simulates network latency deterministically under fake timers.
          setTimeout(() => {
            inFlightCount -= 1;
            resolve({ ok: true, data: { id: 1, drinkerId: PourerFixture.id, embedding: [1, 0, 0] } });
          }, 1_500);
        });
      });
      await renderEnroll();
      fireEvent.click(screen.getByTestId('face-enroll-start'));
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

      // Single-flight: never more than 1 concurrent enrollFace call, even though
      // 700ms ticks fire far more often than the 1500ms round-trip completes.
      expect(maxInFlight).toBeLessThanOrEqual(1);
      // Exactly 3 sequential round-trips (each ~1500ms) are enough to reach the
      // target well inside the 15s budget -- if the single-flight guard were
      // missing, overlapping ticks would have produced many more than 3 calls by
      // 16s (ticks fire every 700ms, so up to ~22 would have started).
      expect(enrollFace).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('face-enroll-delete')).toBeInTheDocument(); // done
      expect(track.stop).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});

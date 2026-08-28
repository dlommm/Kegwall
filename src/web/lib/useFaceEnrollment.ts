import {
  useEffect, useRef, useState, type RefObject,
} from 'react';
import { computeEmbedding, loadHuman } from './faceRecognition';
import {
  deleteFaces, enrollFace, isFaceEnrolled, type FaceDirectory,
} from './api';

/** Task 8 (face sign-in, Plan B): the armed screen's on-tablet enrollment capture --
 * cadence and budget straight from this task's brief. `FACE_ENROLL_BUDGET_MS` (fix
 * round 2 rename, was `FACE_ENROLL_TIMEOUT_MS`) is a WALL-CLOCK deadline, not an
 * accumulator of completed ticks -- see `startFaceEnrollment`'s `deadline`/`finish`
 * below for why that distinction matters. */
const FACE_ENROLL_TARGET = 3;
const FACE_ENROLL_INTERVAL_MS = 700;
const FACE_ENROLL_BUDGET_MS = 15_000;

interface FaceEnrollOptions {
  drinkerId: number;
  /** The panel's already-mounted `<video>` preview element -- unlike
   * faceRecognition.ts's pipeline/motion detector, this loop needs a VISIBLE feed, so
   * it attaches to a caller-owned element instead of creating its own offscreen one. */
  video: HTMLVideoElement;
  /** Fired once at least one embedding has been captured AND successfully saved
   * (`enrollFace` resolved `.ok`) -- either because all 3 were reached, or because the
   * 15s budget ran out with 1 or 2 successful saves already banked (fix round 1, F2:
   * partial success still counts -- a save shown as "done" must actually be saved).
   * The camera is already released by the time this fires. */
  onCaptured: () => void;
  /** Fired when the `FACE_ENROLL_BUDGET_MS` wall-clock deadline passes having NEVER
   * detected a face at all (every tick's `computeEmbedding` returned null) -- distinct
   * from `onSaveFailed` below (fix round 1, F2). The camera is already released by the
   * time this fires. */
  onTimeout: () => void;
  /** Fired when the `FACE_ENROLL_BUDGET_MS` wall-clock deadline passes having detected
   * at least one face but with zero successful `enrollFace` saves (every POST failed)
   * -- distinct from `onTimeout` so the panel can show an honest "couldn't save"
   * rather than "no face found" (fix round 1, F2). The camera is already released by
   * the time this fires. */
  onSaveFailed: () => void;
  /** Mirrors faceRecognition.ts's `startFacePipeline` `signal` contract: aborting
   * before the camera/model are ready closes whichever came up first instead of
   * leaving a live stream nobody's watching. */
  signal?: AbortSignal;
  /** Test seam — defaults to `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

/**
 * Task 8 (face sign-in, Plan B): the armed screen's "Add my face" capture loop.
 * Deliberately tablet-local (this hook module) rather than living in
 * faceRecognition.ts -- capturing enrollment shots is UI choreography specific to this
 * one panel (a live preview, a capture count, a retry affordance), not reusable
 * matching logic -- but it shares `startFacePipeline`'s 320x240 camera constraints and
 * self-contained "resolve a disposer" shape, so the two behave identically from a
 * camera-lifecycle standpoint.
 *
 * Attaches the camera feed to the caller's already-mounted `<video>` preview and loads
 * the shared `@vladmandic/human` singleton (`loadHuman` memoizes it there, so this is
 * instant after the first pipeline/enrollment run in a session). Every
 * `FACE_ENROLL_INTERVAL_MS` it runs `computeEmbedding`: a null frame (no face) doesn't
 * count against the budget and the loop just tries again next tick. A non-null frame
 * is AWAITED through `enrollFace` (fix round 1, F2: a save that never reached the
 * server must never be reported as "done") -- only a `.ok` POST counts toward the
 * 3-capture target; a failed POST isn't individually retried (matching TabletPage's
 * other public-mutation call sites, e.g. `disarmTablet`'s fire-and-forget), but doesn't
 * poison the run either -- the loop just keeps ticking on cadence, same as a null
 * frame.
 *
 * Fix round 2: the `FACE_ENROLL_BUDGET_MS` deadline is wall-clock (`Date.now()` at
 * start + the budget, enforced by its OWN `setTimeout`), not an accumulator of
 * completed ticks -- `api.ts`'s `request()` has no fetch timeout, so a hung
 * `enrollFace` POST could otherwise stall the tick that would have advanced the clock
 * and pin the camera open indefinitely. That same `setTimeout` is also the only thing
 * that can end a run with a POST still in flight; the existing `stopped` flag makes
 * that in-flight POST's eventual (possibly very late) resolution a no-op. Ticks are
 * additionally single-flight (`inFlight`): a tick that fires while the previous
 * `computeEmbedding`/`enrollFace` round-trip is still pending skips entirely rather
 * than starting a second one on top -- the wall-clock deadline keeps running
 * regardless, so a slow round-trip still can't extend the session, but it does mean
 * the server can never receive more than one concurrent (and, in steady state, more
 * than `FACE_ENROLL_TARGET`) `enrollFace` POST per run.
 *
 * The loop stops and releases the camera itself the instant any outcome is reached
 * (`onCaptured`, `onTimeout`, or `onSaveFailed`) -- callers never need to separately
 * dispose a *finished* run; the returned disposer exists purely for the "ended early"
 * paths (Cancel, a screen change away from 'armed', or unmount -- all handled by
 * `useFaceEnrollment`'s capture effect below).
 *
 * Resolves `null` — mirroring `startFacePipeline`/`startCameraMotion` — when the
 * camera/model is genuinely unavailable (a real `getUserMedia`/`loadHuman` failure) OR
 * when `signal` was aborted mid-start. The caller (`useFaceEnrollment`'s capture
 * effect) is responsible for telling these apart: an abort it itself requested
 * (Cancel, unmount, a screen change) must never be treated as a camera error -- see
 * that effect's "currency" check (fix round 1, F1) for how it does that without this
 * function needing to encode "why" in its return value.
 */
async function startFaceEnrollment(opts: FaceEnrollOptions): Promise<(() => void) | null> {
  const {
    drinkerId, video, onCaptured, onTimeout, onSaveFailed, signal,
    getUserMedia = (constraints: MediaStreamConstraints) => (
      navigator.mediaDevices.getUserMedia(constraints)
    ),
  } = opts;

  if (signal?.aborted) return null;

  // Same "stop the instant abort fires, even mid-await" shape as startFacePipeline --
  // see that function's identical comment for the race this closes.
  let liveStream: MediaStream | undefined;
  const stopLiveStream = () => liveStream?.getTracks().forEach((track) => track.stop());
  signal?.addEventListener('abort', stopLiveStream, { once: true });

  const getUserMediaPromise = getUserMedia({
    video: { width: 320, height: 240 },
    audio: false,
  }).then((s) => {
    liveStream = s;
    if (signal?.aborted) s.getTracks().forEach((track) => track.stop());
    return s;
  });
  const loadHumanPromise = loadHuman().then((h) => {
    if (signal?.aborted) stopLiveStream();
    return h;
  });

  let stream: MediaStream;
  let human: unknown;
  try {
    [stream, human] = await Promise.all([getUserMediaPromise, loadHumanPromise]);
  } catch {
    signal?.removeEventListener('abort', stopLiveStream);
    getUserMediaPromise.catch(() => {});
    loadHumanPromise.catch(() => {});
    stopLiveStream();
    return null;
  }

  signal?.removeEventListener('abort', stopLiveStream);
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  video.srcObject = stream;
  // Don't await -- same fire-and-forget rationale as faceRecognition.ts's identical
  // call (jsdom's play() stub never resolves under fake timers).
  video.play()?.catch(() => {});

  let stopped = false;
  let captured = 0; // successful (`.ok`) saves -- NOT just non-null embeddings (F2)
  let sawFace = false; // true once ANY tick detected a face, success or not (F2)
  let inFlight = false; // fix round 2: single-flight guard -- see the tick below

  const dispose = () => {
    stopped = true;
    clearInterval(intervalId);
    clearTimeout(deadlineTimer);
    stream.getTracks().forEach((track) => track.stop());
  };

  /** Fix round 2: the wall-clock deadline's own terminal evaluation, independent of
   * whatever a tick is doing. Fires exactly once, `FACE_ENROLL_BUDGET_MS` after the
   * loop starts, via `setTimeout` (NOT the interval's own accumulated tick count) --
   * this is what bounds the session even when a tick's `enrollFace` POST never
   * resolves at all. `stopped` makes this inert if a tick already reached a terminal
   * outcome (e.g. the 3rd capture) in the same instant this fires. */
  const finish = () => {
    if (stopped) return;
    dispose();
    if (captured > 0) onCaptured(); // partial success (1 or 2 of 3) still counts
    else if (sawFace) onSaveFailed(); // detected a face, but every save failed
    else onTimeout(); // never detected a face at all
  };

  const tick = () => {
    // Fix round 2: single-flight -- a slow `computeEmbedding`/`enrollFace` round-trip
    // (>700ms, e.g. a slow network) must not stack a second one on top of it; the
    // wall-clock deadline above runs independently of this guard, so a stuck round-trip
    // still can't extend the session past its budget.
    if (stopped || inFlight) return;
    inFlight = true;
    void computeEmbedding(human, video).then(async (embedding) => {
      try {
        if (stopped) return; // disposed while this detect pass was in flight
        if (embedding) {
          sawFace = true;
          const result = await enrollFace(drinkerId, embedding);
          if (stopped) return; // disposed (e.g. the deadline fired) while this save was in flight
          if (result.ok) {
            captured += 1;
            if (captured >= FACE_ENROLL_TARGET) {
              dispose();
              onCaptured();
            }
          }
        }
      } finally {
        inFlight = false;
      }
    });
  };

  const intervalId = setInterval(tick, FACE_ENROLL_INTERVAL_MS);
  const deadlineTimer = setTimeout(finish, FACE_ENROLL_BUDGET_MS);
  return dispose;
}

/** The enrollment panel's full state machine. 'idle' means "no panel" -- the armed
 * screen instead shows either "Add my face" or (already enrolled) "Face sign-in:
 * enrolled" + delete, decided by `isEnrolled`. */
export type FaceEnrollState =
  | 'idle' | 'capturing' | 'retry' | 'save-failed' | 'camera-error' | 'done';

/** Everything `FaceEnrollPanel` needs to render and drive the enrollment flow --
 * returned by `useFaceEnrollment` below and handed to the panel as a single prop. */
export interface FaceEnrollment {
  enrollState: FaceEnrollState;
  /** Whether the armed drinker already has a face on file (server boolean, no vectors). */
  isEnrolled: boolean;
  /** The panel's live `<video>` preview element -- `startFaceEnrollment` attaches the
   * camera feed to it while capturing. */
  enrollVideoRef: RefObject<HTMLVideoElement | null>;
  handleStartEnroll: () => void;
  handleRetryEnroll: () => void;
  handleCancelEnroll: () => void;
  handleDeleteFace: () => Promise<void>;
}

export interface UseFaceEnrollmentOptions {
  /** The armed pourer's id, or null whenever the tablet isn't on the armed screen --
   * the enrollment UI only ever renders there. */
  armedDrinkerId: number | null;
  /** The tablet's current screen kind -- only its transitions away from 'armed'
   * matter here (see the reset effect below). */
  screenKind: string;
  /** The enrolled-faces directory: its identity change (a WS `faces_changed` refetch
   * after enroll/delete) retriggers the `isEnrolled` fetch below. */
  faces: FaceDirectory;
}

/**
 * Task 8 (face sign-in, Plan B): the armed screen's enrollment capture panel state.
 * `enrollVideoRef` is the panel's live preview element; `enrollControllerRef`/
 * `enrollDisposeRef` mirror the face pipeline's own refs (useFacePipeline) for the
 * identical reason -- an in-flight `startFaceEnrollment` start (camera/model still
 * loading) needs a way to be cancelled before it resolves, not just after.
 */
export function useFaceEnrollment(
  { armedDrinkerId, screenKind, faces }: UseFaceEnrollmentOptions,
): FaceEnrollment {
  const [enrollState, setEnrollState] = useState<FaceEnrollState>('idle');
  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);
  const enrollControllerRef = useRef<AbortController | null>(null);
  const enrollDisposeRef = useRef<(() => void) | null>(null);

  // Whether the armed drinker already has a face on file. Fetched as a boolean (the corpus
  // never reaches the client); refetched when `faces` changes identity (a WS faces_changed
  // after enroll/delete triggers loadFaces → setFaces with a fresh object).
  const [isEnrolled, setIsEnrolled] = useState(false);
  useEffect(() => {
    if (armedDrinkerId === null) { setIsEnrolled(false); return; }
    let cancelled = false;
    isFaceEnrolled(armedDrinkerId).then((r) => {
      if (!cancelled && r.ok) setIsEnrolled(r.data.enrolled);
    });
    return () => { cancelled = true; };
  }, [armedDrinkerId, faces]);

  /** Starts (and, for "try again", re-starts) the capture loop whenever `enrollState`
   * becomes 'capturing'. The cleanup below is what actually guarantees the
   * camera-release contract across every path that can end a capture early -- Cancel,
   * a screen change away from 'armed' (see the reset effect below), and component
   * unmount all just change/remove `enrollState`, which this cleanup responds to
   * identically. A capture that finishes on its own (3rd capture, the 15s timeout, or
   * a save failure) has ALREADY released the camera by the time it calls
   * `setEnrollState` -- this cleanup running for that transition is a harmless no-op
   * (`enrollDisposeRef.current` is already null by then).
   *
   * Fix round 1 (F1): the `.then()` below checks CURRENCY -- `enrollControllerRef.current
   * === controller` -- before touching any state, not just before clearing the ref. The
   * cleanup below ALSO clears `enrollControllerRef.current` (not just aborts) the moment
   * a capture is cancelled/superseded. Together these close a race the reviewer
   * reproduced: cancelling before `getUserMedia` resolves let the eventually-settling
   * (aborted) call's `.then()` still run `setEnrollState('camera-error')` and silently
   * reopen a panel the user had already closed -- and, worse, a cancel-then-immediately-
   * retry could let that same stale `.then()` clobber the SECOND attempt's live state.
   * With the ref cleared on cancel, a stale `.then()` always finds `enrollControllerRef
   * .current !== controller` and bails before calling `setEnrollState` at all -- it can
   * still `dispose()` a stray disposer that arrived late (releasing whatever camera it
   * acquired), but it never touches state that might belong to a newer attempt (or to
   * the deliberately-idle state the user asked for). */
  useEffect(() => {
    if (enrollState !== 'capturing') return undefined;
    const video = enrollVideoRef.current;
    if (!video || armedDrinkerId === null) return undefined;

    const controller = new AbortController();
    enrollControllerRef.current = controller;
    startFaceEnrollment({
      drinkerId: armedDrinkerId,
      video,
      signal: controller.signal,
      onCaptured: () => {
        enrollDisposeRef.current = null;
        setEnrollState('done');
      },
      onTimeout: () => {
        enrollDisposeRef.current = null;
        setEnrollState('retry');
      },
      onSaveFailed: () => {
        enrollDisposeRef.current = null;
        setEnrollState('save-failed');
      },
    }).then((dispose) => {
      if (enrollControllerRef.current !== controller) {
        // Superseded by a cancel or a newer attempt before this one settled -- release
        // a disposer if one arrived anyway (aborted mid-flight after acquiring a
        // stream), but never touch `enrollState`: it either belongs to whatever the
        // CURRENT attempt is doing now, or to the idle state the user asked for.
        dispose?.();
        return;
      }
      enrollControllerRef.current = null;
      if (!dispose) {
        // Still current, and no disposer -- `controller.abort()` is only ever called
        // from this effect's own cleanup, which clears `enrollControllerRef` first, so
        // reaching here with the ref still matching means this was NOT a deliberate
        // cancel. It can only be a genuine camera/model failure (F3) -- land on an
        // honest, distinct state rather than "No face found", which a denied camera
        // could never resolve by retrying the same way a no-face timeout can.
        setEnrollState('camera-error');
        return;
      }
      enrollDisposeRef.current = dispose;
    });

    return () => {
      controller.abort();
      if (enrollControllerRef.current === controller) enrollControllerRef.current = null;
      enrollDisposeRef.current?.();
      enrollDisposeRef.current = null;
    };
  }, [enrollState, armedDrinkerId]);

  // A screen change away from 'armed' while the panel is still open (e.g. Sign out
  // mid-capture) must close it -- the effect above only reacts to `enrollState` itself,
  // so without this an abandoned 'capturing'/'retry'/'done' state would otherwise
  // linger (invisible, since the panel only renders inside TabletPage's 'armed' branch,
  // but a later re-arm would resume mid-flow instead of starting clean). Setting
  // 'idle' here re-triggers the effect above's cleanup, releasing the camera.
  useEffect(() => {
    if (screenKind !== 'armed' && enrollState !== 'idle') setEnrollState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the transition matters
  }, [screenKind]);

  function handleStartEnroll() {
    setEnrollState('capturing');
  }

  function handleRetryEnroll() {
    setEnrollState('capturing');
  }

  function handleCancelEnroll() {
    setEnrollState('idle');
  }

  /** Shared by both the outer "Face sign-in: enrolled" row and the panel's post-capture
   * done-state -- same testid, same behavior either way. In the panel, closing back to
   * 'idle' afterward matters (the delete button won't survive a directory refetch that
   * still shows no faces for a moment); in the outer row it's already 'idle', so the
   * extra `setEnrollState` call is a no-op. Deliberately doesn't hand-patch `faces`
   * itself -- the server's DELETE broadcasts `faces_changed`, and TabletPage's
   * `loadFaces` already refetches on that, same as enrollment's own POSTs do.
   *
   * Fix round 1 (Minor): only close back to 'idle' on a successful delete -- a failed
   * request (network error, server 500) must leave the panel exactly as it was (still
   * showing "Remove my face data" so the user can just tap it again) rather than
   * silently claiming the removal happened. */
  async function handleDeleteFace() {
    if (armedDrinkerId === null) return;
    const result = await deleteFaces(armedDrinkerId);
    if (result.ok) setEnrollState('idle');
  }

  return {
    enrollState,
    isEnrolled,
    enrollVideoRef,
    handleStartEnroll,
    handleRetryEnroll,
    handleCancelEnroll,
    handleDeleteFace,
  };
}

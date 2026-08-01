import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useParams } from 'react-router';
import { useWallData } from '../lib/useWallData';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { ThemeProvider } from '../themes/ThemeProvider';
import { useLookClock } from '../components/looks/lookShared';
import { formatVolumeMl } from '../lib/units';
import { ScreenCare } from '../components/ScreenCare';
import { useDisplayPower } from '../lib/displayPower';
import { startCameraMotion } from '../lib/cameraMotion';
import {
  computeEmbedding, loadHuman, startFacePipeline, type MatchCandidate,
} from '../lib/faceRecognition';
import {
  armTablet, createPourer, deleteFaces, disarmTablet, enrollFace, getFaces, getPourers,
  getSession, startSession, joinSession, endSession, type FaceDirectory, type PublicPourer,
  type SessionSnapshotResponse,
} from '../lib/api';

/** The signup screen's preset avatar palette (design 3a). */
export const POURER_COLORS = ['#D08C4C', '#5FD9BC', '#7FA8E0', '#C77FB8', '#94C25C', '#E0B23D'];

const DONE_SIGNOUT_SECONDS = 5;
/** Minimum gap between page-root pointer taps that count as presence "wake" activity
 * (Task 10) — normal pouring generates constant taps on the armed/done screens, so
 * without a throttle every tap would hit POST /api/presence/wake. */
const POINTER_WAKE_THROTTLE_MS = 30_000;
/** Minimum gap between camera-detected motion events that count as presence "wake"
 * activity (Task 11) — the detector samples every 500ms by default, so without a
 * throttle sustained motion (someone standing at the kegerator) would spam
 * POST /api/presence/wake. Independent of the pointer-tap throttle above: each has its
 * own `useRef` timestamp, so exhausting one never blocks the other. */
const CAMERA_WAKE_THROTTLE_MS = 5_000;

type Screen =
  | { kind: 'grid' }
  | { kind: 'signup' }
  | { kind: 'armed'; pourer: ActivePourer }
  | { kind: 'done'; pourer: ActivePourer; pour: AttributedPour };

interface ActivePourer {
  id: number;
  name: string;
  color: string | null;
}

interface AttributedPour {
  volumeMl: number;
  beerName: string | null;
  tapNumber: number;
  pourCount: number;
}

function isPourAttributedMessage(msg: unknown): msg is {
  type: 'pour_attributed'; drinkerId: number; volumeMl: number;
  beerName: string | null; tapNumber: number; pourCount: number;
} {
  return typeof msg === 'object' && msg !== null
    && (msg as { type?: unknown }).type === 'pour_attributed'
    && typeof (msg as { drinkerId?: unknown }).drinkerId === 'number';
}

/** Task 7 (face sign-in, Plan B): ws.ts's invalidation signal for enrollment/deletion
 * (routes/public.ts's POST/DELETE /api/public/faces) — no payload, just "go refetch". */
function isFacesChangedMessage(msg: unknown): msg is { type: 'faces_changed' } {
  return typeof msg === 'object' && msg !== null
    && (msg as { type?: unknown }).type === 'faces_changed';
}

/** Task 8 (face sign-in, Plan B): the armed screen's on-tablet enrollment capture --
 * cadence and budget straight from this task's brief. */
const FACE_ENROLL_TARGET = 3;
const FACE_ENROLL_INTERVAL_MS = 700;
const FACE_ENROLL_TIMEOUT_MS = 15_000;

interface FaceEnrollOptions {
  drinkerId: number;
  /** The panel's already-mounted `<video>` preview element -- unlike
   * faceRecognition.ts's pipeline/motion detector, this loop needs a VISIBLE feed, so
   * it attaches to a caller-owned element instead of creating its own offscreen one. */
  video: HTMLVideoElement;
  /** Fired once the 3rd embedding has been captured and POSTed. The camera is already
   * released by the time this fires. */
  onCaptured: () => void;
  /** Fired when `FACE_ENROLL_TIMEOUT_MS` elapses without reaching the target (or the
   * camera/model never came up at all). The camera is already released by the time
   * this fires too. */
  onTimeout: () => void;
  /** Mirrors faceRecognition.ts's `startFacePipeline` `signal` contract: aborting
   * before the camera/model are ready closes whichever came up first instead of
   * leaving a live stream nobody's watching. */
  signal?: AbortSignal;
  /** Test seam — defaults to `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

/**
 * Task 8 (face sign-in, Plan B): the armed screen's "Add my face" capture loop.
 * Deliberately TabletPage-local rather than living in faceRecognition.ts -- capturing
 * enrollment shots is UI choreography specific to this one panel (a live preview, a
 * capture count, a retry affordance), not reusable matching logic -- but it shares
 * `startFacePipeline`'s 320x240 camera constraints and self-contained "resolve a
 * disposer" shape, so the two behave identically from a camera-lifecycle standpoint.
 *
 * Attaches the camera feed to the caller's already-mounted `<video>` preview and loads
 * the shared `@vladmandic/human` singleton (`loadHuman` memoizes it there, so this is
 * instant after the first pipeline/enrollment run in a session). Every
 * `FACE_ENROLL_INTERVAL_MS` it runs `computeEmbedding`: a null frame (no face) doesn't
 * count against the budget and the loop just tries again next tick, but a non-null
 * frame is immediately POSTed via `enrollFace` (fire-and-forget -- a dropped POST isn't
 * individually retried, matching this file's other public-mutation call sites, e.g.
 * `disarmTablet`) and counts toward the 3-capture target. The loop stops and releases
 * the camera itself the instant either outcome is reached (`onCaptured` or
 * `onTimeout`) -- callers never need to separately dispose a *finished* run; the
 * returned disposer exists purely for the "ended early" paths (Cancel, a screen change
 * away from 'armed', or unmount -- all handled by TabletPage's effect below).
 *
 * Resolves `null` — mirroring `startFacePipeline`/`startCameraMotion` — when the
 * camera is unavailable/denied or `signal` was already aborted; the panel treats that
 * the same as a same-tick timeout (lands on the retry affordance).
 */
async function startFaceEnrollment(opts: FaceEnrollOptions): Promise<(() => void) | null> {
  const {
    drinkerId, video, onCaptured, onTimeout, signal,
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
  let captured = 0;
  let elapsedMs = 0;

  const dispose = () => {
    stopped = true;
    clearInterval(intervalId);
    stream.getTracks().forEach((track) => track.stop());
  };

  const tick = () => {
    if (stopped) return;
    void computeEmbedding(human, video).then((embedding) => {
      if (stopped) return; // disposed while this detect pass was in flight
      if (embedding) {
        captured += 1;
        void enrollFace(drinkerId, embedding);
        if (captured >= FACE_ENROLL_TARGET) {
          dispose();
          onCaptured();
          return;
        }
      }
      elapsedMs += FACE_ENROLL_INTERVAL_MS;
      if (elapsedMs >= FACE_ENROLL_TIMEOUT_MS) {
        dispose();
        onTimeout();
      }
    });
  };

  const intervalId = setInterval(tick, FACE_ENROLL_INTERVAL_MS);
  return dispose;
}

/** "SL" for "Sam Lee", "S" for "Sam" — same rule the menu's ClaimSheet uses. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

/**
 * The kegerator tablet kiosk (`/tablet/:slug`, design 3a): a passwordless
 * 4-screen flow — (1) "Who's pouring?" avatar grid, (2) name + color signup,
 * (3) armed/pouring with automatic tap detection and the live counter, (4)
 * done with a 5s auto sign-out. Arming is server-side (core/tabletArm.ts) so
 * the pour attributes even if the tablet naps mid-pour; the done screen is
 * driven by the WS `pour_attributed` relay. Themed by the named wall's theme.
 * Task 10: the whole page is wrapped in `ScreenCare` (server-pushed
 * screensaver/off stage, same `useDisplayPower` hook `WallPage` uses) OUTSIDE
 * the grid/signup/armed/done screen machine above — arming/session flows are
 * untouched by it. `taps={[]}` is passed deliberately: the screensaver's
 * rotating tap highlight line makes sense on the wall display, not on this
 * kiosk. Every pointer tap on the page also counts as presence activity
 * (throttled to one wake per 30s so normal pouring doesn't spam the wake
 * endpoint) — separate from the off-overlay's own always-fires tap-to-wake.
 * Task 11: when the wall opts in via `displayPower.cameraMotion`, a low-res camera
 * frame-differencing detector (`lib/cameraMotion.ts`) also feeds `wake('camera')`,
 * throttled to one wake per 5s independently of the pointer-tap throttle.
 * Task 7 (face sign-in, Plan B): when the enrolled-faces directory (`GET
 * /api/public/faces`, refetched on WS `faces_changed`) is enabled and non-empty and
 * the grid screen is showing, the same camera motion above (or, when a wall has no
 * camera-motion input at all, a pointer tap) also starts `lib/faceRecognition.ts`'s
 * browser matching pipeline. A match resolves against the loaded pourers list and
 * opens a one-tap confirm sheet ("You pouring, NAME?"); confirming runs the exact
 * same `selectPourer` arm flow a manual avatar tap uses. At most one pipeline ever
 * runs at a time (a ref guard, not state — starting one must never wait on a render).
 */
export function TabletPage() {
  const { slug } = useParams<{ slug: string }>();
  const reducedMotion = usePrefersReducedMotion();
  const clock = useLookClock();

  const [screen, setScreen] = useState<Screen>({ kind: 'grid' });
  const [pourers, setPourers] = useState<PublicPourer[]>([]);
  const [pourersStatus, setPourersStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [signupName, setSignupName] = useState('');
  const [signupColor, setSignupColor] = useState(POURER_COLORS[0]!);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(DONE_SIGNOUT_SECONDS);
  // Session mode (design 6c): the active group tab, polled while on screen.
  const [session, setSession] = useState<SessionSnapshotResponse | null>(null);
  const [recap, setRecap] = useState<SessionSnapshotResponse | null>(null);

  // The armed pourer, readable from the WS callback without re-subscribing.
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  // Task 7 (face sign-in, Plan B): the enrolled-faces directory feeding the browser
  // matching pipeline below. `enabled`/`threshold` default to the server's own
  // disabled defaults so a slow first fetch never accidentally satisfies the
  // "directory enabled" guard before GET /api/public/faces actually answers.
  // `facesRef`/`pourersRef` mirror `screenRef` above -- read from event-handler
  // closures (camera motion, pointer taps) that don't otherwise see a fresh render.
  const [faces, setFaces] = useState<FaceDirectory>({ enabled: false, threshold: 0.6, faces: [] });
  const facesRef = useRef<FaceDirectory>(faces);
  facesRef.current = faces;
  const pourersRef = useRef<PublicPourer[]>(pourers);
  pourersRef.current = pourers;

  const loadFaces = useCallback(() => {
    getFaces().then((result) => {
      if (result.ok) setFaces(result.data);
    });
  }, []);

  useEffect(() => {
    loadFaces();
  }, [loadFaces]);

  // Task 10: the server-pushed display power stage rides the same /ws socket as
  // pour_attributed below — onWsMessage is chained in alongside it.
  const { stage, onWsMessage, wake } = useDisplayPower(slug);

  const handleWsMessage = useCallback((msg: unknown) => {
    onWsMessage(msg);
    // Task 7: faces_changed carries no payload -- just "go refetch the directory".
    if (isFacesChangedMessage(msg)) loadFaces();
    if (!isPourAttributedMessage(msg)) return;
    const current = screenRef.current;
    if (current.kind === 'armed' && msg.drinkerId === current.pourer.id) {
      setScreen({
        kind: 'done',
        pourer: current.pourer,
        pour: {
          volumeMl: msg.volumeMl,
          beerName: msg.beerName,
          tapNumber: msg.tapNumber,
          pourCount: msg.pourCount,
        },
      });
    }
  }, [onWsMessage, loadFaces]);

  const {
    wall, taps, units, stale, connected, loading, notFound,
  } = useWallData(slug, { onMessage: handleWsMessage });

  // F3 fix: same dead-server fallback as WallPage -- see that file's comment. A dead
  // server can't push a fresh display_power frame, so a stale `'off'` would otherwise
  // black out the kegerator tablet indefinitely (and the wake tap would just POST into
  // the same dead server). Force `'active'` whenever the connection is stale/disconnected.
  const effectiveStage = stale || !connected ? 'active' : stage;

  // Read ahead of both trigger sites below (pointer fallback + camera motion) since the
  // pointer fallback needs to know whether camera motion is even in play.
  const cameraMotionEnabled = wall?.config.displayPower.cameraMotion ?? false;

  // Task 7 (face sign-in, Plan B): the one-tap confirm sheet a pipeline match opens.
  const [faceConfirm, setFaceConfirm] = useState<ActivePourer | null>(null);

  // "At most one pipeline at a time" ref guard: set synchronously the instant a start
  // is attempted -- before `startFacePipeline`'s own async camera/model-load work even
  // begins -- so a second motion/tap landing before that promise resolves can never
  // slip through and start an overlapping session. `facePipelineControllerRef` is this
  // attempt's cancellation seam (Task 6's `signal`); `facePipelineStopRef` is the
  // disposer once the pipeline actually starts ticking. Both are read by the
  // unmount-cleanup effect below.
  const facePipelineActiveRef = useRef(false);
  const facePipelineControllerRef = useRef<AbortController | null>(null);
  const facePipelineStopRef = useRef<(() => void) | null>(null);

  /** A pipeline match: resolve it against the already-loaded pourers list (an
   * unknown/stale drinkerId -- the directory can lag a deletion -- is ignored
   * silently, no sheet) and open the one-tap confirm sheet. The pipeline itself always
   * self-stops right after firing this (faceRecognition.ts's `dispose()` inside
   * `startFacePipeline`'s tick handler), so clearing the ref guard here is exactly what
   * lets the NEXT motion/tap start a fresh run -- "Not me" never needs to touch these
   * refs itself, since by the time it's clickable this has already run.
   *
   * Fix round 1 (mis-arm guard): a pipeline started on the grid screen can still be
   * running when someone arms manually in the meantime (hand-tap an avatar, or
   * signup) -- `startFacePipeline`'s own promise chain has no way to know the screen
   * moved on. Without this check, a late `onCandidate` would pop the confirm sheet
   * over whatever screen is now showing, and "Yes" would call `armTablet` with a
   * *different* drinkerId than whoever's actually armed -- core/tabletArm.ts silently
   * replaces the armed slot, so the next pour would attribute to the wrong person.
   * Reading `screenRef.current` here (not a value closed over when the pipeline
   * started) catches every screen the tablet could have moved to since then. The
   * pipeline itself isn't stopped by this -- it already self-stopped by firing
   * `onCandidate` in the first place -- so no extra cleanup is needed here. */
  const handleFaceCandidate = useCallback(({ drinkerId }: MatchCandidate) => {
    facePipelineActiveRef.current = false;
    facePipelineControllerRef.current = null;
    facePipelineStopRef.current = null;
    if (screenRef.current.kind !== 'grid') return;
    const pourer = pourersRef.current.find((p) => p.id === drinkerId);
    if (!pourer) return;
    setFaceConfirm({ id: pourer.id, name: pourer.displayName, color: pourer.avatarColor });
  }, []);

  /** Starts the face pipeline (Task 6) when the directory is enabled/non-empty and the
   * grid screen is showing -- called from two sites below: camera motion (the
   * pipeline's primary trigger) and, when the wall has no camera-motion input at all, a
   * pointer-tap fallback. Reads `faces`/`screen`/`pourers` via refs since it's invoked
   * from event-handler closures that don't otherwise see a fresh render. A fresh
   * `AbortController` per attempt lets the unmount-cleanup effect below close the
   * live-camera-during-model-load window (see faceRecognition.ts's `signal` doc) even
   * if this specific attempt hasn't resolved yet. */
  const maybeStartFacePipeline = useCallback(() => {
    if (facePipelineActiveRef.current) return;
    const directory = facesRef.current;
    if (!directory.enabled || directory.faces.length === 0) return;
    if (screenRef.current.kind !== 'grid') return;

    facePipelineActiveRef.current = true;
    const controller = new AbortController();
    facePipelineControllerRef.current = controller;

    startFacePipeline({
      getEnrolled: () => facesRef.current.faces,
      threshold: facesRef.current.threshold,
      onCandidate: handleFaceCandidate,
      signal: controller.signal,
    }).then((disposer) => {
      if (facePipelineControllerRef.current === controller) facePipelineControllerRef.current = null;
      if (!disposer) {
        facePipelineActiveRef.current = false;
        return;
      }
      facePipelineStopRef.current = disposer;
    });
  }, [handleFaceCandidate]);

  // Belt and braces (Task 7): on unmount, abort whichever attempt's controller is still
  // live -- stops a camera that's mid getUserMedia/model-load immediately, per
  // faceRecognition.ts's `signal` contract, rather than waiting for that promise to
  // settle -- AND call the disposer if one had already resolved by then. Both are
  // idempotent (an aborted `startFacePipeline` resolves without ever setting
  // `facePipelineStopRef`; a disposer's own `dispose()` is safe to call more than
  // once), so running both unconditionally here is safe regardless of which stage the
  // pipeline was in when the component unmounted.
  useEffect(() => () => {
    facePipelineControllerRef.current?.abort();
    facePipelineStopRef.current?.();
  }, []);

  // Task 8 (face sign-in, Plan B): the armed screen's enrollment capture panel.
  // 'idle' means "no panel" -- the armed screen instead shows either "Add my face" or
  // (already enrolled) "Face sign-in: enrolled" + delete, decided by `isEnrolled`
  // below. `enrollVideoRef` is the panel's live preview element; `enrollControllerRef`/
  // `enrollDisposeRef` mirror the face pipeline's own refs above for the identical
  // reason -- an in-flight `startFaceEnrollment` start (camera/model still loading)
  // needs a way to be cancelled before it resolves, not just after.
  const [enrollState, setEnrollState] = useState<'idle' | 'capturing' | 'retry' | 'done'>('idle');
  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);
  const enrollControllerRef = useRef<AbortController | null>(null);
  const enrollDisposeRef = useRef<(() => void) | null>(null);

  // Only meaningful while armed -- the enrollment UI only ever renders there -- but
  // read from a plain `const` (not a ref) since, unlike the pipeline's event-handler
  // closures, everything below runs from React state/effects that already see a fresh
  // render.
  const armedDrinkerId = screen.kind === 'armed' ? screen.pourer.id : null;
  const isEnrolled = armedDrinkerId !== null && faces.faces.some((f) => f.drinkerId === armedDrinkerId);

  /** Starts (and, for "try again", re-starts) the capture loop whenever `enrollState`
   * becomes 'capturing'. The cleanup below is what actually guarantees the
   * camera-release contract across every path that can end a capture early -- Cancel,
   * a screen change away from 'armed' (see the reset effect below), and component
   * unmount all just change/remove `enrollState`, which this cleanup responds to
   * identically. A capture that finishes on its own (3rd capture, or the 15s timeout)
   * has ALREADY released the camera by the time it calls `setEnrollState` -- this
   * cleanup running for that transition is a harmless no-op (`enrollDisposeRef.current`
   * is already null by then). */
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
    }).then((dispose) => {
      if (enrollControllerRef.current === controller) enrollControllerRef.current = null;
      if (!dispose) {
        // Camera unavailable/denied -- nothing ever started capturing. Land on the
        // same "try again" affordance a mid-capture timeout would show, rather than
        // leaving the panel stuck on a dead preview.
        setEnrollState('retry');
        return;
      }
      enrollDisposeRef.current = dispose;
    });

    return () => {
      controller.abort();
      enrollDisposeRef.current?.();
      enrollDisposeRef.current = null;
    };
  }, [enrollState, armedDrinkerId]);

  // A screen change away from 'armed' while the panel is still open (e.g. Sign out
  // mid-capture) must close it -- the effect above only reacts to `enrollState` itself,
  // so without this an abandoned 'capturing'/'retry'/'done' state would otherwise
  // linger (invisible, since the panel only renders inside the 'armed' branch below,
  // but a later re-arm would resume mid-flow instead of starting clean). Setting
  // 'idle' here re-triggers the effect above's cleanup, releasing the camera.
  useEffect(() => {
    if (screen.kind !== 'armed' && enrollState !== 'idle') setEnrollState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the transition matters
  }, [screen.kind]);

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
   * itself -- the server's DELETE broadcasts `faces_changed`, and `loadFaces` above
   * already refetches on that, same as enrollment's own POSTs do. */
  async function handleDeleteFace() {
    if (armedDrinkerId === null) return;
    await deleteFaces(armedDrinkerId);
    setEnrollState('idle');
  }

  // Page-root wake-tap throttle (Task 10): a `useRef` timestamp guard, not state — this
  // must never trigger a re-render on every tap. The off-overlay's own `onWake` (below)
  // bypasses this entirely, calling `wake()` directly, so a tap that lands there always
  // wakes even mid-throttle-window.
  const lastPointerWakeRef = useRef(0);
  const handlePointerDownWake = useCallback(() => {
    // Task 7: with no camera-motion input at all, a tablet's only "someone's here"
    // signal is a tap -- fall back to it as the pipeline's trigger. When camera motion
    // IS enabled, motion (below) is the sole trigger; a touch here is already the
    // "who's pouring" tap itself, not a face-recognition opportunity, and starting a
    // second detection path on top would just fight the first for the camera.
    if (!cameraMotionEnabled) maybeStartFacePipeline();
    const now = Date.now();
    if (now - lastPointerWakeRef.current < POINTER_WAKE_THROTTLE_MS) return;
    lastPointerWakeRef.current = now;
    wake();
  }, [wake, cameraMotionEnabled, maybeStartFacePipeline]);

  // Camera motion input (Task 11): fully opt-in per wall — `startCameraMotion` is only
  // ever called while `displayPower.cameraMotion` is true, and this effect's own
  // cleanup (which fires on every dependency change, including the flag flipping to
  // false, and on unmount) disposes it. `disposed` guards the case where the flag
  // flips off again before the async `startCameraMotion()` call resolves, so a
  // just-granted camera stream doesn't leak past its owning effect run.
  const lastCameraWakeRef = useRef(0);
  useEffect(() => {
    if (!cameraMotionEnabled) return undefined;
    let disposed = false;
    let stop: (() => void) | null = null;
    startCameraMotion({
      onMotion: () => {
        // Task 7: the pipeline's primary trigger. Unthrottled (unlike wake() below) --
        // the ref guard above already makes a redundant call here a no-op, so there's
        // no need to gate it behind the wake-post's own 5s cooldown.
        maybeStartFacePipeline();
        const now = Date.now();
        if (now - lastCameraWakeRef.current < CAMERA_WAKE_THROTTLE_MS) return;
        lastCameraWakeRef.current = now;
        wake('camera');
      },
    }).then((disposer) => {
      if (disposed) {
        disposer?.();
        return;
      }
      stop = disposer;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [cameraMotionEnabled, wake, maybeStartFacePipeline]);

  const loadPourers = useCallback(() => {
    setPourersStatus('loading');
    getPourers().then((result) => {
      if (result.ok) {
        setPourers(result.data);
        setPourersStatus('loaded');
      } else {
        setPourersStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    if (screen.kind === 'grid') loadPourers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on each return to the grid
  }, [screen.kind]);

  // Session poll (5s): keeps the per-member bars live while a group tab runs.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSession().then((result) => {
        if (cancelled || !result.ok) return;
        setSession('totals' in result.data ? result.data : null);
      });
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Done screen: 5s auto sign-out countdown ("tap to stay" re-arms instead).
  useEffect(() => {
    if (screen.kind !== 'done') return undefined;
    setCountdown(DONE_SIGNOUT_SECONDS);
    const started = Date.now();
    const id = setInterval(() => {
      const left = DONE_SIGNOUT_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        disarmTablet();
        setScreen({ kind: 'grid' });
      } else {
        setCountdown(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [screen]);

  async function selectPourer(pourer: ActivePourer) {
    setBusy(true);
    // With a session running, picking yourself also joins the group tab (6c).
    if (session) {
      const joined = await joinSession(pourer.id);
      if (joined.ok) setSession(joined.data);
    }
    const result = await armTablet(pourer.id);
    setBusy(false);
    if (result.ok) setScreen({ kind: 'armed', pourer });
  }

  /** "Yes, that's me" on the face-confirm sheet (Task 7): close the sheet and run the
   * exact same arm flow a manual avatar tap uses -- `selectPourer` already handles the
   * session-join branch and the armed-screen transition, so a face-match confirm and a
   * hand-tap confirm are indistinguishable from here on. */
  async function confirmFaceMatch(pourer: ActivePourer) {
    setFaceConfirm(null);
    await selectPourer(pourer);
  }

  async function handleStartSession() {
    const result = await startSession();
    if (result.ok) setSession(result.data);
  }

  async function handleEndSession() {
    const result = await endSession();
    if (result.ok) {
      setSession(null);
      setRecap(result.data);
      setTimeout(() => setRecap(null), 12_000);
    }
  }

  async function submitSignup() {
    const name = signupName.trim();
    if (!name) {
      setSignupError('A name is all we need.');
      return;
    }
    setBusy(true);
    setSignupError(null);
    const result = await createPourer(name, signupColor);
    if (!result.ok) {
      setBusy(false);
      setSignupError(result.message);
      return;
    }
    const created = result.data;
    const arm = await armTablet(created.id);
    setBusy(false);
    if (arm.ok) {
      setSignupName('');
      setScreen({
        kind: 'armed',
        pourer: { id: created.id, name: created.displayName, color: created.avatarColor },
      });
    } else {
      setSignupError(arm.message);
    }
  }

  async function signOut() {
    disarmTablet();
    setScreen({ kind: 'grid' });
  }

  async function stayAfterDone(pourer: ActivePourer) {
    const result = await armTablet(pourer.id);
    if (result.ok) setScreen({ kind: 'armed', pourer });
    else setScreen({ kind: 'grid' });
  }

  if (loading && !wall) {
    return (
      <main className="tablet-page__loading flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100" data-testid="tablet-page-loading">
        <p>Loading…</p>
      </main>
    );
  }

  if (!wall) {
    return (
      <main className="tablet-page__error flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 text-center text-neutral-100" data-testid="tablet-page-error">
        <h1 className="font-display text-2xl">{notFound ? 'This tablet link doesn’t exist' : 'Tablet unavailable'}</h1>
        <p className="text-neutral-300">{`Check the link — /tablet/${slug ?? ''} needs a wall slug.`}</p>
      </main>
    );
  }

  const pouringTap = taps.find((t) => t.pouring);

  return (
    <ThemeProvider theme={wall.config.theme} className="tablet-page">
      <div
        className="tablet-page__frame"
        data-testid="tablet-page"
        onPointerDownCapture={handlePointerDownWake}
      >
        <ScreenCare stage={effectiveStage} taps={[]} title={wall.name || ''} onWake={() => wake()}>
          {screen.kind === 'grid' && (
            <div className="tablet-screen" data-testid="tablet-grid">
              <header className="tablet-screen__header">
                <span className="tablet-screen__title font-display">Who’s pouring?</span>
                <span className="tablet-screen__clock font-tabular">{clock}</span>
              </header>
              {pourersStatus === 'error' && (
                <p className="tablet-screen__quiet" role="alert">
                  Couldn’t load pourers.
                  {' '}
                  <button type="button" className="tablet-screen__link" onClick={loadPourers}>Try again</button>
                </p>
              )}
              <div className="tablet-grid__avatars" data-testid="tablet-avatars">
                {pourers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="tablet-avatar"
                    data-testid="tablet-avatar"
                    disabled={busy}
                    onClick={() => selectPourer({ id: p.id, name: p.displayName, color: p.avatarColor })}
                  >
                    <span className="tablet-avatar__circle font-display" style={{ backgroundColor: p.avatarColor ?? '#7A6C58' }}>
                      {initials(p.displayName)}
                    </span>
                    <span className="tablet-avatar__name">{p.displayName}</span>
                    <span className="tablet-avatar__pours font-tabular">{`${p.pourCount} pours`}</span>
                  </button>
                ))}
              </div>
              {session && (
                <div className="tablet-session" data-testid="tablet-session">
                  <div className="tablet-session__head">
                    <span className="tablet-session__name font-display">{`${session.name.toUpperCase()} · GROUP TAB`}</span>
                    <button type="button" data-testid="tablet-session-end" className="tablet-secondary" onClick={handleEndSession}>
                      End session
                    </button>
                  </div>
                  {session.totals.length === 0 ? (
                    <span className="tablet-screen__quiet">Tap your avatar to join the session.</span>
                  ) : (
                    session.totals.map((member) => {
                      const max = Math.max(1, ...session.totals.map((t) => t.volumeMl));
                      return (
                        <div key={member.drinkerId} className="tablet-session__row" data-testid="tablet-session-row">
                          <span className="tablet-session__member">{member.name}</span>
                          <span className="tablet-session__bar">
                            <span className="tablet-session__bar-fill" style={{ width: `${Math.round((member.volumeMl / max) * 100)}%` }} />
                          </span>
                          <span className="tablet-session__count font-tabular">
                            {`${member.pourCount} pour${member.pourCount === 1 ? '' : 's'} · ${formatVolumeMl(member.volumeMl, units)}`}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              <div className="tablet-grid__footer">
                <button
                  type="button"
                  className="tablet-cta"
                  data-testid="tablet-signup-button"
                  onClick={() => setScreen({ kind: 'signup' })}
                >
                  I’M NEW — SIGN ME UP
                </button>
                {!session && (
                  <button
                    type="button"
                    className="tablet-secondary"
                    data-testid="tablet-session-start"
                    onClick={handleStartSession}
                  >
                    Start session
                  </button>
                )}
                <span className="tablet-grid__hint">or scan the QR on the wall with your phone</span>
              </div>
            </div>
          )}

          {screen.kind === 'signup' && (
            <div className="tablet-screen" data-testid="tablet-signup">
              <span className="tablet-screen__title font-display">New pourer</span>
              <span className="tablet-screen__quiet">Just a name — no email, no password.</span>
              <input
                type="text"
                className="tablet-signup__name"
                data-testid="tablet-signup-name"
                value={signupName}
                maxLength={40}
                placeholder="Your name"
                onChange={(e) => setSignupName(e.target.value)}
              />
              <div className="tablet-signup__colors-label">PICK YOUR COLOR</div>
              <div className="tablet-signup__colors">
                {POURER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Avatar color ${color}`}
                    data-testid="tablet-signup-color"
                    className={color === signupColor ? 'tablet-signup__swatch tablet-signup__swatch--active' : 'tablet-signup__swatch'}
                    style={{ backgroundColor: color }}
                    onClick={() => setSignupColor(color)}
                  />
                ))}
              </div>
              {signupError && <p className="tablet-screen__error" role="alert" data-testid="tablet-signup-error">{signupError}</p>}
              <div className="tablet-signup__actions">
                <button type="button" className="tablet-cta" data-testid="tablet-signup-submit" disabled={busy} onClick={submitSignup}>
                  START POURING
                </button>
                <button type="button" className="tablet-secondary" onClick={() => setScreen({ kind: 'grid' })}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {screen.kind === 'armed' && (
            <div className="tablet-screen tablet-screen--center" data-testid="tablet-armed">
              <div className="tablet-armed__who">
                <span className="tablet-avatar__circle tablet-avatar__circle--small font-display" style={{ backgroundColor: screen.pourer.color ?? '#7A6C58' }}>
                  {initials(screen.pourer.name)}
                </span>
                <span className="tablet-armed__hint">
                  {'You’re up, '}
                  <b>{screen.pourer.name}</b>
                  {' — pour from any tap'}
                </span>
              </div>
              {pouringTap ? (
                <>
                  <span className="tablet-armed__detected font-display" data-testid="tablet-detected">
                    <span className={reducedMotion ? 'look-pour-dot' : 'look-pour-dot look-pour-dot--pulse'} />
                    {`DETECTED · TAP ${pouringTap.tapNumber}${pouringTap.beer ? ` · ${pouringTap.beer.name.toUpperCase()}` : ''}`}
                  </span>
                  <div className="tablet-armed__counter" data-testid="tablet-counter">
                    <span className="tablet-armed__counter-value font-display font-tabular">
                      {formatVolumeMl(pouringTap.curServMl ?? 0, units).split(' ')[0]}
                    </span>
                    <span className="tablet-armed__counter-unit font-display">
                      {units === 'metric' ? 'ML' : 'OZ'}
                    </span>
                  </div>
                </>
              ) : (
                <span className="tablet-armed__waiting" data-testid="tablet-waiting">
                  No beer selection needed — Kegtron knows which tap is flowing
                </span>
              )}
              {/* Task 8 (face sign-in, Plan B): "note the directory only carries faces
                  when enabled" -- gating the whole row on `faces.enabled` (rather than
                  just the "Add my face" branch) keeps the delete branch from ever
                  rendering off a stale/disabled directory too. */}
              {faces.enabled && (
                enrollState === 'idle' ? (
                  isEnrolled ? (
                    <div className="face-enroll__summary" data-testid="face-enroll-summary">
                      <span className="face-enroll__status">Face sign-in: enrolled</span>
                      <button
                        type="button"
                        className="tablet-secondary"
                        data-testid="face-enroll-delete"
                        onClick={handleDeleteFace}
                      >
                        Remove my face data
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="tablet-secondary"
                      data-testid="face-enroll-start"
                      onClick={handleStartEnroll}
                    >
                      Add my face
                    </button>
                  )
                ) : (
                  <div className="face-enroll" data-testid="face-enroll-panel">
                    {enrollState === 'capturing' && (
                      <>
                        <video
                          ref={enrollVideoRef}
                          className="face-enroll__preview"
                          data-testid="face-enroll-preview"
                          width={320}
                          height={240}
                          muted
                          playsInline
                        />
                        <span className="face-enroll__hint">Look at the camera…</span>
                        <button
                          type="button"
                          className="tablet-secondary"
                          data-testid="face-enroll-cancel"
                          onClick={handleCancelEnroll}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {enrollState === 'retry' && (
                      <>
                        <span className="face-enroll__hint" role="alert">No face found — try again</span>
                        <div className="face-enroll__actions">
                          <button
                            type="button"
                            className="tablet-cta"
                            data-testid="face-enroll-retry"
                            onClick={handleRetryEnroll}
                          >
                            Try again
                          </button>
                          <button
                            type="button"
                            className="tablet-secondary"
                            data-testid="face-enroll-cancel"
                            onClick={handleCancelEnroll}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                    {enrollState === 'done' && (
                      <>
                        <span className="face-enroll__hint">Face saved — you can sign in by camera next time.</span>
                        <button
                          type="button"
                          className="tablet-secondary"
                          data-testid="face-enroll-delete"
                          onClick={handleDeleteFace}
                        >
                          Remove my face data
                        </button>
                      </>
                    )}
                  </div>
                )
              )}
              <button type="button" className="tablet-secondary tablet-armed__signout" data-testid="tablet-signout" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}

          {screen.kind === 'done' && (
            <button
              type="button"
              className="tablet-screen tablet-screen--center tablet-done"
              data-testid="tablet-done"
              onClick={() => stayAfterDone(screen.pourer)}
            >
              <span className="tablet-done__check">✓</span>
              <span className="tablet-done__title font-display">{`Cheers, ${screen.pourer.name}`}</span>
              <span className="tablet-done__detail">
                <b>
                  {formatVolumeMl(screen.pour.volumeMl, units)}
                  {screen.pour.beerName ? ` of ${screen.pour.beerName}` : ''}
                </b>
                {` logged to you · pour #${screen.pour.pourCount}`}
              </span>
              <span className="tablet-done__countdown font-tabular" data-testid="tablet-countdown">
                {`Signing out in ${countdown}s — tap to stay`}
              </span>
            </button>
          )}
          {recap && (
            <button
              type="button"
              className="tablet-recap"
              data-testid="tablet-recap"
              onClick={() => setRecap(null)}
            >
              <span className="tablet-done__title font-display">{`${recap.name.toUpperCase()} — RECAP`}</span>
              {recap.totals.map((member) => (
                <span key={member.drinkerId} className="tablet-recap__row font-tabular">
                  {`${member.name}: ${member.pourCount} pour${member.pourCount === 1 ? '' : 's'} · ${formatVolumeMl(member.volumeMl, units)}`}
                </span>
              ))}
              <span className="tablet-screen__quiet">Tap to dismiss</span>
            </button>
          )}
          {faceConfirm && (
            <div className="claim-sheet__backdrop" data-testid="face-confirm-sheet">
              <div
                className="face-confirm__sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="face-confirm-heading"
              >
                <span
                  className="tablet-avatar__circle font-display"
                  style={{ backgroundColor: faceConfirm.color ?? '#7A6C58' }}
                >
                  {initials(faceConfirm.name)}
                </span>
                <p id="face-confirm-heading" className="face-confirm__prompt font-display">
                  {'You pouring, '}
                  <b>{faceConfirm.name}</b>
                  ?
                </p>
                <div className="face-confirm__actions">
                  <button
                    type="button"
                    className="face-confirm__yes"
                    data-testid="face-confirm-yes"
                    onClick={() => confirmFaceMatch(faceConfirm)}
                  >
                    Yes, that&rsquo;s me
                  </button>
                  <button
                    type="button"
                    className="face-confirm__no"
                    data-testid="face-confirm-no"
                    onClick={() => setFaceConfirm(null)}
                  >
                    Not me
                  </button>
                </div>
              </div>
            </div>
          )}
        </ScreenCare>
      </div>
    </ThemeProvider>
  );
}

import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useParams } from 'react-router';
import { useWallData } from '../lib/useWallData';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { ThemeProvider } from '../themes/ThemeProvider';
import { useLookClock } from '../components/looks/lookShared';
import { ScreenCare } from '../components/ScreenCare';
import { useDisplayPower } from '../lib/displayPower';
import { startCameraMotion } from '../lib/cameraMotion';
import {
  armTablet, createPourer, disarmTablet, getFaces, getPourers,
  getSession, startSession, joinSession, endSession, type FaceDirectory, type PublicPourer,
  type SessionSnapshotResponse,
} from '../lib/api';
import { useFacePipeline } from '../lib/useFacePipeline';
import { useFaceEnrollment } from '../lib/useFaceEnrollment';
import { initials } from '../lib/initials';
import { usePolledFetch } from '../lib/usePolledFetch';
import { FaceEnrollPanel } from '../components/FaceEnrollPanel';
import { TabletSession, TabletSessionRecap } from '../components/TabletSession';
import { useFocusTrap } from '../lib/useFocusTrap';
import { KioskWho } from './tablet/KioskWho';
import { KioskArmed, KioskDone } from './tablet/KioskPour';
// Styles only this route tree uses (split out of index.css in Kegwall V2 M1).
import './tablet.css';
import '../components/sheetBackdrop.css';

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
  // Big-roster "find your name" search (redesign 2g) — filters the pourer grid client-side.
  const [pourerQuery, setPourerQuery] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupColor, setSignupColor] = useState(POURER_COLORS[0]!);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
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
  const [faces, setFaces] = useState<FaceDirectory>({ enabled: false });

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
    wall, taps, units, servingSizeMl, stale, connected, loading, notFound,
  } = useWallData(slug, { onMessage: handleWsMessage });

  // F3 fix: same dead-server fallback as WallPage -- see that file's comment. A dead
  // server can't push a fresh display_power frame, so a stale `'off'` would otherwise
  // black out the kegerator tablet indefinitely (and the wake tap would just POST into
  // the same dead server). Force `'active'` whenever the connection is stale/disconnected.
  const effectiveStage = stale || !connected ? 'active' : stage;

  // Read ahead of both trigger sites below (pointer fallback + camera motion) since the
  // pointer fallback needs to know whether camera motion is even in play.
  const cameraMotionEnabled = wall?.config.displayPower.cameraMotion ?? false;

  // Task 7 (face sign-in, Plan B): the face-match pipeline's ref choreography -- the
  // "at most one at a time" guard, candidate resolution into the one-tap confirm
  // sheet, and every teardown path (unmount, screen-leaves-grid, directory-goes-
  // disabled) -- lives in useFacePipeline; TabletPage wires its two trigger sites
  // (camera motion + the pointer-tap fallback) below.
  const { faceConfirm, setFaceConfirm, maybeStartFacePipeline } = useFacePipeline({
    screenRef, screenKind: screen.kind, faces, pourers,
  });

  const faceSheetRef = useRef<HTMLDivElement | null>(null);
  const closeFaceConfirm = useCallback(() => setFaceConfirm(null), [setFaceConfirm]);
  useFocusTrap(faceSheetRef, faceConfirm !== null, closeFaceConfirm);

  // Only meaningful while armed -- the enrollment UI only ever renders there -- but
  // read from a plain `const` (not a ref) since, unlike the pipeline's event-handler
  // closures, everything the enrollment hook does runs from React state/effects that
  // already see a fresh render.
  const armedDrinkerId = screen.kind === 'armed' ? screen.pourer.id : null;
  // Task 8 (face sign-in, Plan B): the armed screen's enrollment capture panel --
  // state machine, camera lifecycle, and handlers all live in useFaceEnrollment;
  // <FaceEnrollPanel> in the armed branch below renders it.
  const faceEnrollment = useFaceEnrollment({ armedDrinkerId, screenKind: screen.kind, faces });

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
  usePolledFetch((isCancelled) => {
    getSession().then((result) => {
      if (isCancelled() || !result.ok) return;
      setSession('totals' in result.data ? result.data : null);
    });
  }, { intervalMs: 5000 });

  // Done screen: 5s auto sign-out countdown ("tap to stay" re-arms instead).
  // `doneCountdownRef` exposes the live interval id to `stayAfterDone` below so the tap
  // handler can clear it SYNCHRONOUSLY -- this effect's own cleanup only runs after
  // React commits the post-`setScreen` render, which is NOT guaranteed to beat the
  // interval's next 250ms tick once `stayAfterDone` has an `await` on the stack (see
  // that function's comment for the arm/disarm race the tick would open).
  const doneCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    doneCountdownRef.current = id;
    return () => {
      clearInterval(id);
      // Only null the ref if it still points at THIS run's interval -- `stayAfterDone`
      // may have already cleared+nulled it, and a re-entered done screen owns a newer
      // interval by the time this stale cleanup runs.
      if (doneCountdownRef.current === id) doneCountdownRef.current = null;
    };
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
    if (result.ok) {
      setPickError(null);
      setScreen({ kind: 'armed', pourer });
    } else {
      // Arming failed: say so, or the pourer thinks the next pour is theirs.
      setPickError(`Couldn’t get the taps ready for ${pourer.name}. Try again.`);
    }
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
    }
  }

  // The session recap shows for 12 s, and its timer dies with the page.
  useEffect(() => {
    if (!recap) return undefined;
    const id = setTimeout(() => setRecap(null), 12_000);
    return () => clearTimeout(id);
  }, [recap]);

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

  function signOut() {
    disarmTablet();
    setScreen({ kind: 'grid' });
  }

  async function stayAfterDone(pourer: ActivePourer) {
    // Race fix: stop the auto-sign-out countdown SYNCHRONOUSLY, before the awaited
    // armTablet POST ever goes out. With <250ms left on the countdown, the interval's
    // next tick would otherwise fire disarmTablet() while the arm POST is still in
    // flight: the server processes arm -> disarm (actually disarmed), then the resolved
    // arm's `.ok` flips the UI to the armed screen -- "You're up" -- and the next pour
    // goes unattributed while the UI claims otherwise. Clearing the interval here (not
    // relying on the countdown effect's cleanup, which only runs after the post-await
    // re-render commits) makes the disarm tick impossible the instant "stay" is tapped.
    if (doneCountdownRef.current !== null) {
      clearInterval(doneCountdownRef.current);
      doneCountdownRef.current = null;
    }
    const result = await armTablet(pourer.id);
    if (result.ok) {
      setScreen({ kind: 'armed', pourer });
    } else {
      // The re-arm failed and the countdown above is already dead -- don't strand the
      // user on a frozen done screen. Mirror what the countdown reaching 0 would have
      // done (disarm + back to the grid): the pour's original arm may still be live
      // server-side, and showing the grid while leaving it armed would silently
      // attribute the NEXT pour to this pourer.
      disarmTablet();
      setScreen({ kind: 'grid' });
    }
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
            <KioskWho
              pourers={pourers}
              pourersStatus={pourersStatus}
              busy={busy}
              clock={clock}
              faceSignIn={faces.enabled}
              error={pickError}
              onRetry={loadPourers}
              onPick={(p) => { void selectPourer(p); }}
              onNew={() => setScreen({ kind: 'signup' })}
              session={(
                <>
                  {session && <TabletSession session={session} units={units} onEndSession={handleEndSession} />}
                  {!session && (
                    <button type="button" className="tablet-secondary" data-testid="tablet-session-start" onClick={handleStartSession}>
                      Start a group tab
                    </button>
                  )}
                </>
              )}
            />
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
            <KioskArmed
              pourer={screen.pourer}
              units={units}
              servingSizeMl={servingSizeMl}
              reducedMotion={reducedMotion}
              pouringTap={pouringTap}
              onSignOut={signOut}
            >
              <FaceEnrollPanel enabled={faces.enabled} enrollment={faceEnrollment} />
            </KioskArmed>
          )}

          {screen.kind === 'done' && (
            <KioskDone
              pourer={screen.pourer}
              units={units}
              servingSizeMl={servingSizeMl}
              reducedMotion={reducedMotion}
              pour={screen.pour}
              countdown={countdown}
              onStay={() => { void stayAfterDone(screen.pourer); }}
            />
          )}
          {recap && (
            <TabletSessionRecap recap={recap} units={units} onDismiss={() => setRecap(null)} />
          )}
          {faceConfirm && (
            <div className="claim-sheet__backdrop" data-testid="face-confirm-sheet">
              <div
                ref={faceSheetRef}
                className="face-confirm__sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="face-confirm-heading"
                tabIndex={-1}
              >
                <span
                  className="kiosk-avatar kiosk-avatar--big"
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

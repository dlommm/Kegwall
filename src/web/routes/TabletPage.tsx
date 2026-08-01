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
  armTablet, createPourer, disarmTablet, getPourers, getSession, startSession,
  joinSession, endSession, type PublicPourer, type SessionSnapshotResponse,
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

  // Task 10: the server-pushed display power stage rides the same /ws socket as
  // pour_attributed below — onWsMessage is chained in alongside it.
  const { stage, onWsMessage, wake } = useDisplayPower(slug);

  const handleWsMessage = useCallback((msg: unknown) => {
    onWsMessage(msg);
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
  }, [onWsMessage]);

  const { wall, taps, units, loading, notFound } = useWallData(slug, { onMessage: handleWsMessage });

  // Page-root wake-tap throttle (Task 10): a `useRef` timestamp guard, not state — this
  // must never trigger a re-render on every tap. The off-overlay's own `onWake` (below)
  // bypasses this entirely, calling `wake()` directly, so a tap that lands there always
  // wakes even mid-throttle-window.
  const lastPointerWakeRef = useRef(0);
  const handlePointerDownWake = useCallback(() => {
    const now = Date.now();
    if (now - lastPointerWakeRef.current < POINTER_WAKE_THROTTLE_MS) return;
    lastPointerWakeRef.current = now;
    wake();
  }, [wake]);

  // Camera motion input (Task 11): fully opt-in per wall — `startCameraMotion` is only
  // ever called while `displayPower.cameraMotion` is true, and this effect's own
  // cleanup (which fires on every dependency change, including the flag flipping to
  // false, and on unmount) disposes it. `disposed` guards the case where the flag
  // flips off again before the async `startCameraMotion()` call resolves, so a
  // just-granted camera stream doesn't leak past its owning effect run.
  const cameraMotionEnabled = wall?.config.displayPower.cameraMotion ?? false;
  const lastCameraWakeRef = useRef(0);
  useEffect(() => {
    if (!cameraMotionEnabled) return undefined;
    let disposed = false;
    let stop: (() => void) | null = null;
    startCameraMotion({
      onMotion: () => {
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
  }, [cameraMotionEnabled, wake]);

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
        <ScreenCare stage={stage} taps={[]} title={wall.name || ''} onWake={() => wake()}>
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
        </ScreenCare>
      </div>
    </ThemeProvider>
  );
}

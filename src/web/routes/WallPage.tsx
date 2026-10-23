import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useWallData } from '../lib/useWallData';
import {
  getDisplayView, getLeaderboard, getSensors,
  type AmbientSensorReading, type DisplayView, type LeaderboardResponse,
} from '../lib/api';
import { useViewRotation } from '../lib/useViewRotation';
import { PlaylistBar } from '../components/PlaylistBar';
import { LeaderboardBoard } from '../components/LeaderboardBoard';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { formatTempC } from '../lib/units';
import { useBanners, type BannerKind } from '../lib/useBanners';
import { usePolledFetch } from '../lib/usePolledFetch';
import { useRotatingPageIndex, wallPagesFor } from '../lib/wallPages';
import { ThemeProvider } from '../themes/ThemeProvider';
import {
  WallLook, autoPageSize, resolveLook,
} from '../components/looks/WallLook';
import { Stage } from '../design/Stage';
import { PourLayer } from '../wall/pour/PourLayer';
import { usePourLanes, type RecordedPour } from '../wall/pour/usePourLanes';
import {
  MOMENT_MS, WallMoment, isWallMomentEvent, type WallMomentEvent,
} from '../wall/pour/WallMoment';
import { BannerLane } from '../components/BannerLane';
import { GameStrip } from '../components/GameStrip';
import { ScreenCare } from '../components/ScreenCare';
import { useDisplayPower } from '../lib/displayPower';
// Styles only this route tree uses (split out of index.css in Kegwall V2 M1).
import './wall.css';

declare global {
  interface Window {
    /** Dev-build-only manual test hook for pushing a wall banner (see the Task 5 plan) —
     * kept alongside the real server-driven path below (Phase 5 Task 4), not replaced by
     * it — still handy for local dev/design work without a running automation rule. */
    __wall?: { banner: (text: string, kind?: BannerKind) => void };
  }
}

const DEFAULT_ROTATION_SECONDS = 15;

/** The server's `wall_banner` action kind (`{type:'banner', kind: 'info'|'celebrate'|
 * 'warning', ...}`, see core/automationSchema.ts's ActionSchema) is a distinct enum from
 * the wall's local `BannerKind` (`'info'|'warning'|'success'`, from Phase 3's
 * `useBanners`) — 'celebrate' maps onto the existing 'success' styling (BannerLane/
 * index.css already define a `--success` accent treatment; no new CSS needed), the other
 * two pass straight through. */
function mapServerBannerKind(kind: string): BannerKind {
  if (kind === 'celebrate') return 'success';
  if (kind === 'warning') return 'warning';
  return 'info';
}

interface WsBannerMessage {
  type: 'banner';
  text: string;
  kind: string;
  durationMs?: number;
}

interface WsThemeOverrideMessage {
  type: 'theme_override';
  minutes: number;
}

function isWsBannerMessage(msg: unknown): msg is WsBannerMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'banner'
    && typeof (msg as { text?: unknown }).text === 'string' && typeof (msg as { kind?: unknown }).kind === 'string';
}

function isWsThemeOverrideMessage(msg: unknown): msg is WsThemeOverrideMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'theme_override'
    && typeof (msg as { minutes?: unknown }).minutes === 'number';
}

/** Kegwall V2: a recorded pour, relayed by ws.ts so the takeover finishes on its volume. */
interface WsPourRecordedMessage {
  type: 'pour_recorded';
  tapId: number;
  volumeMl: number;
  durationMs: number | null;
  pourerName: string | null;
  pourerPourCount: number | null;
}

function isWsPourRecordedMessage(msg: unknown): msg is WsPourRecordedMessage {
  const m = msg as { type?: unknown; tapId?: unknown; volumeMl?: unknown } | null;
  return typeof m === 'object' && m !== null && m.type === 'pour_recorded'
    && typeof m.tapId === 'number' && typeof m.volumeMl === 'number';
}

/** The 60s host-health frame ws.ts relays for walls with showHostStats. */
interface WsHostStatsMessage {
  type: 'host_stats';
  cpuPct: number;
  memPct: number;
  diskPct: number | null;
  tempC: number | null;
  watts: number | null;
  ts: string;
}

function isWsHostStatsMessage(msg: unknown): msg is WsHostStatsMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'host_stats'
    && typeof (msg as { cpuPct?: unknown }).cpuPct === 'number';
}

/**
 * Party mode's "temporary theme override" (Phase 5 Task 4): rather than swapping to a
 * whole separate named theme (which would mean either adding a 5th entry to
 * `themes.ts`'s curated, exactly-four `THEMES` catalog — a deliberate Phase 3 design
 * boundary, see themes.test.ts's "ships exactly the four built-in themes" — or
 * maintaining a hidden non-catalog theme object), this layers a fixed accent-color
 * override on top of whatever theme the wall is already configured with, using
 * `ThemeProvider`'s existing `theme.overrides` mechanism (already used for wall-level
 * per-token customization, already CSS-injection-guarded by `themes.ts`'s
 * `isSafeOverride`). No CSS animation is added for this (unlike BannerLane's slide-in) —
 * a static color swap needs no `prefers-reduced-motion` gating in the first place, so the
 * plan's "wall/banner changes respect prefers-reduced-motion" constraint is honored
 * trivially rather than needing a second reduced-motion branch here.
 */
const PARTY_MODE_OVERRIDES: Record<string, string> = { '--accent': '#ff2fb0' };

/**
 * The wall itself: `/wall/:slug`, fullscreen, no browser chrome. Composes the live data
 * layer (`useWallData`) with page rotation, the header, the tap grid, banners, an
 * optional QR overlay, and OLED screen care. See the Task 5 report for one still-
 * documented gap: there's no `logoUrl` source yet, so that prop is wired end-to-end and
 * tested but always fed `null` at this call site today. `WallHeader`'s temp readout DOES
 * have a real source as of Task 1 (Phase 4) — `TapState.temp`, populated server-side from
 * the bound monitor's latest telemetry row — so it's derived from all of the wall's taps
 * below (not just the current page) and passed through.
 */
export function WallPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const reducedMotion = usePrefersReducedMotion();
  // TV scale-to-fit: 720p/1080p/4K all render the 1080p-designed wall identically.
  const { queue, push, dismiss } = useBanners();

  // This page is a TV/kiosk — no pointer belongs on it, ever. Hide it at the DOCUMENT ROOT while the
  // wall is mounted: stronger than the scoped `.wall-page { cursor: none }` rule (WPE/cog under the
  // native kiosk didn't reliably honor the scoped rule, and a bare mouse still showed). Restored on
  // unmount so the admin/menu pages are unaffected.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.cursor;
    root.style.cursor = 'none';
    return () => { root.style.cursor = prev; };
  }, []);

  // Per-display overrides (design 7c): a paired display opens
  // /wall/:slug?display=<id> — its stored look/theme/takeover overrides are
  // fetched once and merged over the wall's own config below.
  const displayId = searchParams.get('display');
  const [displayOverrides, setDisplayOverrides] = useState<DisplayView['overrides'] | null>(null);
  useEffect(() => {
    if (!displayId) {
      setDisplayOverrides(null);
      return undefined;
    }
    let cancelled = false;
    getDisplayView(Number(displayId)).then((result) => {
      if (!cancelled && result.ok) setDisplayOverrides(result.data.overrides);
    });
    return () => {
      cancelled = true;
    };
  }, [displayId]);

  // Party mode's countdown-revert timer -- a ref (not state) because it's pure
  // bookkeeping for the effect below, not something a render needs to read.
  const partyModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [partyMode, setPartyMode] = useState(false);

  const [hostStats, setHostStats] = useState<WsHostStatsMessage | null>(null);

  // Task 9: the wall's server-pushed power stage (screensaver/off) rides the SAME /ws
  // socket as everything else below -- `onWsMessage` is chained into handleWsMessage
  // rather than opening a second connection, same reasoning as the banner/theme_override
  // messages already handled here.
  const { stage, onWsMessage, wake } = useDisplayPower(slug);

  // Recent `pour_recorded` frames (Kegwall V2): a takeover finishes on the recorded volume.
  const [recordedPours, setRecordedPours] = useState<RecordedPour[]>([]);
  // Wall moments (Kegwall V2): queued, shown one at a time for MOMENT_MS each. The WS
  // handler reads the wall's moment settings through a ref (it is created before config).
  const momentsEnabledRef = useRef<{ kicked: boolean; tapped: boolean; milestone: boolean } | null>(null);
  const momentQueue = useRef<WallMomentEvent[]>([]);
  const [moment, setMoment] = useState<WallMomentEvent | null>(null);
  const momentShowing = useRef(false);
  const showNextMoment = useCallback(() => {
    const next = momentQueue.current.shift() ?? null;
    momentShowing.current = next !== null;
    setMoment(next);
    if (next) setTimeout(showNextMoment, MOMENT_MS);
  }, []);
  const handleWsMessage = useCallback((msg: unknown) => {
    onWsMessage(msg);
    if (isWallMomentEvent(msg)) {
      if (momentsEnabledRef.current?.[msg.kind]) {
        momentQueue.current.push(msg);
        if (momentQueue.current.length === 1 && !momentShowing.current) showNextMoment();
      }
    } else if (isWsBannerMessage(msg)) {
      // A built-in celebration banner duplicates a moment this wall shows full-screen.
      const tag = (msg as { moment?: 'kicked' | 'milestone' }).moment;
      if (tag && momentsEnabledRef.current?.[tag]) return;
      push(msg.text, mapServerBannerKind(msg.kind), msg.durationMs);
    } else if (isWsHostStatsMessage(msg)) {
      setHostStats(msg);
    } else if (isWsPourRecordedMessage(msg)) {
      setRecordedPours((prev) => [...prev.slice(-9), {
        tapId: msg.tapId, volumeMl: msg.volumeMl, durationMs: msg.durationMs,
        pourerName: msg.pourerName, pourerPourCount: msg.pourerPourCount, at: Date.now(),
      }]);
    } else if (isWsThemeOverrideMessage(msg)) {
      if (partyModeTimerRef.current) clearTimeout(partyModeTimerRef.current);
      setPartyMode(true);
      partyModeTimerRef.current = setTimeout(() => {
        setPartyMode(false);
        partyModeTimerRef.current = null;
      }, msg.minutes * 60_000);
    }
    // Any other/unrecognized `type` is silently ignored (same "unknown types are
    // harmless" contract useTapStates' snapshot handling already has).
  }, [push, onWsMessage, showNextMoment]);

  // Countdown timer cleanup on unmount -- doesn't touch state (nothing to revert to on an
  // unmounted page), just prevents a dangling setTimeout outliving the component.
  useEffect(() => () => {
    if (partyModeTimerRef.current) clearTimeout(partyModeTimerRef.current);
  }, []);

  const {
    wall, taps, units, servingSizeMl, stale, connected, loading, error, notFound,
  } = useWallData(slug, { onMessage: handleWsMessage });

  // F3 fix: a dead/unreachable server can't push a fresh display_power frame, so the last
  // stage the WS delivered would otherwise persist forever (including a stale `'off'`,
  // leaving the screen permanently black with no way to recover short of a power cycle —
  // the wake tap POSTs into the same dead server). Force `'active'` whenever the
  // connection is stale or outright disconnected, mirroring the bash display-agent's own
  // documented safe default (screens stay ON while its stream is unreachable — see
  // docs/install/display-agent.md).
  const effectiveStage = stale || !connected ? 'active' : stage;

  const baseConfig = wall?.config ?? null;
  // Per-display overrides (7c) merge over the wall's own config: look, theme
  // id (keeping the wall's token overrides), and takeover style.
  const config = useMemo(() => {
    if (!baseConfig) return null;
    if (!displayOverrides) return baseConfig;
    return {
      ...baseConfig,
      look: (displayOverrides.look as typeof baseConfig.look | undefined) ?? baseConfig.look,
      theme: displayOverrides.themeId
        ? { ...baseConfig.theme, id: displayOverrides.themeId }
        : baseConfig.theme,
      takeover: displayOverrides.takeoverStyle
        ? { ...baseConfig.takeover, style: displayOverrides.takeoverStyle as typeof baseConfig.takeover.style }
        : baseConfig.takeover,
    };
  }, [baseConfig, displayOverrides]);

  // Page cycling: with no manual pages configured, a wall with more taps than its look
  // holds auto-chunks into pages. Pre-V2 looks were designed around 6 taps per screen;
  // Kegwall V2 stage looks declare their own capacity (the density ladder).
  const pages = useMemo(
    () => wallPagesFor(config?.pages ?? [], taps, autoPageSize(resolveLook(config?.look))),
    [config, taps],
  );
  // Max temp across every tap on the wall (not just the current rotating page) — a
  // site-wide readout, so it shouldn't flicker/change as pages rotate.
  const maxTempC = useMemo(() => {
    const temps = taps.map((t) => t.temp).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.max(...temps) : null;
  }, [taps]);
  const pageIndex = useRotatingPageIndex(pages.length, config?.rotationSeconds ?? DEFAULT_ROTATION_SECONDS);
  const currentTaps = pages[pageIndex] ?? [];
  const transition = reducedMotion ? 'none' : (config?.transition ?? 'crossfade');

  // Pour takeover (Kegwall V2): one lane per qualifying pour on ANY of the wall's taps (not
  // just the current page), finishing on the recorded volume from the WS feed.
  const pourLanes = usePourLanes(taps, config?.takeover, recordedPours);
  const takeoverStyle = config?.takeover?.style ?? 'off';

  // View rotation (design 4a/4b): enabled playlist views cycle on their own
  // timers; a live pour always interrupts back to the wall view.
  const rotationViews = useMemo(
    () => (config?.viewRotation?.enabled
      ? config.viewRotation.views.filter((v) => v.enabled)
      : []),
    [config],
  );
  const anyPouring = taps.some((t) => t.pouring);
  const rotationIndex = useViewRotation(rotationViews, anyPouring);
  const currentViewKind = rotationViews[rotationIndex]?.kind ?? 'wall';
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  // Govee ambient sensors (Phase 6): the header sensor strip's chips, polled
  // on the handoff's ~60s cadence when the header temp strip is on.
  const [ambientSensors, setAmbientSensors] = useState<AmbientSensorReading[]>([]);
  const showTemp = config?.header.showTemp ?? false;
  usePolledFetch((isCancelled) => {
    getSensors().then((result) => {
      if (isCancelled() || !result.ok || !Array.isArray(result.data)) return;
      // Keep the previous array reference when the payload hasn't changed — the
      // memoized WallLook subtree then skips the poll's re-render entirely.
      setAmbientSensors((prev) => (
        JSON.stringify(prev) === JSON.stringify(result.data) ? prev : result.data));
    });
  }, { intervalMs: 60_000, enabled: showTemp });
  usePolledFetch((isCancelled) => {
    getLeaderboard('month').then((result) => {
      if (isCancelled() || !result.ok) return;
      // Same identity-preserving guard as the sensors poll above.
      setBoard((prev) => (
        JSON.stringify(prev) === JSON.stringify(result.data) ? prev : result.data));
    });
  }, {
    intervalMs: 60_000,
    enabled: rotationViews.some((v) => v.kind === 'leaderboard'),
    // A playlist edit swaps `rotationViews` wholesale — refetch immediately, like the
    // hand-rolled effect's `[rotationViews]` dependency did.
    restartKey: rotationViews,
  });
  momentsEnabledRef.current = config?.wallMoments ?? null;

  // Spotlight isn't an overlay: the look lifts every pouring row or card and dims the rest.
  const spotlightTapIds = useMemo(
    () => (takeoverStyle === 'spotlight' && pourLanes.length ? new Set(pourLanes.map((l) => l.tapId)) : null),
    [takeoverStyle, pourLanes],
  );

  // Dev-only manual banner hook (`window.__wall.banner('text')`) — `import.meta.env.DEV`
  // is false in a real `vite build` output, so this never ships to the production wall.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__wall = { banner: push };
    return () => {
      delete window.__wall;
    };
  }, [push]);

  // The loading/not-yet-loaded error states render before any wall config exists, so
  // there's no theme to mount ThemeProvider with yet — fall back to plain Tailwind
  // utilities for a dark, on-brand background instead of a jarring unstyled white page.
  const unthemedFullScreen = 'flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 text-center text-neutral-100';

  if (loading && !wall) {
    return (
      <main className={`wall-page__loading ${unthemedFullScreen}`} data-testid="wall-page-loading">
        <p>Loading the wall…</p>
      </main>
    );
  }

  if (!wall || !config) {
    return (
      <main className={`wall-page__error ${unthemedFullScreen}`} data-testid="wall-page-error">
        <h1 className="font-display text-2xl">{notFound ? 'This wall doesn’t exist' : 'Wall unavailable'}</h1>
        <p className="text-neutral-300">
          {notFound
            ? `No wall is set up at "${slug}" — check the link, or ask an admin to create it.`
            : (error ?? 'Something went wrong loading this wall.')}
        </p>
      </main>
    );
  }

  const title = config.header.title ?? wall.name;
  const menuUrl = `${window.location.origin}/menu`;
  // Party mode layers a fixed accent override on top of the wall's OWN configured theme
  // (id + its own overrides untouched) -- see PARTY_MODE_OVERRIDES' doc comment above.
  const theme = partyMode
    ? { ...config.theme, overrides: { ...(config.theme?.overrides ?? {}), ...PARTY_MODE_OVERRIDES } }
    : config.theme;

  return (
    <ThemeProvider theme={theme} customCss={config.customCss} className="wall-page">
      <div
        className={stale ? 'wall-page__dimmable wall-page__dimmable--stale' : 'wall-page__dimmable'}
        data-testid="wall-page-dimmable"
        // Per-wall UI scale (redesign 1c, hard requirement): exposed as a CSS variable every
        // look multiplies its base type scale by (calc(Npx * var(--ui-scale))). Default 1 is a
        // visual no-op, so walls with no display config render exactly as before.
        style={{ '--ui-scale': config.display?.uiScale ?? 1 } as React.CSSProperties}
      >
        {/* Everything on the wall is drawn on the 1920 × 1080 stage (Kegwall V2), so 720p,
            1080p and 4K show the same composition, letterboxed in the theme ground. */}
        <Stage uiScale={config.display?.uiScale ?? 1}>
        <ScreenCare stage={effectiveStage} taps={taps} title={title} onWake={() => wake()}>
          {currentViewKind === 'leaderboard' ? (
            <div
              key={`view-${rotationIndex}`}
              className={`wall-grid-transition wall-grid-transition--${transition} look-frame`}
              data-testid="wall-page-content"
              data-transition={transition}
            >
              {board ? (
                <LeaderboardBoard data={board} units={units} title={title} />
              ) : (
                <p className="wall-rotation-loading" data-testid="wall-rotation-loading">Loading the leaderboard…</p>
              )}
            </div>
          ) : (
            <div
                key={pageIndex}
                className={`wall-grid-transition wall-grid-transition--${transition} look-frame`}
                data-testid="wall-page-content"
                data-transition={transition}
                // Split and Dock move the wall aside to make room (see wall.css).
                data-pour={pourLanes.length && (takeoverStyle === 'split' || takeoverStyle === 'dock') ? takeoverStyle : undefined}
                style={{ '--pour-lanes': pourLanes.length } as React.CSSProperties}
              >
                <WallLook
                  taps={currentTaps}
                  allTaps={taps}
                  config={config}
                  units={units}
                  servingSizeMl={servingSizeMl}
                  title={title}
                  menuUrl={menuUrl}
                  tempC={maxTempC}
                  pageIndex={pageIndex}
                  pageCount={pages.length}
                  rotationSeconds={config.rotationSeconds}
                  spotlightTapIds={spotlightTapIds}
                  sensors={ambientSensors}
                />
              </div>
          )}
          <PourLayer
            style={takeoverStyle}
            lanes={pourLanes}
            units={units}
            servingSizeMl={servingSizeMl}
            finish={config.takeover?.finish}
          />
          {moment && <WallMoment moment={moment} />}
          <PlaylistBar views={rotationViews} activeIndex={rotationIndex} />
          {/* Additive live game strip (redesign 5c) — renders itself only when a game runs. */}
          <GameStrip />
          <BannerLane queue={queue} onDismiss={dismiss} />
          {config.showHostStats && hostStats && (
            <div className="wall-host-stats font-tabular" data-testid="wall-host-stats">
              {`CPU ${Math.round(hostStats.cpuPct)}% · RAM ${Math.round(hostStats.memPct)}%`}
              {hostStats.diskPct != null && ` · Disk ${Math.round(hostStats.diskPct)}%`}
              {hostStats.tempC != null && ` · ${formatTempC(hostStats.tempC, units)}`}
              {hostStats.watts != null && ` · ${hostStats.watts} W`}
            </div>
          )}
        </ScreenCare>
        </Stage>
      </div>
      {stale && (
        <div className="wall-page__reconnecting" data-testid="wall-reconnecting-pill">
          <span className="wall-page__reconnecting-dot" />
          Reconnecting…
        </div>
      )}
    </ThemeProvider>
  );
}

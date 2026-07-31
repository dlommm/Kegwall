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
import { useBanners, type BannerKind } from '../lib/useBanners';
import { resolveWallPages, useRotatingPageIndex } from '../lib/wallPages';
import { ThemeProvider } from '../themes/ThemeProvider';
import { WallHeader } from '../components/WallHeader';
import { WallGrid } from '../components/WallGrid';
import { WallLook } from '../components/looks/WallLook';
import { PourTakeover } from '../components/takeover/PourTakeover';
import { useTakeover } from '../lib/useTakeover';
import { BannerLane } from '../components/BannerLane';
import { QrOverlay } from '../components/QrOverlay';
import { ScreenCare } from '../components/ScreenCare';

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
  const { queue, push, dismiss } = useBanners();

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

  const handleWsMessage = useCallback((msg: unknown) => {
    if (isWsBannerMessage(msg)) {
      push(msg.text, mapServerBannerKind(msg.kind), msg.durationMs);
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
  }, [push]);

  // Countdown timer cleanup on unmount -- doesn't touch state (nothing to revert to on an
  // unmounted page), just prevents a dangling setTimeout outliving the component.
  useEffect(() => () => {
    if (partyModeTimerRef.current) clearTimeout(partyModeTimerRef.current);
  }, []);

  const {
    wall, taps, units, stale, loading, error, notFound,
  } = useWallData(slug, { onMessage: handleWsMessage });

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

  // Page cycling for >6 taps (design 1c/4): the overhaul looks are designed
  // around 6 taps per screen — with no manual pages configured, larger tap
  // sets auto-chunk into 6-per-page cycles.
  const AUTO_PAGE_SIZE = 6;
  const pages = useMemo(() => {
    const configuredPages = config?.pages ?? [];
    const look = config?.look ?? 'classic';
    if (look !== 'classic' && configuredPages.length === 0 && taps.length > AUTO_PAGE_SIZE) {
      const chunks: typeof taps[] = [];
      for (let i = 0; i < taps.length; i += AUTO_PAGE_SIZE) {
        chunks.push(taps.slice(i, i + AUTO_PAGE_SIZE));
      }
      return chunks;
    }
    return resolveWallPages(configuredPages, taps);
  }, [config, taps]);
  // Max temp across every tap on the wall (not just the current rotating page) — a
  // site-wide readout, so it shouldn't flicker/change as pages rotate.
  const maxTempC = useMemo(() => {
    const temps = taps.map((t) => t.temp).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.max(...temps) : null;
  }, [taps]);
  const pageIndex = useRotatingPageIndex(pages.length, config?.rotationSeconds ?? DEFAULT_ROTATION_SECONDS);
  const currentTaps = pages[pageIndex] ?? [];
  const transition = reducedMotion ? 'none' : (config?.transition ?? 'crossfade');

  // Pour takeover (design turns 2 + 9): watches ALL of the wall's taps (not just the
  // current rotating page) so a pour on another page still takes the screen over.
  const takeoverState = useTakeover(taps, config?.takeover);
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
  useEffect(() => {
    if (!showTemp) return undefined;
    let cancelled = false;
    const load = () => {
      getSensors().then((result) => {
        if (!cancelled && result.ok && Array.isArray(result.data)) setAmbientSensors(result.data);
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showTemp]);
  useEffect(() => {
    if (!rotationViews.some((v) => v.kind === 'leaderboard')) return undefined;
    let cancelled = false;
    const load = () => {
      getLeaderboard('month').then((result) => {
        if (!cancelled && result.ok) setBoard(result.data);
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [rotationViews]);
  const takeoverVisible = takeoverState.phase !== 'idle';
  // Spotlight (2b) isn't an overlay: the wall itself highlights the pouring row.
  const spotlightTapId = takeoverStyle === 'spotlight' && takeoverVisible
    ? takeoverState.tap.tapId
    : null;
  const overlayActive = takeoverVisible && takeoverStyle !== 'spotlight' && takeoverStyle !== 'off';

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
  // Server-parsed configs always carry `look` (schema default 'classic'), but the
  // defensive fallback keeps any not-yet-reparsed config on the classic path.
  const look = config.look ?? 'classic';
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
      >
        <ScreenCare screensaver={config.screensaver} taps={taps} title={title}>
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
          ) : look === 'classic' ? (
            <>
              <WallHeader
                title={title}
                showClock={config.header.showClock}
                showTemp={config.header.showTemp}
                tempC={maxTempC}
                units={units}
                ticker={config.ticker}
              />
              <div
                key={pageIndex}
                className={`wall-grid-transition wall-grid-transition--${transition}${takeoverStyle === 'split' && overlayActive ? ' takeover-squeeze' : ''}`}
                data-testid="wall-page-content"
                data-transition={transition}
              >
                <WallGrid
                  taps={currentTaps}
                  columns={config.columns}
                  template={config.cardTemplate}
                  fields={config.fields}
                  fillStyle={config.fillStyle}
                  units={units}
                  spotlightTapId={spotlightTapId}
                />
              </div>
            </>
          ) : (
            // Pour Wall overhaul looks (Ledger/Gallery/Columns…) own their whole
            // frame — header, rows/cards, footer ticker + QR — so the classic
            // WallHeader/QrOverlay chrome stays out of their way entirely.
            <div
              key={pageIndex}
              className={`wall-grid-transition wall-grid-transition--${transition} look-frame${takeoverStyle === 'split' && overlayActive ? ' takeover-squeeze' : ''}`}
              data-testid="wall-page-content"
              data-transition={transition}
            >
              <WallLook
                taps={currentTaps}
                config={config}
                units={units}
                title={title}
                menuUrl={menuUrl}
                tempC={maxTempC}
                pageIndex={pageIndex}
                pageCount={pages.length}
                rotationSeconds={config.rotationSeconds}
                spotlightTapId={spotlightTapId}
                sensors={ambientSensors}
              />
            </div>
          )}
          {/* `overlayActive` implies a non-idle takeover (TS narrows through the
              aliased condition, so `state` types as active|complete here). */}
          {overlayActive && (
            <PourTakeover
              style={takeoverStyle}
              state={takeoverState}
              units={units}
              tempC={maxTempC}
            />
          )}
          <PlaylistBar views={rotationViews} activeIndex={rotationIndex} />
          <BannerLane queue={queue} onDismiss={dismiss} />
          {look === 'classic' && config.showQr && <QrOverlay url={menuUrl} />}
        </ScreenCare>
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

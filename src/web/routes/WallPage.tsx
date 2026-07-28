import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useWallData } from '../lib/useWallData';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { useBanners, type BannerKind } from '../lib/useBanners';
import { resolveWallPages, useRotatingPageIndex } from '../lib/wallPages';
import { ThemeProvider } from '../themes/ThemeProvider';
import { WallHeader } from '../components/WallHeader';
import { WallGrid } from '../components/WallGrid';
import { BannerLane } from '../components/BannerLane';
import { QrOverlay } from '../components/QrOverlay';
import { ScreenCare } from '../components/ScreenCare';

declare global {
  interface Window {
    /** Dev-build-only manual test hook for pushing a wall banner (see the Task 5 plan) —
     * Phase 5 automations will eventually push banners over the WS feed instead. */
    __wall?: { banner: (text: string, kind?: BannerKind) => void };
  }
}

const DEFAULT_ROTATION_SECONDS = 15;

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
  const {
    wall, taps, units, stale, loading, error, notFound,
  } = useWallData(slug);
  const reducedMotion = usePrefersReducedMotion();
  const { queue, push, dismiss } = useBanners();

  const config = wall?.config ?? null;
  const pages = useMemo(
    () => resolveWallPages(config?.pages ?? [], taps),
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

  return (
    <ThemeProvider theme={config.theme} customCss={config.customCss} className="wall-page">
      <div
        className={stale ? 'wall-page__dimmable wall-page__dimmable--stale' : 'wall-page__dimmable'}
        data-testid="wall-page-dimmable"
      >
        <ScreenCare screensaver={config.screensaver} taps={taps} title={title}>
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
            className={`wall-grid-transition wall-grid-transition--${transition}`}
            data-testid="wall-page-content"
            data-transition={transition}
          >
            <WallGrid
              taps={currentTaps}
              columns={config.columns}
              template={config.cardTemplate}
              fields={config.fields}
              units={units}
            />
          </div>
          <BannerLane queue={queue} onDismiss={dismiss} />
          {config.showQr && <QrOverlay url={menuUrl} />}
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

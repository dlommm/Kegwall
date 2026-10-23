import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ThemeProvider } from '../themes/ThemeProvider';
import { WallLook } from './looks/WallLook';
import { ScreenCare } from './ScreenCare';
import { PourLayer } from '../wall/pour/PourLayer';
import type { PourLane } from '../wall/pour/usePourLanes';
import type { WallConfig } from '../../server/core/wallConfig.js';
import type { TapState } from '../../server/core/state.js';

/**
 * The Wall Editor's live stage (Kegwall V2 M9, blueprint §E.3). Renders the wall from the
 * DRAFT `WallConfig` — every control updates it with no save round-trip — on the wall's own
 * taps when it has any (sample beers otherwise). The 1920 × 1080 frame is scaled to its pane
 * ("Fit") or shown at 100% inside a scrolling pane. Three modes: the wall as it stands, a pour
 * held mid-way in the chosen takeover style, and the screensaver. "Preview a pour" plays one
 * whole pour; nothing is recorded.
 */

function sampleTap(
  n: number, name: string, style: string, srm: number, abv: number, ibu: number, levelPct: number,
): TapState {
  const sizeMl = 19000;
  return {
    tapId: n, tapNumber: n, tapName: null,
    beer: {
      id: n, name, brewery: 'Halfmoon Brewing', style, abv, ibu, srm,
      description: 'Bright, balanced, and easy-drinking.', labelImage: null, createdAt: '',
    },
    keg: {
      id: n, beerId: n, tapId: n, sizeMl, volStartMl: sizeMl,
      volDispensedMl: sizeMl * (1 - levelPct / 100), dateTapped: null, status: 'on_tap',
      createdAt: '', kegType: null, costCents: null, levelPct, remainingMl: sizeMl * (levelPct / 100),
    },
    lastPour: null, pouring: false, curServMl: null,
    monitorOnline: true, hidden: false, temp: 2.2, avgRating: 4.4, nextUpBeerName: null,
    tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
  };
}

/** Shown only while the wall has no taps of its own to draw. */
export const SAMPLE_TAPS: TapState[] = [
  sampleTap(1, 'Sunset Haze', 'Hazy IPA', 5, 6.8, 55, 78),
  sampleTap(2, 'Midnight Porter', 'Porter', 32, 5.4, 30, 44),
  sampleTap(3, 'Coastal Pilsner', 'Pilsner', 3, 4.9, 32, 12),
  sampleTap(4, 'Copper Bell', 'Amber Ale', 12, 5.6, 24, 61),
];

export type PreviewMode = 'wall' | 'pour' | 'screensaver';

export interface WallLivePreviewProps {
  config: WallConfig;
  title: string;
  units: 'us' | 'metric';
  menuUrl: string;
  /** The current page's taps. Empty or omitted draws the sample beers. */
  taps?: TapState[];
  /** Every tap on the wall, for wall-wide choices (spotlight, headline). Defaults to `taps`. */
  allTaps?: TapState[];
  servingSizeMl?: number;
  pageIndex?: number;
  pageCount?: number;
  mode?: PreviewMode;
  /** `fit` scales the frame to the pane; `actual` shows it at 100% in a scrolling pane. */
  fit?: 'fit' | 'actual';
  /** Bump to play one simulated pour in the selected takeover style: 0 → a US pint, a short
   * hold on the finish, then back to the wall. */
  simulateNonce?: number;
}

const POUR_TOTAL_ML = 473; // a US pint
/** Held mid-pour in "Live pour" mode. */
const HELD_POUR_ML = 284;
const POUR_TICK_MS = 80;
const POUR_STEP_ML = 64; // real Kegtron cadence ×8, so the preview pour takes about a second
const POUR_HOLD_MS = 1800;

function laneFor(tap: TapState, phase: PourLane['phase'], ml: number): PourLane {
  return {
    key: 'preview',
    tapId: tap.tapId,
    phase,
    tap: phase === 'pouring' ? { ...tap, pouring: true, curServMl: ml } : { ...tap, pouring: false, curServMl: null },
    measuredMl: ml,
    recordedMl: phase === 'pouring' ? null : ml,
    durationMs: null,
    pourerName: null,
    pourerPourCount: null,
    startedAt: 0,
  };
}

export function WallLivePreview({
  config, title, units, menuUrl, taps, allTaps, servingSizeMl = POUR_TOTAL_ML,
  pageIndex = 0, pageCount = 1, mode = 'wall', fit = 'fit', simulateNonce = 0,
}: WallLivePreviewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneScale, setPaneScale] = useState(0.25);
  const [sim, setSim] = useState<PourLane | null>(null);

  const usingSamples = !taps || taps.length === 0;
  const pageTaps = usingSamples ? SAMPLE_TAPS : taps;
  const wallTaps = usingSamples ? SAMPLE_TAPS : (allTaps ?? taps);
  const pourTap = pageTaps[Math.min(1, pageTaps.length - 1)]!;

  // One simulated pour on a tap of the current page. Badge (`off`) has no overlay, so the
  // pour shows as that tap's own pouring row.
  useEffect(() => {
    if (!simulateNonce) return undefined;
    let ml = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      ml = Math.min(POUR_TOTAL_ML, ml + POUR_STEP_ML);
      setSim(laneFor(pourTap, 'pouring', ml));
      if (ml >= POUR_TOTAL_ML) {
        clearInterval(tick);
        setSim(laneFor(pourTap, 'finish', POUR_TOTAL_ML));
        hold = setTimeout(() => setSim(null), POUR_HOLD_MS);
      }
    }, POUR_TICK_MS);
    return () => { clearInterval(tick); if (hold) clearTimeout(hold); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tap is captured when the pour starts
  }, [simulateNonce]);

  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setPaneScale(el.clientWidth / 1920);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lane = sim ?? (mode === 'pour' ? laneFor(pourTap, 'pouring', HELD_POUR_ML) : null);
  const style = config.takeover.style;
  const shownTaps = useMemo(() => (lane && lane.phase === 'pouring'
    ? pageTaps.map((t) => (t.tapId === lane.tapId ? lane.tap : t))
    : pageTaps), [pageTaps, lane]);
  const spotlightTapIds = lane && style === 'spotlight' ? new Set([lane.tapId]) : null;
  const showOverlay = lane !== null && style !== 'spotlight' && style !== 'off';
  const uiScale = config.display?.uiScale ?? 1;
  const scale = fit === 'actual' ? 1 : paneScale;
  const stageVars = { '--u': `${uiScale}px` } as CSSProperties;

  return (
    <div
      className={fit === 'actual' ? 'wall-live-preview wall-live-preview--actual' : 'wall-live-preview'}
      data-testid="wall-live-preview"
      data-mode={mode}
      data-samples={usingSamples ? 'true' : 'false'}
      ref={paneRef}
    >
      <div
        className="wall-live-preview__frame"
        style={{ transform: `scale(${scale})`, '--ui-scale': uiScale } as CSSProperties}
      >
        <ThemeProvider theme={config.theme} customCss={config.customCss} className="wall-live-preview__scope">
          <ScreenCare stage={mode === 'screensaver' ? 'screensaver' : 'active'} taps={wallTaps} title={title} onWake={() => {}}>
            {/* V2 stage looks size themselves in stage units: in this fixed 1920 × 1080 frame one
                design pixel is 1px × the wall's UI scale (Stage.tsx does the same on a screen). */}
            <div className="wall-live-preview__stage" style={stageVars}>
              <WallLook
                taps={shownTaps}
                allTaps={wallTaps}
                config={config}
                units={units}
                servingSizeMl={servingSizeMl}
                title={title}
                menuUrl={menuUrl}
                tempC={2.2}
                pageIndex={pageIndex}
                pageCount={pageCount}
                rotationSeconds={config.rotationSeconds}
                spotlightTapIds={spotlightTapIds}
              />
            </div>
            {showOverlay && lane && (
              <div className="wall-live-preview__stage-overlay" style={stageVars}>
                <PourLayer
                  style={style}
                  lanes={[lane]}
                  units={units}
                  servingSizeMl={servingSizeMl}
                  finish={config.takeover.finish}
                />
              </div>
            )}
          </ScreenCare>
        </ThemeProvider>
      </div>
    </div>
  );
}

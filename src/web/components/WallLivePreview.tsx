import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ThemeProvider } from '../themes/ThemeProvider';
import { WallLook } from './looks/WallLook';
import { WallHeader } from './WallHeader';
import { WallGrid } from './WallGrid';
import { PourTakeover } from './takeover/PourTakeover';
import type { TakeoverState } from '../lib/useTakeover';
import type { WallConfig } from '../../server/core/wallConfig.js';
import type { TapState } from '../../server/core/state.js';

/**
 * Redesign 1c — the wall editor's LIVE preview. Renders the wall from a DRAFT `WallConfig`
 * (whatever the editor's form currently holds) with sample tap data, so every control updates
 * the preview instantly with no save round-trip. The 1920×1080 frame is scaled to fit its
 * pane; `--ui-scale` rides the frame so the Display Fit slider is reflected here too. Sample
 * data per the handoff ("beer names, numbers are placeholder").
 */

function sampleTap(
  n: number, name: string, style: string, srm: number, abv: number, ibu: number,
  levelPct: number, opts: { pouring?: boolean; labelImage?: string | null } = {},
): TapState {
  const sizeMl = 19000;
  return {
    tapId: n, tapNumber: n, tapName: null,
    beer: {
      id: n, name, brewery: 'Halfmoon Brewing', style, abv, ibu, srm,
      description: 'Bright, balanced, and easy-drinking.', labelImage: opts.labelImage ?? null, createdAt: '',
    },
    keg: {
      id: n, beerId: n, tapId: n, sizeMl, volStartMl: sizeMl,
      volDispensedMl: sizeMl * (1 - levelPct / 100), dateTapped: null, status: 'on_tap',
      createdAt: '', kegType: null, costCents: null, levelPct, remainingMl: sizeMl * (levelPct / 100),
    },
    lastPour: null, pouring: opts.pouring ?? false, curServMl: opts.pouring ? 300 : null,
    monitorOnline: true, hidden: false, temp: 2.2, avgRating: 4.4, nextUpBeerName: null,
  };
}

const SAMPLE_TAPS: TapState[] = [
  sampleTap(1, 'Sunset Haze', 'Hazy IPA', 5, 6.8, 55, 78),
  sampleTap(2, 'Midnight Porter', 'Porter', 32, 5.4, 30, 44, { pouring: true }),
  sampleTap(3, 'Coastal Pilsner', 'Pilsner', 3, 4.9, 32, 12),
  sampleTap(4, 'Copper Bell', 'Amber Ale', 12, 5.6, 24, 61),
];

export interface WallLivePreviewProps {
  config: WallConfig;
  title: string;
  units: 'us' | 'metric';
  menuUrl: string;
  /** Redesign 1c: bump this to run a simulated pour in the currently-selected takeover
   * style — 0 → 16 oz (473 mL), then a brief hold, then clear. */
  simulateNonce?: number;
}

const POUR_TOTAL_ML = 473; // full US pint
const POUR_TICK_MS = 80;
const POUR_STEP_ML = 8 * 8; // 8mL/80ms real cadence, ×8 so the preview animation is snappy
const POUR_HOLD_MS = 1800;

export function WallLivePreview({ config, title, units, menuUrl, simulateNonce = 0 }: WallLivePreviewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [sim, setSim] = useState<TakeoverState | null>(null);

  // Pour simulation (redesign 1c): animate the "Midnight Porter" sample tap in the selected
  // takeover style. 'off' shows only the badge (already on the sample tap), so nothing to run.
  useEffect(() => {
    if (!simulateNonce || config.takeover.style === 'off') return undefined;
    const base = SAMPLE_TAPS[1]!; // the pouring sample tap
    let ml = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      ml = Math.min(POUR_TOTAL_ML, ml + POUR_STEP_ML);
      setSim({ phase: 'active', tap: { ...base, pouring: true, curServMl: ml }, pourMl: ml });
      if (ml >= POUR_TOTAL_ML) {
        clearInterval(tick);
        setSim({ phase: 'complete', tap: { ...base, pouring: false, curServMl: null }, pourMl: POUR_TOTAL_ML });
        hold = setTimeout(() => setSim(null), POUR_HOLD_MS);
      }
    }, POUR_TICK_MS);
    return () => { clearInterval(tick); if (hold) clearTimeout(hold); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- style/nonce captured intentionally at trigger
  }, [simulateNonce]);

  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setScale(el.clientWidth / 1920);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const uiScale = config.display?.uiScale ?? 1;
  const spotlightTapId = sim && sim.phase !== 'idle' && config.takeover.style === 'spotlight'
    ? sim.tap.tapId : null;
  const overlayStyle = config.takeover.style;
  const showOverlay = sim !== null && overlayStyle !== 'spotlight' && overlayStyle !== 'off';

  return (
    <div className="wall-live-preview" data-testid="wall-live-preview" ref={paneRef}>
      <div
        className="wall-live-preview__frame"
        style={{ transform: `scale(${scale})`, '--ui-scale': uiScale } as CSSProperties}
      >
        <ThemeProvider theme={config.theme} customCss={config.customCss} className="wall-live-preview__scope">
          {config.look === 'classic' ? (
            <>
              <WallHeader
                title={title}
                showClock={config.header.showClock}
                showTemp={config.header.showTemp}
                tempC={2.2}
                units={units}
                ticker={config.ticker}
              />
              <WallGrid
                taps={SAMPLE_TAPS}
                columns={config.columns}
                template={config.cardTemplate}
                fields={config.fields}
                fillStyle={config.fillStyle}
                units={units}
                spotlightTapId={spotlightTapId}
              />
            </>
          ) : (
            <WallLook
              taps={SAMPLE_TAPS}
              config={config}
              units={units}
              title={title}
              menuUrl={menuUrl}
              tempC={2.2}
              pageIndex={0}
              pageCount={1}
              rotationSeconds={config.rotationSeconds}
              spotlightTapId={spotlightTapId}
            />
          )}
          {showOverlay && sim && sim.phase !== 'idle' && (
            <PourTakeover style={overlayStyle} state={sim} units={units} tempC={2.2} />
          )}
        </ThemeProvider>
      </div>
    </div>
  );
}

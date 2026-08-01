import { useEffect, useState, type ReactNode } from 'react';
import type { TapState } from '../../server/core/state.js';

const DRIFT_INTERVAL_MS = 5 * 60_000;
const HIGHLIGHT_INTERVAL_MS = 4_000;

/** A small cycle of 1px nudges (OLED pixel-shift burn-in mitigation) — never more than
 * 1px in either axis from center, so it's imperceptible at normal TV viewing distance. */
const DRIFT_OFFSETS: readonly [number, number][] = [
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1],
];

/** The screensaver's big dim clock (design 6f) — refreshed every 30s. */
function SaverClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <p className="screen-care__saver-clock font-display font-tabular" data-testid="screensaver-clock">
      {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
    </p>
  );
}

export interface ScreenCareProps {
  /** Server-pushed power stage (Task 9; see lib/displayPower.ts) — replaces the old
   * internal `setTimeout`-driven screensaver activation and the `screensaver` config
   * prop. The presence engine now owns all timing; this component only renders
   * whichever stage it's told. */
  stage: 'active' | 'screensaver' | 'off';
  taps: TapState[];
  /** Wall title, shown (dimmed) on the screensaver overlay. */
  title: string;
  /** Called when the user taps the off-stage black overlay. */
  onWake?: () => void;
  children: ReactNode;
}

/**
 * OLED screen care for the wall (Task 5 plan, re-plumbed in Task 9): a constant,
 * imperceptible 1px layout drift every 5 minutes, plus a server-driven `stage` that
 * renders a dimmed screensaver overlay (wall title + a highlight that rotates across
 * taps every few seconds, so no single pixel region stays lit at full brightness
 * indefinitely) or blanks the display entirely when the server says `'off'`.
 */
export function ScreenCare({
  stage, taps, title, onWake, children,
}: ScreenCareProps) {
  const [driftIndex, setDriftIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setDriftIndex((i) => (i + 1) % DRIFT_OFFSETS.length);
    }, DRIFT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const active = stage === 'screensaver';

  const [highlightIndex, setHighlightIndex] = useState(0);
  useEffect(() => {
    if (!active || taps.length === 0) return undefined;
    const id = setInterval(() => {
      setHighlightIndex((i) => (i + 1) % taps.length);
    }, HIGHLIGHT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, taps.length]);

  const [dx, dy] = DRIFT_OFFSETS[driftIndex % DRIFT_OFFSETS.length] ?? [0, 0];
  const highlightTap = active ? taps[highlightIndex % Math.max(taps.length, 1)] : undefined;

  return (
    <div
      className="screen-care"
      data-testid="screen-care"
      style={{ transform: `translate(${dx}px, ${dy}px)` }}
    >
      {children}
      {active && (
        <div className="screen-care__saver" data-testid="screensaver-overlay">
          <SaverClock />
          <p className="screen-care__saver-title font-display">{title}</p>
          {highlightTap && (
            <p className="screen-care__saver-highlight font-body" data-testid="screensaver-highlight">
              {highlightTap.tapName ?? `Tap ${highlightTap.tapNumber}`}
            </p>
          )}
        </div>
      )}
      {stage === 'off' && (
        <div className="screen-care__off" data-testid="screen-off-overlay" onClick={onWake} />
      )}
    </div>
  );
}

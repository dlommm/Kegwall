import { useEffect, useState, type ReactNode } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';

const DRIFT_INTERVAL_MS = 5 * 60_000;
const HIGHLIGHT_INTERVAL_MS = 4_000;

/** A small cycle of 1px nudges (OLED pixel-shift burn-in mitigation) — never more than
 * 1px in either axis from center, so it's imperceptible at normal TV viewing distance. */
const DRIFT_OFFSETS: readonly [number, number][] = [
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1],
];

export interface ScreenCareProps {
  screensaver: WallConfig['screensaver'];
  taps: TapState[];
  /** Wall title, shown (dimmed) on the screensaver overlay. */
  title: string;
  children: ReactNode;
}

/**
 * OLED screen care for the wall (Task 5 plan): a constant, imperceptible 1px layout
 * drift every 5 minutes, plus an optional screensaver mode (`config.screensaver`) that
 * engages `startAfterMinutes` after mount — a dimmed overlay with the wall title and a
 * highlight that rotates across taps every few seconds, so no single pixel region stays
 * lit at full brightness indefinitely.
 */
export function ScreenCare({
  screensaver, taps, title, children,
}: ScreenCareProps) {
  const [driftIndex, setDriftIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setDriftIndex((i) => (i + 1) % DRIFT_OFFSETS.length);
    }, DRIFT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(false);
    if (!screensaver.enabled) return undefined;
    const id = setTimeout(() => setActive(true), screensaver.startAfterMinutes * 60_000);
    return () => clearTimeout(id);
  }, [screensaver.enabled, screensaver.startAfterMinutes]);

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
          <p className="screen-care__saver-title font-display">{title}</p>
          {highlightTap && (
            <p className="screen-care__saver-highlight font-body" data-testid="screensaver-highlight">
              {highlightTap.tapName ?? `Tap ${highlightTap.tapNumber}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

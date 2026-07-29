import { useEffect, useMemo, useState } from 'react';
import { qrCodeSvg } from '../../lib/qr';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { formatTempC, type VolumeUnits } from '../../lib/units';
import type { TapLookModel } from '../../lib/lookData';

/**
 * Small shared pieces every wall look composes: the slow clock, badge chips,
 * the footer marquee ticker, the menu QR block, and the sensor chip strip.
 * All styling comes from theme tokens (see index.css `.look-*` rules) so each
 * look/theme combination renders correctly.
 */

const CLOCK_UPDATE_MS = 30_000;

/** "5:24 PM"-style clock string, refreshed every 30s (same cadence WallHeader uses). */
export function useLookClock(): string {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_UPDATE_MS);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface LookBadgesProps {
  model: TapLookModel;
  /** Per-look badge copy — the Ledger says "NEW ON TAP", the card looks just "NEW". */
  newLabel?: string;
  lowLabel?: string;
}

/** The NEW / ALMOST GONE / POURING badge row (design rule: every look shows
 * badges + pour state, each in its own voice — the voice here is per-look copy
 * + per-look CSS on the shared class hooks). */
export function LookBadges({ model, newLabel = 'NEW', lowLabel = 'ALMOST GONE' }: LookBadgesProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (!model.isNew && !model.isLow && !model.pouring) return null;
  return (
    <>
      {model.isNew && (
        <span className="look-badge look-badge--new" data-testid="look-badge-new">{newLabel}</span>
      )}
      {model.isLow && (
        <span className="look-badge look-badge--low" data-testid="look-badge-low">{lowLabel}</span>
      )}
      {model.pouring && (
        <span className="look-badge look-badge--pouring" data-testid="look-badge-pouring">
          <span className={reducedMotion ? 'look-pour-dot' : 'look-pour-dot look-pour-dot--pulse'} />
          {model.pourLabel ? `POURING · ${model.pourLabel}` : 'POURING'}
        </span>
      )}
    </>
  );
}

export interface TickerMarqueeProps {
  text: string;
}

/** Footer marquee (design: ~36s translateX loop, content duplicated for a
 * seamless wrap; static under prefers-reduced-motion). Items are split on
 * newlines or " · " so a plain ticker string becomes ✦-separated entries. */
export function TickerMarquee({ text }: TickerMarqueeProps) {
  const reducedMotion = usePrefersReducedMotion();
  const items = useMemo(
    () => text.split(/\n+| · /).map((s) => s.trim()).filter(Boolean),
    [text],
  );
  if (items.length === 0) return null;

  const run = (
    <>
      {items.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- order is the identity here
        <span key={i} className="look-ticker__item">
          {item}
          <span aria-hidden="true" className="look-ticker__sep">✦</span>
        </span>
      ))}
    </>
  );

  return (
    <div className="look-ticker" data-testid="look-ticker">
      <div className={reducedMotion ? 'look-ticker__run' : 'look-ticker__run look-ticker__run--animated'}>
        {run}
        {!reducedMotion && <span aria-hidden="true" className="look-ticker__dup">{run}</span>}
      </div>
    </div>
  );
}

export interface LookQrProps {
  url: string;
  label?: string;
}

/** The looks' in-chrome QR block (Ledger footer / Gallery header) — a real,
 * scannable code via lib/qr.ts, with a visually-hidden link for non-scanners. */
export function LookQr({ url, label = 'SCAN FOR MENU' }: LookQrProps) {
  const svgMarkup = useMemo(() => qrCodeSvg(url), [url]);
  return (
    <div className="look-qr" data-testid="look-qr">
      {/* eslint-disable-next-line react/no-danger -- qrCodeSvg's output is our own generated markup */}
      <div className="look-qr__code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      <a href={url} className="look-qr__label">{label}</a>
    </div>
  );
}

export interface SensorChipsProps {
  /** Max Kegtron temp across the wall's taps (Celsius), or null to hide. */
  tempC: number | null;
  units: VolumeUnits;
}

/** The header sensor strip. Today it carries the one real reading we have —
 * the Kegtron monitors' own temperature (labeled KEGTRON, per the handoff:
 * Kegtron's temp keeps its own label even once Govee sensors land). Govee
 * chips slot in beside it in Phase 6. */
export function SensorChips({ tempC, units }: SensorChipsProps) {
  if (tempC == null) return null;
  return (
    <div className="look-sensors" data-testid="look-sensors">
      <span className="look-sensor-chip">
        <span className="look-sensor-chip__dot" />
        <span className="look-sensor-chip__name">KEGTRON</span>
        <span className="look-sensor-chip__value">{formatTempC(tempC, units)}</span>
      </span>
    </div>
  );
}

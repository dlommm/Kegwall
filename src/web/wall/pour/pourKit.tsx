import { useEffect, useRef, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import type { VolumeUnits } from '../../lib/units';
import type { PourLane } from './usePourLanes';
import styles from './pourKit.module.css';

const ML_PER_OZ = 29.5735295625;

/** "8.0" + "oz", or "236" + "mL": the number and its unit, set apart on a wall. */
export function volumeParts(ml: number, units: VolumeUnits): { value: string; unit: string } {
  const safe = Number.isFinite(ml) ? Math.max(0, ml) : 0;
  return units === 'metric'
    ? { value: String(Math.round(safe)), unit: 'mL' }
    : { value: (safe / ML_PER_OZ).toFixed(1), unit: 'oz' };
}

/** The volume a lane shows: the recorded pour once finished, else the latest reading. */
export function laneVolumeMl(lane: PourLane): number {
  return lane.phase !== 'pouring' && lane.recordedMl != null ? lane.recordedMl : lane.measuredMl;
}

/** How full the glass is: shown volume over one serving, capped at a full glass. */
export function glassFraction(ml: number, servingSizeMl: number): number {
  return servingSizeMl > 0 ? Math.max(0, Math.min(1, ml / servingSizeMl)) : 0;
}

/** The foam head grows over the second half of a pour. */
export function headFraction(frac: number): number {
  return Math.max(0, (frac - 0.55) / 0.45);
}

/** A finished pour this full has its head capped at the rim and spilling over; a shorter one doesn't. */
export const BRIM_FRACTION = 0.85;

export function brimmed(frac: number, finished: boolean): boolean {
  return finished && frac >= BRIM_FRACTION;
}

const EASE_MS = 900;

/**
 * The live counter. It eases toward each new Kegtron reading over 900 ms (ease-out) and is
 * clamped so it never shows more than was measured; `final` snaps to the value at once (the
 * finish shows the recorded pour exactly). Writes straight to the DOM: no re-render per frame.
 */
export function EasedVolume({
  ml, units, final = false, className,
}: { ml: number; units: VolumeUnits; final?: boolean; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const target = ml;
    const write = (v: number) => {
      shown.current = v;
      el.textContent = volumeParts(v, units).value;
    };
    if (final || reduced || target <= shown.current || typeof requestAnimationFrame === 'undefined') {
      write(target);
      return undefined;
    }
    const from = shown.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / EASE_MS);
      const eased = 1 - (1 - k) ** 3;
      write(Math.min(target, from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ml, units, final, reduced]);
  const unit = volumeParts(ml, units).unit;
  return (
    <span className={className ? `${styles.volume} ${className}` : styles.volume} data-testid="pour-volume">
      <b ref={ref}>{volumeParts(final || reduced ? ml : shown.current, units).value}</b>
      <span>{unit}</span>
    </span>
  );
}

export interface PourGlassProps {
  /** 0-1 of one serving. */
  frac: number;
  /** Beer is flowing: the stream shows and the bubbles run. */
  flowing: boolean;
  /** The pour finished: the stream's tail drops; a full glass's head rises to the rim and spills over. */
  finished: boolean;
  /** Glass size in design pixels. */
  width: number;
  height: number;
  /** Marks on the glass, as fractions of a serving, with their labels. */
  marks?: Array<{ at: number; label: string }>;
  /** Tap Pull: the glass starts tilted and straightens as it fills, then slides off. */
  tilted?: boolean;
}

/**
 * The pour glass with its beer stream (blueprint v0.7): a steel spout, a tapered flowing body
 * with a light and shade edge, a foam bloom riding the surface, then the glass itself filling
 * by measured volume over the serving size. Liquid moves only by transform; the stream's
 * texture and the bubbles loop only while beer is flowing.
 */
export function PourGlass({
  frac, flowing, finished, width, height, marks = [], tilted = false,
}: PourGlassProps) {
  const style = {
    '--tilt': tilted ? `${((1 - Math.min(frac * 1.8, 1)) * -16).toFixed(2)}deg` : '0deg',
    '--frac': frac.toFixed(3),
    '--head': headFraction(frac).toFixed(3),
    '--gw': width,
    '--gh': height,
  } as CSSProperties;
  return (
    <div
      className={styles.rig}
      style={style}
      data-flowing={flowing ? 'true' : undefined}
      data-finished={finished ? 'true' : undefined}
      data-brim={brimmed(frac, finished) ? 'true' : undefined}
      data-tilted={tilted ? 'true' : undefined}
      aria-hidden="true"
    >
      <div className={styles.spout} />
      <div className={styles.stream} />
      <div className={styles.bloom} />
      <div className={styles.glass}>
        <div className={styles.liquid} />
        <div className={styles.bubbles}>
          {Array.from({ length: 10 }, (_, i) => (
            // eslint-disable-next-line react/no-array-index-key -- decorative, positional
            <i key={i} style={{ '--x': `${10 + ((i * 37) % 80)}%`, '--d': `${2.2 + (i % 4) * 0.5}s`, '--dl': `${-(i * 0.37).toFixed(2)}s` } as CSSProperties} />
          ))}
        </div>
        <div className={styles.foam} />
        {marks.map((m) => (
          <span key={m.label} className={styles.mark} style={{ '--at': m.at } as CSSProperties}>{m.label}</span>
        ))}
        <div className={styles.rim} />
      </div>
      <div className={styles.spill}><b /><i /><i /><i /></div>
    </div>
  );
}

/** 8 / 12 / 16 oz marks on a US pint glass, or quarter marks in mL otherwise. */
export function servingMarks(servingSizeMl: number, units: VolumeUnits): Array<{ at: number; label: string }> {
  if (units === 'us') {
    const servingOz = servingSizeMl / ML_PER_OZ;
    return [8, 12, 16].filter((oz) => oz <= servingOz + 0.5).map((oz) => ({ at: (oz * ML_PER_OZ) / servingSizeMl, label: `${oz} oz` }));
  }
  return [0.5, 1].map((f) => ({ at: f, label: `${Math.round(servingSizeMl * f)} mL` }));
}

import { useMemo } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import { qrCodeSvg } from '../../lib/qr';
import type { VolumeUnits } from '../../lib/units';
import { wallTapModel, type WallTapModel } from '../wallModel';
import { relativeLuminance } from '../../lib/contrast';
import { mixHex } from '../../lib/srm';
import styles from './lookKit.module.css';

/**
 * Shared pieces for Kegwall V2 looks. Every V2 look is drawn on the 1920 × 1080 stage in
 * design pixels (`calc(N * var(--u))`), reads the wall theme's semantic colors
 * (`--color-ground`, `--color-ink-*`, …) and uses the V2 type (Big Shoulders Display +
 * Atkinson Hyperlegible) whatever the theme's own fonts are.
 */

/** Per-tap V2 models for a page, rebuilt only when the taps (stable refs) change. */
export function useWallModels(taps: TapState[], units: VolumeUnits, servingSizeMl: number): WallTapModel[] {
  return useMemo(
    () => taps.map((t) => wallTapModel(t, { units, servingSizeMl })),
    [taps, units, servingSizeMl],
  );
}

/**
 * The keg that owns a spotlight (Just Tapped's color field, Editorial's feature, Zen's orb):
 * the pinned tap when `spotlight.mode` is 'pinned' and that tap has beer, otherwise the most
 * recently tapped keg. Kicked and empty taps never lead.
 */
export function pickSpotlight(models: WallTapModel[], spotlight: WallConfig['spotlight'] | undefined): WallTapModel | null {
  const candidates = models.filter((m) => m.hasBeer && !m.isKicked);
  if (spotlight?.mode === 'pinned' && spotlight.tapId != null) {
    const pinned = candidates.find((m) => m.tap.tapId === spotlight.tapId);
    if (pinned) return pinned;
  }
  const tappedAt = (m: WallTapModel) => Date.parse(m.tap.keg?.dateTapped ?? '') || 0;
  return candidates.reduce<WallTapModel | null>((best, m) => (!best || tappedAt(m) > tappedAt(best) ? m : best), null);
}

/** The spotlight-takeover treatment for a row or card: lifted when it pours, dimmed otherwise. */
export function spotlightState(tapId: number, spotlightTapId: number | null | undefined): 'lit' | 'dim' | undefined {
  if (spotlightTapId == null) return undefined;
  return tapId === spotlightTapId ? 'lit' : 'dim';
}

export interface MenuQrProps {
  url: string;
  /** Design-pixel edge length of the code. */
  size?: number;
  label?: string;
}

/** The scannable menu QR with its sentence, drawn on a light tile so phones read it on any ground. */
export function MenuQr({ url, size = 92, label = 'Menu and claim your pour' }: MenuQrProps) {
  const svg = useMemo(() => qrCodeSvg(url, { margin: 1 }), [url]);
  return (
    <a className={styles.qr} href={url} data-testid="look-qr" style={{ '--qr-size': size } as React.CSSProperties}>
      <span className={styles.qrLabel}>{label}</span>
      {/* eslint-disable-next-line react/no-danger -- qrCodeSvg's output is our own generated markup */}
      <span className={styles.qrCode} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    </a>
  );
}

/** "8:42 PM · kegerator 38°F" style meta line parts, joined by the look. */
export function metaParts(parts: Array<string | null | false | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

/** When a keg went on, in a bartender's words: "today", "Saturday" (this week), "Oct 9". */
export function tappedLabel(dateTapped: string | null | undefined, now: Date = new Date()): string {
  if (!dateTapped) return '—';
  const d = new Date(dateTapped);
  if (Number.isNaN(d.getTime())) return '—';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "today" / "about a day" / "≈ 5 days" / "—" for the kick forecast. */
export function kicksInLabel(days: number | null, isKicked: boolean): string {
  if (isKicked) return 'kicked';
  if (days == null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'about a day';
  return `≈ ${days} days`;
}

/** The beer's color for a level picture. Near-black stouts are lifted a little so the level
 * still reads against a dark ground. */
export function levelColor(beerColor: string): string {
  return relativeLuminance(beerColor) < 0.02 ? mixHex(beerColor, '#FFFFFF', 0.16) : beerColor;
}

/** "pint" / "pints" / "pour" / "pours" for a whole count. */
export function servingsWord(m: Pick<WallTapModel, 'servingNoun'>, n: number): string {
  return `${m.servingNoun}${n === 1 ? '' : 's'}`;
}

import { useMemo, type CSSProperties } from 'react';
import { levelToColor } from '../lib/fillColor';
import { resolveKegAsset, type KegAssetId } from '../lib/kegAssets';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { formatVolumeMl, type VolumeUnits } from '../lib/units';

export interface KegFillProps {
  /** Fill level as a percent (0-100); out-of-range values are clamped. */
  levelPct: number;
  /** The keg's declared size in mL — drives the auto-match asset pick (see
   * `lib/kegAssets.ts`'s `resolveKegAsset`) whenever `kegType` is null. */
  sizeMl: number;
  /** Manual asset override (a keg's `keg_type` column, migration 005); `null`/undefined
   * means auto-match by `sizeMl`. */
  kegType?: KegAssetId | null;
  /** True while a pour is actively in progress on this tap. */
  pouring: boolean;
  /** Current in-progress serving volume in mL, shown as a running readout while pouring. */
  curServMl: number | null;
  /** Unit system for the pour readout. Defaults to `'us'`. */
  units?: VolumeUnits;
  className?: string;
}

/**
 * The `fillStyle: 'keg'` alternative to `LiquidFill` (see wallConfig.ts's doc comment):
 * a photorealistic cutaway keg photo (one of the 7 assets in `lib/kegAssets.ts`,
 * auto-selected by nearest `sizeMl` match or pinned via an explicit `kegType` override)
 * with a colored level overlay clipped to the photo's interior cavity. Unlike
 * `LiquidFill`'s SRM-true tint, the overlay color is a traffic-light status read
 * (`levelToColor` — green/yellow/red by level), and the percent itself is stamped in
 * large, high-contrast numerals over the cavity opening so the level reads at a glance
 * even before the color registers.
 *
 * Each asset's source photo has a caption ("1/2 Barrel / Full Size / 15.5 Gallons" etc.)
 * baked into the bottom of the image — `asset.cropPct` crops that band off entirely
 * (rather than covering it or leaving it visible) since the card already shows the keg's
 * size as real text elsewhere; showing it twice, once as a fixed photo caption that can't
 * reflow with the card's own typography, was worse than just not showing it here. The
 * crop is a pure display-box trick (see `cropStyle`/`imageStyle` below): the box's own
 * aspect-ratio is narrowed to `cropPct` of the original photo's height, and the image
 * inside is rendered at its own natural size with `overflow: hidden` doing the clipping
 * — so `asset.cavity`'s percentages are all relative to the CROPPED box, not the
 * original photo.
 */
export function KegFill({
  levelPct, sizeMl, kegType = null, pouring, curServMl, units = 'us', className,
}: KegFillProps) {
  const reducedMotion = usePrefersReducedMotion();
  const clampedLevel = Math.max(0, Math.min(100, levelPct));
  const asset = useMemo(() => resolveKegAsset(sizeMl, kegType), [sizeMl, kegType]);
  const color = useMemo(() => levelToColor(clampedLevel), [clampedLevel]);

  const animated = pouring && !reducedMotion;

  const containerClassName = [
    'keg-fill',
    animated ? 'keg-fill--pouring' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const overlayClassName = [
    'keg-fill__level',
    reducedMotion ? '' : 'keg-fill__level--transition',
  ].filter(Boolean).join(' ');

  // Narrows the display box to `cropPct` of the original photo's height (at the photo's
  // own width:height ratio) — see the module doc comment above for why/how this crops
  // the baked-in caption band off without touching the image file itself.
  const cropStyle: CSSProperties = {
    aspectRatio: `${asset.width} / ${(asset.height * asset.cropPct) / 100}`,
  };

  const cavityStyle: CSSProperties = {
    top: `${asset.cavity.top}%`,
    bottom: `${100 - asset.cavity.bottom}%`,
    left: `${asset.cavity.left}%`,
    right: `${asset.cavity.right}%`,
    borderRadius: `${asset.cavity.borderRadius}%`,
  };

  const levelStyle: CSSProperties = {
    height: `${clampedLevel}%`,
    background: color,
  };

  return (
    <div
      className={containerClassName}
      data-testid="keg-fill"
      data-pouring={pouring}
      data-reduced-motion={reducedMotion}
      data-asset={asset.id}
    >
      <div className="keg-fill__crop" style={cropStyle}>
        <img
          src={asset.src}
          alt=""
          className="keg-fill__image"
          data-testid="keg-fill-image"
        />
        <div className="keg-fill__cavity" style={cavityStyle} data-testid="keg-fill-cavity">
          <div
            className={overlayClassName}
            style={levelStyle}
            data-testid="keg-fill-overlay"
          />
          <span className="keg-fill__percent" data-testid="keg-fill-percent">
            {`${Math.round(clampedLevel)}%`}
          </span>
        </div>
      </div>
      {pouring && (
        <div className="keg-fill__readout" data-testid="keg-fill-readout">
          {formatVolumeMl(curServMl ?? 0, units)}
        </div>
      )}
    </div>
  );
}

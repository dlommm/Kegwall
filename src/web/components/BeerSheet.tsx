import { useRef } from 'react';
import type { RecentPour } from '../lib/api';
import { formatRelativeTime } from '../lib/useRelativeTime';
import { formatVolumeMl, type VolumeUnits } from '../lib/units';
import { useFocusTrap } from '../lib/useFocusTrap';
import { TapMarker } from '../wall/TapMarker';
import type { WallTapModel } from '../wall/wallModel';

export interface BeerSheetProps {
  model: WallTapModel;
  units: VolumeUnits;
  /** Unclaimed recent pours on this tap. */
  pours: RecentPour[];
  onClaim: (pour: RecentPour) => void;
  onClose: () => void;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "Kicks in about 3 days" / "Tapped 2 days ago" / null. */
function kegLine(model: WallTapModel): string | null {
  if (model.isKicked) return 'This keg is kicked.';
  if (model.kicksInDays != null) {
    if (model.kicksInDays <= 0) return 'Likely to kick today.';
    return `Likely to kick in about ${model.kicksInDays} ${model.kicksInDays === 1 ? 'day' : 'days'}.`;
  }
  const tapped = model.tap.keg?.dateTapped;
  return tapped ? `Tapped ${formatRelativeTime(tapped)}.` : null;
}

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="beer-sheet__stars" role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rounded ? 'is-on' : n - 0.5 === rounded ? 'is-half' : undefined} aria-hidden="true">★</span>
      ))}
      <b>{value.toFixed(1)}</b>
    </span>
  );
}

/**
 * One beer on the phone menu (Kegwall V2 M10; fixes issues 4 and 18): an opaque bottom
 * sheet with the beer's marker, style · ABV · IBU, the tap and what's left, the description,
 * its rating, and the tap's unclaimed pours as "That was me" rows that open the claim picker.
 * Focus stays inside while it's open; Escape or the backdrop close it.
 */
export function BeerSheet({
  model, units, pours, onClaim, onClose,
}: BeerSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const line = [model.style, model.abv != null ? `${model.abv}% ABV` : null, model.ibu != null ? `${model.ibu} IBU` : null]
    .filter(Boolean).join(' · ');
  const keg = kegLine(model);
  return (
    <div className="beer-sheet__backdrop" data-testid="beer-sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="beer-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beer-sheet-title"
        tabIndex={-1}
        data-testid="beer-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="beer-sheet__grab" aria-hidden="true" />
        <header className="beer-sheet__head">
          <TapMarker model={model} size={72} />
          <div>
            <h2 id="beer-sheet-title" className="beer-sheet__name">{model.name ?? `Tap ${model.tapNumber}`}</h2>
            {model.brewery && <p className="beer-sheet__brewery">{model.brewery}</p>}
          </div>
          <button type="button" className="beer-sheet__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        {line && <p className="beer-sheet__line">{line}</p>}
        <dl className="beer-sheet__facts">
          <div><dt>Tap</dt><dd>{model.tapNumber}</dd></div>
          <div><dt>Left</dt><dd className={model.isLow ? 'is-low' : undefined}>{model.servingsLabel}</dd></div>
          {model.priceCents != null && <div><dt>A pint</dt><dd>{money(model.priceCents)}</dd></div>}
        </dl>
        {keg && <p className="beer-sheet__keg">{keg}</p>}
        {model.tap.avgRating != null && <Stars value={model.tap.avgRating} />}
        {model.notes && <p className="beer-sheet__desc" data-testid="beer-sheet-description">{model.notes}</p>}

        {pours.length > 0 && (
          <section className="beer-sheet__claims" aria-labelledby="beer-sheet-claims">
            <h3 id="beer-sheet-claims">Was one of these yours?</h3>
            <ul>
              {pours.map((pour) => (
                <li key={pour.id}>
                  <span>
                    <b>{formatVolumeMl(pour.volumeMl, units)}</b>
                    {` · ${formatRelativeTime(pour.ts)}`}
                  </span>
                  <button type="button" data-testid="beer-sheet-claim" onClick={() => onClaim(pour)}>That was me</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { LiquidFill } from './LiquidFill';
import { KickedBadge } from './KickedBadge';
import { useRelativeTime } from '../lib/useRelativeTime';
import type { VolumeUnits } from '../lib/units';
import { FIELD_KEYS, TEMPLATE_DEFAULT_FIELDS, type CardTemplate, type ResolvedFields } from '../lib/cardFields';

// Re-exported for existing import sites (e.g. `WallGrid.tsx`'s `import { TapCard, type
// CardTemplate } from './TapCard'`) — the type itself now lives in `lib/cardFields.ts`
// alongside `FIELD_KEYS`/`TEMPLATE_DEFAULT_FIELDS`, which the wall editor (Task 7) also
// needs and shouldn't have to import a component module to get at.
export type { CardTemplate };

/** Applies a wall's `config.fields` overrides on top of a template's defaults. */
function resolveFields(template: CardTemplate, overrides?: WallConfig['fields']): ResolvedFields {
  const resolved = { ...TEMPLATE_DEFAULT_FIELDS[template] };
  if (overrides) {
    for (const key of FIELD_KEYS) {
      const value = overrides[key];
      if (typeof value === 'boolean') resolved[key] = value;
    }
  }
  return resolved;
}

export interface TapCardProps {
  tap: TapState;
  template?: CardTemplate;
  /** A wall's `config.fields` — per-field visibility overrides on top of the template default. */
  fields?: WallConfig['fields'];
  /** Unit system for the ABV-adjacent pour readout. Defaults to `'us'`. */
  units?: VolumeUnits;
  className?: string;
}

/**
 * A single tap's card on the wall/menu. Renders the SRM-true `LiquidFill` as
 * its signature element plus beer metadata per `template`/`fields`. A tap
 * with no active keg renders a quiet empty state instead; a tap whose keg has
 * been kicked renders normally but drained, desaturated, and stamped (see
 * `KickedBadge`) rather than disappearing.
 */
export function TapCard({
  tap, template = 'standard', fields, units = 'us', className,
}: TapCardProps) {
  const resolvedFields = useMemo(() => resolveFields(template, fields), [template, fields]);
  // Always called (rules of hooks) even when there's no last pour to format — the hook
  // itself returns null and starts no interval in that case.
  const lastPourRelative = useRelativeTime(tap.lastPour?.ts ?? null);

  const isKicked = tap.keg?.status === 'kicked';
  const rootClassName = [
    'tap-card',
    `tap-card--${template}`,
    isKicked ? 'tap-card--kicked' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  if (!tap.beer || !tap.keg) {
    return (
      <div className={rootClassName} data-testid="tap-card" data-template={template}>
        <p className="tap-card__empty" data-testid="tap-card-empty">
          {`Tap ${tap.tapNumber} — nothing on tap`}
        </p>
      </div>
    );
  }

  const { beer, keg } = tap;
  const tapLabel = tap.tapName ?? `Tap ${tap.tapNumber}`;

  return (
    <div className={rootClassName} data-testid="tap-card" data-template={template} data-kicked={isKicked}>
      {resolvedFields.labelImage && beer.labelImage && (
        <img
          src={beer.labelImage}
          alt=""
          className="tap-card__label-image"
          data-testid="tap-card-label-image"
        />
      )}

      <div className="tap-card__liquid" data-testid="tap-card-liquid">
        <LiquidFill
          // A kicked keg reads as drained regardless of its last recorded level: showing
          // real remaining volume on a keg that's off tap would misleadingly imply it's
          // still pourable.
          levelPct={isKicked ? 0 : keg.levelPct}
          srm={beer.srm}
          pouring={!isKicked && tap.pouring}
          curServMl={tap.curServMl}
          units={units}
        />
        {/*
          The stamp is sized against this wrapper via `position: absolute; inset: 0`
          (see index.css) — fine at the full/standard/minimal liquid heights (8-10rem),
          but `compact`'s liquid swatch is a 28x40px corner element, far too small to
          contain the rotated stamp without it overflowing onto the neighbouring "TAP N"
          label (Phase 3 final review, finding I2). Compact gets an inline pill next to
          the beer name instead — see below.
        */}
        {isKicked && template !== 'compact' && <KickedBadge className="tap-card__kicked-badge" />}
      </div>

      <div className="tap-card__info">
        <span className="tap-card__tap-label font-tabular" data-testid="tap-card-tap-label">
          {tapLabel}
        </span>
        <h2 className="tap-card__name font-display" data-testid="tap-card-name">
          {beer.name}
        </h2>
        {isKicked && template === 'compact' && (
          <span className="tap-card__kicked-pill" data-testid="tap-card-kicked-pill">
            Kicked
          </span>
        )}

        {resolvedFields.brewery && beer.brewery && (
          <p className="tap-card__brewery font-body" data-testid="tap-card-brewery">
            {beer.brewery}
          </p>
        )}
        {resolvedFields.style && beer.style && (
          <p className="tap-card__style font-body" data-testid="tap-card-style">
            {beer.style}
          </p>
        )}
        {resolvedFields.description && beer.description && (
          <p className="tap-card__description font-body" data-testid="tap-card-description">
            {beer.description}
          </p>
        )}

        {(resolvedFields.abv || resolvedFields.ibu) && (
          <div className="tap-card__stats">
            {resolvedFields.abv && beer.abv != null && (
              <span className="tap-card__stat font-tabular" data-testid="tap-card-abv">
                {`${beer.abv.toFixed(1)}% ABV`}
              </span>
            )}
            {resolvedFields.ibu && beer.ibu != null && (
              <span className="tap-card__stat font-tabular" data-testid="tap-card-ibu">
                {`${beer.ibu} IBU`}
              </span>
            )}
          </div>
        )}

        {resolvedFields.lastPour && lastPourRelative && (
          <p className="tap-card__last-pour font-body font-tabular" data-testid="tap-card-last-pour">
            {`Last pour ${lastPourRelative}`}
          </p>
        )}
      </div>
    </div>
  );
}

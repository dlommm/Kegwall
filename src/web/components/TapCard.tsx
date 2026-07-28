import { useMemo } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { LiquidFill } from './LiquidFill';
import { KickedBadge } from './KickedBadge';
import { useRelativeTime } from '../lib/useRelativeTime';
import type { VolumeUnits } from '../lib/units';

export type CardTemplate = 'full' | 'standard' | 'compact' | 'minimal';

const FIELD_KEYS = ['labelImage', 'brewery', 'style', 'description', 'abv', 'ibu', 'lastPour'] as const;
type FieldKey = typeof FIELD_KEYS[number];
type ResolvedFields = Record<FieldKey, boolean>;

/**
 * Per-template default field visibility, per the Task 4 plan: `full` (label
 * art + all fields), `standard` (everything full has, minus the
 * description), `compact` (a dense row — just enough to identify the beer),
 * `minimal` (name + liquid only). A wall's `config.fields` overrides
 * individual keys on top of whichever template is active (see
 * `resolveFields`).
 */
const TEMPLATE_DEFAULT_FIELDS: Record<CardTemplate, ResolvedFields> = {
  full: {
    labelImage: true, brewery: true, style: true, description: true, abv: true, ibu: true, lastPour: true,
  },
  standard: {
    labelImage: true, brewery: true, style: true, description: false, abv: true, ibu: true, lastPour: true,
  },
  compact: {
    labelImage: false, brewery: false, style: true, description: false, abv: true, ibu: false, lastPour: false,
  },
  minimal: {
    labelImage: false, brewery: false, style: false, description: false, abv: false, ibu: false, lastPour: false,
  },
};

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
        {isKicked && <KickedBadge className="tap-card__kicked-badge" />}
      </div>

      <div className="tap-card__info">
        <span className="tap-card__tap-label font-tabular" data-testid="tap-card-tap-label">
          {tapLabel}
        </span>
        <h2 className="tap-card__name font-display" data-testid="tap-card-name">
          {beer.name}
        </h2>

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

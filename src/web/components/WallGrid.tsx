import { memo, type CSSProperties } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { TapCard, type CardTemplate } from './TapCard';
import type { VolumeUnits } from '../lib/units';

export interface WallGridProps {
  taps: TapState[];
  columns: number;
  template: CardTemplate;
  /** A wall's `config.fields` — per-field visibility overrides passed through to TapCard. */
  fields?: WallConfig['fields'];
  /** A wall's `config.fillStyle` — passed through to TapCard unchanged (see its own doc
   * comment for the `compact`-always-liquid exception). */
  fillStyle?: WallConfig['fillStyle'];
  units: VolumeUnits;
  /** Spotlight takeover (2b): the pouring tap's id — its card highlights, all
   * others dim (see index.css `.tap-card--spotlit`/`--spotlight-dimmed`). */
  spotlightTapId?: number | null;
}

/**
 * The wall's tap grid: a plain CSS grid sized to `columns` (via the `--wall-columns`
 * custom property, read by `.wall-grid` in index.css) with one `TapCard` per tap.
 * "Card scale" per the design direction comes for free from the grid itself — fewer
 * columns means more space per cell, so cards (and the liquid inside them) grow without
 * any separate scale knob. Purely presentational: page selection/rotation is WallPage's
 * job, this component just renders whichever tap list it's handed.
 *
 * Memoized: `useTapStates` keeps the taps array reference stable across unchanged WS
 * snapshots (`stabilizeTaps`), so shallow prop equality skips the grid entirely on
 * no-op snapshots; when one tap changes, `TapCard`'s own memo skips the others. Stable
 * `tap.tapId` keys throughout — never a remount.
 */
export const WallGrid = memo(function WallGrid({
  taps, columns, template, fields, fillStyle, units, spotlightTapId,
}: WallGridProps) {
  const style = { '--wall-columns': columns } as CSSProperties;

  return (
    <div className="wall-grid" data-testid="wall-grid" style={style}>
      {taps.map((tap) => (
        <TapCard
          key={tap.tapId}
          tap={tap}
          template={template}
          fields={fields}
          fillStyle={fillStyle}
          units={units}
          className={spotlightTapId == null ? undefined
            : (tap.tapId === spotlightTapId ? 'tap-card--spotlit' : 'tap-card--spotlight-dimmed')}
        />
      ))}
    </div>
  );
});

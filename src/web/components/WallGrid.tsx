import type { CSSProperties } from 'react';
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
}

/**
 * The wall's tap grid: a plain CSS grid sized to `columns` (via the `--wall-columns`
 * custom property, read by `.wall-grid` in index.css) with one `TapCard` per tap.
 * "Card scale" per the design direction comes for free from the grid itself — fewer
 * columns means more space per cell, so cards (and the liquid inside them) grow without
 * any separate scale knob. Purely presentational: page selection/rotation is WallPage's
 * job, this component just renders whichever tap list it's handed.
 */
export function WallGrid({
  taps, columns, template, fields, fillStyle, units,
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
        />
      ))}
    </div>
  );
}

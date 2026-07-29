import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
import type { TakeoverState } from '../../lib/useTakeover';
import { FullTakeover } from './FullTakeover';
import { SplitTakeover } from './SplitTakeover';
import { DockTakeover } from './DockTakeover';
import { FillTakeover } from './FillTakeover';

/** What every overlay takeover view receives. `state` is never idle here. */
export interface TakeoverViewProps {
  state: Extract<TakeoverState, { phase: 'active' | 'complete' }>;
  units: VolumeUnits;
  /** Site-wide Kegtron temp (same value the looks' sensor chip shows). */
  tempC: number | null;
}

/**
 * Dispatches an active/complete takeover to its overlay view. Two of the five
 * styles never reach here: 'off' (the hook stays idle) and 'spotlight' (2b is
 * not an overlay — the wall itself dims/highlights rows via the
 * `spotlightTapId` prop threaded into the looks/grid by WallPage).
 */
export function PourTakeover({
  style, state, units, tempC,
}: TakeoverViewProps & { style: WallConfig['takeover']['style'] }) {
  if (state.phase !== 'active' && state.phase !== 'complete') return null;
  const props = { state, units, tempC };
  switch (style) {
    case 'full': return <FullTakeover {...props} />;
    case 'split': return <SplitTakeover {...props} />;
    case 'dock': return <DockTakeover {...props} />;
    case 'fill': return <FillTakeover {...props} />;
    default: return null;
  }
}

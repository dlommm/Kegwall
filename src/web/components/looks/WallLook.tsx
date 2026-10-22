import { memo, type ComponentType } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
import type { AmbientSensor } from './lookShared';
import { JustTappedLook } from '../../wall/looks/JustTappedLook';
import { ClassicLook } from '../../wall/looks/ClassicLook';
import { LedgerLook } from '../../wall/looks/LedgerLook';
import { ColumnsLook } from '../../wall/looks/ColumnsLook';
import { GalleryLook } from '../../wall/looks/GalleryLook';
import { ChalkboardLook } from '../../wall/looks/ChalkboardLook';
import { EditorialLook } from '../../wall/looks/EditorialLook';
import { NeonLook } from '../../wall/looks/NeonLook';
import { TerminalLook } from '../../wall/looks/TerminalLook';
import { PosterLook } from '../../wall/looks/PosterLook';
import { DeparturesLook } from '../../wall/looks/DeparturesLook';
import { ZenLook } from '../../wall/looks/ZenLook';
import { HandlesLook } from '../../wall/looks/HandlesLook';
import { TallyLook } from '../../wall/looks/TallyLook';

type LookComponent = ComponentType<WallLookProps>;

/**
 * Kegwall V2 looks: drawn on the 1920 × 1080 stage (design/Stage.tsx), so the wall shows the
 * same composition at any resolution. `pageSize` is how many taps one page holds before the
 * wall auto-paginates (the density ladder for that look).
 */
export const V2_LOOKS: Partial<Record<WallConfig['look'], { component: LookComponent; pageSize: number }>> = {
  'just-tapped': { component: JustTappedLook, pageSize: 12 },
  classic: { component: ClassicLook, pageSize: 12 },
  ledger: { component: LedgerLook, pageSize: 12 },
  columns: { component: ColumnsLook, pageSize: 8 },
  gallery: { component: GalleryLook, pageSize: 8 },
  chalkboard: { component: ChalkboardLook, pageSize: 8 },
  editorial: { component: EditorialLook, pageSize: 12 },
  neon: { component: NeonLook, pageSize: 8 },
  terminal: { component: TerminalLook, pageSize: 12 },
  poster: { component: PosterLook, pageSize: 12 },
  departures: { component: DeparturesLook, pageSize: 11 },
  zen: { component: ZenLook, pageSize: 12 },
  handles: { component: HandlesLook, pageSize: 8 },
  tally: { component: TallyLook, pageSize: 12 },
};

/** True when this look is a V2 stage look. */
export function isStageLook(look: WallConfig['look']): boolean {
  return V2_LOOKS[look] !== undefined;
}

/** Taps per auto-generated page: the look's own capacity (its density ladder). */
export function autoPageSize(look: WallConfig['look']): number {
  return V2_LOOKS[look]?.pageSize ?? 12;
}

/** The props every wall look receives (the "look contract"): the current page's taps, the
 * wall config, resolved title, and the shared chrome inputs (clock/temp/QR/pagination).
 * Looks own their entire 1080p frame: header, body and footer. */
export interface WallLookProps {
  taps: TapState[];
  config: WallConfig;
  units: VolumeUnits;
  title: string;
  menuUrl: string;
  /** Max Kegtron temp across ALL of the wall's taps (site-wide readout, so it
   * doesn't flicker as pages rotate), or null when unavailable. */
  tempC: number | null;
  logoUrl?: string | null;
  pageIndex: number;
  pageCount: number;
  rotationSeconds: number;
  /** Spotlight takeover (2b): the currently pouring tap's id — its row/card
   * highlights and every other one dims. Null/undefined = no spotlight. */
  spotlightTapId?: number | null;
  /** Named Govee ambient sensors (Phase 6) for the header sensor strip. */
  sensors?: AmbientSensor[];
  /** Kegwall V2: every tap on the wall (not just this page), for wall-wide choices such as
   * the Just Tapped spotlight and the headline. Defaults to `taps`. */
  allTaps?: TapState[];
  /** Kegwall V2: one serving in mL, for "pints left". Defaults to a US pint. */
  servingSizeMl?: number;
}

export type LookId = WallConfig['look'];

/** The look a wall actually renders: its configured look, or classic for an unknown id. */
export function resolveLook(look: WallConfig['look'] | undefined): LookId {
  return look && V2_LOOKS[look] ? look : 'classic';
}

/** Dispatches to the configured look's component. Memoized (like every look it
 * dispatches to): the `/ws` feed pushes a full snapshot for every state change, and
 * `useTapStates` keeps tap/array references stable across unchanged snapshots
 * (`stabilizeTaps`), so shallow prop equality here skips the whole look subtree
 * whenever nothing this page shows actually changed. Same component identity every
 * render — never a remount, so scroll/animation state always survives snapshots. */
export const WallLook = memo(function WallLook(props: WallLookProps) {
  const look = resolveLook(props.config.look);
  const Component = V2_LOOKS[look]?.component;
  if (!Component) return null;
  return <Component {...props} />;
});

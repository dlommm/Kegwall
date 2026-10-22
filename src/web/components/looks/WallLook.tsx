import { memo, type ReactElement } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
import type { AmbientSensor } from './lookShared';
import { LedgerLook } from './LedgerLook';
import { GalleryLook } from './GalleryLook';
import { ColumnsLook } from './ColumnsLook';
import {
  ChalkboardLook, EditorialLook, NeonLook, TerminalLook, PosterLook, DeparturesLook, ZenLook,
} from './styleLooks';

/** The props every wall look receives (the "look contract"): the current
 * page's taps, the wall config, resolved title, and the shared chrome inputs
 * (clock/temp/QR/pagination). Looks own their entire 1080p frame — header,
 * body, footer — unlike the classic WallGrid path where WallPage composes
 * WallHeader + grid separately. */
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
}

/** Non-classic look id → component. `classic` never reaches here (WallPage
 * keeps its existing WallHeader/WallGrid path for it). Kegwall V2 looks register here as
 * they are built; an id without a component renders as classic (see `resolveLook`). */
const LOOKS: Partial<Record<WallConfig['look'], (props: WallLookProps) => ReactElement | null>> = {
  ledger: LedgerLook,
  gallery: GalleryLook,
  columns: ColumnsLook,
  chalkboard: ChalkboardLook,
  editorial: EditorialLook,
  neon: NeonLook,
  terminal: TerminalLook,
  poster: PosterLook,
  departures: DeparturesLook,
  zen: ZenLook,
};

export type LookId = WallConfig['look'];

/** The look a wall actually renders: its configured look when one is built, else classic. */
export function resolveLook(look: WallConfig['look'] | undefined): LookId {
  return look && (look === 'classic' || LOOKS[look]) ? look : 'classic';
}

/** Dispatches to the configured look's component. Memoized (like every look it
 * dispatches to): the `/ws` feed pushes a full snapshot for every state change, and
 * `useTapStates` keeps tap/array references stable across unchanged snapshots
 * (`stabilizeTaps`), so shallow prop equality here skips the whole look subtree
 * whenever nothing this page shows actually changed. Same component identity every
 * render — never a remount, so scroll/animation state always survives snapshots. */
export const WallLook = memo(function WallLook(props: WallLookProps) {
  const look = props.config.look;
  const Component = look !== 'classic' ? LOOKS[look] : undefined;
  if (!Component) return null;
  return <Component {...props} />;
});

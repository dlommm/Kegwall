import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
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
}

/** Non-classic look id → component. `classic` never reaches here (WallPage
 * keeps its existing WallHeader/WallGrid path for it). */
const LOOKS = {
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
} as const;

export type LookId = keyof typeof LOOKS | 'classic';

/** Dispatches to the configured look's component. */
export function WallLook(props: WallLookProps) {
  const look = props.config.look;
  const Component = look !== 'classic' ? LOOKS[look] : undefined;
  if (!Component) return null;
  return <Component {...props} />;
}

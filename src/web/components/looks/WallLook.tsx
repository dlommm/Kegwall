import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import type { VolumeUnits } from '../../lib/units';
import { LedgerLook } from './LedgerLook';
import { GalleryLook } from './GalleryLook';
import { ColumnsLook } from './ColumnsLook';

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
}

/** Non-classic look id → component. `classic` never reaches here (WallPage
 * keeps its existing WallHeader/WallGrid path for it). */
const LOOKS = {
  ledger: LedgerLook,
  gallery: GalleryLook,
  columns: ColumnsLook,
} as const;

export type LookId = keyof typeof LOOKS | 'classic';

/** Dispatches to the configured look's component. */
export function WallLook(props: WallLookProps) {
  const look = props.config.look;
  const Component = look !== 'classic' ? LOOKS[look] : undefined;
  if (!Component) return null;
  return <Component {...props} />;
}

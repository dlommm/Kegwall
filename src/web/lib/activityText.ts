import type { ActivityEvent } from '../../server/db/activity.js';
import { formatVolumeMl, type VolumeUnits } from './units';

/**
 * Turns a structured `ActivityEvent` (see `server/db/activity.ts`) into the prose the
 * dashboard's activity feed renders. The server deliberately returns "text-ready
 * fields, not prose" (Task 3 plan) — beerName/tapNumber/volumeMl/kind — so all copy and
 * tone (sentence case, plain verbs, per the design direction) lives here, client-side.
 */
export function formatActivityText(event: ActivityEvent, units: VolumeUnits): string {
  const tapPhrase = event.tapNumber != null ? ` on tap ${event.tapNumber}` : '';
  if (event.kind === 'keg_tapped') {
    return `Tapped ${event.beerName}${tapPhrase}`;
  }
  const volume = event.volumeMl != null ? formatVolumeMl(event.volumeMl, units) : 'a pour';
  return `Poured ${volume} of ${event.beerName}${tapPhrase}`;
}

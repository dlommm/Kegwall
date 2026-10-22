import { useEffect, useState } from 'react';

/**
 * Small shared pieces for wall surfaces: the slow clock every look and takeover shows, and
 * the ambient-sensor shape the looks' meta line reads. (Kegwall V2 moved the rest of the
 * look chrome into wall/looks/lookKit.tsx.)
 */

const CLOCK_UPDATE_MS = 30_000;

/** "5:24 PM"-style clock string, refreshed every 30s (same cadence WallHeader uses). */
export function useLookClock(): string {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_UPDATE_MS);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface AmbientSensor {
  sensorId: string;
  name: string;
  tempC: number | null;
  humidity: number | null;
}

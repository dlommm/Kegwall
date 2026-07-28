import { useEffect, useState } from 'react';
import { formatTempC, type VolumeUnits } from '../lib/units';

const CLOCK_UPDATE_MS = 30_000;

export interface WallHeaderProps {
  /** Wall site title — `config.header.title`, falling back to the wall's own name. */
  title: string;
  /**
   * Site logo image URL. There's no `config.header.logo`/settings field feeding this
   * yet (see the Task 5 report) — the prop exists so the component is ready the moment
   * one lands; today every caller passes `null`/omits it.
   */
  logoUrl?: string | null;
  showClock: boolean;
  showTemp: boolean;
  /**
   * Max monitor temperature in Celsius, or `null` when unavailable. `TapState` doesn't
   * carry a temperature reading yet (telemetry is recorded per-monitor but never
   * surfaced on the public tap payload — see the Task 5 report's documented gap), so
   * every current caller passes `null` and the readout stays hidden even when
   * `showTemp` is true. Implemented and tested here so wiring real data through later
   * is a one-line change at the call site, not a new component.
   */
  tempC: number | null;
  units: VolumeUnits;
  ticker?: string;
}

/**
 * The wall's optional top chrome: site title/logo, a slowly-updating clock, a max-temp
 * readout, and a ticker line — each independently toggleable per `config.header`/
 * `config.ticker` (Task 5 plan).
 */
export function WallHeader({
  title, logoUrl, showClock, showTemp, tempC, units, ticker,
}: WallHeaderProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!showClock) return undefined;
    const id = setInterval(() => setNow(new Date()), CLOCK_UPDATE_MS);
    return () => clearInterval(id);
  }, [showClock]);

  const showTempReadout = showTemp && tempC != null;

  return (
    <header className="wall-header" data-testid="wall-header">
      <div className="wall-header__identity">
        {logoUrl && (
          <img src={logoUrl} alt="" className="wall-header__logo" data-testid="wall-header-logo" />
        )}
        <h1 className="wall-header__title font-display" data-testid="wall-header-title">
          {title}
        </h1>
      </div>

      <div className="wall-header__meta">
        {showClock && (
          <span className="wall-header__clock font-tabular" data-testid="wall-header-clock">
            {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {showTempReadout && (
          <span className="wall-header__temp font-tabular" data-testid="wall-header-temp">
            {formatTempC(tempC as number, units)}
          </span>
        )}
      </div>

      {ticker && (
        <div className="wall-header__ticker font-body" data-testid="wall-header-ticker">
          {ticker}
        </div>
      )}
    </header>
  );
}

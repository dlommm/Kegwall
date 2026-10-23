import { useEffect, useState } from 'react';
import { getPassport, type PassportResponse } from '../lib/api';
import { getRememberedPourer } from '../lib/pourerIdentity';
import { formatVolumeMl } from '../lib/units';
import { formatRelativeTime } from '../lib/useRelativeTime';
import './PassportCard.css';

const ML_PER_GALLON = 3785.411784;

/**
 * The pourer passport (design 6a), menu edition: when this phone remembers a
 * pourer ("your phone remembers you", lib/pourerIdentity.ts), show their own
 * stats — pours / gallons / styles tried, earned badges, and recent pours with
 * their ★ ratings. Renders nothing for an anonymous visitor.
 */
export function PassportCard() {
  const [passport, setPassport] = useState<PassportResponse | null>(null);

  useEffect(() => {
    const remembered = getRememberedPourer();
    if (!remembered) return undefined;
    let cancelled = false;
    getPassport(remembered.id).then((result) => {
      if (!cancelled && result.ok) setPassport(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!passport) return null;

  return (
    <section className="passport" data-testid="passport-card" aria-labelledby="passport-heading">
      <h2 id="passport-heading" className="passport__heading font-display">
        {`${passport.drinker.displayName}’s passport`}
      </h2>
      <div className="passport__stats font-tabular" data-testid="passport-stats">
        <span>{`${passport.pourCount} pours`}</span>
        <span>{`${(passport.volumeMl / ML_PER_GALLON).toFixed(1)} gal`}</span>
        <span>{`${passport.stylesTried} styles`}</span>
        {passport.avgQuality != null && <span>{`Q ${passport.avgQuality}`}</span>}
      </div>
      {passport.badges.length > 0 && (
        <div className="passport__badges" data-testid="passport-badges">
          {passport.badges.map((badge) => (
            <span key={badge} className="passport__badge">{badge}</span>
          ))}
        </div>
      )}
      {passport.recent.length > 0 && (
        <ul className="passport__recent" data-testid="passport-recent">
          {passport.recent.map((pour) => (
            <li key={pour.id} className="passport__recent-row">
              <span className="passport__recent-beer">{pour.beerName}</span>
              <span className="passport__recent-meta font-tabular">
                {formatVolumeMl(pour.volumeMl, 'us')}
                {pour.rating != null ? ` · ${'★'.repeat(pour.rating)}` : ''}
                {` · ${formatRelativeTime(pour.ts)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import { listKegs } from '../../lib/adminApi';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';

const HISTORY_LIMIT = 5;

interface KickedHistoryProps {
  tapId: number;
  beers: Beer[];
  units: VolumeUnits;
  refreshKey: number;
}

function beerName(beers: Beer[], beerId: number): string {
  return beers.find((b) => b.id === beerId)?.name ?? 'Unknown beer';
}

/**
 * A tap's last few kicked kegs, collapsed by default (Task 5). Reuses the existing
 * `GET /api/kegs?status=kicked` endpoint (already server-tested, already sorted
 * newest-first) rather than adding a dedicated per-tap history route: `kegs` carries
 * `tapId`, so filtering down to one tap and taking the first `HISTORY_LIMIT` is a plain
 * client-side slice with no new server surface to build, test, or keep in sync — the
 * cost is fetching every kicked keg system-wide on each expand, which is fine at this
 * app's scale (a home/small taproom's total kicked-keg count) and matches the
 * already-established "load once, filter client-side" pattern used elsewhere in this
 * phase (e.g. BeersPage's full catalog fetch).
 */
export function KickedHistory({ tapId, beers, units, refreshKey }: KickedHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  useEffect(() => {
    if (!expanded) return;
    setStatus('loading');
    listKegs({ status: 'kicked' }).then((result) => {
      if (result.ok) {
        setKegs(result.data.filter((k) => k.tapId === tapId).slice(0, HISTORY_LIMIT));
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey intentionally
    // re-triggers this fetch even though it isn't read inside the effect body.
  }, [expanded, tapId, refreshKey]);

  return (
    <div className="kicked-history" data-testid="kicked-history">
      <button
        type="button"
        className="kicked-history__toggle"
        data-testid="kicked-history-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Hide kicked history' : 'Show kicked history'}
      </button>

      {expanded && (
        <>
          {status === 'loading' && <p className="admin-page-quiet" data-testid="kicked-history-loading">Loading…</p>}
          {status === 'error' && (
            <p className="admin-page-quiet" role="alert" data-testid="kicked-history-error">
              Couldn&rsquo;t load kicked history. Try again.
            </p>
          )}
          {status === 'loaded' && kegs.length === 0 && (
            <p className="admin-page-quiet" data-testid="kicked-history-empty">No kicked kegs yet.</p>
          )}
          {status === 'loaded' && kegs.length > 0 && (
            <ul className="kicked-history__list" data-testid="kicked-history-list">
              {kegs.map((keg) => (
                <li key={keg.id} className="kicked-history__row" data-testid="kicked-history-row">
                  <span>{beerName(beers, keg.beerId)}</span>
                  <span className="font-tabular">{formatVolumeMl(keg.sizeMl, units)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

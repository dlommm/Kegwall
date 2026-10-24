import { useEffect, useMemo, useState } from 'react';
import {
  getLeaderboard, getPourers, type LeaderboardResponse, type PublicPourer,
} from '../../lib/api';
import { qrCodeSvg } from '../../lib/qr';
import { formatBoardVolume } from '../../components/LeaderboardBoard';
import { initials } from '../../lib/initials';
import { pickInk } from '../../lib/contrast';
import { beerColorFor } from '../../wall/wallModel';
import { Tally } from '../../components/Tally';
import { useAdminContext } from './useAdminContext';
import { ErrorState, Skeleton } from './ui';

/**
 * The People page's Pourers tab, also served at `/admin/pourers`: the passwordless pourers as
 * cards, most volume first — avatar, name, lifetime pours, all-time volume and average pour
 * quality — plus the invite QR (the public menu, where the phone join/claim flow lives).
 * `embedded` hides the standalone header under the People page's header and tabs.
 */
export function PourersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { units } = useAdminContext();
  const [pourers, setPourers] = useState<PublicPourer[]>([]);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPourers(), getLeaderboard('all')]).then(([pourersResult, boardResult]) => {
      if (cancelled) return;
      if (pourersResult.ok) {
        setPourers(pourersResult.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
      if (boardResult.ok) setBoard(boardResult.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const statsByDrinker = useMemo(() => {
    const map = new Map<number, { volumeMl: number; avgQuality: number | null; beers: { srm: number | null }[] }>();
    for (const entry of board?.entries ?? []) {
      map.set(entry.drinkerId, { volumeMl: entry.volumeMl, avgQuality: entry.avgQuality, beers: entry.beers ?? [] });
    }
    return map;
  }, [board]);

  const inviteUrl = `${window.location.origin}/menu`;
  const inviteQr = useMemo(() => qrCodeSvg(inviteUrl), [inviteUrl]);

  // Ranked by pours, the tally a bar keeps; volume breaks a tie.
  const ranked = [...pourers].sort((a, b) => b.pourCount - a.pourCount
    || (statsByDrinker.get(b.id)?.volumeMl ?? 0) - (statsByDrinker.get(a.id)?.volumeMl ?? 0));

  return (
    <div data-testid="pourers-page">
      {!embedded && (
        <header className="adm-page__head">
          <div className="adm-page__say">
            <h1 className="adm-page__title">Pourers</h1>
            <p className="adm-page__sub">
              Passwordless pourers. They join from the kegerator tablet or the menu QR, no account needed.
            </p>
          </div>
        </header>
      )}

      {status === 'loading' && <Skeleton height={140} />}
      {status === 'error' && (
        <div data-testid="pourers-error"><ErrorState title="Couldn’t load pourers." /></div>
      )}

      {status === 'loaded' && (
        <div className="people-v2__layout">
          <ol className="people-v2__list" data-testid="pourers-grid">
            {ranked.map((pourer, i) => {
              const stats = statsByDrinker.get(pourer.id);
              // Colored by the beer they pour most; their own avatar color until they've poured.
              const favorite = stats?.beers[0];
              const color = favorite ? beerColorFor(favorite.srm) : pourer.avatarColor ?? '#7A6C58';
              return (
                <li key={pourer.id} className="people-v2__row" data-testid="pourer-card">
                  <span className="people-v2__rank">{i + 1}</span>
                  <span className="people-v2__avatar" style={{ backgroundColor: color, color: pickInk(color) }} aria-hidden="true">
                    {initials(pourer.displayName)}
                  </span>
                  <span className="people-v2__who">
                    <b className="people-v2__name">{pourer.displayName}</b>
                    {stats && stats.beers.length > 0 && (
                      <span className="people-v2__strip" aria-hidden="true">
                        {stats.beers.map((b, j) => <i key={j} style={{ background: beerColorFor(b.srm) }} />)}
                      </span>
                    )}
                  </span>
                  <Tally count={pourer.pourCount} className="people-v2__tally" />
                  <span className="adm-sub adm-num-cell people-v2__figures">
                    {[
                      `${pourer.pourCount} pour${pourer.pourCount === 1 ? '' : 's'}`,
                      stats ? `${formatBoardVolume(stats.volumeMl, units)} in all` : null,
                      stats?.avgQuality != null ? `quality ${stats.avgQuality}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ol>
          <aside className="people-v2__invite" data-testid="pourers-invite">
            {/* eslint-disable-next-line react/no-danger -- our own generated QR markup */}
            <div className="people-v2__qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inviteQr }} />
            <b className="people-v2__name">Invite someone</b>
            <span className="adm-sub">Scan to join from a phone</span>
          </aside>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  getLeaderboard, getPourers, type LeaderboardResponse, type PublicPourer,
} from '../../lib/api';
import { qrCodeSvg } from '../../lib/qr';
import { formatBoardVolume } from '../../components/LeaderboardBoard';
import { initials } from '../../lib/initials';
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
    const map = new Map<number, { volumeMl: number; avgQuality: number | null }>();
    for (const entry of board?.entries ?? []) {
      map.set(entry.drinkerId, { volumeMl: entry.volumeMl, avgQuality: entry.avgQuality });
    }
    return map;
  }, [board]);

  const inviteUrl = `${window.location.origin}/menu`;
  const inviteQr = useMemo(() => qrCodeSvg(inviteUrl), [inviteUrl]);

  const ranked = [...pourers].sort((a, b) => (statsByDrinker.get(b.id)?.volumeMl ?? 0) - (statsByDrinker.get(a.id)?.volumeMl ?? 0));

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
        <ul className="people-v2__grid" data-testid="pourers-grid">
          {ranked.map((pourer) => {
            const stats = statsByDrinker.get(pourer.id);
            return (
              <li key={pourer.id} className="people-v2__card" data-testid="pourer-card">
                <span className="people-v2__avatar people-v2__avatar--big" style={{ backgroundColor: pourer.avatarColor ?? '#7A6C58' }} aria-hidden="true">
                  {initials(pourer.displayName)}
                </span>
                <b className="people-v2__name">{pourer.displayName}</b>
                <span className="adm-sub adm-num-cell">
                  {[
                    `${pourer.pourCount} pour${pourer.pourCount === 1 ? '' : 's'}`,
                    stats ? `${formatBoardVolume(stats.volumeMl, units)} in all` : null,
                    stats?.avgQuality != null ? `quality ${stats.avgQuality}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            );
          })}
          <li className="people-v2__card people-v2__card--invite" data-testid="pourers-invite">
            {/* eslint-disable-next-line react/no-danger -- our own generated QR markup */}
            <div className="people-v2__qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inviteQr }} />
            <b className="people-v2__name">Invite someone</b>
            <span className="adm-sub">Scan to join from a phone</span>
          </li>
        </ul>
      )}
    </div>
  );
}

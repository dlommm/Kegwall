import { useEffect, useMemo, useState } from 'react';
import {
  getLeaderboard, getPourers, type LeaderboardResponse, type PublicPourer,
} from '../../lib/api';
import { qrCodeSvg } from '../../lib/qr';
import { formatBoardVolume } from '../../components/LeaderboardBoard';
import { useAdminContext } from './useAdminContext';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

/**
 * `/admin/pourers` (design 11c, first cut in Phase 4): the passwordless pourer
 * tier as a card grid — avatar, name, lifetime pours, all-time volume and
 * average pour quality — plus the invite QR (the public menu, where the phone
 * join/claim flow lives). Merge/promote/export land with the full 11c pass in
 * Phase 6.
 */
export function PourersPage() {
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

  return (
    <div data-testid="pourers-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Pourers</h1>
        <p className="admin-page-quiet">
          Passwordless pourers — they join from the kegerator tablet or the menu QR, no account needed.
        </p>
      </header>

      {status === 'loading' && <p className="admin-page-quiet">Loading pourers…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="pourers-error">Couldn&rsquo;t load pourers.</p>
      )}

      {status === 'loaded' && (
        <div className="pourers-grid" data-testid="pourers-grid">
          {pourers.map((pourer) => {
            const stats = statsByDrinker.get(pourer.id);
            return (
              <div key={pourer.id} className="pourer-card" data-testid="pourer-card">
                <span className="pourer-card__avatar font-display" style={{ backgroundColor: pourer.avatarColor ?? '#7A6C58' }}>
                  {initials(pourer.displayName)}
                </span>
                <span className="pourer-card__name">{pourer.displayName}</span>
                <span className="pourer-card__stats font-tabular">
                  {[
                    `${pourer.pourCount} pours`,
                    stats ? formatBoardVolume(stats.volumeMl, units) : null,
                    stats?.avgQuality != null ? `Q ${stats.avgQuality}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            );
          })}
          <div className="pourer-card pourer-card--invite" data-testid="pourers-invite">
            {/* eslint-disable-next-line react/no-danger -- our own generated QR markup */}
            <div className="pourer-card__qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inviteQr }} />
            <span className="pourer-card__name">Invite</span>
            <span className="pourer-card__stats">Scan to join from a phone</span>
          </div>
        </div>
      )}
    </div>
  );
}

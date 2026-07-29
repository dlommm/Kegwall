import { useEffect, useState } from 'react';
import { ThemeProvider } from '../themes/ThemeProvider';
import { LeaderboardBoard } from '../components/LeaderboardBoard';
import { getLeaderboard, getMenu, type LeaderboardResponse } from '../lib/api';
import type { VolumeUnits } from '../lib/units';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * `/board` — the standalone pourer-leaderboard TV view (design 4a/6b). Fetches
 * the public leaderboard on a 60s poll (same cadence as the admin stats pages)
 * plus the site name/units from the public menu endpoint. Rendered in the
 * default theme; Phase 5's rotation playlists reuse `LeaderboardBoard` inside
 * a wall's own theme instead.
 */
export function BoardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [siteName, setSiteName] = useState('Leaderboard');
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getLeaderboard('month').then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else {
          setError(result.message);
        }
      });
    };
    load();
    getMenu().then((result) => {
      if (cancelled || !result.ok) return;
      setSiteName(result.data.siteName);
      setUnits(result.data.units ?? 'us');
    });
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <ThemeProvider className="board-page">
      {data ? (
        <LeaderboardBoard data={data} units={units} title={siteName} />
      ) : (
        <main className="board-page__loading" data-testid="board-page-loading">
          <p>{error ?? 'Loading the leaderboard…'}</p>
        </main>
      )}
    </ThemeProvider>
  );
}

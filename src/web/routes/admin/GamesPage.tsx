import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGames, getActiveGame, startGameSession, endGameSession,
  type Game,
} from '../../lib/adminApi';
import { useAdminContext } from './useAdminContext';

/** Category display metadata (redesign 5a) — color tick + header + subtitle, in doc order. */
const CATEGORY_META: Record<Game['category'], { label: string; color: string; subtitle: string }> = {
  volume: { label: 'Volume & Races', color: '#D08C4C', subtitle: 'Pour the most, or hit a target first.' },
  precision: { label: 'Precision & Skill', color: '#5FD9BC', subtitle: 'Steady hands and clean pours win.' },
  cardboard: { label: 'Card & Board Tie-ins', color: '#B48CFF', subtitle: 'Your favorite tabletop, with taps.' },
  party: { label: 'Party & Social', color: '#E7B93F', subtitle: 'Big-group chaos and dares.' },
  team: { label: 'Team & Tournament', color: '#57B45F', subtitle: 'Draft, bracket, and league play.' },
  season: { label: 'Season & Long-haul', color: '#7FA8E0', subtitle: 'Slow burns across weeks and months.' },
  chance: { label: 'Chance & Chaos', color: '#E05B4B', subtitle: 'Luck decides who pours.' },
  mind: { label: 'Mind & Trivia', color: '#C77FB8', subtitle: 'Outsmart the table.' },
};
const CATEGORY_ORDER = Object.keys(CATEGORY_META) as Game['category'][];

type Filter = 'all' | Game['category'] | 'AUTO' | 'TABLET';

/**
 * `/admin/games` (redesign 5a): the 100-game library, grouped by category with color-coded
 * filter chips. Editors can start a game (one at a time) — results decorate the ONE house
 * leaderboard (Phase 5), never a separate board.
 */
export function GamesPage() {
  const { me } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getGames().then((result) => {
      if (result.ok) { setGames(result.data); setStatus('loaded'); } else setStatus('error');
    });
    getActiveGame().then((result) => {
      if (result.ok && result.data) {
        setActiveName(result.data.game.name);
        setActiveSessionId(result.data.session.id);
      } else {
        setActiveName(null);
        setActiveSessionId(null);
      }
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => games.filter((game) => {
    if (filter === 'all') return true;
    if (filter === 'AUTO' || filter === 'TABLET') return game.tracking === filter;
    return game.category === filter;
  }), [games, filter]);

  const byCategory = useMemo(() => CATEGORY_ORDER
    .map((cat) => ({ cat, items: visible.filter((game) => game.category === cat) }))
    .filter((section) => section.items.length > 0), [visible]);

  async function handleStart(game: Game) {
    setBusy(true);
    const result = await startGameSession({ gameId: game.id });
    setBusy(false);
    if (result.ok) load();
  }

  async function handleEnd() {
    if (activeSessionId == null) return;
    setBusy(true);
    await endGameSession(activeSessionId);
    setBusy(false);
    load();
  }

  return (
    <section data-testid="admin-games-page">
      <header className="admin-page-header">
        <div className="admin-page-header__lead">
          <h1 className="admin-page-header__title font-display">Games</h1>
          {status === 'loaded' && (
            <span className="beers-summary font-tabular" data-testid="games-count">{`${games.length} games`}</span>
          )}
        </div>
      </header>

      {activeName && (
        <div className="games-active-banner" data-testid="games-active-banner">
          <span>
            <span className="games-active-banner__dot" aria-hidden="true" />
            {` Now playing: ${activeName}`}
          </span>
          {canEdit && (
            <button type="button" className="games-active-banner__end" data-testid="games-end" disabled={busy} onClick={handleEnd}>
              End game
            </button>
          )}
        </div>
      )}

      <div className="games-filters" role="group" aria-label="Filter games" data-testid="games-filters">
        <button type="button" className="games-chip" data-testid="games-filter-all" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </button>
        {CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            type="button"
            className="games-chip"
            data-testid={`games-filter-${cat}`}
            aria-pressed={filter === cat}
            style={filter === cat ? { borderColor: CATEGORY_META[cat].color, color: CATEGORY_META[cat].color } : undefined}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_META[cat].label}
          </button>
        ))}
        {(['AUTO', 'TABLET'] as const).map((t) => (
          <button key={t} type="button" className="games-chip" data-testid={`games-filter-${t.toLowerCase()}`} aria-pressed={filter === t} onClick={() => setFilter(t)}>
            {t}
          </button>
        ))}
      </div>

      {status === 'loading' && <p className="admin-page-quiet" data-testid="games-loading">Loading…</p>}
      {status === 'error' && <p className="admin-page-quiet" role="alert" data-testid="games-error">Couldn’t load games.</p>}

      {byCategory.map(({ cat, items }) => (
        <section key={cat} className="games-section" data-testid={`games-section-${cat}`}>
          <div className="games-section__head">
            <span className="games-section__tick" style={{ background: CATEGORY_META[cat].color }} aria-hidden="true" />
            <h2 className="games-section__title font-display">{CATEGORY_META[cat].label}</h2>
            <span className="games-section__subtitle">{CATEGORY_META[cat].subtitle}</span>
          </div>
          <div className="games-grid">
            {items.map((game) => (
              <article key={game.id} className="game-card" data-testid="game-card">
                <h3 className="game-card__name font-display">{game.name}</h3>
                <p className="game-card__premise">{game.premise}</p>
                <div className="game-card__chips">
                  <span className={`game-tag game-tag--${game.tracking.toLowerCase()}`} data-testid="game-tracking">{game.tracking}</span>
                  <span className="game-card__meta font-tabular">
                    {`${game.minPlayers}${game.maxPlayers ? `–${game.maxPlayers}` : '+'} players`}
                  </span>
                  {game.duration && <span className="game-card__meta font-tabular">{game.duration}</span>}
                  {canEdit && !activeName && (
                    <button type="button" className="game-card__start" data-testid="game-start" disabled={busy} onClick={() => handleStart(game)}>
                      Start
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

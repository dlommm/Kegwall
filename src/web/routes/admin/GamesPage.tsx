import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGames, getActiveGame, startGameSession, endGameSession,
  type Game,
} from '../../lib/adminApi';
import { getPourers, type PublicPourer } from '../../lib/api';
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
  // 5b game-setup sheet: pick players (+ a target for volume games) before the game starts.
  const [pourers, setPourers] = useState<PublicPourer[]>([]);
  const [setupGame, setSetupGame] = useState<Game | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [targetOz, setTargetOz] = useState('100');

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
  useEffect(() => {
    getPourers().then((result) => { if (result.ok) setPourers(result.data); });
  }, []);

  const visible = useMemo(() => games.filter((game) => {
    if (filter === 'all') return true;
    if (filter === 'AUTO' || filter === 'TABLET') return game.tracking === filter;
    return game.category === filter;
  }), [games, filter]);

  const byCategory = useMemo(() => CATEGORY_ORDER
    .map((cat) => ({ cat, items: visible.filter((game) => game.category === cat) }))
    .filter((section) => section.items.length > 0), [visible]);

  function openSetup(game: Game) {
    setSetupGame(game);
    setPickedIds(new Set());
    setTargetOz('100');
  }

  function togglePicked(id: number) {
    setPickedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleStartConfirmed() {
    if (!setupGame) return;
    setBusy(true);
    // Only volume/oz games carry a target; the wall strip reads settings.targetOz for the bar.
    const settings = setupGame.metric === 'oz' && targetOz.trim()
      ? { targetOz: Number(targetOz.trim()) }
      : undefined;
    const result = await startGameSession({
      gameId: setupGame.id,
      participantDrinkerIds: [...pickedIds],
      settings,
    });
    setBusy(false);
    if (result.ok) {
      setSetupGame(null);
      load();
    }
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
                    <button type="button" className="game-card__start" data-testid="game-start" disabled={busy} onClick={() => openSetup(game)}>
                      Start
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {setupGame && (
        <div className="admin-confirm__backdrop" data-testid="game-setup" onClick={() => !busy && setSetupGame(null)}>
          <div className="admin-confirm game-setup" role="dialog" aria-modal="true" aria-label="Set up game" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display">{setupGame.name}</h3>
            <p className="admin-page-quiet">{setupGame.premise}</p>

            <span className="game-setup__label">Who’s playing?</span>
            <div className="game-setup__players" data-testid="game-setup-players">
              {pourers.length === 0 ? (
                <p className="admin-page-quiet">No pourers yet — players can also join later from the tablet.</p>
              ) : pourers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`game-setup__player${pickedIds.has(p.id) ? ' game-setup__player--on' : ''}`}
                  data-testid="game-setup-player"
                  aria-pressed={pickedIds.has(p.id)}
                  onClick={() => togglePicked(p.id)}
                >
                  {p.displayName}
                </button>
              ))}
            </div>

            {setupGame.metric === 'oz' && (
              <label className="admin-field game-setup__target">
                <span>Race to (oz)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="game-setup-target"
                  value={targetOz}
                  onChange={(e) => setTargetOz(e.target.value)}
                />
              </label>
            )}

            <p className="admin-page-quiet">Pours auto-count; the winner’s badge + a superlative post to the leaderboard automatically.</p>
            <div className="admin-confirm__actions">
              <button type="button" className="game-setup__start" data-testid="game-setup-start" disabled={busy} onClick={handleStartConfirmed}>
                {busy ? 'Starting…' : 'Start the game'}
              </button>
              <button type="button" data-testid="game-setup-cancel" disabled={busy} onClick={() => setSetupGame(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

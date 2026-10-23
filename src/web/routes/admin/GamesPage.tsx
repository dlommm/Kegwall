import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGames, getActiveGame, startGameSession, endGameSession,
  type Game,
} from '../../lib/adminApi';
import { getPourers, type PublicPourer } from '../../lib/api';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import { Button, Drawer, ErrorState, Skeleton } from './ui';

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
 * `/admin/games` (redesign 5a; on the V2 page template in M9): the game library, grouped by
 * category with filter chips. Editors can start a game (one at a time) — results decorate the ONE house
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
  const [actionError, setActionError] = useState<string | null>(null);

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
    setActionError(null);
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
      setActionError(null);
      load();
    } else {
      setActionError(result.message);
    }
  }

  async function handleEnd() {
    if (activeSessionId == null) return;
    setBusy(true);
    const result = await endGameSession(activeSessionId);
    setBusy(false);
    setActionError(result.ok ? null : result.message);
    load();
  }

  const title = status !== 'loaded'
    ? 'Games'
    : activeName ? `Now playing: ${activeName}.` : `${games.length} games to play.`;

  return (
    <PageTemplate
      testId="admin-games-page"
      title={title}
      sub="Pours count by themselves. The winner’s badge lands on the one house leaderboard."
      actions={activeName && canEdit && (
        <Button variant="secondary" data-testid="games-end" disabled={busy} onClick={handleEnd}>End the game</Button>
      )}
      drawer={setupGame && (
        <Drawer
          open
          onOpenChange={(open) => { if (!open && !busy) setSetupGame(null); }}
          title={setupGame.name}
          description={setupGame.premise}
          testId="game-setup"
        >
          <div className="adm-form">
            <div>
              <p className="studio-group__title">Who’s playing?</p>
              <div className="games-v2__players" data-testid="game-setup-players">
                {pourers.length === 0 ? (
                  <p className="adm-sub">No pourers yet. Players can join later from the tablet.</p>
                ) : pourers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="adm-chip"
                    data-testid="game-setup-player"
                    aria-pressed={pickedIds.has(p.id)}
                    onClick={() => togglePicked(p.id)}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            </div>
            {setupGame.metric === 'oz' && (
              <label className="admin-field studio-narrow">
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
            <p className="adm-sub">Pours count by themselves. The winner’s badge and a superlative post to the leaderboard.</p>
            {actionError && <p className="adm-danger-text" role="alert" data-testid="game-setup-error">{actionError}</p>}
            <div className="adm-form__actions">
              <Button variant="primary" data-testid="game-setup-start" disabled={busy} onClick={handleStartConfirmed}>
                {busy ? 'Starting…' : 'Start the game'}
              </Button>
              <Button variant="quiet" data-testid="game-setup-cancel" disabled={busy} onClick={() => setSetupGame(null)}>Cancel</Button>
            </div>
          </div>
        </Drawer>
      )}
    >
      {activeName && (
        <p className="games-v2__active" data-testid="games-active-banner">
          <span className="games-v2__live" aria-hidden="true" />
          {`Now playing: ${activeName}. The wall shows the standings in a strip along the bottom.`}
        </p>
      )}
      {actionError && !setupGame && <p className="adm-danger-text" role="alert">{actionError}</p>}

      <div className="adm-toolbar">
        <div className="adm-chips" role="group" aria-label="Filter games" data-testid="games-filters">
          <button type="button" className="adm-chip" data-testid="games-filter-all" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          {CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              type="button"
              className="adm-chip"
              data-testid={`games-filter-${cat}`}
              aria-pressed={filter === cat}
              onClick={() => setFilter(cat)}
            >
              <span className="games-v2__tick" style={{ background: CATEGORY_META[cat].color }} aria-hidden="true" />
              {CATEGORY_META[cat].label}
            </button>
          ))}
          {(['AUTO', 'TABLET'] as const).map((t) => (
            <button key={t} type="button" className="adm-chip" data-testid={`games-filter-${t.toLowerCase()}`} aria-pressed={filter === t} onClick={() => setFilter(t)}>
              {t === 'AUTO' ? 'Counts itself' : 'Uses the tablet'}
            </button>
          ))}
        </div>
        {status === 'loaded' && <span className="adm-sub" data-testid="games-count">{`${games.length} games`}</span>}
      </div>

      {status === 'loading' && <div data-testid="games-loading"><Skeleton height={160} /></div>}
      {status === 'error' && <div data-testid="games-error"><ErrorState title="Couldn’t load games." onRetry={load} /></div>}

      {byCategory.map(({ cat, items }) => (
        <section key={cat} className="games-v2__section" data-testid={`games-section-${cat}`}>
          <div className="games-v2__head">
            <span className="games-v2__tick" style={{ background: CATEGORY_META[cat].color }} aria-hidden="true" />
            <h2 className="adm-h2">{CATEGORY_META[cat].label}</h2>
            <span className="adm-sub">{CATEGORY_META[cat].subtitle}</span>
          </div>
          <ul className="games-v2__grid">
            {items.map((game) => (
              <li key={game.id} className="games-v2__card" data-testid="game-card">
                <h3 className="games-v2__name">{game.name}</h3>
                <p className="adm-sub">{game.premise}</p>
                <div className="games-v2__meta">
                  <span className="games-v2__tag" data-testid="game-tracking">{game.tracking}</span>
                  <span className="adm-sub adm-num-cell">
                    {`${game.minPlayers}${game.maxPlayers ? `–${game.maxPlayers}` : '+'} players`}
                    {game.duration ? ` · ${game.duration}` : ''}
                  </span>
                  {canEdit && !activeName && (
                    <Button className="games-v2__start" data-testid="game-start" disabled={busy} onClick={() => openSetup(game)}>
                      Start
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageTemplate>
  );
}

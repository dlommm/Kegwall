import type { CSSProperties } from 'react';
import { formatVolumeMl, type VolumeUnits } from '../lib/units';
import { beerColorFor } from '../wall/wallModel';
import { Tally } from './Tally';
import type { LeaderboardResponse } from '../lib/api';
import './LeaderboardBoard.css';

const ML_PER_GALLON = 3785.411784;

/** "12.3 gal" / "46.7 L" — the board's per-pourer volume figure. */
export function formatBoardVolume(ml: number, units: VolumeUnits): string {
  if (units === 'metric') return `${(ml / 1000).toFixed(1)} L`;
  return `${(ml / ML_PER_GALLON).toFixed(1)} gal`;
}

/** Medal treatment per podium rank (redesign 2f): gold / silver / bronze rings + labels. */
const WINDOW_TABS = [
  { key: 'week', label: 'WEEK' },
  { key: 'month', label: 'MONTH' },
  { key: 'all', label: 'ALL TIME' },
] as const;

export interface LeaderboardBoardProps {
  data: LeaderboardResponse;
  units: VolumeUnits;
  title: string;
  onWindowChange?: (window: LeaderboardResponse['window']) => void;
}

/**
 * The one and only leaderboard as a 1920×1080 TV view (redesign 2f). Top 3 get a medal
 * podium (2nd · 1st · 3rd, champion centered and tallest); ranks 4+ are compact rows with a
 * colored quality pill; the footer carries superlatives as trophy chips. Game results post
 * HERE (Phase 5) as temporary chips — there is deliberately no separate game leaderboard.
 * Pure/presentational — `/board` fetches; the wall rotation reuses it.
 */
/**
 * The one leaderboard, drawn as the bar's tally board (Kegwall 2.1 "g-board"): a row per pourer
 * with their pours as tally marks struck in fives and a strip of the beers they drank; the
 * leader's row is larger and tinted with their beer. Superlatives are sentences. Games only
 * decorate it (a winner line); there is never a second board.
 */
export function LeaderboardBoard({ data, units, title, onWindowChange }: LeaderboardBoardProps) {
  const { superlatives, entries } = data;
  const leader = entries[0];
  const leadColor = leader?.beers?.[0] ? beerColorFor(leader.beers[0].srm) : '#E0975A';
  const gap = entries[1] ? (leader!.pourCount - entries[1].pourCount) : 0;
  const lines: { key: string; text: string; testId?: string }[] = [];
  if (superlatives.mostPours) lines.push({ key: 'most', text: `${superlatives.mostPours.displayName} poured the most often: ${superlatives.mostPours.pourCount} pours.` });
  if (superlatives.biggestPour) lines.push({ key: 'big', text: `The biggest pour was ${superlatives.biggestPour.displayName}'s, ${formatVolumeMl(superlatives.biggestPour.volumeMl, units)}.` });
  if (superlatives.smoothest) lines.push({ key: 'smooth', text: `The steadiest hand: ${superlatives.smoothest.displayName}, a pour score of ${superlatives.smoothest.avgQuality}.` });
  if (superlatives.gameWinner) lines.push({ key: 'game', text: `${superlatives.gameWinner.gameName} went to ${superlatives.gameWinner.displayName}.`, testId: 'board-game-winner' });

  return (
    <div className="board-look" data-testid="leaderboard-board">
      <header className="board-look__header">
        <span className="board-look__title font-display">{title}</span>
        <span className="board-look__brand font-display">
          {leader ? (gap > 0 ? `${leader.displayName} leads by ${gap} pour${gap === 1 ? '' : 's'}` : `${leader.displayName} leads`) : 'The tally'}
        </span>
        <div className="board-look__windows" role="group" aria-label="Leaderboard window">
          {WINDOW_TABS.map((w) => onWindowChange ? (
            <button
              type="button" key={w.key}
              className="board-look__window-pill"
              data-active={data.window === w.key}
              aria-pressed={data.window === w.key}
              data-testid={`board-window-${w.key}`}
              onClick={() => onWindowChange(w.key)}
            >{w.label}</button>
          ) : (
            <span
              key={w.key}
              className="board-look__window-pill"
              data-active={data.window === w.key}
              data-testid={`board-window-${w.key}`}
            >
              {w.label}
            </span>
          ))}
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="board-look__empty" data-testid="leaderboard-empty">
          No claimed pours yet — pour one and claim it from the menu.
        </p>
      ) : (
        <ol className="board-tally">
          {entries.slice(0, 8).map((entry, i) => (
            <li
              key={entry.drinkerId}
              className={i === 0 ? 'board-tally__row board-tally__row--lead' : 'board-tally__row'}
              data-testid="leaderboard-row"
              data-rank={i + 1}
              style={i === 0 ? { '--lead': leadColor } as CSSProperties : undefined}
            >
              <span className="board-tally__rank font-display">{i + 1}</span>
              <span className="board-tally__who">
                <span className="board-tally__name font-display">{entry.displayName}</span>
                {entry.beers && entry.beers.length > 0 && (
                  <span className="board-tally__strip" aria-hidden="true">
                    {entry.beers.map((b) => <i key={b.beerId} style={{ flex: b.pours, background: beerColorFor(b.srm) }} />)}
                  </span>
                )}
              </span>
              <Tally count={entry.pourCount} className="board-tally__marks" height={i === 0 ? 40 : 30} />
              <span className="board-tally__total">
                <b className="font-tabular">{entry.pourCount}</b>
                <span className="font-tabular">{formatBoardVolume(entry.volumeMl, units)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <footer className="board-look__footer" data-testid="leaderboard-superlatives">
        {lines.map((l) => <span key={l.key} className="board-line" data-testid={l.testId}>{l.text}</span>)}
      </footer>
    </div>
  );
}

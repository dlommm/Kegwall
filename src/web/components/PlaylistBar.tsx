import type { RotationView } from '../lib/useViewRotation';

const VIEW_LABELS: Record<RotationView['kind'], string> = {
  wall: 'POUR WALL',
  leaderboard: 'LEADERBOARD',
};

export interface PlaylistBarProps {
  views: RotationView[];
  activeIndex: number;
}

/**
 * The rotation playlist bar (design 4a): a row of chips along the TV bottom
 * showing every playlist entry with its duration, the active one accented, so
 * a viewer always knows what the screen is doing and what's next.
 */
export function PlaylistBar({ views, activeIndex }: PlaylistBarProps) {
  if (views.length <= 1) return null;
  return (
    <div className="playlist-bar" data-testid="playlist-bar">
      {views.map((view, i) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- position is the identity
          key={i}
          className={i === activeIndex ? 'playlist-bar__chip playlist-bar__chip--active' : 'playlist-bar__chip'}
          data-testid="playlist-bar-chip"
        >
          {VIEW_LABELS[view.kind]}
          <span className="playlist-bar__seconds font-tabular">{`${view.seconds}s`}</span>
        </span>
      ))}
    </div>
  );
}

import { formatVolumeMl, type VolumeUnits } from '../lib/units';
import type { SessionSnapshotResponse } from '../lib/api';

interface TabletSessionProps {
  /** The active group tab snapshot -- TabletPage polls it every 5s while on screen. */
  session: SessionSnapshotResponse;
  units: VolumeUnits;
  onEndSession: () => void;
}

/**
 * Session mode (design 6c): the grid screen's group-tab panel -- the session name,
 * the "End session" affordance, and the live per-member bars (each scaled against the
 * session's current max pour volume). Pure presentation: the snapshot poll and the
 * start/end/join flows stay in TabletPage.
 */
export function TabletSession({ session, units, onEndSession }: TabletSessionProps) {
  return (
    <div className="tablet-session" data-testid="tablet-session">
      <div className="tablet-session__head">
        <span className="tablet-session__name font-display">{`${session.name.toUpperCase()} · GROUP TAB`}</span>
        <button type="button" data-testid="tablet-session-end" className="tablet-secondary" onClick={onEndSession}>
          End session
        </button>
      </div>
      {session.totals.length === 0 ? (
        <span className="tablet-screen__quiet">Tap your avatar to join the session.</span>
      ) : (
        session.totals.map((member) => {
          const max = Math.max(1, ...session.totals.map((t) => t.volumeMl));
          return (
            <div key={member.drinkerId} className="tablet-session__row" data-testid="tablet-session-row">
              <span className="tablet-session__member">{member.name}</span>
              <span className="tablet-session__bar">
                <span className="tablet-session__bar-fill" style={{ width: `${Math.round((member.volumeMl / max) * 100)}%` }} />
              </span>
              <span className="tablet-session__count font-tabular">
                {`${member.pourCount} pour${member.pourCount === 1 ? '' : 's'} · ${formatVolumeMl(member.volumeMl, units)}`}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

interface TabletSessionRecapProps {
  /** The just-ended session's final snapshot -- TabletPage shows it for 12s. */
  recap: SessionSnapshotResponse;
  units: VolumeUnits;
  onDismiss: () => void;
}

/**
 * Session mode (design 6c): the tap-to-dismiss recap overlay shown right after "End
 * session" -- the final per-member totals of the tab that just closed.
 */
export function TabletSessionRecap({ recap, units, onDismiss }: TabletSessionRecapProps) {
  return (
    <button
      type="button"
      className="tablet-recap"
      data-testid="tablet-recap"
      onClick={onDismiss}
    >
      <span className="tablet-done__title font-display">{`${recap.name.toUpperCase()} — RECAP`}</span>
      {recap.totals.map((member) => (
        <span key={member.drinkerId} className="tablet-recap__row font-tabular">
          {`${member.name}: ${member.pourCount} pour${member.pourCount === 1 ? '' : 's'} · ${formatVolumeMl(member.volumeMl, units)}`}
        </span>
      ))}
      <span className="tablet-screen__quiet">Tap to dismiss</span>
    </button>
  );
}

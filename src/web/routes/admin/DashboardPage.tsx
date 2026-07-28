import { useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import type { ActivityEvent } from '../../../server/db/activity.js';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { getActivity, getSources, getPoursSince } from '../../lib/adminApi';
import { formatActivityText } from '../../lib/activityText';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';
import { srmToColor } from '../../lib/srm';
import { formatRelativeTime } from '../../lib/useRelativeTime';

/** How often source health + the activity feed + today's pour totals re-poll — there's
 * no push channel for any of these (unlike taps, which ride the existing `/ws` snapshot
 * via `useTapStates` below), per the Task 3 plan. */
const POLL_INTERVAL_MS = 60_000;

const SOURCE_LABELS: Record<SourceStatus['name'], string> = {
  kegtron_cloud: 'Kegtron cloud',
  kegtron_udp: 'Kegtron UDP',
  gen1_mqtt: 'Gen 1 MQTT',
  gen1_ble: 'Gen 1 BLE',
  mqtt_publisher: 'MQTT publisher',
};

/** Local midnight, as an ISO string — the boundary `GET /api/pours?since=` filters
 * against for the "today's pours" card. Uses the browser's local calendar day (the
 * taproom's own clock), not UTC, so the count matches what staff mean by "today". */
function startOfTodayIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** A tap pill's fill color: the beer's real SRM tint normally, or a muted neutral once
 * the keg is kicked — a kicked keg reads as drained, not just empty, matching the wall's
 * own treatment of a kicked tap (see `TapCard`). */
function tapPillColor(isKicked: boolean, srm: number | null): string {
  if (isKicked) return 'color-mix(in srgb, var(--text) 30%, transparent)';
  return srmToColor(srm).liquid;
}

/**
 * `/admin` (index route): at-a-glance cards — taps overview, today's pours, an alerts
 * placeholder (Phase 5), source health, and a prose activity feed. Per the design
 * direction, the liquid/SRM language only ever reappears here as a small swatch (the
 * tap pill's fill color), not the wall's full `LiquidFill` treatment.
 */
export function DashboardPage() {
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [pourCount, setPourCount] = useState(0);
  const [pourVolumeMl, setPourVolumeMl] = useState(0);

  // Initial taps snapshot + display units come from the same public menu payload
  // MenuPage/WallPage use; live updates then ride useTapStates' own /ws subscription
  // below — one live-data story for every surface that shows taps.
  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled || !result.ok) return;
      setInitialTaps(result.data.taps);
      setUnits(result.data.units ?? 'us');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps } = useTapStates(initialTaps);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getSources().then((result) => {
        if (!cancelled && result.ok) setSources(result.data);
      });
      getActivity().then((result) => {
        if (!cancelled && result.ok) setActivity(result.data);
      });
      getPoursSince(startOfTodayIso()).then((result) => {
        if (!cancelled && result.ok) {
          setPourCount(result.data.length);
          setPourVolumeMl(result.data.reduce((sum, p) => sum + p.volumeMl, 0));
        }
      });
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section data-testid="admin-dashboard-page" className="dashboard">
      <h1 className="dashboard__title font-display">Dashboard</h1>

      <div className="dashboard__grid">
        <section className="dashboard-card" data-testid="dashboard-card-taps">
          <h2 className="dashboard-card__title">Taps</h2>
          {taps.length === 0 ? (
            <p className="dashboard-card__quiet">No taps set up yet.</p>
          ) : (
            <ul className="dashboard-tap-list" data-testid="dashboard-tap-list">
              {taps.map((tap) => {
                const isKicked = tap.keg?.status === 'kicked';
                const levelPct = tap.keg && !isKicked ? tap.keg.levelPct : 0;
                return (
                  <li
                    key={tap.tapId}
                    className="dashboard-tap-pill"
                    data-testid="dashboard-tap-pill"
                    data-kicked={isKicked}
                  >
                    <span className="dashboard-tap-pill__bar" aria-hidden="true">
                      <span
                        className="dashboard-tap-pill__fill"
                        style={{
                          width: `${Math.round(levelPct)}%`,
                          backgroundColor: tapPillColor(isKicked, tap.beer?.srm ?? null),
                        }}
                      />
                    </span>
                    <span className="dashboard-tap-pill__meta">
                      <span className="dashboard-tap-pill__label font-tabular">
                        {tap.tapName ?? `Tap ${tap.tapNumber}`}
                      </span>
                      <span className="dashboard-tap-pill__beer">
                        {tap.beer ? tap.beer.name : 'Empty'}
                      </span>
                      {tap.beer && (
                        <span className="dashboard-tap-pill__level font-tabular">
                          {isKicked ? 'Kicked' : `${Math.round(levelPct)}%`}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="dashboard-card" data-testid="dashboard-card-pours">
          <h2 className="dashboard-card__title">Today&rsquo;s pours</h2>
          <p className="dashboard-card__stat font-tabular" data-testid="dashboard-pour-count">
            {pourCount}
          </p>
          <p className="dashboard-card__quiet font-tabular" data-testid="dashboard-pour-volume">
            {formatVolumeMl(pourVolumeMl, units)}
          </p>
        </section>

        <section className="dashboard-card" data-testid="dashboard-card-alerts">
          <h2 className="dashboard-card__title">Open alerts</h2>
          <p className="dashboard-card__stat font-tabular" data-testid="dashboard-alert-count">
            0
          </p>
          <p className="dashboard-card__quiet" data-testid="dashboard-alert-note">
            Alerts arrive in a later update
          </p>
        </section>

        <section className="dashboard-card" data-testid="dashboard-card-sources">
          <h2 className="dashboard-card__title">Source health</h2>
          <ul className="dashboard-source-list" data-testid="dashboard-source-list">
            {sources.map((source) => {
              const state = !source.registered ? 'unconfigured' : source.healthy ? 'healthy' : 'unhealthy';
              return (
                <li key={source.name} className="dashboard-source-row" data-testid="dashboard-source-row">
                  <span
                    className={`dashboard-source-badge dashboard-source-badge--${state}`}
                    data-testid="dashboard-source-badge"
                  >
                    {state === 'healthy' ? 'Healthy' : state === 'unhealthy' ? 'Unhealthy' : 'Not set up'}
                  </span>
                  <span className="dashboard-source-row__name">{SOURCE_LABELS[source.name]}</span>
                  <span className="dashboard-source-row__detail" data-testid="dashboard-source-detail">
                    {source.detail || (source.registered ? '—' : 'Set this up in settings to enable it')}
                  </span>
                  <span className="dashboard-source-row__seen font-tabular">
                    {source.lastEventAt ? formatRelativeTime(source.lastEventAt) : 'No events yet'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="dashboard-card dashboard-card--activity" data-testid="dashboard-card-activity">
        <h2 className="dashboard-card__title">Activity</h2>
        {activity.length === 0 ? (
          <p className="dashboard-card__quiet" data-testid="dashboard-activity-empty">
            Nothing&rsquo;s happened yet.
          </p>
        ) : (
          <ul className="dashboard-activity-list" data-testid="dashboard-activity-list">
            {activity.map((event, index) => (
              <li
                // eslint-disable-next-line react/no-array-index-key -- events have no stable id
                key={`${event.ts}-${index}`}
                className="dashboard-activity-row"
                data-testid="dashboard-activity-row"
              >
                <span className="dashboard-activity-row__text">{formatActivityText(event, units)}</span>
                <span className="dashboard-activity-row__time font-tabular">
                  {formatRelativeTime(event.ts)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

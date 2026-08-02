import { useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import type { ActivityEvent } from '../../../server/db/activity.js';
import { Link } from 'react-router';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import {
  getActivity, getSources, getPoursSince, getSystemStats, listWalls, triggerReboot,
  type SystemStats,
} from '../../lib/adminApi';
import { formatActivityText } from '../../lib/activityText';
import { formatTempC, formatVolumeMl } from '../../lib/units';
import { levelStatus } from '../../lib/lookData';
import { srmToColor } from '../../lib/srm';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { useAdminContext } from './useAdminContext';

/** How often source health + the activity feed + today's pour totals re-poll — there's
 * no push channel for any of these (unlike taps, which ride the existing `/ws` snapshot
 * via `useTapStates` below). */
const POLL_INTERVAL_MS = 60_000;

/** Host stats poll their own (faster) clock — a separate effect so the activity/
 * sources/pours traffic isn't tripled just to keep CPU% fresh. */
const STATS_POLL_MS = 20_000;

const SOURCE_LABELS: Record<SourceStatus['name'], string> = {
  kegtron_cloud: 'Kegtron cloud',
  kegtron_udp: 'Kegtron UDP',
  gen1_mqtt: 'Gen 1 MQTT',
  gen1_ble: 'Gen 1 BLE',
  pro_ble: 'Pro BLE',
  mqtt_publisher: 'MQTT publisher',
  govee: 'Govee gateway',
  motion_mqtt: 'Motion MQTT',
  // Motion-source registry's GPIO/BLE transports (Task 1's events.ts union extension) —
  // not registered as ingest sources yet (a later task's job), but this map must stay
  // exhaustive over SourceStatus['name'].
  motion_gpio: 'Motion GPIO',
  motion_ble: 'Motion BLE',
};

/** Local midnight, as an ISO string — the boundary `GET /api/pours?since=` filters
 * against for the "today's pours" card. Uses the browser's local calendar day (the
 * taproom's own clock), not UTC, so the count matches what staff mean by "today". */
function startOfTodayIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

const STATUS_TOKEN: Record<ReturnType<typeof levelStatus>, string> = {
  ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)',
};

const ML_PER_PINT = 473.176;

/**
 * `/admin` (index route), rebuilt to design 5a: four stat cards (Today's pours,
 * On tap, Keg room, Sources) over a two-column body — live tap levels with real
 * SRM swatches + the sensor mini-cards on the left, source health and the
 * activity feed on the right.
 */
export function DashboardPage() {
  const { units } = useAdminContext();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [pourCount, setPourCount] = useState(0);
  const [pourVolumeMl, setPourVolumeMl] = useState(0);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [wallCount, setWallCount] = useState<number | null>(null);
  const [rebootConfirming, setRebootConfirming] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  // Initial taps snapshot comes from the same public menu payload MenuPage/WallPage use
  // (live updates then ride useTapStates' own /ws subscription below).
  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled || !result.ok) return;
      setInitialTaps(result.data.taps);
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

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getSystemStats().then((result) => {
        if (!cancelled && result.ok) setStats(result.data);
      });
    };
    poll();
    const id = setInterval(poll, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // One-shot: drives the "finish setting up" hint while no wall exists yet.
  useEffect(() => {
    let cancelled = false;
    listWalls().then((result) => {
      if (!cancelled && result.ok) setWallCount(result.data.length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReboot() {
    setRebooting(true);
    await triggerReboot();
    // No poll-for-recovery machinery: the server is about to drop the connection; the
    // admin watches the wall come back. Button stays disabled for this page's life.
  }

  const onTap = taps.filter((t) => t.beer && t.keg);
  const kicked = onTap.filter((t) => t.keg!.status === 'kicked').length;
  const almostGone = onTap.filter((t) => t.keg!.status !== 'kicked' && t.keg!.levelPct <= 15).length;
  const temps = taps.map((t) => t.temp).filter((t): t is number => t != null);
  const maxTempC = temps.length > 0 ? Math.max(...temps) : null;
  const registered = sources.filter((s) => s.registered);
  const healthy = registered.filter((s) => s.healthy);

  const undervolted = stats?.throttle
    && (stats.throttle.undervoltedNow || stats.throttle.undervoltedSinceBoot);

  return (
    <section data-testid="admin-dashboard-page" className="dashboard">
      {wallCount === 0 && (
        <div className="dashboard-banner dashboard-banner--info" data-testid="dashboard-setup-hint">
          <span>No tap wall yet — finish the guided setup to create one.</span>
          <Link to="/admin/welcome" className="dashboard-banner__action">Finish setting up →</Link>
        </div>
      )}

      {undervolted && (
        <div className="dashboard-banner dashboard-banner--danger" role="alert" data-testid="dashboard-undervolt-banner">
          <strong>Power problem:</strong>
          {' '}
          {stats!.throttle!.undervoltedNow
            ? 'this Pi isn’t getting enough power right now.'
            : 'this Pi hasn’t had enough power at some point since it booted.'}
          {' '}
          Use the official power supply — undervoltage corrupts SD cards and causes random crashes.
        </div>
      )}

      {stats?.rebootRequired && (
        <div className="dashboard-banner dashboard-banner--warn" data-testid="dashboard-reboot-banner">
          <span>An OS update is waiting for a reboot.</span>
          {stats.osManaged && !rebootConfirming && (
            <button
              type="button"
              className="dashboard-banner__action"
              onClick={() => setRebootConfirming(true)}
              data-testid="dashboard-reboot-button"
            >
              Reboot now
            </button>
          )}
          {stats.osManaged && rebootConfirming && (
            <button
              type="button"
              className="dashboard-banner__action dashboard-banner__action--confirm"
              onClick={handleReboot}
              disabled={rebooting}
              data-testid="dashboard-reboot-confirm"
            >
              {rebooting
                ? 'Rebooting…'
                : 'Confirm — the wall goes dark for ~1–2 minutes; pours during the reboot are lost unless they sync back from Kegtron cloud'}
            </button>
          )}
        </div>
      )}

      <div className="dashboard__stats">
        <div className="dashboard-stat" data-testid="dashboard-card-pours">
          <span className="dashboard-stat__label">TODAY&rsquo;S POURS</span>
          <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-pour-count">
            {pourCount}
            <span className="dashboard-stat__sub font-tabular" data-testid="dashboard-pour-volume">
              {` · ${formatVolumeMl(pourVolumeMl, units)}`}
            </span>
          </span>
        </div>
        <div className="dashboard-stat" data-testid="dashboard-card-on-tap">
          <span className="dashboard-stat__label">ON TAP</span>
          <span className="dashboard-stat__value font-display font-tabular">
            {onTap.length - kicked}
            <span className="dashboard-stat__sub"> taps</span>
          </span>
          <span className="dashboard-stat__note dashboard-stat__note--warn" data-testid="dashboard-on-tap-note">
            {`${almostGone} almost gone · ${kicked} kicked`}
          </span>
        </div>
        <div className="dashboard-stat" data-testid="dashboard-card-keg-room">
          <span className="dashboard-stat__label">KEG ROOM</span>
          <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-keg-room-temp">
            {maxTempC != null ? formatTempC(maxTempC, units) : '—'}
          </span>
          <span className="dashboard-stat__note">Kegtron monitors</span>
        </div>
        <div className="dashboard-stat" data-testid="dashboard-card-sources">
          <span className="dashboard-stat__label">SOURCES</span>
          <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-sources-count">
            {`${healthy.length}/${registered.length}`}
            <span className="dashboard-stat__sub"> healthy</span>
          </span>
        </div>
        {stats && (
          <div className="dashboard-stat" data-testid="dashboard-card-server">
            <span className="dashboard-stat__label">SERVER</span>
            <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-server-primary">
              {stats.cpuTempC != null ? formatTempC(stats.cpuTempC, units) : `${stats.cpu.loadPct}%`}
              {stats.cpuTempC == null && <span className="dashboard-stat__sub"> CPU</span>}
            </span>
            <span className="dashboard-stat__note" data-testid="dashboard-server-note">
              {`CPU ${stats.cpu.loadPct}% · RAM ${stats.memory.usedPct}%`}
              {stats.disk ? ` · disk ${stats.disk.usedPct}%` : ''}
              {stats.watts != null ? ` · ${stats.watts} W` : ''}
            </span>
          </div>
        )}
      </div>

      <div className="dashboard__body">
        <section className="dashboard-card dashboard-card--taps" data-testid="dashboard-card-taps">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">TAPS</h2>
            <span className="dashboard-card__hint">live · updates over WebSocket</span>
          </div>
          {taps.length === 0 ? (
            <p className="dashboard-card__quiet">No taps set up yet.</p>
          ) : (
            <ul className="dashboard-tap-list" data-testid="dashboard-tap-list">
              {taps.map((tap) => {
                const isKicked = tap.keg?.status === 'kicked';
                const levelPct = tap.keg && !isKicked ? Math.round(tap.keg.levelPct) : 0;
                const pints = tap.keg && !isKicked ? Math.round(tap.keg.remainingMl / ML_PER_PINT) : 0;
                return (
                  <li
                    key={tap.tapId}
                    className="dashboard-tap-row"
                    data-testid="dashboard-tap-pill"
                    data-kicked={isKicked}
                  >
                    <span
                      className="dashboard-tap-row__swatch"
                      aria-hidden="true"
                      style={{ backgroundColor: tap.beer ? srmToColor(tap.beer.srm).liquid : 'transparent' }}
                    />
                    <span className="dashboard-tap-row__name">
                      {tap.beer ? tap.beer.name : `${tap.tapName ?? `Tap ${tap.tapNumber}`} — Empty`}
                    </span>
                    <span className="dashboard-tap-row__style">{tap.beer?.style ?? ''}</span>
                    <span className="dashboard-tap-row__bar" aria-hidden="true">
                      <span
                        className="dashboard-tap-row__fill"
                        style={{
                          width: `${levelPct}%`,
                          backgroundColor: isKicked
                            ? 'color-mix(in srgb, var(--text) 30%, transparent)'
                            : STATUS_TOKEN[levelStatus(levelPct)],
                        }}
                      />
                    </span>
                    <span className="dashboard-tap-row__pct font-tabular" data-testid="dashboard-tap-pct">
                      {isKicked ? 'Kicked' : `${levelPct}%`}
                    </span>
                    <span className="dashboard-tap-row__pints font-tabular">
                      {tap.keg && !isKicked ? `${pints} pints` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {maxTempC != null && (
            <div className="dashboard-sensors" data-testid="dashboard-sensors">
              <span className="dashboard-sensor-card">
                <span className="dashboard-sensor-card__name">KEGTRON</span>
                <span className="dashboard-sensor-card__value font-tabular">{formatTempC(maxTempC, units)}</span>
              </span>
            </div>
          )}
        </section>

        <div className="dashboard__side">
          <section className="dashboard-card" data-testid="dashboard-card-source-health">
            <h2 className="dashboard-card__title font-display">SOURCE HEALTH</h2>
            <ul className="dashboard-source-list" data-testid="dashboard-source-list">
              {sources.map((source) => {
                const state = !source.registered ? 'unconfigured' : source.healthy ? 'healthy' : 'unhealthy';
                return (
                  <li key={source.name} className="dashboard-source-row" data-testid="dashboard-source-row">
                    <span className="dashboard-source-row__name">{SOURCE_LABELS[source.name]}</span>
                    <span
                      className={`dashboard-source-badge dashboard-source-badge--${state}`}
                      data-testid="dashboard-source-badge"
                    >
                      {state === 'healthy' ? '● OK' : state === 'unhealthy' ? '● Down' : '○ Not set up'}
                      {source.lastEventAt ? ` · ${formatRelativeTime(source.lastEventAt)}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="dashboard-card dashboard-card--activity" data-testid="dashboard-card-activity">
            <h2 className="dashboard-card__title font-display">ACTIVITY</h2>
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
        </div>
      </div>
    </section>
  );
}

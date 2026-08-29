import { useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import type { ActivityEvent } from '../../../server/db/activity.js';
import { Link } from 'react-router';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { usePolledFetch } from '../../lib/usePolledFetch';
import {
  getActivity, getSources, getPoursSince, getSystemStats, listWalls, triggerReboot,
  getCleaningStatuses, getPoursByDay, getActiveKegStats, getSensors,
  type SystemStats, type PoursByDay, type KegBurnStat, type SensorSummary,
} from '../../lib/adminApi';
import type { CleaningStatus } from '../../../server/db/cleanings.js';
import { buildTriage } from '../../lib/dashboardTriage';
import { buildPoursTrend } from '../../lib/poursTrend';
import { buildSensorCards } from '../../lib/sensorCards';
import { kicksInDays, kicksInLabel, kicksSoon } from '../../lib/kegForecast';
import { formatActivityText } from '../../lib/activityText';
import { formatTempC, formatTempDelta, formatVolumeMl } from '../../lib/units';
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
  const [cleanings, setCleanings] = useState<CleaningStatus[]>([]);
  const [poursByDay, setPoursByDay] = useState<PoursByDay[]>([]);
  const [kegStats, setKegStats] = useState<KegBurnStat[]>([]);
  const [sensors, setSensors] = useState<SensorSummary[]>([]);
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

  usePolledFetch((isCancelled) => {
    getSources().then((result) => {
      if (!isCancelled() && result.ok) setSources(result.data);
    });
    getActivity().then((result) => {
      if (!isCancelled() && result.ok) setActivity(result.data);
    });
    getPoursSince(startOfTodayIso()).then((result) => {
      if (!isCancelled() && result.ok) {
        setPourCount(result.data.length);
        setPourVolumeMl(result.data.reduce((sum, p) => sum + p.volumeMl, 0));
      }
    });
    getCleaningStatuses().then((result) => {
      if (!isCancelled() && result.ok) setCleanings(result.data);
    });
    // 30-day window (not 7): the pours mini-chart shows the last 7 bars, but the
    // week-over-week delta needs to reach back to the SAME WEEKDAY last week.
    getPoursByDay(30).then((result) => {
      if (!isCancelled() && result.ok) setPoursByDay(result.data);
    });
    getActiveKegStats().then((result) => {
      if (!isCancelled() && result.ok) setKegStats(result.data);
    });
    getSensors().then((result) => {
      if (!isCancelled() && result.ok) setSensors(result.data);
    });
  }, { intervalMs: POLL_INTERVAL_MS });

  usePolledFetch((isCancelled) => {
    getSystemStats().then((result) => {
      if (!isCancelled() && result.ok) setStats(result.data);
    });
  }, { intervalMs: STATS_POLL_MS });

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

  // Stat-card trends (redesign 3b) — all from real series, no fabricated history.
  const poursTrend = buildPoursTrend(poursByDay);
  const poursTrendMax = Math.max(1, ...poursTrend.bars.map((b) => b.count));
  // Soonest projected kick across on-tap kegs (server-computed from trailing-7-day burn).
  const nextKickDays = kegStats
    .map((k) => kicksInDays(k.projectedKickDate))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)[0] ?? null;
  const downSources = registered.filter((s) => !s.healthy).map((s) => SOURCE_LABELS[s.name]);
  const sensorCards = buildSensorCards(sensors);
  // Projected kick date per tap (by tap number), for the inline TAPS-row forecast + Swap chip.
  const kickByTap = new Map(kegStats.map((k) => [k.tapNumber, k.projectedKickDate]));

  // DESIGN NOTE: undervoltage keeps its own dedicated red banner below (a distinct hardware
  // alarm with SD-card-corruption context), so the NEEDS ATTENTION card is passed
  // undervolted:false — it triages the operational, one-click-fixable signals (swap a keg,
  // log a cleaning, open the doctor) rather than duplicating the power banner.
  const triage = buildTriage({
    taps,
    unhealthySourceLabels: registered
      .filter((s) => !s.healthy)
      .map((s) => SOURCE_LABELS[s.name]),
    cleaningDueTapIds: cleanings.filter((c) => c.due).map((c) => c.tapId),
    undervolted: false,
  });

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

      {triage.length > 0 && (
        <section className="dashboard-triage" data-testid="dashboard-triage" aria-label="Needs attention">
          <div className="dashboard-triage__head">
            <h2 className="dashboard-triage__title font-display">NEEDS ATTENTION</h2>
            <span className="dashboard-triage__count font-tabular" data-testid="dashboard-triage-count">
              {triage.length}
            </span>
          </div>
          <ul className="dashboard-triage__list">
            {triage.map((item) => (
              <li
                key={item.id}
                className="dashboard-triage__row"
                data-testid="dashboard-triage-row"
                data-severity={item.severity}
              >
                <span
                  className={`dashboard-triage__dot dashboard-triage__dot--${item.severity}`}
                  aria-hidden="true"
                />
                <span className="dashboard-triage__msg">{item.message}</span>
                {item.action && (
                  <Link
                    to={item.action.to}
                    className="dashboard-triage__action"
                    data-testid="dashboard-triage-action"
                  >
                    {item.action.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
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
          {poursTrend.bars.length > 0 && (
            <span className="dashboard-spark" data-testid="dashboard-pours-spark" aria-hidden="true">
              {poursTrend.bars.map((b) => (
                <span
                  key={b.date}
                  className={`dashboard-spark__bar${b.isToday ? ' dashboard-spark__bar--today' : ''}`}
                  style={{ height: `${Math.max(6, Math.round((b.count / poursTrendMax) * 100))}%` }}
                />
              ))}
            </span>
          )}
          {poursTrend.deltaPct != null && (
            <span
              className={`dashboard-stat__delta dashboard-stat__delta--${poursTrend.deltaPct >= 0 ? 'up' : 'down'}`}
              data-testid="dashboard-pours-delta"
            >
              {`${poursTrend.deltaPct >= 0 ? '↑' : '↓'} ${Math.abs(poursTrend.deltaPct)}% ${poursTrend.comparisonLabel}`}
            </span>
          )}
        </div>
        <div className="dashboard-stat" data-testid="dashboard-card-on-tap">
          <span className="dashboard-stat__label">ON TAP</span>
          <span className="dashboard-stat__value font-display font-tabular">
            {onTap.length - kicked}
            <span className="dashboard-stat__sub"> taps</span>
          </span>
          {onTap.some((t) => t.keg!.status !== 'kicked') && (
            <span className="dashboard-stat__pills" data-testid="dashboard-on-tap-pills" aria-hidden="true">
              {onTap.filter((t) => t.keg!.status !== 'kicked').map((t) => (
                <span
                  key={t.tapId}
                  className="dashboard-stat__pill"
                  style={{ background: STATUS_TOKEN[levelStatus(Math.round(t.keg!.levelPct))] }}
                />
              ))}
            </span>
          )}
          <span className="dashboard-stat__note dashboard-stat__note--warn" data-testid="dashboard-on-tap-note">
            {`${almostGone} almost gone · ${kicked} kicked`}
            {nextKickDays != null && ` · next kick ~${nextKickDays} ${nextKickDays === 1 ? 'day' : 'days'}`}
          </span>
        </div>
        {sensorCards.length > 0 ? (
          // DESIGN NOTE: README asks each sensor card to carry a 7-day sparkline; that
          // visualization waits on the Phase 4 Temps analytics tab (where per-sensor history
          // + retention live). The reading, humidity, and the min–max note here are all real
          // (from the telemetry table); the warming delta compares against the Kegtron probe.
          sensorCards.map((s) => (
            <div
              key={s.id}
              className={`dashboard-stat dashboard-sensor-stat${s.warming ? ' dashboard-sensor-stat--warm' : ''}`}
              data-testid="dashboard-sensor-card"
              data-warming={s.warming}
            >
              <span className="dashboard-stat__label">
                {s.name}
                <span
                  className={`dashboard-sensor-stat__tag dashboard-sensor-stat__tag--${s.kind}`}
                  data-testid="dashboard-sensor-tag"
                >
                  {s.kind === 'kegtron' ? ' · KEGTRON' : ' · GOVEE'}
                </span>
              </span>
              <span
                className={`dashboard-stat__value font-display font-tabular${s.warming ? ' dashboard-sensor-stat__value--warm' : ''}`}
                data-testid="dashboard-sensor-temp"
              >
                {s.tempC != null ? formatTempC(s.tempC, units) : '—'}
              </span>
              {/* Humidity is its OWN reading, not a suffix on the temperature (design: keep the two
                  distinct). Only shown when the sensor reports it (Kegtron probes don't). */}
              {s.humidity != null && (
                <span className="dashboard-sensor-stat__humidity font-tabular" data-testid="dashboard-sensor-humidity">
                  {`${Math.round(s.humidity)}% RH`}
                </span>
              )}
              <span
                className={`dashboard-stat__note${s.warming ? ' dashboard-stat__note--warn' : ''}`}
                data-testid="dashboard-sensor-note"
              >
                {s.warming && s.deltaVsRefC != null
                  ? `warming · Δ ${formatTempDelta(s.deltaVsRefC, units)} vs Kegtron`
                  : s.min7dC != null && s.max7dC != null
                    ? `${formatTempC(s.min7dC, units)}–${formatTempC(s.max7dC, units)} · 7 d`
                    : 'no history yet'}
              </span>
            </div>
          ))
        ) : (
          <div className="dashboard-stat" data-testid="dashboard-card-keg-room">
            <span className="dashboard-stat__label">KEG ROOM</span>
            <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-keg-room-temp">
              {maxTempC != null ? formatTempC(maxTempC, units) : '—'}
            </span>
            <span className="dashboard-stat__note">Kegtron monitors</span>
          </div>
        )}
        <div className="dashboard-stat" data-testid="dashboard-card-sources">
          <span className="dashboard-stat__label">SOURCES</span>
          <span className="dashboard-stat__value font-display font-tabular" data-testid="dashboard-sources-count">
            {`${healthy.length}/${registered.length}`}
            <span className="dashboard-stat__sub"> healthy</span>
          </span>
          {downSources.length > 0 && (
            <span className="dashboard-stat__note dashboard-stat__note--warn" data-testid="dashboard-sources-failing">
              {`${downSources.join(', ')} down`}
            </span>
          )}
        </div>
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
                const kickDate = isKicked ? null : kickByTap.get(tap.tapNumber) ?? null;
                const forecast = kickDate ? kicksInLabel(kickDate) : null;
                const kickSoon = kickDate ? kicksSoon(kickDate) : false;
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
                    {forecast && (
                      <span
                        className={`dashboard-tap-row__forecast${kickSoon ? ' dashboard-tap-row__forecast--danger' : ''}`}
                        data-testid="dashboard-tap-forecast"
                      >
                        {forecast}
                      </span>
                    )}
                    {kickSoon && (
                      <Link
                        to="/admin/taps"
                        className="dashboard-tap-row__swap"
                        data-testid="dashboard-tap-swap"
                      >
                        Swap
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="dashboard__side">
          {stats && (
            <section className="dashboard-card dashboard-server-health" data-testid="dashboard-card-server-health">
              <div className="dashboard-card__head">
                <h2 className="dashboard-card__title font-display">SERVER HEALTH</h2>
                {stats.cpuTempC != null && (
                  <span className="dashboard-card__hint font-tabular" data-testid="dashboard-server-health-temp">
                    {formatTempC(stats.cpuTempC, units)}
                  </span>
                )}
              </div>
              {/* DESIGN NOTE: README asks for 7-day CPU/RAM sparkline bars, but there is no
                  server-stats history store yet (built in Phase 4's Server analytics tab, with
                  the retention rules). Rather than fabricate a trend, each row shows the real
                  current reading as a single meter. RAM uses --ok in lieu of the mock's teal
                  (closest existing theme token). */}
              <div className="dashboard-meter-row" data-testid="dashboard-server-cpu">
                <span className="dashboard-meter-row__label">CPU</span>
                <span className="dashboard-meter-row__track" aria-hidden="true">
                  <span
                    className="dashboard-meter-row__fill"
                    style={{ width: `${stats.cpu.loadPct}%`, background: 'var(--accent)' }}
                  />
                </span>
                <span className="dashboard-meter-row__val font-tabular">{`${stats.cpu.loadPct}%`}</span>
              </div>
              <div className="dashboard-meter-row" data-testid="dashboard-server-ram">
                <span className="dashboard-meter-row__label">RAM</span>
                <span className="dashboard-meter-row__track" aria-hidden="true">
                  <span
                    className="dashboard-meter-row__fill"
                    style={{ width: `${stats.memory.usedPct}%`, background: 'var(--ok)' }}
                  />
                </span>
                <span className="dashboard-meter-row__val font-tabular">{`${stats.memory.usedPct}%`}</span>
              </div>
              {stats.disk && (
                <div className="dashboard-meter-row" data-testid="dashboard-server-disk">
                  <span className="dashboard-meter-row__label">DISK</span>
                  <span className="dashboard-meter-row__track" aria-hidden="true">
                    <span
                      className="dashboard-meter-row__fill"
                      style={{
                        width: `${stats.disk.usedPct}%`,
                        background: stats.disk.usedPct > 60 ? 'var(--warn)' : 'var(--text-dim)',
                      }}
                    />
                  </span>
                  <span className="dashboard-meter-row__val font-tabular">{`${stats.disk.usedPct}%`}</span>
                </div>
              )}
              <p className="dashboard-card__quiet" data-testid="dashboard-server-note">
                {`CPU ${stats.cpu.loadPct}% · RAM ${stats.memory.usedPct}%`}
                {stats.disk ? ` · disk ${stats.disk.usedPct}%` : ''}
                {stats.watts != null ? ` · ${stats.watts} W` : ''}
                {` · up ${Math.floor(stats.uptimeSec / 3600)}h`}
              </p>
            </section>
          )}

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

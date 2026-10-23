import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { TapState } from '../../../server/core/state.js';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import type { ActivityEvent } from '../../../server/db/activity.js';
import type { Pour } from '../../../server/db/kegs.js';
import type { CleaningStatus } from '../../../server/db/cleanings.js';
import { serviceDayStart } from '../../../server/core/serviceDay.js';
import { getDrinkers, getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { usePolledFetch } from '../../lib/usePolledFetch';
import {
  getActivity, getSources, getPoursSince, getSystemStats, listWalls, triggerReboot,
  getCleaningStatuses, getSensors, getSettings, listDisplays,
  type SystemStats, type SensorSummary, type Wall, type Display,
} from '../../lib/adminApi';
import {
  buildAttention, capitalize, countWord, tonightHeadline, type AttentionItem,
} from '../../lib/tonightAttention';
import { tonightHours } from '../../lib/tonightHours';
import { buildSensorCards } from '../../lib/sensorCards';
import { formatActivityText } from '../../lib/activityText';
import { formatTempC, formatVolumeMl } from '../../lib/units';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { kicksInLabel } from '../../lib/kegForecast';
import { pickInk } from '../../lib/contrast';
import { wallTapModel, type WallTapModel } from '../../wall/wallModel';
import { TapMarker } from '../../wall/TapMarker';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import { Button, ButtonLink, StatusDot } from './ui';
import './tonight.css';

/** Sources, pours, cleanings, displays and activity re-poll on this clock (no push channel
 * for them; taps ride the `/ws` snapshot through `useTapStates`). */
const POLL_INTERVAL_MS = 60_000;
/** Host stats (power, reboot, CPU) poll faster, on their own clock. */
const STATS_POLL_MS = 20_000;
/** A paired display that checked in within this window counts as on. */
const DISPLAY_ONLINE_MS = 3 * 60_000;
const DEFAULT_SERVING_ML = 473;
/** The side column lists at most this many screens, then links to the rest. */
const SCREENS_SHOWN = 4;

const SOURCE_LABELS: Record<SourceStatus['name'], string> = {
  kegtron_cloud: 'Kegtron cloud',
  kegtron_udp: 'Kegtron UDP',
  gen1_mqtt: 'Gen 1 MQTT',
  gen1_ble: 'Gen 1 BLE',
  pro_ble: 'Pro BLE',
  mqtt_publisher: 'MQTT publisher',
  govee: 'Govee gateway',
  motion_mqtt: 'Motion MQTT',
  motion_gpio: 'Motion GPIO',
  motion_ble: 'Motion BLE',
};

const LEVEL_COLOR: Record<AttentionItem['level'], string> = {
  problem: 'var(--danger)', caution: 'var(--warn)', info: 'var(--info)',
};

/** "13.9 oz" → ["13.9", "oz"], for the big number and its small unit. */
function splitVolume(label: string): [string, string] {
  const i = label.lastIndexOf(' ');
  return i === -1 ? [label, ''] : [label.slice(0, i), label.slice(i + 1)];
}

/**
 * `/admin` (index route): Tonight (Kegwall V2, blueprint §E.4, prototypes/admin-tonight.html).
 * A sentence about the night, then what needs doing (grouped and ranked: one row per kind,
 * fixes issue 11) beside the last pour; below, every tap as a glass with what's left and
 * tonight's pours by hour; at the side, screens, hardware, the next kegs to kick and the
 * latest activity.
 */
export function TonightPage() {
  const { me, units } = useAdminContext();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [servingSizeMl, setServingSizeMl] = useState(DEFAULT_SERVING_ML);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [pours, setPours] = useState<Pour[]>([]);
  const [cleanings, setCleanings] = useState<CleaningStatus[]>([]);
  const [sensors, setSensors] = useState<SensorSummary[]>([]);
  const [walls, setWalls] = useState<Wall[] | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [hasPourers, setHasPourers] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [rebootConfirming, setRebootConfirming] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [rebootError, setRebootError] = useState<string | null>(null);

  // One-shot reads: the taps snapshot (live updates then ride /ws), the serving size (an
  // admin-only read; editors and viewers count US pints), and whether pourers exist.
  useEffect(() => {
    let cancelled = false;
    getMenu().then((r) => { if (!cancelled && r.ok) setInitialTaps(r.data.taps); });
    getSettings().then((r) => { if (!cancelled && r.ok) setServingSizeMl(r.data.servingSizeMl); });
    getDrinkers().then((r) => { if (!cancelled && r.ok) setHasPourers(r.data.length > 0); });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps } = useTapStates(initialTaps);

  usePolledFetch((isCancelled) => {
    getSources().then((r) => { if (!isCancelled() && r.ok) setSources(r.data); });
    getActivity().then((r) => { if (!isCancelled() && r.ok) setActivity(r.data); });
    getPoursSince(serviceDayStart(new Date()).toISOString()).then((r) => {
      if (!isCancelled() && r.ok) setPours(r.data);
    });
    getCleaningStatuses().then((r) => { if (!isCancelled() && r.ok) setCleanings(r.data); });
    getSensors().then((r) => { if (!isCancelled() && r.ok) setSensors(r.data); });
    listWalls().then((r) => { if (!isCancelled() && r.ok) setWalls(r.data); });
    listDisplays().then((r) => { if (!isCancelled() && r.ok) setDisplays(r.data); });
  }, { intervalMs: POLL_INTERVAL_MS });

  usePolledFetch((isCancelled) => {
    getSystemStats().then((r) => { if (!isCancelled() && r.ok) setStats(r.data); });
  }, { intervalMs: STATS_POLL_MS });

  const models = useMemo(
    () => taps.map((t) => wallTapModel(t, { units, servingSizeMl })),
    [taps, units, servingSizeMl],
  );
  const registered = sources.filter((s) => s.registered);
  const attention = buildAttention({
    taps,
    units,
    servingSizeMl,
    downSources: registered.filter((s) => !s.healthy).map((s) => SOURCE_LABELS[s.name]),
    undervolted: stats?.throttle
      ? { now: stats.throttle.undervoltedNow, sinceBoot: stats.throttle.undervoltedSinceBoot }
      : null,
    reboot: stats ? { required: stats.rebootRequired, osManaged: stats.osManaged } : null,
    canReboot: me.role === 'admin',
    cleaningDueTapIds: cleanings.filter((c) => c.due).map((c) => c.tapId),
    tonightPours: pours,
    hasPourers,
    hasWall: walls === null ? null : walls.length > 0,
  });

  const onTap = models.filter((m) => m.hasBeer && m.tap.keg && !m.isKicked);
  // The header counts with the server's own "tonight" (its clock and 04:00 rollover, the same
  // figures the wall shows); the pour list below is only for the chart and the last pour.
  const tonightCount = taps.reduce((sum, t) => sum + (t.tonight?.pours ?? 0), 0);
  const tonightMl = taps.reduce((sum, t) => sum + (t.tonight?.volumeMl ?? 0), 0);
  const others = attention.length > 1
    ? `${capitalize(countWord(attention.length - 1))} more thing${attention.length === 2 ? '' : 's'} below.`
    : 'Everything else is running.';
  const sensorCards = buildSensorCards(sensors);
  const kegtronProbes = sensorCards.filter((c) => c.kind === 'kegtron' && c.tempC != null);
  const warmestProbe = kegtronProbes.reduce<(typeof kegtronProbes)[number] | null>(
    (hi, c) => (hi && hi.tempC! >= c.tempC! ? hi : c), null,
  );
  const sub = tonightCount === 0
    ? `No pours yet tonight. ${attention.length === 0 ? 'Everything is running.' : others}`
    : `${tonightCount} pour${tonightCount === 1 ? '' : 's'} so far tonight, ${formatVolumeMl(tonightMl, units)}. ${attention.length === 0 ? 'Everything is running.' : others}`;

  const tapNumberById = new Map(taps.map((t) => [t.tapId, t.tapNumber]));
  const ignoredCleaningTaps = cleanings
    .filter((c) => c.ignored && tapNumberById.has(c.tapId))
    .map((c) => ({ tapId: c.tapId, tapNumber: tapNumberById.get(c.tapId)! }));

  async function handleReboot() {
    setRebooting(true);
    setRebootError(null);
    const result = await triggerReboot();
    // On success, no recovery polling: the server is about to drop the connection.
    if (!result.ok) {
      setRebooting(false);
      setRebootConfirming(false);
      setRebootError('The reboot didn’t start. Try again, or reboot the Pi from its own menu.');
    }
  }

  return (
    <PageTemplate
      testId="admin-tonight-page"
      title={<span data-testid="tonight-headline">{tonightHeadline(onTap.length, attention)}</span>}
      sub={<span data-testid="tonight-sub">{sub}</span>}
    >
      <div className="tonight__hero">
        <div>
          {attention.length === 0 ? (
            <p className="tonight__clear" data-testid="tonight-clear">Nothing needs you tonight.</p>
          ) : (
            <ul className="tonight__todo" aria-label="Needs attention" data-testid="tonight-attention">
              {attention.map((item) => (
                <li
                  key={item.kind}
                  className="tonight__item"
                  data-testid="tonight-attention-row"
                  data-kind={item.kind}
                  data-level={item.level}
                  // Problems are announced the moment they appear, as the old banners were.
                  role={item.level === 'problem' ? 'alert' : undefined}
                >
                  <span className="tonight__dot" style={{ background: LEVEL_COLOR[item.level] }} aria-hidden="true" />
                  <span className="adm-sr-only">{item.level === 'problem' ? 'Problem: ' : item.level === 'caution' ? 'Caution: ' : ''}</span>
                  <div className="tonight__item-text">
                    <b>{item.title}</b>
                    <span>{item.detail}</span>
                    {item.kind === 'reboot' && rebootError && (
                      <span className="tonight__error" data-testid="tonight-reboot-error">{rebootError}</span>
                    )}
                  </div>
                  {item.action && ('to' in item.action ? (
                    <ButtonLink to={item.action.to} data-testid="tonight-attention-action">{item.action.label}</ButtonLink>
                  ) : rebootConfirming ? (
                    <Button variant="danger" onClick={handleReboot} disabled={rebooting} data-testid="tonight-reboot-confirm">
                      {rebooting ? 'Rebooting…' : 'Reboot the Pi'}
                    </Button>
                  ) : (
                    <Button onClick={() => setRebootConfirming(true)} data-testid="tonight-reboot">{item.action.label}</Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {ignoredCleaningTaps.length > 0 && (
            <p className="tonight__note" data-testid="dashboard-cleaning-ignored">
              Line-cleaning reminders are off for{' '}
              {ignoredCleaningTaps.map((t, i) => (
                <span key={t.tapId}>
                  {i > 0 && ', '}
                  <Link to={`/admin/taps?tap=${t.tapId}`}>Tap {t.tapNumber}</Link>
                </span>
              ))}
              .
            </p>
          )}
        </div>
        <LastPour pour={pours[0] ?? null} models={models} units={units} hasPourers={hasPourers} />
      </div>

      <div className="tonight__cols">
        <section aria-labelledby="tonight-taps">
          <h2 className="adm-h2" id="tonight-taps">On tap now</h2>
          {models.length === 0 ? (
            <p className="tonight__quiet">No taps set up yet. <Link to="/admin/taps">Add a tap</Link></p>
          ) : (
            <ul className="tonight__rail" data-testid="tonight-rail">
              {models.map((m) => <TapGlass key={m.tap.tapId} model={m} />)}
            </ul>
          )}
          <TonightChart pours={pours} />
        </section>

        <aside className="tonight__side">
          <ScreensList walls={walls ?? []} displays={displays} />
          <section aria-labelledby="tonight-hardware">
            <h2 className="adm-h2 adm-h2--side" id="tonight-hardware">Hardware</h2>
            <ul className="tonight__facts" data-testid="tonight-hardware">
              {registered.map((s) => (
                <li key={s.name} data-testid="tonight-source">
                  <div>
                    {SOURCE_LABELS[s.name]}
                    <span>{s.healthy ? 'Answering' : 'Not answering. Pours it reports may be missing.'}</span>
                  </div>
                  <StatusDot
                    state={s.healthy ? 'enabled' : 'failed'}
                    label={s.lastEventAt ? formatRelativeTime(s.lastEventAt) : s.healthy ? 'On' : 'Down'}
                  />
                </li>
              ))}
              {warmestProbe && (
                <li data-testid="tonight-kegerator">
                  <div>
                    Kegerator
                    <span>{kegtronProbes.length === 1 ? 'Kegtron probe' : `Highest of ${kegtronProbes.length} Kegtron probes`}</span>
                  </div>
                  <span className="tonight__val">{formatTempC(warmestProbe.tempC!, units)}</span>
                </li>
              )}
              {sensorCards.filter((c) => c.kind !== 'kegtron').map((c) => (
                <li key={c.id} data-testid="dashboard-sensor-card" data-warming={c.warming}>
                  <div>
                    {c.name}
                    <span>{c.warming ? 'Warmer than the kegerator' : 'Govee sensor'}</span>
                  </div>
                  <span className={`tonight__val${c.warming ? ' tonight__val--warn' : ''}`}>
                    {c.tempC != null ? formatTempC(c.tempC, units) : '—'}
                  </span>
                </li>
              ))}
              {stats && (
                <li data-testid="tonight-server">
                  <div>
                    This server
                    <span>
                      {`CPU ${stats.cpu.loadPct}% · memory ${stats.memory.usedPct}%`}
                      {stats.disk ? ` · disk ${stats.disk.usedPct}%` : ''}
                      {stats.watts != null ? ` · ${stats.watts} W` : ''}
                    </span>
                  </div>
                  <span className="tonight__val">
                    {stats.cpuTempC != null ? formatTempC(stats.cpuTempC, units) : `up ${Math.floor(stats.uptimeSec / 3600)} h`}
                  </span>
                </li>
              )}
            </ul>
          </section>
          <NextToKick models={models} />
          <section aria-labelledby="tonight-lately">
            <h2 className="adm-h2 adm-h2--side" id="tonight-lately">Lately</h2>
            {activity.length === 0 ? (
              <p className="tonight__quiet" data-testid="dashboard-activity-empty">Nothing’s happened yet.</p>
            ) : (
              <ul className="tonight__facts" data-testid="dashboard-activity-list">
                {activity.slice(0, 5).map((event, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- events have no stable id
                  <li key={`${event.ts}-${index}`} data-testid="dashboard-activity-row">
                    <div>{formatActivityText(event, units)}</div>
                    <span className="tonight__val tonight__val--quiet">{formatRelativeTime(event.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="tonight__more" to="/admin/logs">Every event in Logs</Link>
          </section>
        </aside>
      </div>
    </PageTemplate>
  );
}

function LastPour({
  pour, models, units, hasPourers,
}: { pour: Pour | null; models: WallTapModel[]; units: 'us' | 'metric'; hasPourers: boolean }) {
  if (!pour) {
    return (
      <figure className="tonight__last tonight__last--empty" data-testid="tonight-last-pour">
        <div className="tonight__last-field"><b>—</b></div>
        <figcaption>The first pour tonight shows up here.</figcaption>
      </figure>
    );
  }
  const model = models.find((m) => m.tap.keg?.id === pour.kegId) ?? null;
  const color = model?.beerColor ?? 'var(--surface-2)';
  const ink = model ? pickInk(model.beerColor) : 'var(--text)';
  const [num, unit] = splitVolume(formatVolumeMl(pour.volumeMl, units));
  return (
    <figure className="tonight__last" data-testid="tonight-last-pour">
      <div className="tonight__last-field" style={{ background: color, color: ink }}>
        {model && <span className="tonight__last-tap" aria-hidden="true">{model.tapNumber}</span>}
        <b>{num}<small>{unit}</small></b>
      </div>
      <figcaption>
        <span className="tonight__last-row">
          <span className="tonight__last-name">{model?.name ?? 'Last pour'}</span>
          <span className="tonight__last-when">
            {model ? `Tap ${model.tapNumber} · ` : ''}{formatRelativeTime(pour.ts)}
          </span>
        </span>
        {hasPourers && pour.drinkerId == null && (
          <span className="tonight__last-claim">
            <span>No name on this pour yet.</span> <Link to="/admin/pours">Assign it</Link>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function TapGlass({ model }: { model: WallTapModel }) {
  const empty = !model.hasBeer || !model.tap.keg;
  const value = empty || model.isKicked ? '—' : String(Math.round(model.servings ?? 0));
  const caption = empty ? 'no keg' : model.isKicked ? 'kicked' : `${model.servingNoun}s left`;
  const fill = { height: `${empty ? 0 : model.levelPct}%`, background: model.beerColor } as CSSProperties;
  return (
    <li>
      <Link
        to={`/admin/taps?tap=${model.tap.tapId}`}
        className={`tonight__tap${model.isLow && !model.isKicked ? ' is-low' : ''}${model.pouring ? ' is-pouring' : ''}`}
        data-testid="dashboard-tap-pill"
        data-kicked={model.isKicked}
        aria-label={`Tap ${model.tapNumber}: ${model.name ?? 'empty'}, ${value === '—' ? caption : `${value} ${caption}`}`}
      >
        <i className="tonight__tap-fill" style={fill} aria-hidden="true" />
        <span className="tonight__tap-top" aria-hidden="true">
          {model.hasBeer ? <TapMarker model={model} size={30} showNumber={false} /> : <span />}
          <span>Tap {model.tapNumber}</span>
        </span>
        <span className="tonight__tap-name" aria-hidden="true">{model.name ?? 'Empty'}</span>
        <b className="tonight__tap-num" aria-hidden="true">{value}</b>
        <span className="tonight__tap-cap" aria-hidden="true">{caption}</span>
      </Link>
    </li>
  );
}

function TonightChart({ pours }: { pours: Pour[] }) {
  const bars = tonightHours(pours.map((p) => p.ts));
  const max = Math.max(1, ...bars.map((b) => b.pours));
  return (
    <section aria-labelledby="tonight-hours" className="tonight__hours-wrap">
      <h2 className="adm-h2" id="tonight-hours">Tonight so far</h2>
      <ol className="tonight__hours" data-testid="tonight-hours">
        {bars.map((b) => (
          <li key={b.offset} aria-label={`${b.label}: ${b.pours} pour${b.pours === 1 ? '' : 's'}`}>
            <i className={b.isNow ? 'is-now' : undefined} style={{ height: `${(b.pours / max) * 100}%` }} aria-hidden="true" />
            <span aria-hidden="true">{b.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ScreensList({ walls, displays }: { walls: Wall[]; displays: Display[] }) {
  const wallName = new Map(walls.map((w) => [w.id, w.name]));
  const now = Date.now();
  // Paired screens when there are any, otherwise the walls themselves; never a long list.
  const total = displays.length > 0 ? displays.length : walls.length;
  const shownDisplays = displays.slice(0, SCREENS_SHOWN);
  const shownWalls = displays.length === 0 ? walls.slice(0, SCREENS_SHOWN) : [];
  return (
    <section aria-labelledby="tonight-screens">
      <h2 className="adm-h2 adm-h2--side" id="tonight-screens">Screens</h2>
      {displays.length === 0 && walls.length === 0 ? (
        <p className="tonight__quiet">No walls or screens yet.</p>
      ) : (
        <ul className="tonight__facts" data-testid="tonight-screens">
          {shownDisplays.map((d) => {
            const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : null;
            const on = seen != null && now - seen < DISPLAY_ONLINE_MS;
            return (
              <li key={`d${d.id}`}>
                <div>
                  {d.name}
                  <span>{d.wallId != null ? wallName.get(d.wallId) ?? 'A wall' : 'No wall chosen'}</span>
                </div>
                {d.pairedAt == null
                  ? <StatusDot state="pending" label="Not paired" />
                  : on
                    ? <StatusDot state="enabled" />
                    : <StatusDot state="disabled" label={d.lastSeen ? `Seen ${formatRelativeTime(d.lastSeen)}` : 'Off'} />}
              </li>
            );
          })}
          {shownWalls.map((w) => (
            <li key={`w${w.id}`}>
              <div>
                {w.name}
                <span>No paired screen</span>
              </div>
              <a className="tonight__val tonight__val--link" href={`/wall/${w.slug}`} target="_blank" rel="noreferrer">Open</a>
            </li>
          ))}
        </ul>
      )}
      {total > SCREENS_SHOWN && (
        <Link className="tonight__more" to={displays.length > 0 ? '/admin/displays' : '/admin/walls'}>
          {`All ${total} ${displays.length > 0 ? 'screens' : 'walls'}`}
        </Link>
      )}
    </section>
  );
}

function NextToKick({ models }: { models: WallTapModel[] }) {
  const next = models
    .filter((m) => m.kicksInDays != null && m.tap.kickDate)
    .sort((a, b) => a.kicksInDays! - b.kicksInDays!)
    .slice(0, 3);
  if (next.length === 0) return null;
  return (
    <section aria-labelledby="tonight-kick">
      <h2 className="adm-h2 adm-h2--side" id="tonight-kick">Next to kick</h2>
      <ul className="tonight__facts" data-testid="tonight-next-kick">
        {next.map((m) => (
          <li key={m.tap.tapId}>
            <div>
              {m.name}
              <span>{`Tap ${m.tapNumber} · ${m.servingsLabel.replace('≈ ', 'about ')}`}</span>
            </div>
            <span className={`tonight__val${m.kicksInDays! <= 2 ? ' tonight__val--warn' : ''}`}>
              {kicksInLabel(m.tap.kickDate ?? null)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

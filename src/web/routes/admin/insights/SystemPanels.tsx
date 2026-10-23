import { formatRelativeTime } from '../../../lib/useRelativeTime';
import { formatTempC } from '../../../lib/units';
import { TempChart } from '../TempChart';
import { HostStatsChart } from '../HostStatsChart';
import { download, toCsv } from './csv';
import type { PanelProps } from './HistoryPanels';

// Insights › Analytics tabs about the equipment and the raw data (split out of StatsPage in
// Kegwall V2 M8).

/** Every temperature sensor's trend, and each sensor's current reading and 7-day range. */
export function TempsPanel({ d, units }: PanelProps) {
  const { sensors, sensorDevices, tempsByMonitor } = d;
  return (
    <>
      <div className="stats-grid">
        <TempChart
          units={units}
          sensors={sensorDevices.map((d) => ({ ...d, data: tempsByMonitor[d.monitorId] ?? [] }))}
        />
      </div>
      <section className="stats-section" data-testid="analytics-sensor-history">
        <h3 className="stats-chart__title">Sensor history</h3>
        {sensors.length === 0 ? (
          <p className="admin-page-quiet">No temperature sensors reporting.</p>
        ) : (
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Sensor</th>
                  <th scope="col">Now</th>
                  <th scope="col">Humidity</th>
                  <th scope="col">7-day min–max</th>
                  <th scope="col">Last reading</th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((s) => (
                  <tr key={s.id} data-testid="sensor-history-row">
                    <td>{`${s.name} · ${s.kind === 'kegtron' ? 'KEGTRON' : 'GOVEE'}`}</td>
                    <td className="font-tabular">{s.tempC != null ? formatTempC(s.tempC, units) : '—'}</td>
                    <td className="font-tabular">{s.humidity != null ? `${Math.round(s.humidity)}%` : '—'}</td>
                    <td className="font-tabular">
                      {s.min7dC != null && s.max7dC != null ? `${formatTempC(s.min7dC, units)} – ${formatTempC(s.max7dC, units)}` : '—'}
                    </td>
                    <td className="font-tabular">{s.lastSeen ? new Date(s.lastSeen).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** This server's CPU, memory and disk over the last day. */
export function ServerPanel({ d, units }: PanelProps) {
  const { hostStats } = d;
  return (
    <>
      <div className="stats-grid">
        <HostStatsChart data={hostStats} units={units} />
      </div>
    </>
  );
}

/** Each ingest source's state, and UDP packet coverage per Kegtron device. */
export function DevicesPanel({ d }: PanelProps) {
  const { sources, udpDevices, udpStale, days, hours } = d;
  return (
    <>
      <section className="stats-section" data-testid="analytics-ingest-sources">
        <h3 className="stats-chart__title">Ingest sources</h3>
        <div className="analytics-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
                <th scope="col">Last event</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.name} data-testid="ingest-source-row">
                  <td>{s.name}</td>
                  <td>{!s.registered ? 'not set up' : s.healthy ? '● OK' : '● down'}</td>
                  <td>{s.detail || '—'}</td>
                  <td className="font-tabular">{s.lastEventAt ? formatRelativeTime(s.lastEventAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="stats-section" data-testid="analytics-udp-devices">
        <h3 className="stats-chart__title">
          {udpStale ? 'UDP packet coverage · last 14 days' : 'UDP packet coverage · last 24h'}
        </h3>
        {udpStale && (
          <p className="admin-page-quiet" role="alert" data-testid="udp-stale-warning">
            No UDP packets in the last 24 hours — the stream has stopped. These are the
            last receipts on record. Check that multicast still reaches this host (under
            Docker that means host networking) and that the Ingest sources table above
            doesn&rsquo;t report the UDP source down.
          </p>
        )}
        {udpDevices.length === 0 ? (
          <p className="admin-page-quiet">
            No UDP packets received in the last 14 days — either UDP streaming has never
            worked here, or the server has restarted more often than once a minute (counts
            are buffered in memory and flushed on the minute).
          </p>
        ) : (
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Device serial</th>
                  <th scope="col">Packets</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Gaps</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {udpDevices.map((d) => (
                  <tr key={d.serial} data-testid="udp-device-row">
                    <td className="font-tabular">{d.serial}</td>
                    <td className="font-tabular">{d.totalPackets.toLocaleString()}</td>
                    <td className="font-tabular">{`${d.coveragePct}%`}</td>
                    <td className="font-tabular">{d.gaps.length}</td>
                    <td className="font-tabular">{formatRelativeTime(d.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** The in-view datasets as CSV downloads; owner-cost sets for admins only. */
export function RawPanel({ d, isAdmin }: PanelProps) {
  const { kegCosts, monthlySpend, pourHistory, beerHistory, pourerHistory, pours } = d;
  return (
    <>
      <section className="stats-section">
        <h3 className="stats-chart__title">Raw datasets</h3>
        <p className="admin-page-quiet">Download the in-view data as CSV. Admin-only sets carry owner cost.</p>
        <div className="raw-export-chips" data-testid="analytics-raw-chips">
          {([
            ['Pour history', pourHistory],
            ['Beer history', beerHistory],
            ['Pourer history', pourerHistory],
            ['Pours per day', pours],
            ...(isAdmin ? [
              ['Keg costs', kegCosts] as const,
              ['Monthly spend', monthlySpend] as const,
            ] : []),
          ] as unknown as [string, Record<string, unknown>[]][]).map(([label, rows]) => (
            <button
              key={label}
              type="button"
              className="raw-export-chip"
              data-testid={`raw-export-${label.toLowerCase().replace(/\s+/g, '-')}`}
              disabled={rows.length === 0}
              onClick={() => download(toCsv(rows), `kegwall-${label.toLowerCase().replace(/\s+/g, '-')}.csv`)}
            >
              {`${label} · CSV (${rows.length})`}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

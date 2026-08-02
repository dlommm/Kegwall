import { useEffect, useState } from 'react';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import {
  doctorCloud, doctorEnv, doctorGovee, doctorListen, doctorUdpHistory, doctorUdpRaw,
  getSources, type UdpDeviceHistory,
} from '../../lib/adminApi';

type CheckState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; ok: boolean; detail: string };

/**
 * `/admin/doctor` — the Connection doctor (design 11e): per-source diagnostics
 * with a real test behind every button. Cloud = auth + device count + latency;
 * the live-path listen counts ingest events per monitor over a window ("pour
 * now to prove the live path"); Govee = key + reading freshness; the
 * network-mode check detects Docker and explains the host-network fix for UDP.
 * Every result also lands in the Logs stream server-side.
 */
export function DoctorPage() {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [cloud, setCloud] = useState<CheckState>({ state: 'idle' });
  const [listen, setListen] = useState<CheckState>({ state: 'idle' });
  const [rawSamples, setRawSamples] = useState<{ raw: string; ts: string }[]>([]);
  const [udpHistory, setUdpHistory] = useState<UdpDeviceHistory[] | null>(null);
  const [udpRaw, setUdpRaw] = useState<{ raw: string; ts: string; serial?: string }[] | null>(null);

  async function loadUdpHistory() {
    const result = await doctorUdpHistory(24);
    if (result.ok) setUdpHistory(result.data.devices);
  }

  async function loadUdpRaw() {
    const result = await doctorUdpRaw();
    if (result.ok) setUdpRaw(result.data.packets);
  }
  const [govee, setGovee] = useState<CheckState>({ state: 'idle' });
  const [env, setEnv] = useState<{ inDocker: boolean; hint: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSources().then((result) => {
      if (!cancelled && result.ok) setSources(result.data);
    });
    doctorEnv().then((result) => {
      if (!cancelled && result.ok) setEnv(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCloud() {
    setCloud({ state: 'running' });
    const result = await doctorCloud();
    setCloud(result.ok
      ? { state: 'done', ok: result.data.ok, detail: result.data.detail }
      : { state: 'done', ok: false, detail: result.message });
  }

  async function runListen() {
    setListen({ state: 'running' });
    setRawSamples([]);
    const result = await doctorListen(10);
    if (!result.ok) {
      setListen({ state: 'done', ok: false, detail: result.message });
      return;
    }
    const { total, perMonitor, seconds } = result.data;
    setRawSamples(result.data.rawSamples ?? []);
    const per = perMonitor.map((m) => `${m.monitor}: ${m.events}`).join(' · ');
    setListen({
      state: 'done',
      ok: total > 0,
      detail: total > 0
        ? `${total} UDP packet(s) in ${seconds}s — ${per}`
        : `No UDP packets in ${seconds}s — a streaming Kegtron sends ~1/sec even idle, so the packets aren't reaching this server (check the network path and the device's UDP toggle).`,
    });
  }

  async function runGovee() {
    setGovee({ state: 'running' });
    const result = await doctorGovee();
    setGovee(result.ok
      ? { state: 'done', ok: result.data.ok, detail: result.data.detail }
      : { state: 'done', ok: false, detail: result.message });
  }

  // Run-all (redesign 4c): fire every check at once. Concurrent — each sets its own state.
  async function runAll() {
    await Promise.all([runCloud(), runListen(), runGovee()]);
  }

  // Overall verdict banner (redesign 4c): a plain-language health summary over registered sources.
  const registered = sources.filter((s) => s.registered);
  const healthy = registered.filter((s) => s.healthy);
  const down = registered.filter((s) => !s.healthy).map((s) => s.name);
  const verdict = registered.length === 0
    ? { text: 'No ingest sources configured yet.', ok: true }
    : {
      text: down.length === 0
        ? `All ${registered.length} ingest paths healthy.`
        : `${healthy.length} of ${registered.length} paths healthy — ${down.join(', ')} ${down.length === 1 ? 'is' : 'are'} down.`,
      ok: down.length === 0,
    };

  function CheckRow({
    title, hint, check, onRun, runLabel, testId,
  }: {
    title: string; hint: string; check: CheckState; onRun: () => void; runLabel: string; testId: string;
  }) {
    return (
      <div className="doctor-row" data-testid={testId}>
        <div className="doctor-row__info">
          <span className="doctor-row__title">{title}</span>
          <span className="doctor-row__hint">{hint}</span>
          {check.state === 'done' && (
            <span
              className={check.ok ? 'doctor-row__result doctor-row__result--ok' : 'doctor-row__result doctor-row__result--bad'}
              data-testid={`${testId}-result`}
            >
              {`${check.ok ? '● OK' : '● PROBLEM'} — ${check.detail}`}
            </span>
          )}
        </div>
        <button type="button" data-testid={`${testId}-run`} disabled={check.state === 'running'} onClick={onRun}>
          {check.state === 'running' ? 'Running…' : runLabel}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="doctor-page">
      <header className="admin-page-header">
        <div className="admin-page-header__lead">
          <h1 className="admin-page-header__title font-display">Connection doctor</h1>
          <p className="admin-page-quiet">Every result is also written to Logs.</p>
        </div>
        <button type="button" className="admin-page-header__action" data-testid="doctor-run-all" onClick={runAll}>
          Run all checks
        </button>
      </header>

      <div
        className={`doctor-verdict doctor-verdict--${verdict.ok ? 'ok' : 'warn'}`}
        role="status"
        data-testid="doctor-verdict"
      >
        {verdict.text}
      </div>

      <section className="displays-section">
        <h2 className="dashboard-card__title font-display">SOURCES RIGHT NOW</h2>
        <ul className="dashboard-source-list">
          {sources.map((source) => (
            <li key={source.name} className="dashboard-source-row" data-testid="doctor-source-row">
              <span className="dashboard-source-row__name">{source.name}</span>
              <span className={`dashboard-source-badge dashboard-source-badge--${!source.registered ? 'unconfigured' : source.healthy ? 'healthy' : 'unhealthy'}`}>
                {!source.registered ? '○ Not set up' : source.healthy ? '● OK' : '● Down'}
                {source.detail ? ` · ${source.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="displays-section">
        <h2 className="dashboard-card__title font-display">CHECKS</h2>
        <CheckRow
          title="Kegtron cloud API"
          hint="Auth + device count + latency against mdash.net"
          check={cloud}
          onRun={runCloud}
          runLabel="Test cloud"
          testId="doctor-cloud"
        />
        <CheckRow
          title="UDP live path (10s listen)"
          hint="Counts raw UDP packets per device — a streaming Kegtron sends ~1/sec even idle, so 0 here means the packets aren’t reaching this server"
          check={listen}
          onRun={runListen}
          runLabel="Listen 10s"
          testId="doctor-listen"
        />
        {rawSamples.length > 0 && (
          <details className="doctor-raw" data-testid="doctor-raw-samples">
            <summary>Raw UDP packets captured ({rawSamples.length})</summary>
            {rawSamples.map((s) => (
              <pre key={s.ts} className="doctor-raw__packet font-tabular">
                {`${s.ts}\n${s.raw}`}
              </pre>
            ))}
          </details>
        )}
        <div className="doctor-udp-extra">
          <div className="settings-actions">
            <button type="button" data-testid="doctor-udp-history-btn" onClick={loadUdpHistory}>
              UDP history (24h)
            </button>
            <button type="button" data-testid="doctor-udp-raw-btn" onClick={loadUdpRaw}>
              Recent raw packets
            </button>
          </div>
          {udpHistory !== null && (
            udpHistory.length === 0 ? (
              <p className="admin-page-quiet" data-testid="doctor-udp-history-empty">
                No UDP packets recorded in the last 24h. The timeline fills in while packets arrive.
              </p>
            ) : (
              <ul className="doctor-udp-history" data-testid="doctor-udp-history">
                {udpHistory.map((d) => (
                  <li key={d.serial}>
                    <strong className="font-tabular">{d.serial}</strong>
                    {` — ${d.totalPackets} packets, coverage ${d.coveragePct}%, last seen ${d.lastSeen.slice(11)} UTC`}
                    {d.gaps.length > 0 && (
                      <span className="admin-page-quiet">
                        {' '}· gaps: {d.gaps.map((g) => `${g.minutes}min (from ${g.from.slice(11)})`).join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
          {udpRaw !== null && (
            udpRaw.length === 0 ? (
              <p className="admin-page-quiet" data-testid="doctor-udp-raw-empty">
                No packets in the buffer — nothing has arrived since the server started.
              </p>
            ) : (
              <details className="doctor-raw" open data-testid="doctor-udp-raw">
                <summary>Last {udpRaw.length} raw packets (newest first)</summary>
                {udpRaw.map((pkt) => (
                  <pre key={pkt.ts + (pkt.serial ?? '')} className="doctor-raw__packet font-tabular">
                    {`${pkt.ts}${pkt.serial ? ` · ${pkt.serial}` : ' · UNPARSEABLE'}\n${pkt.raw}`}
                  </pre>
                ))}
              </details>
            )
          )}
        </div>
        <CheckRow
          title="Govee sensors"
          hint="API key + reading freshness"
          check={govee}
          onRun={runGovee}
          runLabel="Test Govee"
          testId="doctor-govee"
        />
        {env && (
          <div className="doctor-row" data-testid="doctor-env">
            <div className="doctor-row__info">
              <span className="doctor-row__title">Network mode</span>
              <span
                className={env.inDocker ? 'doctor-row__result doctor-row__result--bad' : 'doctor-row__result doctor-row__result--ok'}
                data-testid="doctor-env-result"
              >
                {env.hint}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

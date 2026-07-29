import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  getLogs, logsQueryString, type LogEntry, type LogsResponse,
} from '../../lib/adminApi';
import { LOG_SOURCES, LOG_LEVELS, type LogLevel, type LogSource } from '../../../server/db/logs.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const LIVE_TAIL_INTERVAL_MS = 2000;

const RANGES: { hours: number; label: string }[] = [
  { hours: 1, label: 'Last hour' },
  { hours: 24, label: 'Last 24h' },
  { hours: 168, label: 'Last 7d' },
  { hours: 720, label: 'Last 30d' },
];

const SOURCE_LABELS: Record<LogSource, string> = {
  app: 'App', kegtron: 'Kegtron', wall: 'Wall', tablet: 'Tablet', sensors: 'Sensors', automations: 'Automations', pours: 'Pours',
};
const LEVEL_LABELS: Record<LogLevel, string> = { info: 'Info', warn: 'Warn', error: 'Error' };

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const month = d.toLocaleString('en-US', { month: 'short' });
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${month} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * `/admin/logs` — the unified log stream (design 5d): one clean stream for
 * everything, with source chips, level chips (warn/error carry live counts),
 * substring search, a time range, a live-tail toggle (2s incremental poll —
 * deliberately polled over the authenticated API rather than pushed over the
 * public `/ws` feed, which anyone on the LAN can open), and JSON/CSV export of
 * the current filter window. Error rows are tinted and expand to their detail.
 */
export function LogsPage() {
  const [source, setSource] = useState<LogSource | 'all'>('all');
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [hours, setHours] = useState(24);
  const [liveTail, setLiveTail] = useState(true);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Newest row id we've seen — the live tail asks only for rows past it.
  const newestIdRef = useRef<number>(0);

  const filters = useCallback(() => ({
    sources: source === 'all' ? undefined : [source],
    levels: level === 'all' ? undefined : [level],
    q: search || undefined,
    hours,
  }), [source, level, search, hours]);

  // Full (re)load whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    getLogs(filters()).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
        newestIdRef.current = result.data.entries[0]?.id ?? 0;
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // Live tail: incremental fetch of rows newer than what's on screen.
  useEffect(() => {
    if (!liveTail) return undefined;
    const id = setInterval(() => {
      getLogs({ ...filters(), afterId: newestIdRef.current }).then((result) => {
        if (!result.ok || result.data.entries.length === 0) return;
        newestIdRef.current = result.data.entries[0]!.id;
        setData((prev) => (prev
          ? {
            ...result.data,
            entries: [...result.data.entries, ...prev.entries].slice(0, 500),
          }
          : result.data));
      });
    }, LIVE_TAIL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [liveTail, filters]);

  const exportHref = (format: 'json' | 'csv') => `/api/logs?${logsQueryString({ ...filters(), limit: 2000 })}&format=${format}`;

  return (
    <div data-testid="logs-page">
      <div className="logs-toolbar">
        <input
          type="search"
          className="logs-toolbar__search"
          data-testid="logs-search"
          placeholder="Search logs…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          data-testid="logs-range"
          className="logs-toolbar__range"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {RANGES.map((r) => (
            <option key={r.hours} value={r.hours}>{r.label}</option>
          ))}
        </select>
        <button
          type="button"
          className={liveTail ? 'logs-toolbar__tail logs-toolbar__tail--on' : 'logs-toolbar__tail'}
          data-testid="logs-live-tail"
          aria-pressed={liveTail}
          onClick={() => setLiveTail((v) => !v)}
        >
          <span className="look-pour-dot" />
          Live tail
        </button>
        <a className="logs-toolbar__export" data-testid="logs-export-json" href={exportHref('json')} download>
          JSON ↓
        </a>
        <a className="logs-toolbar__export" data-testid="logs-export-csv" href={exportHref('csv')} download>
          CSV ↓
        </a>
      </div>

      <div className="logs-filters" data-testid="logs-filters">
        <span className="logs-filters__label">SOURCE</span>
        <button
          type="button"
          className={source === 'all' ? 'logs-chip logs-chip--active' : 'logs-chip'}
          onClick={() => setSource('all')}
        >
          All
        </button>
        {LOG_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`logs-source-${s}`}
            className={source === s ? 'logs-chip logs-chip--active' : 'logs-chip'}
            onClick={() => setSource(s)}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
        <span className="logs-filters__divider" />
        <span className="logs-filters__label">LEVEL</span>
        <button
          type="button"
          className={level === 'all' ? 'logs-chip logs-chip--active' : 'logs-chip'}
          onClick={() => setLevel('all')}
        >
          All
        </button>
        {LOG_LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            data-testid={`logs-level-${l}`}
            className={`logs-chip logs-chip--${l}${level === l ? ' logs-chip--active' : ''}`}
            onClick={() => setLevel(l)}
          >
            {LEVEL_LABELS[l]}
            {l !== 'info' && data ? ` · ${data.counts[l]}` : ''}
          </button>
        ))}
      </div>

      {error && <p className="admin-page-quiet" role="alert" data-testid="logs-error">{error}</p>}

      <div className="logs-stream" data-testid="logs-stream">
        {data && data.entries.length === 0 && (
          <p className="admin-page-quiet" data-testid="logs-empty">Nothing logged in this window.</p>
        )}
        {data?.entries.map((entry: LogEntry) => (
          <div
            key={entry.id}
            className={`logs-row logs-row--${entry.level}`}
            data-testid="logs-row"
            data-level={entry.level}
          >
            <span className="logs-row__ts">{formatTs(entry.ts)}</span>
            <span className={`logs-row__level logs-row__level--${entry.level}`}>{entry.level.toUpperCase()}</span>
            <span className="logs-row__source">{entry.source}</span>
            <span className="logs-row__message">
              {entry.message}
              {entry.detail && (
                <button
                  type="button"
                  className="logs-row__expand"
                  data-testid="logs-row-expand"
                  onClick={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
                >
                  {expandedId === entry.id ? '▾ hide details' : '▸ details'}
                </button>
              )}
              {entry.detail && expandedId === entry.id && (
                <span className="logs-row__detail" data-testid="logs-row-detail">{entry.detail}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {data && (
        <footer className="logs-footer" data-testid="logs-footer">
          <span>{`${data.total.toLocaleString()} events in this window`}</span>
          <span>·</span>
          <span>{`Retention: ${data.retentionDays} days (configurable)`}</span>
          <span>·</span>
          <span>Errors auto-create a notification</span>
        </footer>
      )}
    </div>
  );
}

import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { LogsPage } from '../../../src/web/routes/admin/LogsPage';
import { getLogs } from '../../../src/web/lib/adminApi';
import { renderAdminPage } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/web/lib/adminApi')>()),
  getLogs: vi.fn(),
}));

function makeResponse() {
  return {
    entries: [
      {
        id: 2, ts: '2026-07-29T20:14:07.412Z', level: 'info', source: 'pours', message: 'Pour complete — tap 2, 12.6 oz', detail: null,
      },
      {
        id: 1, ts: '2026-07-29T19:58:03.019Z', level: 'error', source: 'kegtron', message: 'Cloud API timeout after 10s', detail: 'request GET /device — attempt 1/3',
      },
    ],
    counts: { info: 1, warn: 0, error: 1 },
    total: 2,
    retentionDays: 30,
  };
}

function mockLogs(data: ReturnType<typeof makeResponse>) {
  (getLogs as Mock).mockResolvedValue({ ok: true, data });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LogsPage (design 5d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogs(makeResponse());
  });

  it('shows a "show similar" chip on repeated error signatures and filters to it on click (redesign 4b)', async () => {
    mockLogs({
      entries: [
        { id: 3, ts: '2026-07-29T20:00:00.000Z', level: 'error', source: 'kegtron', message: 'Cloud API timeout after 10s', detail: null },
        { id: 2, ts: '2026-07-29T19:59:00.000Z', level: 'error', source: 'kegtron', message: 'Cloud API timeout after 12s', detail: null },
        { id: 1, ts: '2026-07-29T19:58:00.000Z', level: 'info', source: 'pours', message: 'Pour complete', detail: null },
      ],
      counts: { info: 1, warn: 0, error: 2 }, total: 3, retentionDays: 30,
    });
    renderAdminPage(<LogsPage />);
    await flush();
    // Two errors share the digit-normalized signature → chip shows "· 2".
    const chips = screen.getAllByTestId('logs-row-similar');
    expect(chips[0]).toHaveTextContent('show similar · 2');
    fireEvent.click(chips[0]!);
    expect(screen.getByTestId('logs-search')).toHaveValue('Cloud API timeout after');
  });

  it('renders the stream with level badges, source, and the footer counts', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    const rows = screen.getAllByTestId('logs-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('INFO');
    expect(rows[0]).toHaveTextContent('pours');
    expect(rows[1]).toHaveAttribute('data-level', 'error');
    expect(screen.getByTestId('logs-footer')).toHaveTextContent('2 events in this window');
    expect(screen.getByTestId('logs-footer')).toHaveTextContent('Retention: 30 days');
  });

  it('level chips show warn/error counts and filter on click', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    expect(screen.getByTestId('logs-level-error')).toHaveTextContent('Error · 1');
    (getLogs as Mock).mockClear();
    mockLogs(makeResponse());
    fireEvent.click(screen.getByTestId('logs-level-error'));
    await flush();
    expect((getLogs as Mock).mock.calls.some(([q]) => q.levels?.[0] === 'error')).toBe(true);
  });

  it('source chips filter the query', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    (getLogs as Mock).mockClear();
    mockLogs(makeResponse());
    fireEvent.click(screen.getByTestId('logs-source-kegtron'));
    await flush();
    expect((getLogs as Mock).mock.calls.some(([q]) => q.sources?.[0] === 'kegtron')).toBe(true);
  });

  it('an error row expands to its detail', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('logs-row-expand'));
    expect(screen.getByTestId('logs-row-detail')).toHaveTextContent('attempt 1/3');
  });

  it('offers JSON and CSV export links carrying the active filters', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    expect(screen.getByTestId('logs-export-json').getAttribute('href')).toContain('format=json');
    expect(screen.getByTestId('logs-export-csv').getAttribute('href')).toContain('format=csv');
  });

  it('live tail is on by default and toggles off', async () => {
    renderAdminPage(<LogsPage />);
    await flush();
    const tail = screen.getByTestId('logs-live-tail');
    expect(tail).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tail);
    expect(tail).toHaveAttribute('aria-pressed', 'false');
  });
});

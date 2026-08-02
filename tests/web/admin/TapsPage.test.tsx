import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { TapsPage } from '../../../src/web/routes/admin/TapsPage';
import { getMenu } from '../../../src/web/lib/api';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import {
  listBeers, listKegs, listMonitors, deleteTap, listTaps, getActiveKegStats, getCleaningStatuses,
  logTapCleaning,
} from '../../../src/web/lib/adminApi';
import type { TapState } from '../../../src/server/core/state';
import type { Tap } from '../../../src/server/db/taps';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/api', () => ({ getMenu: vi.fn() }));
vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  listBeers: vi.fn(),
  listKegs: vi.fn(),
  listMonitors: vi.fn(),
  listTaps: vi.fn(),
  deleteTap: vi.fn(),
  getActiveKegStats: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getCleaningStatuses: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  logTapCleaning: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

vi.mock('../../../src/web/routes/admin/TapForm', () => ({
  TapForm: (props: { mode: string; tap: Tap | null; onSaved: (t: Tap) => void; onCancel: () => void }) => (
    <div data-testid="mock-tap-form">
      <span data-testid="mock-tap-form-mode">{props.mode}</span>
      <span data-testid="mock-tap-form-target">
        {props.tap ? `${props.tap.id}:${props.tap.number}:${props.tap.name}:${props.tap.defaultDrinkerId}` : ''}
      </span>
      <button
        type="button"
        data-testid="mock-tap-form-save"
        onClick={() => props.onSaved({
          id: 1, number: 1, name: 'Saved', defaultDrinkerId: null, hidden: false,
        })}
      >
        Save
      </button>
      <button type="button" data-testid="mock-tap-form-cancel" onClick={props.onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('../../../src/web/routes/admin/SwapWizard', () => ({
  SwapWizard: (props: { tap: TapState; promoteKeg: unknown; onClose: () => void; onDone: () => void }) => (
    <div data-testid="mock-swap-wizard">
      <span data-testid="mock-swap-wizard-tap">{props.tap.tapId}</span>
      <span data-testid="mock-swap-wizard-promote">{props.promoteKeg ? 'promote' : 'new'}</span>
      <button type="button" data-testid="mock-swap-wizard-done" onClick={props.onDone}>Done</button>
      <button type="button" data-testid="mock-swap-wizard-close" onClick={props.onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../../../src/web/routes/admin/OnDeckQueue', () => ({
  OnDeckQueue: (props: { tapId: number; canEdit: boolean; refreshKey: number; onPromote: (k: unknown) => void }) => (
    <div data-testid="mock-on-deck-queue">
      <span data-testid="mock-on-deck-tap">{props.tapId}</span>
      <span data-testid="mock-on-deck-can-edit">{String(props.canEdit)}</span>
      <span data-testid="mock-on-deck-refresh-key">{props.refreshKey}</span>
      <button type="button" data-testid="mock-on-deck-promote" onClick={() => props.onPromote({ id: 77 })}>
        Promote
      </button>
    </div>
  ),
}));

vi.mock('../../../src/web/routes/admin/KickedHistory', () => ({
  KickedHistory: (props: { tapId: number; refreshKey: number }) => (
    <div data-testid="mock-kicked-history">
      <span data-testid="mock-kicked-history-tap">{props.tapId}</span>
      <span data-testid="mock-kicked-history-refresh-key">{props.refreshKey}</span>
    </div>
  ),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId, tapNumber: tapId, tapName: null, beer: null, keg: null, lastPour: null,
    pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
  (useTapStates as Mock).mockReturnValue({ taps: [], stale: false, connected: true, reconnectCount: 0 });
  (listBeers as Mock).mockResolvedValue({ ok: true, data: [] });
  (listKegs as Mock).mockResolvedValue({ ok: true, data: [] });
  (listMonitors as Mock).mockResolvedValue({ ok: true, data: [] });
  (listTaps as Mock).mockResolvedValue({ ok: true, data: [] });
});

describe('TapsPage', () => {
  it('renders one row per tap with number/name/beer/level from the live tap states', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(1, {
          tapName: 'Left',
          beer: {
            id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
          },
          keg: {
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4750, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 75, remainingMl: 14250,
          },
        }),
        makeTap(2),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    const rows = await screen.findAllByTestId('taps-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('Left');
    expect(rows[0]).toHaveTextContent('Citra IPA');
    expect(rows[0]).toHaveTextContent('75%');
    expect(rows[1]).toHaveTextContent('Empty');
  });

  it('a keg projected to kick within 3 days shows a danger forecast and an accent Swap (redesign 3d)', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    (getActiveKegStats as Mock).mockResolvedValue({
      ok: true,
      data: [{
        kegId: 1, beerName: 'Citra IPA', tapNumber: 1, srm: 6,
        levelPct: 18, remainingMl: 3400, dailyBurnMl: 1700, projectedKickDate: soon,
      }],
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1, {
        beer: {
          id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
        },
        keg: {
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 15600, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 18, remainingMl: 3400,
        },
      })],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    const forecast = await screen.findByTestId('taps-row-forecast');
    expect(forecast).toHaveClass('taps-row__forecast--danger');
    expect(screen.getByTestId('taps-row-swap')).toHaveClass('taps-row__swap--critical');
  });

  it('renders the days-to-kick timeline marker positioned by elapsed/predicted (redesign 3d)', async () => {
    // Tapped 2 days ago, projected to kick in 8 days → ~20% elapsed.
    const tapped = new Date(Date.now() - 2 * 86400000).toISOString();
    const kick = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
    (getActiveKegStats as Mock).mockResolvedValue({
      ok: true,
      data: [{
        kegId: 1, beerName: 'Citra IPA', tapNumber: 1, srm: 6, levelPct: 60, remainingMl: 11000, dailyBurnMl: 1300, projectedKickDate: kick,
      }],
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1, {
        beer: {
          id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
        },
        keg: {
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 8000, dateTapped: tapped, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 60, remainingMl: 11000,
        },
      })],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    const marker = (await screen.findByTestId('taps-row-timeline')).querySelector('.taps-row__timeline-marker') as HTMLElement;
    const left = parseInt(marker.style.left, 10);
    expect(left).toBeGreaterThanOrEqual(18);
    expect(left).toBeLessThanOrEqual(22);
  });

  it('opens a backdating dialog and logs a cleaning with a past date (redesign 4a)', async () => {
    (getCleaningStatuses as Mock).mockResolvedValue({
      ok: true, data: [{ tapId: 1, lastCleanedAt: null, gallonsSince: 20, daysSince: null, due: true }],
    });
    (useTapStates as Mock).mockReturnValue({ taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0 });
    renderAdminPage(<TapsPage />);
    fireEvent.click(await screen.findByTestId('taps-row-expand'));
    await flush();
    fireEvent.click(screen.getByTestId('taps-cleaning-log'));
    // Dialog opens; default is "just now".
    expect(screen.getByTestId('cleaning-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('cleaning-dialog-preview')).toHaveTextContent('just now');
    fireEvent.click(screen.getByTestId('cleaning-pick-yesterday'));
    expect(screen.getByTestId('cleaning-dialog-preview')).toHaveTextContent('Will log as cleaned on');
    fireEvent.click(screen.getByTestId('cleaning-dialog-save'));
    await flush();
    expect(logTapCleaning).toHaveBeenCalledWith(1, expect.objectContaining({ cleanedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }));
  });

  it('shows a cleaning meter (amber when due) that replaces the old badge (redesign 3d)', async () => {
    (getCleaningStatuses as Mock).mockResolvedValue({
      ok: true,
      data: [{
        tapId: 1, lastCleanedAt: '2026-06-01T00:00:00.000Z', gallonsSince: 18, daysSince: 40, due: true,
      }],
    });
    (useTapStates as Mock).mockReturnValue({ taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0 });
    renderAdminPage(<TapsPage />);
    fireEvent.click(await screen.findByTestId('taps-row-expand'));
    await flush();
    // The surprise badge is gone.
    expect(screen.queryByTestId('taps-row-cleaning-due')).not.toBeInTheDocument();
    const fill = screen.getByTestId('taps-cleaning-meter').querySelector('.taps-cleaning__meter-fill') as HTMLElement;
    expect(fill).toHaveAttribute('data-due', 'true');
    // 18 gal ÷ 15 clamps to 100%.
    expect(fill.style.width).toBe('100%');
    expect(screen.getByTestId('taps-cleaning')).toHaveTextContent('due now');
  });

  it('marks a kicked tap distinctly', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1, {
        beer: {
          id: 1, name: 'Stout', brewery: null, style: null, abv: null, ibu: null, srm: 35, description: null, labelImage: null, createdAt: '',
        },
        keg: {
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 19000, dateTapped: null, status: 'kicked', createdAt: '', kegType: null, costCents: null, levelPct: 0, remainingMl: 0,
        },
      })],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    const row = await screen.findByTestId('taps-row');
    expect(row).toHaveAttribute('data-kicked', 'true');
    expect(row).toHaveTextContent('Kicked');
  });

  it('shows a quiet empty state with no taps', async () => {
    renderAdminPage(<TapsPage />);
    expect(await screen.findByTestId('taps-empty')).toHaveTextContent('No taps yet.');
  });

  it('a viewer sees a read-only list: no Add/Swap/Edit/Delete controls, but can still expand details', async () => {
    (useTapStates as Mock).mockReturnValue({ taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0 });
    renderAdminPage(<TapsPage />, adminContext('viewer'));
    await screen.findAllByTestId('taps-row');
    expect(screen.queryByTestId('taps-add-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('taps-row-swap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('taps-row-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('taps-row-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('taps-row-expand')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('taps-row-expand'));
    await flush();
    expect(screen.getByTestId('mock-on-deck-can-edit')).toHaveTextContent('false');
  });

  it('an editor sees "Add tap", which opens the create form', async () => {
    renderAdminPage(<TapsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('taps-add-button'));
    expect(screen.getByTestId('mock-tap-form-mode')).toHaveTextContent('create');
  });

  it('clicking Edit opens the edit form pre-targeted at that tap', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(3, { tapNumber: 3, tapName: 'Right' })], stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-edit'));
    expect(screen.getByTestId('mock-tap-form-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('mock-tap-form-target')).toHaveTextContent('3:3:Right:null');
  });

  it("resolves the tap's real defaultDrinkerId (from listTaps, not the live /ws tap state, "
    + "which doesn't carry it) into the edit form target", async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(3, { tapNumber: 3, tapName: 'Right' })], stale: false, connected: true, reconnectCount: 0,
    });
    (listTaps as Mock).mockResolvedValue({
      ok: true, data: [{ id: 3, number: 3, name: 'Right', defaultDrinkerId: 42, hidden: false }],
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    await flush();
    fireEvent.click(screen.getByTestId('taps-row-edit'));
    expect(screen.getByTestId('mock-tap-form-target')).toHaveTextContent('3:3:Right:42');
  });

  it('saving the tap form closes it and reloads catalog data', async () => {
    renderAdminPage(<TapsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('taps-add-button'));
    expect(listBeers).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('mock-tap-form-save'));
    expect(screen.queryByTestId('mock-tap-form')).not.toBeInTheDocument();
    await flush();
    expect(listBeers).toHaveBeenCalledTimes(2);
  });

  it('deleting a tap shows a full consequence sentence naming it, then reloads on success', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(2, { tapNumber: 2, tapName: 'Right' })], stale: false, connected: true, reconnectCount: 0,
    });
    (deleteTap as Mock).mockResolvedValue({ ok: true, data: null });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-delete'));
    const confirm = screen.getByTestId('taps-delete-confirm');
    expect(confirm).toHaveTextContent('permanently delete tap 2');
    expect(confirm).toHaveTextContent('Right');
    expect(confirm).toHaveTextContent("can’t be undone");
    fireEvent.click(screen.getByTestId('taps-delete-confirm-button'));
    await flush();
    expect(deleteTap).toHaveBeenCalledWith(2);
    expect(screen.queryByTestId('taps-delete-confirm')).not.toBeInTheDocument();
  });

  it('a 409 delete conflict explains what blocks it and keeps the dialog open', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(2)], stale: false, connected: true, reconnectCount: 0,
    });
    (deleteTap as Mock).mockResolvedValue({
      ok: false, status: 409, message: "tap 2 has keg history (3 keg(s) on record) and can't be deleted",
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-delete'));
    fireEvent.click(screen.getByTestId('taps-delete-confirm-button'));
    await flush();
    expect(screen.getByTestId('taps-delete-error')).toHaveTextContent("can't be deleted");
    expect(screen.getByTestId('taps-delete-confirm')).toBeInTheDocument();
  });

  it('"Swap keg" opens the wizard for that tap in the new-keg (non-promote) mode', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-swap'));
    expect(screen.getByTestId('mock-swap-wizard-tap')).toHaveTextContent('1');
    expect(screen.getByTestId('mock-swap-wizard-promote')).toHaveTextContent('new');
  });

  it('an on-deck row\'s Promote hands off to the wizard in promote mode', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-expand'));
    fireEvent.click(screen.getByTestId('mock-on-deck-promote'));
    expect(screen.getByTestId('mock-swap-wizard-promote')).toHaveTextContent('promote');
  });

  it('the wizard\'s onDone bumps the refresh key threaded into on-deck/kicked-history', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-expand'));
    expect(screen.getByTestId('mock-on-deck-refresh-key')).toHaveTextContent('0');

    fireEvent.click(screen.getByTestId('taps-row-swap'));
    fireEvent.click(screen.getByTestId('mock-swap-wizard-done'));
    await flush();
    expect(screen.getByTestId('mock-on-deck-refresh-key')).toHaveTextContent('1');
    expect(screen.getByTestId('mock-kicked-history-refresh-key')).toHaveTextContent('1');
  });

  it('closing the wizard removes it from the page', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1)], stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<TapsPage />);
    await screen.findAllByTestId('taps-row');
    fireEvent.click(screen.getByTestId('taps-row-swap'));
    fireEvent.click(screen.getByTestId('mock-swap-wizard-close'));
    expect(screen.queryByTestId('mock-swap-wizard')).not.toBeInTheDocument();
  });
});

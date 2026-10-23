import { useSearchParams } from 'react-router';
import {
  useCallback, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Tap } from '../../../server/db/taps.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import type { MonitorWithDeviceKeg } from '../../lib/adminApi';
import type { KegBurnStat } from '../../../server/db/stats.js';
import type { CleaningStatus } from '../../../server/db/cleanings.js';
import {
  listBeers, listKegs, listMonitors, listTaps, deleteTap as deleteTapApi,
  getActiveKegStats, getCleaningStatuses, logTapCleaning, setCleaningReminders,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { formatWholeVolume } from '../../lib/lookData';
import { matchKegType } from '../../lib/kegAssets';
import { kicksInDays, kicksSoon } from '../../lib/kegForecast';
import { cleaningProgress, kickTimelinePct } from '../../lib/tapMeters';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { shortDate } from '../../lib/adminFormat';
import { isEmptyTap, isLowTap, tapsHeadline, tapsSwapFirst } from '../../lib/tapsSay';
import { wallTapModel, type WallTapModel } from '../../wall/wallModel';
import { TapMarker } from '../../wall/TapMarker';
import { TapForm } from './TapForm';
import { SwapWizard } from './SwapWizard';
import { OnDeckQueue } from './OnDeckQueue';
import { KickedHistory } from './KickedHistory';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import {
  Button, Chips, ConfirmDialog, Drawer, EmptyState, ErrorState, LevelBar, Modal, Skeleton, Table,
} from './ui';

type TapFormState = { mode: 'create' } | { mode: 'edit'; tap: Tap } | null;
interface DeleteTapState { tap: Tap; error: string | null }
interface WizardState { tap: TapState; promoteKeg: Keg | null }
type TapFilter = 'all' | 'swap' | 'cleaning';

/** `TapState` (the `/ws`-live snapshot every tap row is rendered from) has no
 * `defaultDrinkerId` — that's admin configuration, not live device state (see
 * db/taps.ts's doc comment), so it's not part of the public-facing `TapState` shape. The
 * edit form still needs the tap's REAL current value, so this resolves it against
 * `tapRows` — the plain `GET /api/taps` listing this page also loads (Phase 5 Task 0) —
 * falling back to `null` for the brief window before that load resolves. */
function tapToPlainTap(tap: TapState, tapRows: Tap[]): Tap {
  const row = tapRows.find((r) => r.id === tap.tapId);
  return {
    id: tap.tapId, number: tap.tapNumber, name: tap.tapName,
    defaultDrinkerId: row?.defaultDrinkerId ?? null,
    hidden: row?.hidden ?? false,
  };
}

/** "about 6 days", "about a day", "today" from a keg's projected kick date. */
function kicksInText(stat: KegBurnStat | undefined, now: Date = new Date()): string | null {
  const days = stat ? kicksInDays(stat.projectedKickDate, now) : null;
  if (days === null) return null;
  if (days <= 0) return 'today';
  return days === 1 ? 'about a day' : `about ${days} days`;
}

const KEG_TYPE_LABELS: Record<string, string> = {
  'half-barrel': 'Half barrel',
  'quarter-barrel': 'Quarter barrel',
  'sixth-barrel': 'Sixth barrel',
  'fifty-liter': '50 L',
  cornelius: 'Corny',
  'slim-quarter': 'Slim quarter',
  'mini-keg': 'Mini keg',
};

/** YYYY-MM-DD for N days ago, local — for the cleaning dialog's quick-picks. */
function daysAgoDate(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "20 of 40 pints", "Kicked", "Empty". */
function leftText(model: WallTapModel): string {
  if (model.isKicked) return 'Kicked';
  if (!model.hasBeer || model.servings === null) return 'Empty';
  const noun = model.servingNoun;
  const left = Math.round(model.servings);
  const full = model.fullServings;
  return full ? `${left} of ${full} ${noun}s` : `${left} ${noun}${left === 1 ? '' : 's'}`;
}

/** " · 50%" after the servings, or nothing for an empty tap. */
function pctText(model: WallTapModel): string {
  return isEmptyTap(model) ? '' : ` · ${Math.round(model.levelPct)}%`;
}

/**
 * `/admin/taps` (Kegwall V2 M8, prototypes/admin-taps.html): a sentence about the taps, filter
 * chips, and one table of taps with what's left (in servings and as a bar in the beer's
 * color), the kick forecast and the bound monitor. Selecting a tap opens its drawer: keg,
 * line cleaning, on deck and kicked history, plus Edit and Delete. Swapping a keg runs in its
 * own drawer (SwapWizard). Levels come live over the same `/ws` snapshot the wall uses. A
 * viewer sees everything read-only.
 */
export function TapsPage() {
  const { me, units, servingSizeMl } = useAdminContext();
  const [searchParams] = useSearchParams();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [monitors, setMonitors] = useState<MonitorWithDeviceKeg[]>([]);
  const [tapRows, setTapRows] = useState<Tap[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [selectedTapId, setSelectedTapId] = useState<number | null>(() => {
    const tapId = Number(searchParams.get('tap'));
    return Number.isInteger(tapId) && tapId > 0 ? tapId : null;
  });
  const [filter, setFilter] = useState<TapFilter>('all');
  const [tapFormState, setTapFormState] = useState<TapFormState>(null);
  const [deleteState, setDeleteState] = useState<DeleteTapState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  // Backdated line-cleaning dialog (redesign 4a). `when` is a YYYY-MM-DD date, or '' = just now.
  const [cleaningDialog, setCleaningDialog] = useState<{ tapId: number; when: string } | null>(null);
  const [cleaningError, setCleaningError] = useState<string | null>(null);
  const [reminderSaving, setReminderSaving] = useState<number | null>(null);
  const [cleaningSaving, setCleaningSaving] = useState(false);
  const [kegStats, setKegStats] = useState<KegBurnStat[]>([]);
  const [cleanings, setCleanings] = useState<CleaningStatus[]>([]);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setInitialTaps(result.data.taps);
        setTapsStatus('loaded');
      } else {
        setTapsStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps } = useTapStates(initialTaps);
  const models = useMemo(
    () => taps.map((t) => wallTapModel(t, { units, servingSizeMl })),
    [taps, units, servingSizeMl],
  );

  // `?tap=<id>` deep links (Tonight's attention rows and tap rail) open that tap's drawer and
  // bring its row into view once rows exist — also on back/forward between two such links.
  const linkedTapId = Number(searchParams.get('tap'));
  const hasLinkedTap = Number.isInteger(linkedTapId) && linkedTapId > 0;
  const linkedRowReady = hasLinkedTap && tapsStatus === 'loaded' && taps.some((t) => t.tapId === linkedTapId);
  useEffect(() => {
    if (!hasLinkedTap) return;
    setSelectedTapId(linkedTapId);
    if (!linkedRowReady) return;
    const row = document.querySelector(`[data-tap-id="${linkedTapId}"]`);
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [hasLinkedTap, linkedTapId, linkedRowReady]);

  // Beers/kegs/monitors/tapRows don't ride the /ws snapshot (only tap-level live state
  // does) — this reloads them whenever `dataRefreshKey` is bumped (after a swap, a tap
  // edit, or any other action that could have changed what the swap drawer, on-deck
  // queue or edit form need).
  const loadCatalogData = useCallback(() => {
    listBeers().then((result) => { if (result.ok) setBeers(result.data); });
    listKegs().then((result) => { if (result.ok) setKegs(result.data); });
    listMonitors().then((result) => { if (result.ok) setMonitors(result.data); });
    listTaps().then((result) => { if (result.ok) setTapRows(result.data); });
    getActiveKegStats().then((result) => { if (result.ok) setKegStats(result.data); });
    getCleaningStatuses().then((result) => { if (result.ok) setCleanings(result.data); });
  }, []);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData, dataRefreshKey]);

  const refresh = useCallback(() => setDataRefreshKey((k) => k + 1), []);

  const canEdit = me.role === 'editor' || me.role === 'admin';

  function handleTapSaved() {
    setTapFormState(null);
    refresh();
  }

  async function handleLogCleaning() {
    if (!cleaningDialog) return;
    setCleaningSaving(true);
    setCleaningError(null);
    // A backdated date is logged at local noon so it lands on the intended calendar day
    // regardless of timezone; blank = "just now" (server stamps the real time).
    const cleanedAt = cleaningDialog.when
      ? new Date(`${cleaningDialog.when}T12:00:00`).toISOString()
      : undefined;
    const result = await logTapCleaning(cleaningDialog.tapId, { cleanedAt });
    setCleaningSaving(false);
    if (result.ok) {
      setCleaningDialog(null);
      refresh();
    } else {
      setCleaningError(result.message);
    }
  }

  async function handleReminders(tapId: number, ignored: boolean) {
    setReminderSaving(tapId);
    setCleaningError(null);
    const result = await setCleaningReminders(tapId, ignored);
    setReminderSaving(null);
    if (result.ok) setCleanings((statuses) => statuses.map((status) => status.tapId === tapId ? result.data : status));
    else setCleaningError(result.message);
  }

  async function handleConfirmDeleteTap() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteTapApi(deleteState.tap.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      setSelectedTapId(null);
      refresh();
      return;
    }
    setDeleteState({ ...deleteState, error: result.message });
  }

  const statFor = (tap: TapState) => (tap.keg ? kegStats.find((s) => s.kegId === tap.keg!.id) : undefined);
  const cleaningFor = (tapId: number) => cleanings.find((c) => c.tapId === tapId);
  const needsSwap = (m: WallTapModel) => isEmptyTap(m) || isLowTap(m);
  const swapCount = models.filter(needsSwap).length;
  const dueCount = models.filter((m) => cleaningFor(m.tap.tapId)?.due).length;
  const shown = models.filter((m) => (filter === 'swap' ? needsSwap(m)
    : filter === 'cleaning' ? cleaningFor(m.tap.tapId)?.due === true : true));

  const selectedModel = models.find((m) => m.tap.tapId === selectedTapId) ?? null;
  const swapFirst = tapsSwapFirst(models);

  return (
    <PageTemplate
      testId="admin-taps-page"
      title={tapsStatus === 'loaded' ? tapsHeadline(models) : 'Taps & kegs'}
      sub={tapsStatus === 'loaded' && taps.length > 0
        ? swapFirst ?? 'Select a tap for its keg, line cleaning and what’s on deck.'
        : undefined}
      actions={canEdit && (
        <Button variant="primary" data-testid="taps-add-button" onClick={() => setTapFormState({ mode: 'create' })}>
          Add a tap
        </Button>
      )}
      drawer={(
        <>
          {selectedModel && (
            <TapDrawer
              model={selectedModel}
              stat={statFor(selectedModel.tap)}
              cleaning={cleaningFor(selectedModel.tap.tapId)}
              monitor={monitors.find((m) => m.tapId === selectedModel.tap.tapId && m.type !== 'govee_sensor')}
              units={units}
              canEdit={canEdit}
              reminderSaving={reminderSaving}
              cleaningError={cleaningDialog ? null : cleaningError}
              onClose={() => setSelectedTapId(null)}
              onLogCleaning={() => setCleaningDialog({ tapId: selectedModel.tap.tapId, when: '' })}
              onReminders={handleReminders}
              onEdit={() => setTapFormState({ mode: 'edit', tap: tapToPlainTap(selectedModel.tap, tapRows) })}
              onDelete={() => setDeleteState({ tap: tapToPlainTap(selectedModel.tap, tapRows), error: null })}
              onSwap={() => setWizardState({ tap: selectedModel.tap, promoteKeg: null })}
            >
              <OnDeckQueue
                tapId={selectedModel.tap.tapId}
                beers={beers}
                kegs={kegs}
                units={units}
                canEdit={canEdit}
                refreshKey={dataRefreshKey}
                critical={kicksSoon(statFor(selectedModel.tap)?.projectedKickDate ?? null)}
                onPromote={(queuedKeg) => setWizardState({ tap: selectedModel.tap, promoteKeg: queuedKeg })}
              />
              <KickedHistory
                tapId={selectedModel.tap.tapId}
                beers={beers}
                units={units}
                refreshKey={dataRefreshKey}
              />
            </TapDrawer>
          )}

          {tapFormState && canEdit && (
            <Drawer
              open
              onOpenChange={(open) => { if (!open) setTapFormState(null); }}
              title={tapFormState.mode === 'edit' ? `Edit tap ${tapFormState.tap.number}` : 'Add a tap'}
            >
              <TapForm
                key={tapFormState.mode === 'edit' ? tapFormState.tap.id : 'create'}
                mode={tapFormState.mode}
                tap={tapFormState.mode === 'edit' ? tapFormState.tap : null}
                onSaved={handleTapSaved}
                onCancel={() => setTapFormState(null)}
              />
            </Drawer>
          )}

          {wizardState && (
            <SwapWizard
              tap={wizardState.tap}
              beers={beers}
              kegs={kegs}
              monitors={monitors}
              promoteKeg={wizardState.promoteKeg}
              onClose={() => setWizardState(null)}
              onDone={refresh}
            />
          )}

          <ConfirmDialog
            open={deleteState !== null}
            onOpenChange={(open) => { if (!open) setDeleteState(null); }}
            title={deleteState ? `Delete tap ${deleteState.tap.number}?` : ''}
            confirmLabel="Delete tap"
            busyLabel="Deleting…"
            busy={deleting}
            error={deleteState?.error}
            onConfirm={handleConfirmDeleteTap}
            testId="taps-delete-confirm"
            confirmTestId="taps-delete-confirm-button"
            cancelTestId="taps-delete-cancel-button"
            errorTestId="taps-delete-error"
          >
            {deleteState && (
              <p>
                This will permanently delete tap {deleteState.tap.number}
                {deleteState.tap.name ? ` (${deleteState.tap.name})` : ''} from the taproom. This can&rsquo;t
                be undone.
              </p>
            )}
          </ConfirmDialog>

          <Modal
            open={cleaningDialog !== null}
            onOpenChange={(open) => { if (!open && !cleaningSaving) setCleaningDialog(null); }}
            title="Log a line cleaning"
            description="Backdating recomputes the counters: pours after the chosen date count toward the next cleaning."
            testId="cleaning-dialog"
            footer={(
              <>
                <Button variant="primary" data-testid="cleaning-dialog-save" disabled={cleaningSaving} onClick={handleLogCleaning}>
                  {cleaningSaving ? 'Saving…' : 'Log cleaning'}
                </Button>
                <Button variant="quiet" data-testid="cleaning-dialog-cancel" disabled={cleaningSaving} onClick={() => setCleaningDialog(null)}>
                  Cancel
                </Button>
              </>
            )}
          >
            {cleaningDialog && (
              <>
                {cleaningError && <p className="adm-modal__error" role="alert">{cleaningError}</p>}
                <div className="cleaning-dialog__picks">
                  <Button
                    data-testid="cleaning-pick-now"
                    aria-pressed={cleaningDialog.when === ''}
                    onClick={() => setCleaningDialog({ ...cleaningDialog, when: '' })}
                  >
                    Just now
                  </Button>
                  <Button
                    data-testid="cleaning-pick-yesterday"
                    aria-pressed={cleaningDialog.when === daysAgoDate(1)}
                    onClick={() => setCleaningDialog({ ...cleaningDialog, when: daysAgoDate(1) })}
                  >
                    Yesterday
                  </Button>
                  <input
                    type="date"
                    aria-label="Cleaned on"
                    data-testid="cleaning-pick-date"
                    max={daysAgoDate(0)}
                    value={cleaningDialog.when}
                    onChange={(e) => setCleaningDialog({ ...cleaningDialog, when: e.target.value })}
                  />
                </div>
                <p className="adm-modal__body" data-testid="cleaning-dialog-preview">
                  {cleaningDialog.when
                    ? `Will log as cleaned on ${new Date(`${cleaningDialog.when}T12:00:00`).toLocaleDateString()}.`
                    : 'Will log as cleaned just now.'}
                </p>
              </>
            )}
          </Modal>
        </>
      )}
    >
      {tapsStatus === 'loading' && (
        <div data-testid="taps-loading" aria-label="Loading taps">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}
      {tapsStatus === 'error' && (
        <div data-testid="taps-error">
          <ErrorState title="Couldn’t load taps.">Reload to try again.</ErrorState>
        </div>
      )}
      {tapsStatus === 'loaded' && taps.length === 0 && (
        <div data-testid="taps-empty">
          <EmptyState title="No taps yet.">
            Add a tap for each faucet, then tap a keg on it.
          </EmptyState>
        </div>
      )}

      {tapsStatus === 'loaded' && taps.length > 0 && (
        <>
          <div className="adm-toolbar">
            <Chips<TapFilter>
              label="Show taps"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: models.length },
                { value: 'swap', label: 'Needs a swap', count: swapCount },
                { value: 'cleaning', label: 'Due for cleaning', count: dueCount },
              ]}
            />
          </div>
          <Table className="taps-v2" data-testid="taps-list">
            <thead>
              <tr>
                <th scope="col">Tap</th>
                <th scope="col">Beer and keg</th>
                <th scope="col" className="taps-row__left">Left</th>
                <th scope="col" className="taps-row__kicks">Kicks in</th>
                <th scope="col" className="taps-row__monitor">Monitor</th>
                <th scope="col"><span className="adm-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((model) => (
                <TapRow
                  key={model.tap.tapId}
                  model={model}
                  stat={statFor(model.tap)}
                  monitor={monitors.find((m) => m.tapId === model.tap.tapId && m.type !== 'govee_sensor')}
                  units={units}
                  selected={model.tap.tapId === selectedTapId}
                  canEdit={canEdit}
                  onOpen={() => setSelectedTapId(model.tap.tapId)}
                  onSwap={() => setWizardState({ tap: model.tap, promoteKeg: null })}
                />
              ))}
            </tbody>
          </Table>
          {shown.length === 0 && (
            <p className="adm-note" style={{ marginTop: 16 }}>
              {filter === 'swap' ? 'Every keg has plenty left.' : 'No tap is due for a cleaning.'}
            </p>
          )}
        </>
      )}
    </PageTemplate>
  );
}

/** The bound monitor, said the way it's labelled on the device: "Pro B · port 0". */
function boundMonitorLabel(monitor: MonitorWithDeviceKeg | undefined): { name: string; seen: string | null } | null {
  if (!monitor) return null;
  const kind = monitor.type === 'kegtron_gen1' ? 'Gen 1' : 'Pro';
  return {
    name: `${monitor.name ?? kind} · port ${monitor.portIndex}`,
    seen: monitor.lastSeen ? formatRelativeTime(monitor.lastSeen) : null,
  };
}

function TapRow({
  model, stat, monitor, units, selected, canEdit, onOpen, onSwap,
}: {
  model: WallTapModel;
  units: 'us' | 'metric';
  stat: KegBurnStat | undefined;
  monitor: MonitorWithDeviceKeg | undefined;
  selected: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onSwap: () => void;
}) {
  const { tap } = model;
  const kicked = model.isKicked;
  const empty = isEmptyTap(model);
  const low = isLowTap(model);
  // Redesign 3d: a keg projected to kick within 3 days reads danger, and its Swap leads.
  const kickSoon = !kicked && stat ? kicksSoon(stat.projectedKickDate) : false;
  const kegType = tap.keg ? tap.keg.kegType ?? matchKegType(tap.keg.sizeMl) : null;
  const hasActiveKeg = tap.keg != null && tap.keg.status === 'on_tap';
  const forecast = !kicked ? kicksInText(stat) : null;
  const mon = boundMonitorLabel(monitor);
  const swapLeads = kickSoon || low || empty;
  const kegLine = [
    tap.tapName,
    tap.keg ? (kegType ? KEG_TYPE_LABELS[kegType] : null) ?? formatWholeVolume(tap.keg.sizeMl, units) : null,
    tap.keg?.dateTapped && !kicked ? `tapped ${shortDate(tap.keg.dateTapped)}` : null,
    model.style,
  ].filter(Boolean).join(' · ');

  return (
    <tr
      className={selected ? 'taps-row is-selected' : 'taps-row'}
      data-testid="taps-row"
      data-tap-id={tap.tapId}
      data-kicked={kicked}
    >
      <td className="taps-row__num">{tap.tapNumber}</td>
      <td>
        <div className="adm-who">
          {model.hasBeer && <TapMarker model={model} size={44} showNumber={false} className="taps-row__marker" />}
          <div>
            <div className="adm-name adm-ell taps-row__beer">
              {model.hasBeer ? model.name : 'Empty'}
              {tap.hidden && <span className="taps-row__flag" data-testid="taps-row-hidden">Hidden</span>}
            </div>
            {kegLine && <div className="adm-sub adm-ell">{kegLine}</div>}
          </div>
        </div>
      </td>
      <td className="taps-row__left adm-num-cell">
        <span className={low ? 'adm-warn-text' : undefined} data-testid="taps-row-status">
          {leftText(model)}
          <span className="taps-row__pct">{pctText(model)}</span>
        </span>
        {!empty && <LevelBar pct={model.levelPct} color={model.beerColor} low={low} />}
      </td>
      <td className="taps-row__kicks adm-num-cell">
        {forecast ? (
          <span
            className={kickSoon ? 'taps-row__forecast taps-row__forecast--danger' : 'taps-row__forecast'}
            data-testid="taps-row-forecast"
          >
            {forecast}
          </span>
        ) : <span className="adm-sub">—</span>}
      </td>
      <td className="taps-row__monitor adm-sub">
        {mon ? (
          <>
            {mon.name}
            <br />
            <span className={tap.monitorOnline ? 'adm-ok-text' : 'adm-warn-text'}>
              {tap.monitorOnline ? '●' : '○'} {mon.seen ?? (tap.monitorOnline ? 'online' : 'not heard from')}
            </span>
          </>
        ) : 'Not bound'}
      </td>
      <td className="adm-actions">
        {canEdit && swapLeads && (
          <Button
            variant="primary"
            className={kickSoon ? 'taps-row__swap taps-row__swap--critical' : 'taps-row__swap'}
            data-testid="taps-row-swap"
            onClick={onSwap}
          >
            {hasActiveKeg ? 'Swap keg' : 'Tap a keg'}
          </Button>
        )}
        <Button variant="quiet" data-testid="taps-row-expand" aria-expanded={selected} onClick={onOpen}>
          Details
        </Button>
      </td>
    </tr>
  );
}

function TapDrawer({
  model, stat, cleaning, monitor, units, canEdit, reminderSaving, cleaningError, children,
  onClose, onLogCleaning, onReminders, onEdit, onDelete, onSwap,
}: {
  model: WallTapModel;
  stat: KegBurnStat | undefined;
  cleaning: CleaningStatus | undefined;
  monitor: MonitorWithDeviceKeg | undefined;
  units: 'us' | 'metric';
  canEdit: boolean;
  reminderSaving: number | null;
  cleaningError: string | null;
  children: ReactNode;
  onClose: () => void;
  onLogCleaning: () => void;
  onReminders: (tapId: number, ignored: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onSwap: () => void;
}) {
  const { tap } = model;
  const hasActiveKeg = tap.keg != null && tap.keg.status === 'on_tap';
  const timelinePct = stat && tap.keg ? kickTimelinePct(tap.keg.dateTapped, stat.projectedKickDate) : null;
  const forecast = kicksInText(stat);
  const mon = boundMonitorLabel(monitor);
  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={model.hasBeer ? `Tap ${tap.tapNumber} · ${model.name}` : `Tap ${tap.tapNumber}`}
      description={tap.tapName ?? undefined}
      testId="taps-row-details"
      footer={canEdit ? (
        <>
          <Button variant="primary" onClick={onSwap}>{hasActiveKeg ? 'Swap keg' : 'Tap a keg'}</Button>
          <Button data-testid="taps-row-edit" onClick={onEdit}>Edit tap</Button>
          <Button variant="quiet" data-testid="taps-row-delete" onClick={onDelete}>Delete</Button>
        </>
      ) : undefined}
    >
      <dl className="adm-facts">
        <dt>Left</dt>
        <dd>{`${leftText(model)}${pctText(model)}`}</dd>
        {tap.keg && !model.isKicked && (
          <>
            <dt>Volume</dt>
            <dd>{`${formatWholeVolume(tap.keg.remainingMl, units)} of ${formatWholeVolume(tap.keg.volStartMl, units)}`}</dd>
          </>
        )}
        <dt>Kicks in</dt>
        <dd className={stat && kicksSoon(stat.projectedKickDate) ? 'adm-danger-text' : undefined}>
          {forecast ? `${forecast} at the current pace` : '—'}
        </dd>
        <dt>Monitor</dt>
        <dd>{mon ? `${mon.name}${mon.seen ? ` · ${mon.seen}` : ''}` : 'Not bound'}</dd>
        {model.nextUpName && (
          <>
            <dt>Next up</dt>
            <dd>{model.nextUpName}</dd>
          </>
        )}
      </dl>
      {timelinePct != null && stat?.projectedKickDate && tap.keg?.dateTapped && (
        <div className="taps-detail__timeline-wrap">
          <span className="taps-detail__timeline" data-testid="taps-row-timeline" aria-hidden="true">
            <span className="taps-row__timeline-marker" style={{ left: `${timelinePct}%` }} />
          </span>
          <span className="adm-sub taps-detail__timeline-ends">
            <span>{`Tapped ${shortDate(tap.keg.dateTapped)}`}</span>
            <span>{`Kicks about ${shortDate(`${stat.projectedKickDate}T12:00:00`)}`}</span>
          </span>
        </div>
      )}

      <section
        className="adm-drawer__section"
        data-testid="taps-cleaning"
        data-due={cleaning?.due ?? false}
        aria-label="Line cleaning"
      >
        <h3>Line cleaning</h3>
        <p className={cleaning?.due ? 'adm-warn-text' : 'adm-dim'} style={{ margin: 0 }}>
          {cleaning?.ignored ? 'Reminders ignored' : cleaning?.inactive ? 'Empty tap · reminders paused' : cleaning?.lastCleanedAt
            ? `${cleaning.daysSince} day(s) · ${cleaning.gallonsSince} gal since`
            : 'No cleaning recorded'}
          {cleaning?.due ? ' · due now' : ''}
        </p>
        {cleaning && !cleaning.ignored && !cleaning.inactive && (
          <span className="taps-detail__meter" data-testid="taps-cleaning-meter" aria-hidden="true">
            <span
              className="taps-cleaning__meter-fill"
              data-due={cleaning.due}
              style={{ width: `${Math.round(cleaningProgress(cleaning) * 100)}%` }}
            />
          </span>
        )}
        {cleaningError && <p className="adm-danger-text" role="alert" style={{ margin: 0 }}>{cleaningError}</p>}
        {canEdit && (
          <div className="taps-detail__row">
            <Button data-testid="taps-cleaning-log" onClick={onLogCleaning}>Log cleaning</Button>
            <Button
              variant="quiet"
              disabled={reminderSaving !== null || !cleaning}
              onClick={() => onReminders(tap.tapId, !cleaning?.ignored)}
            >
              {reminderSaving === tap.tapId ? 'Saving…' : cleaning?.ignored ? 'Resume reminders' : 'Ignore reminders'}
            </Button>
          </div>
        )}
      </section>

      <section className="adm-drawer__section" aria-label="On deck and history">
        {children}
      </section>
    </Drawer>
  );
}

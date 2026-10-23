import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Display } from '../../lib/adminApi';
import {
  createDisplay, deleteDisplay, listDisplays, listWalls, regenerateDisplayCode, updateDisplay,
  type Wall,
} from '../../lib/adminApi';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { LOOK_OPTIONS, TAKEOVER_OPTIONS } from '../../lib/wallCatalog';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Skeleton, Table,
} from './ui';

type LookId = (typeof LOOK_OPTIONS)[number]['id'];
type TakeoverId = (typeof TAKEOVER_OPTIONS)[number]['id'];

/** A screen that hasn't checked in for this long reads as gone quiet. */
const QUIET_MS = 24 * 60 * 60 * 1000;

function isQuiet(display: Display, now: number): boolean {
  return !display.lastSeen || now - Date.parse(display.lastSeen) > QUIET_MS;
}

/** "Three screens paired." / "Three screens paired. The Patio TV hasn't checked in today." */
function displaysHeadline(displays: Display[], now: number): string {
  if (displays.length === 0) return 'No screens paired yet.';
  const lead = displays.length === 1 ? 'One screen paired.' : `${capitalize(countWord(displays.length))} screens paired.`;
  const quiet = displays.filter((d) => d.pairedAt && isQuiet(d, now));
  if (quiet.length === 1) return `${lead} ${quiet[0]!.name} hasn’t checked in today.`;
  if (quiet.length > 1) return `${lead} ${capitalize(countWord(quiet.length))} haven’t checked in today.`;
  return lead;
}

/**
 * `/admin/displays` (Kegwall V2 M9; design 7c): one row per paired screen with the wall it
 * shows, optional per-screen look and takeover overrides, when it last checked in, and its
 * pairing code. Pairing codes are shown to editors and admins only: anyone holding a live code
 * can pair a screen.
 */
export function DisplaysPage() {
  const { me } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';
  const [displays, setDisplays] = useState<Display[]>([]);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [adding, setAdding] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Display | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDisplays().then((r) => {
      if (r.ok) { setDisplays(r.data); setStatus('loaded'); } else setStatus((s) => (s === 'loaded' ? s : 'error'));
    });
    listWalls().then((r) => { if (r.ok) setWalls(r.data); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addDisplay(e: FormEvent) {
    e.preventDefault();
    const name = newDisplayName.trim();
    if (!name) return;
    const result = await createDisplay({ name });
    if (result.ok) {
      setNewDisplayName('');
      setError(null);
      setAdding(false);
      load();
    } else {
      setError(result.message);
    }
  }

  async function patchDisplay(id: number, input: Parameters<typeof updateDisplay>[1]) {
    const result = await updateDisplay(id, input);
    if (result.ok) { setError(null); load(); } else setError(result.message);
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    const result = await deleteDisplay(removeTarget.id);
    setRemoving(false);
    if (result.ok) { setRemoveTarget(null); load(); } else setRemoveError(result.message);
  }

  const now = Date.now();

  return (
    <PageTemplate
      testId="displays-page"
      title={status === 'loaded' ? displaysHeadline(displays, now) : 'Displays'}
      sub="A screen pairs by opening /display and typing its code. Codes last 15 minutes; paired screens stay connected."
      actions={canEdit && (
        <Button variant="primary" data-testid="displays-pair-button" onClick={() => { setError(null); setAdding(true); }}>
          Pair a screen
        </Button>
      )}
      drawer={(
        <>
          <Drawer
            open={adding}
            onOpenChange={setAdding}
            title="Pair a screen"
            description="Name it after where it hangs. You get a code to type on the screen."
          >
            <form className="adm-form" onSubmit={addDisplay}>
              <label className="admin-field">
                <span>Name</span>
                <input
                  type="text"
                  data-testid="displays-add-name"
                  placeholder="Living room TV"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </label>
              <ol className="displays-v2__steps">
                <li>Add it here. Its code shows in the list.</li>
                <li>On the screen, open <code>{`${window.location.origin}/display`}</code>.</li>
                <li>Type the code. Then pick the wall it shows.</li>
              </ol>
              {error && <p className="adm-danger-text" role="alert">{error}</p>}
              <div className="adm-form__actions">
                <Button type="submit" variant="primary" data-testid="displays-add-button" disabled={!newDisplayName.trim()}>
                  Add the screen
                </Button>
                <Button variant="quiet" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </form>
          </Drawer>
          <ConfirmDialog
            open={removeTarget !== null}
            onOpenChange={(open) => { if (!open) { setRemoveTarget(null); setRemoveError(null); } }}
            title={removeTarget ? `Unpair ${removeTarget.name}?` : ''}
            confirmLabel="Unpair"
            busyLabel="Unpairing…"
            busy={removing}
            error={removeError}
            onConfirm={confirmRemove}
            testId="displays-remove-confirm"
            confirmTestId="displays-remove-confirm-button"
          >
            <p>The screen stops showing its wall and needs a new code to pair again.</p>
          </ConfirmDialog>
        </>
      )}
    >
      {error && !adding && <p className="adm-danger-text" role="alert" data-testid="displays-error">{error}</p>}
      {status === 'loading' && <Skeleton height={120} />}
      {status === 'error' && <ErrorState title="Couldn’t load screens." onRetry={load} />}
      {status === 'loaded' && displays.length === 0 && (
        <div data-testid="displays-empty">
          <EmptyState title="No screens paired yet.">
            Any browser can open a wall by its address. Pair a screen to pick its wall from here.
          </EmptyState>
        </div>
      )}
      {displays.length > 0 && (
        <Table data-testid="displays-table">
          <thead>
            <tr>
              <th scope="col">Screen</th>
              <th scope="col">Shows</th>
              <th scope="col">Look</th>
              <th scope="col">Pour takeover</th>
              {canEdit && <th scope="col">Pairing code</th>}
              {canEdit && <th scope="col" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {displays.map((display) => (
              <tr key={display.id} data-testid="displays-row">
                <td>
                  <b>{display.name}</b>
                  <div className={display.pairedAt && isQuiet(display, now) ? 'adm-warn-text' : 'adm-sub'}>
                    {display.lastSeen ? `Seen ${formatRelativeTime(display.lastSeen)}` : display.pairedAt ? 'Paired, never seen' : 'Waiting to pair'}
                  </div>
                </td>
                <td>
                  <select
                    className="adm-select"
                    aria-label={`Wall on ${display.name}`}
                    data-testid="displays-row-wall"
                    disabled={!canEdit}
                    value={display.wallId ?? ''}
                    onChange={(e) => patchDisplay(display.id, {
                      wallId: e.target.value === '' ? null : Number(e.target.value),
                    })}
                  >
                    <option value="">Nothing yet</option>
                    {walls.map((wall) => (
                      <option key={wall.id} value={wall.id}>{`${wall.name} · /wall/${wall.slug}`}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="adm-select"
                    aria-label={`Look on ${display.name}`}
                    data-testid="displays-row-look"
                    disabled={!canEdit}
                    value={display.overrides.look ?? ''}
                    onChange={(e) => patchDisplay(display.id, {
                      overrides: { ...display.overrides, look: e.target.value === '' ? undefined : e.target.value as LookId },
                    })}
                  >
                    <option value="">The wall’s own</option>
                    {LOOK_OPTIONS.map((look) => <option key={look.id} value={look.id}>{look.label}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    className="adm-select"
                    aria-label={`Pour takeover on ${display.name}`}
                    data-testid="displays-row-takeover"
                    disabled={!canEdit}
                    value={display.overrides.takeoverStyle ?? ''}
                    onChange={(e) => patchDisplay(display.id, {
                      overrides: {
                        ...display.overrides,
                        takeoverStyle: e.target.value === '' ? undefined : e.target.value as TakeoverId,
                      },
                    })}
                  >
                    <option value="">The wall’s own</option>
                    {TAKEOVER_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </td>
                {canEdit && (
                  <td className="adm-num-cell" data-testid="displays-row-code">
                    <b className="displays-v2__code">{display.code}</b>
                    <Button
                      variant="quiet"
                      data-testid="displays-row-regenerate"
                      onClick={async () => {
                        const result = await regenerateDisplayCode(display.id);
                        if (result.ok) { setError(null); load(); } else setError(result.message);
                      }}
                    >
                      New code
                    </Button>
                  </td>
                )}
                {canEdit && (
                  <td className="adm-actions">
                    <Button
                      variant="quiet"
                      data-testid="displays-row-delete"
                      onClick={() => { setRemoveError(null); setRemoveTarget(display); }}
                    >
                      Unpair
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </PageTemplate>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Display } from '../../lib/adminApi';
import {
  createDisplay, deleteDisplay, listDisplays, listWalls, regenerateDisplayCode, updateDisplay,
  type Wall,
} from '../../lib/adminApi';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { useAdminContext } from './useAdminContext';

const LOOK_OPTIONS = ['', 'just-tapped', 'classic', 'ledger', 'gallery', 'columns'] as const;
const TAKEOVER_OPTIONS = ['', 'off', 'full', 'spotlight', 'split', 'dock', 'fill'] as const;

/**
 * `/admin/displays` — Displays (design 7c): one row per paired screen with its
 * pairing code, wall assignment, optional per-display look/takeover overrides,
 * and last-seen.
 */
export function DisplaysPage() {
  const { me } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';
  const [displays, setDisplays] = useState<Display[]>([]);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDisplays().then((r) => { if (r.ok) setDisplays(r.data); });
    listWalls().then((r) => { if (r.ok) setWalls(r.data); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addDisplay() {
    const name = newDisplayName.trim();
    if (!name) return;
    const result = await createDisplay({ name });
    if (result.ok) {
      setNewDisplayName('');
      setError(null);
      load();
    } else {
      setError(result.message);
    }
  }

  async function patchDisplay(id: number, input: Parameters<typeof updateDisplay>[1]) {
    const result = await updateDisplay(id, input);
    if (result.ok) load();
    else setError(result.message);
  }

  return (
    <div data-testid="displays-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Displays</h1>
        <p className="admin-page-quiet">
          A display pairs by opening <code>/display</code> on the TV and typing its code.
          Codes expire 15 minutes after they're minted — use <strong>New code</strong> if
          the TV reports an expired one. Screens that are already paired stay connected.
        </p>
      </header>

      {error && <p className="admin-page-quiet" role="alert" data-testid="displays-error">{error}</p>}

      <section className="displays-section">
        <h2 className="dashboard-card__title font-display">DISPLAYS</h2>
        {canEdit && (
          <div className="displays-add">
            <input
              type="text"
              data-testid="displays-add-name"
              placeholder="Living room TV"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
            />
            <button type="button" data-testid="displays-add-button" onClick={addDisplay}>
              Add display
            </button>
          </div>
        )}
        {displays.length === 0 ? (
          <p className="admin-page-quiet" data-testid="displays-empty">No displays paired yet.</p>
        ) : (
          <table className="admin-table" data-testid="displays-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Pairing code</th>
                <th scope="col">Wall</th>
                <th scope="col">Look override</th>
                <th scope="col">Takeover override</th>
                <th scope="col">Last seen</th>
                {canEdit && <th scope="col" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {displays.map((display) => (
                <tr key={display.id} data-testid="displays-row">
                  <td>{display.name}</td>
                  <td className="font-tabular" data-testid="displays-row-code">
                    {display.code}
                    {canEdit && (
                      <button
                        type="button"
                        data-testid="displays-row-regenerate"
                        onClick={async () => {
                          const result = await regenerateDisplayCode(display.id);
                          if (result.ok) { setError(null); load(); } else setError(result.message);
                        }}
                      >
                        New code
                      </button>
                    )}
                  </td>
                  <td>
                    <select
                      data-testid="displays-row-wall"
                      disabled={!canEdit}
                      value={display.wallId ?? ''}
                      onChange={(e) => patchDisplay(display.id, {
                        wallId: e.target.value === '' ? null : Number(e.target.value),
                      })}
                    >
                      <option value="">— none —</option>
                      {walls.map((wall) => (
                        <option key={wall.id} value={wall.id}>{wall.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      data-testid="displays-row-look"
                      disabled={!canEdit}
                      value={display.overrides.look ?? ''}
                      onChange={(e) => patchDisplay(display.id, {
                        overrides: { ...display.overrides, look: e.target.value === '' ? undefined : e.target.value as Exclude<typeof LOOK_OPTIONS[number], ''> },
                      })}
                    >
                      {LOOK_OPTIONS.map((look) => (
                        <option key={look} value={look}>{look === '' ? 'wall default' : look}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      data-testid="displays-row-takeover"
                      disabled={!canEdit}
                      value={display.overrides.takeoverStyle ?? ''}
                      onChange={(e) => patchDisplay(display.id, {
                        overrides: { ...display.overrides, takeoverStyle: e.target.value === '' ? undefined : e.target.value as Exclude<typeof TAKEOVER_OPTIONS[number], ''> },
                      })}
                    >
                      {TAKEOVER_OPTIONS.map((style) => (
                        <option key={style} value={style}>{style === '' ? 'wall default' : style}</option>
                      ))}
                    </select>
                  </td>
                  <td className="font-tabular">
                    {display.lastSeen ? formatRelativeTime(display.lastSeen) : 'Never'}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        data-testid="displays-row-delete"
                        onClick={() => deleteDisplay(display.id).then(load)}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

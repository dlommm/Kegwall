import { useCallback, useEffect, useState } from 'react';
import {
  getPresenceSources, listWalls, setPresenceState, updateWall, type Wall,
} from '../../lib/adminApi';
import { isDisplayPowerMessage, type PowerStage } from '../../lib/displayPower';
import { useTapStates } from '../../lib/useTapStates';
import {
  configToFormState, parseWallConfigForm, safeParseWallConfig, type WallConfigFormState,
} from '../../lib/wallEditorConfig';

/** Same cadence as DashboardPage's source-health/activity poll — there's no push channel
 * for the SSE agent-connection counts `GET /api/presence/sources` reports (unlike zone
 * power state, which rides `display_power` WS frames below). */
const POLL_INTERVAL_MS = 60_000;

const POWER_STAGE_LABEL: Record<PowerStage, string> = {
  active: 'Active', screensaver: 'Screensaver', off: 'Off',
};

/** "no agent" / "1 agent connected" / "N agents connected" — the Zones panel's per-row
 * agent-count text (spec Part B, panel 1). */
function agentsLabel(count: number): string {
  if (count === 0) return 'no agent';
  return `${count} agent${count === 1 ? '' : 's'} connected`;
}

/** A display-power panel row's three editable fields — the same shape WallEditor's
 * `displayPower` fieldset writes (wallEditorConfig.ts's `WallConfigFormState`), pulled
 * out on its own so this page doesn't have to hold a full per-wall form-state object
 * for fields it never shows. */
interface DpFields {
  screensaverAfterMinutes: number | null;
  offAfterMinutes: number | null;
  cameraMotion: boolean;
}

function dpFieldsFromWall(wall: Wall): DpFields {
  const { displayPower } = safeParseWallConfig(wall.config);
  return {
    screensaverAfterMinutes: displayPower.screensaverAfterMinutes,
    offAfterMinutes: displayPower.offAfterMinutes,
    cameraMotion: displayPower.cameraMotion,
  };
}

/**
 * `/admin/presence` — the Displays & Presence hub (spec 2026-08-01, Part B). This task
 * builds the first two of its four panels:
 *
 *  1. Zones — one row per wall: live power state (seeded 'active' from the walls fetch,
 *     then kept current by `display_power` WS frames — both the on-connect replay and
 *     live transitions ride the same frame shape, so no special-casing is needed), a
 *     live agent-connection count, and Wake/Sleep/"Wake all" buttons that POST
 *     `/api/presence/state` (admin override, independent of any motion wake).
 *  2. Display power — per-wall `screensaverAfterMinutes`/`offAfterMinutes`/`cameraMotion`,
 *     writing the exact same `WallConfig.displayPower` shape the wall editor writes (same
 *     blank-input-means-null semantics, same real `wallConfigSchema` validation via
 *     `wallEditorConfig.ts` — see `saveDisplayPower` below).
 *
 * Panels 3 (motion sources table) and 4 (webhook & agent) are Task 5's job — this page
 * intentionally renders only a two-panel list rather than scaffolding empty stubs for them.
 *
 * Live frames ride the SAME public `/ws` feed every other admin page's live data uses
 * (see DashboardPage.tsx's `useTapStates` for the precedent) — `useTapStates([], ...)`
 * opens that socket purely for its `onMessage` escape hatch; the taps/stale/connected
 * fields it also returns aren't needed here and are ignored.
 */
export function PresencePage() {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [wallsLoaded, setWallsLoaded] = useState(false);
  const [zoneStates, setZoneStates] = useState<Record<string, PowerStage>>({});
  const [agentsBySlug, setAgentsBySlug] = useState<Record<string, number>>({});
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [dpForm, setDpForm] = useState<Record<number, DpFields>>({});
  const [dpErrors, setDpErrors] = useState<Record<number, string[] | null>>({});

  useEffect(() => {
    let cancelled = false;
    listWalls().then((result) => {
      if (cancelled || !result.ok) return;
      setWalls(result.data);
      setWallsLoaded(true);
      // Seed only slugs not already known — a `display_power` frame (including the
      // socket's own on-connect replay) can resolve before this fetch does, and that
      // live-known state must win over the 'active' default, never be clobbered by it.
      setZoneStates((prev) => {
        const next = { ...prev };
        for (const wall of result.data) {
          if (!(wall.slug in next)) next[wall.slug] = 'active';
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getPresenceSources().then((result) => {
        if (cancelled || !result.ok) return;
        const next: Record<string, number> = {};
        for (const agent of result.data.agents) next[agent.wall] = agent.connections;
        setAgentsBySlug(next);
      });
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleWsMessage = useCallback((msg: unknown) => {
    if (!isDisplayPowerMessage(msg)) return;
    setZoneStates((prev) => ({ ...prev, [msg.wallSlug]: msg.state }));
  }, []);
  useTapStates([], { onMessage: handleWsMessage });

  async function handleSetState(wall: string | undefined, state: PowerStage) {
    const result = await setPresenceState(wall, state);
    setZoneError(result.ok ? null : result.message);
  }

  function updateDpField<K extends keyof DpFields>(wall: Wall, key: K, value: DpFields[K]) {
    setDpForm((prev) => {
      const base = prev[wall.id] ?? dpFieldsFromWall(wall);
      return { ...prev, [wall.id]: { ...base, [key]: value } };
    });
  }

  async function saveDisplayPower(wall: Wall) {
    const fields = dpForm[wall.id] ?? dpFieldsFromWall(wall);
    const baseForm = configToFormState(safeParseWallConfig(wall.config));
    const form: WallConfigFormState = {
      ...baseForm,
      displayPowerScreensaverAfterMinutes: fields.screensaverAfterMinutes,
      displayPowerOffAfterMinutes: fields.offAfterMinutes,
      displayPowerCameraMotion: fields.cameraMotion,
    };
    // Every tapId already on the wall's own pages is by definition valid (it wouldn't be
    // there otherwise) -- passing them straight through as the "still valid" set means
    // `parseWallConfigForm`'s pruning step is a no-op here, without this panel needing to
    // fetch the full tap list just to reconstruct it (this panel never edits pages).
    const validTapIds = form.pages.flatMap((page) => page.tapIds);
    const parsed = parseWallConfigForm(form, validTapIds);
    if (!parsed.ok) {
      setDpErrors((prev) => ({ ...prev, [wall.id]: parsed.errors }));
      return;
    }
    setDpErrors((prev) => ({ ...prev, [wall.id]: null }));
    const result = await updateWall(wall.id, { config: parsed.config });
    if (!result.ok) {
      setDpErrors((prev) => ({ ...prev, [wall.id]: [result.message] }));
      return;
    }
    setWalls((prev) => prev.map((w) => (w.id === result.data.id ? result.data : w)));
  }

  return (
    <div data-testid="presence-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Displays &amp; Presence</h1>
        <p className="admin-page-quiet">
          Zone power state and per-wall display-power timing. Motion sources and the
          webhook/agent setup live here too, once wired up.
        </p>
      </header>

      <div className="presence-panels">
        <section className="dashboard-card presence-panel" data-testid="presence-panel-zones">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">ZONES</h2>
            <button type="button" data-testid="zone-wake-all" onClick={() => { void handleSetState(undefined, 'active'); }}>
              Wake all
            </button>
          </div>
          {zoneError && <p className="admin-page-quiet" role="alert" data-testid="zone-error">{zoneError}</p>}
          {wallsLoaded && walls.length === 0 ? (
            <p className="admin-page-quiet" data-testid="zones-empty">No walls set up yet.</p>
          ) : (
            <table className="admin-table" data-testid="zones-table">
              <thead>
                <tr>
                  <th scope="col">Wall</th>
                  <th scope="col">State</th>
                  <th scope="col">Agents</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {walls.map((wall) => {
                  const state = zoneStates[wall.slug] ?? 'active';
                  const agents = agentsBySlug[wall.slug] ?? 0;
                  return (
                    <tr key={wall.slug} data-testid={`zone-row-${wall.slug}`}>
                      <td>{wall.name}</td>
                      <td className="font-tabular" data-testid={`zone-state-${wall.slug}`}>
                        {POWER_STAGE_LABEL[state]}
                      </td>
                      <td data-testid={`zone-agents-${wall.slug}`}>{agentsLabel(agents)}</td>
                      <td>
                        <button
                          type="button"
                          data-testid={`zone-wake-${wall.slug}`}
                          onClick={() => { void handleSetState(wall.slug, 'active'); }}
                        >
                          Wake
                        </button>
                        <button
                          type="button"
                          data-testid={`zone-sleep-${wall.slug}`}
                          onClick={() => { void handleSetState(wall.slug, 'off'); }}
                        >
                          Sleep
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashboard-card presence-panel" data-testid="presence-panel-display-power">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">DISPLAY POWER</h2>
          </div>
          {wallsLoaded && walls.length === 0 ? (
            <p className="admin-page-quiet" data-testid="display-power-empty">No walls set up yet.</p>
          ) : (
            <table className="admin-table" data-testid="display-power-table">
              <thead>
                <tr>
                  <th scope="col">Wall</th>
                  <th scope="col">Screensaver after (min)</th>
                  <th scope="col">Off after (min)</th>
                  <th scope="col">Camera motion</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {walls.map((wall) => {
                  const fields = dpForm[wall.id] ?? dpFieldsFromWall(wall);
                  const errors = dpErrors[wall.id];
                  return (
                    <tr key={wall.slug} data-testid={`dp-row-${wall.slug}`}>
                      <td>{wall.name}</td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          data-testid={`dp-saver-${wall.slug}`}
                          value={fields.screensaverAfterMinutes ?? ''}
                          onChange={(e) => updateDpField(
                            wall,
                            'screensaverAfterMinutes',
                            e.target.value === '' ? null : Number(e.target.value),
                          )}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={2}
                          data-testid={`dp-off-${wall.slug}`}
                          value={fields.offAfterMinutes ?? ''}
                          onChange={(e) => updateDpField(
                            wall,
                            'offAfterMinutes',
                            e.target.value === '' ? null : Number(e.target.value),
                          )}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          data-testid={`dp-camera-${wall.slug}`}
                          checked={fields.cameraMotion}
                          onChange={(e) => updateDpField(wall, 'cameraMotion', e.target.checked)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          data-testid={`dp-save-${wall.slug}`}
                          onClick={() => { void saveDisplayPower(wall); }}
                        >
                          Save
                        </button>
                        {errors && (
                          <ul className="wall-editor__errors" role="alert" data-testid={`dp-errors-${wall.slug}`}>
                            {errors.map((err) => <li key={err}>{err}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

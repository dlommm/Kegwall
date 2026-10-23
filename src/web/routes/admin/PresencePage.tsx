import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPresenceSource, deletePresenceSource, getPresenceSources, getSettings, getWall,
  listWalls, patchSettings, setPresenceState, updatePresenceSource, updateWall,
  type PresenceSourcesResponse, type Wall,
} from '../../lib/adminApi';
import { isDisplayPowerMessage, type PowerStage } from '../../lib/displayPower';
import { useTapStates } from '../../lib/useTapStates';
import { usePolledFetch } from '../../lib/usePolledFetch';
import {
  configToFormState, parseWallConfigForm, safeParseWallConfig, type WallConfigFormState,
} from '../../lib/wallEditorConfig';
import { capitalize, countWord, listJoin } from '../../lib/tonightAttention';
import type { MotionSource } from '../../../server/db/settings.js';
import {
  BLINK_MS, POLL_INTERVAL_MS, blankSourceForm, buildSourceConfig, dpFieldsFromWall,
  effectiveSourceName, isMotionMessage, sourceFormFrom, validateSourceForm,
  type DpFields, type SourceFormState, type SourceRow,
} from './presence/presenceModel';
import {
  DisplayPowerPanel, SourcesPanel, WebhookPanel, ZonesPanel,
} from './presence/PresencePanels';
import { SourceForm } from './presence/SourceForm';
import { PageTemplate } from './PageTemplate';
import { ConfirmDialog } from './ui';

export { parseEqualsInput } from './presence/presenceModel';

/** "Two zones, all awake." / "Two zones. Patio is asleep." */
function presenceHeadline(walls: Wall[], states: Record<string, PowerStage>): string {
  if (walls.length === 0) return 'No zones yet.';
  const lead = walls.length === 1 ? 'One zone' : `${capitalize(countWord(walls.length))} zones`;
  const resting = walls.filter((w) => (states[w.slug] ?? 'active') !== 'active');
  if (resting.length === 0) return `${lead}, all awake.`;
  if (resting.length === walls.length) return `${lead}, all resting.`;
  const names = listJoin(resting.map((w) => w.name));
  return `${lead}. ${names} ${resting.length === 1 ? 'is' : 'are'} resting.`;
}

/**
 * `/admin/presence` — Presence (spec 2026-08-01 Part B; on the V2 page template in M9), four
 * sections (presence/PresencePanels.tsx):
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
 *  3. Motion sources — every configured `motionSources` entry (registry snapshot) plus
 *     every derived tablet-camera row, in one table: health dot, "last motion N min ago"
 *     (or "never"), and a live blink (`data-blink="true"` for `BLINK_MS`) on a matching WS
 *     `motion` frame. An add/edit modal switches its visible field set by `type` and
 *     validates client-side before ever calling the api (`validateSourceForm`); a camera
 *     row has no modal (it's derived from wall config, not a stored entry) — just a toggle
 *     that writes straight through to that wall's `displayPower.cameraMotion`, same field
 *     the Display power panel's `dp-camera-<slug>` checkbox edits (two doors to the same
 *     value, matching the spec's own "both doors stay" call for that field). Delete goes
 *     through an `.admin-confirm` confirmation dialog (same shell WallsPage/TapsPage/
 *     BeersPage use), per the spec's explicit "delete with confirm". A webhook-type row
 *     shows its own attributed copy-paste URL AND its own HA snippet
 *     (`ha-snippet-<id>`, `&source=<id>` baked in) in an expandable `<details>`.
 *  4. Webhook & agent — the presence webhook token's masked display + Generate button
 *     (MOVED here from SettingsPage's Integrations card, not duplicated — see
 *     SettingsPage.tsx's now-pointer-only `PresenceBlock`), the base copy-paste webhook
 *     URL, and a FALLBACK HA snippet (`ha-snippet`, unattributed base URL) shown only
 *     while there isn't yet a webhook-type source to attribute to — once one exists, its
 *     own row's `ha-snippet-<id>` above is the promoted path (per-source health/last-
 *     motion attribution an unattributed URL can't give an HA integrator).
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

  // --- Task 5: motion sources -----------------------------------------------------------
  const [sources, setSources] = useState<PresenceSourcesResponse['sources']>([]);
  const [cameraRows, setCameraRows] = useState<PresenceSourcesResponse['camera']>([]);
  const [blinking, setBlinking] = useState<Record<string, boolean>>({});
  // Per-row blink-clear timers, keyed by the SAME `id` as `blinking` — a ref (not state)
  // since these are pure bookkeeping for `setTimeout`/`clearTimeout` and never rendered.
  const blinkTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [sourceForm, setSourceForm] = useState<SourceFormState | null>(null);
  const [sourceFormSubmitting, setSourceFormSubmitting] = useState(false);
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [sourcesActionError, setSourcesActionError] = useState<string | null>(null);
  // Review fix F1: delete goes through a confirm dialog (same `.admin-confirm` shell as
  // WallsPage's `deleteState` — see that page's doc comment for the pattern this mirrors)
  // instead of firing straight from the row button.
  const [deleteState, setDeleteState] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Task 5: webhook & agent panel -----------------------------------------------------
  // `webhookToken` is whatever `GET`/`PATCH /api/settings` last returned — ALWAYS the
  // masked '••••'+last4 display form (`presenceWebhookToken` ∈ SECRET_KEYS, db/settings.ts's
  // `SettingsStore.masked()`), used only for the "Webhook token" field's own display.
  // `freshToken` (final-review C1) is the SEPARATE, real raw value this tab put in hand
  // itself via `crypto.randomUUID()` the moment `handleGenerateToken` PATCHes it — the
  // server never echoes a real secret back, so this is the ONLY way this page can ever
  // know a real, copy-paste-able token; it's `null` on every fresh page load (including
  // right after a real token was generated in a DIFFERENT tab/session) until this tab's
  // own Generate button is clicked.
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

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

  usePolledFetch((isCancelled) => {
    getPresenceSources().then((result) => {
      if (isCancelled() || !result.ok) return;
      const next: Record<string, number> = {};
      for (const agent of result.data.agents) next[agent.wall] = agent.connections;
      setAgentsBySlug(next);
      // Task 5: the SAME response's sources/camera arrays feed the Sources panel — one
      // poll, three pieces of state, rather than a second fetch of an endpoint that
      // already returns everything this page needs.
      setSources(result.data.sources);
      setCameraRows(result.data.camera);
    });
  }, { intervalMs: POLL_INTERVAL_MS });

  // Task 5: the presence webhook token (Webhook & agent panel) — fetched once on mount,
  // same masked value `GET /api/settings` always returns (see db/settings.ts's
  // `SettingsStore.masked()`); `handleGenerateToken` below refreshes it after a Generate.
  useEffect(() => {
    let cancelled = false;
    getSettings().then((result) => {
      if (!cancelled && result.ok) setWebhookToken(result.data.presenceWebhookToken);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Blink timers are plain `setTimeout`s tracked in a ref (see `blinkTimers` above) —
  // clear every pending one on unmount so a fake-timer-free real browser session never
  // fires a `setBlinking` call against an unmounted page.
  useEffect(() => () => {
    for (const timer of blinkTimers.current.values()) clearTimeout(timer);
  }, []);

  /** Re-fetches sources/camera/agents immediately after a create/update/delete/toggle —
   * the CRUD handlers below all call this rather than waiting for the next
   * `POLL_INTERVAL_MS` tick, so the table reflects a just-saved change right away. */
  function refreshSources() {
    getPresenceSources().then((result) => {
      if (!result.ok) return;
      const next: Record<string, number> = {};
      for (const agent of result.data.agents) next[agent.wall] = agent.connections;
      setAgentsBySlug(next);
      setSources(result.data.sources);
      setCameraRows(result.data.camera);
    });
  }

  /** Marks `id` as blinking (`data-blink="true"`) for `BLINK_MS`, restarting the clock if
   * it's already blinking (a second motion frame while the first blink is still fading
   * extends it, rather than the two timers racing to clear it early). */
  function blinkSource(id: string) {
    setBlinking((prev) => ({ ...prev, [id]: true }));
    const existing = blinkTimers.current.get(id);
    if (existing) clearTimeout(existing);
    blinkTimers.current.set(id, setTimeout(() => {
      setBlinking((prev) => ({ ...prev, [id]: false }));
      blinkTimers.current.delete(id);
    }, BLINK_MS));
  }

  const handleWsMessage = useCallback((msg: unknown) => {
    if (isDisplayPowerMessage(msg)) {
      setZoneStates((prev) => ({ ...prev, [msg.wallSlug]: msg.state }));
      return;
    }
    if (isMotionMessage(msg) && msg.sourceId) {
      blinkSource(msg.sourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `blinkSource` only closes
    // over stable setState setters + the `blinkTimers` ref (never a per-render value), so
    // it's safe to call from this `[]`-deps callback regardless of render vintage.
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
    // Stale-base fix: `wall` comes from the `walls` state fetched once at mount, but
    // this write rebuilds and PATCHes the ENTIRE WallConfig -- an admin who left this
    // page open for an hour would otherwise resurrect the mount-time value of every
    // OTHER config field (look, theme, pages, ticker, ...) a colleague changed in
    // WallEditor since, wholesale. Re-fetch the wall's CURRENT config immediately
    // before building the PATCH and layer ONLY the three displayPower fields this
    // panel owns on top of it.
    const fresh = await getWall(wall.id);
    if (!fresh.ok) {
      setDpErrors((prev) => ({ ...prev, [wall.id]: [fresh.message] }));
      return;
    }
    const baseForm = configToFormState(safeParseWallConfig(fresh.data.config));
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

  // --- Task 5: motion-sources add/edit/delete --------------------------------------------

  function openAddSource() {
    setSourceFormError(null);
    setSourceForm(blankSourceForm());
  }

  function openEditSource(source: MotionSource) {
    setSourceFormError(null);
    setSourceForm(sourceFormFrom(source));
  }

  function closeSourceForm() {
    setSourceForm(null);
    setSourceFormError(null);
  }

  async function saveSource() {
    if (!sourceForm) return;
    const validationError = validateSourceForm(sourceForm);
    if (validationError) {
      setSourceFormError(validationError);
      return;
    }
    setSourceFormSubmitting(true);
    setSourceFormError(null);
    const body = {
      name: effectiveSourceName(sourceForm),
      type: sourceForm.type,
      enabled: sourceForm.enabled,
      wallSlug: sourceForm.wallSlug === '' ? null : sourceForm.wallSlug,
      config: buildSourceConfig(sourceForm),
    };
    const result = sourceForm.id
      ? await updatePresenceSource(sourceForm.id, body)
      : await createPresenceSource(body);
    setSourceFormSubmitting(false);
    if (!result.ok) {
      setSourceFormError(result.message);
      return;
    }
    setSourceForm(null);
    refreshSources();
  }

  /** Opens the delete confirm dialog (review fix F1) — the row's Delete button calls
   * this instead of deleting directly; only `handleConfirmDeleteSource` below actually
   * calls the api. */
  function requestDeleteSource(source: MotionSource) {
    setDeleteState({ id: source.id, name: source.name, error: null });
  }

  async function handleConfirmDeleteSource() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deletePresenceSource(deleteState.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteState({ ...deleteState, error: result.message });
      return;
    }
    setDeleteState(null);
    refreshSources();
  }

  /** The Sources panel's camera-row toggle — writes straight through to that wall's
   * `displayPower.cameraMotion` (the SAME field/write path the Display power panel's
   * `dp-camera-<slug>` checkbox edits via `saveDisplayPower`, just applied immediately
   * instead of staged behind that panel's own Save button — see this component's doc
   * comment for why both doors are intentional). A camera row only ever appears here
   * while its wall's `cameraMotion` is on (see routes/presence.ts's derivation), so this
   * toggle only ever needs to turn it OFF. */
  async function toggleCameraMotion(wallSlug: string, enabled: boolean) {
    const wall = walls.find((w) => w.slug === wallSlug);
    if (!wall) return;
    setSourcesActionError(null);
    // Stale-base fix -- same re-fetch-before-write as saveDisplayPower above: this
    // toggle also rebuilds and PATCHes the ENTIRE config, so it must base on the
    // server's current config, not the mount-time `walls` snapshot, or it silently
    // reverts concurrent WallEditor edits. Only `cameraMotion` (the one field this
    // toggle owns) is layered on top of the fresh config.
    const fresh = await getWall(wall.id);
    if (!fresh.ok) {
      setSourcesActionError(fresh.message);
      return;
    }
    const nextConfig = configToFormState(safeParseWallConfig(fresh.data.config));
    nextConfig.displayPowerCameraMotion = enabled;
    const validTapIds = nextConfig.pages.flatMap((page) => page.tapIds);
    const parsed = parseWallConfigForm(nextConfig, validTapIds);
    if (!parsed.ok) {
      setSourcesActionError(parsed.errors.join(', '));
      return;
    }
    const result = await updateWall(wall.id, { config: parsed.config });
    if (!result.ok) {
      setSourcesActionError(result.message);
      return;
    }
    setWalls((prev) => prev.map((w) => (w.id === result.data.id ? result.data : w)));
    refreshSources();
  }

  // --- Task 5: webhook & agent panel -------------------------------------------------------

  /** Final-review C1: generates the token CLIENT-SIDE first (`crypto.randomUUID()`) so
   * the real value is in hand before the PATCH ever goes out — `patchSettings`'s response
   * is still used for the "Webhook token" masked DISPLAY field (that's the real,
   * server-confirmed masked form), but the raw value used to build working copy-paste
   * URLs comes from `freshToken`, set to the locally-generated UUID, never from the
   * response (which is masked, per `SettingsStore.masked()` — see this component's doc
   * comment on `freshToken` above). */
  async function handleGenerateToken() {
    setTokenError(null);
    setTokenSubmitting(true);
    const token = crypto.randomUUID();
    const result = await patchSettings({ presenceWebhookToken: token });
    setTokenSubmitting(false);
    if (!result.ok) {
      setTokenError(result.message);
      return;
    }
    setWebhookToken(result.data.presenceWebhookToken);
    setFreshToken(token);
  }

  /** Final-review C1/M7: shown in place of a real token in every copy-paste URL/snippet
   * below whenever `freshToken` is unknown — this tab has EITHER never generated a token
   * (so it only ever saw settings' masked '••••'+last4 form, if any token exists at all)
   * OR no token has ever been set. Interpolating the masked form (or an empty string,
   * M7's original bug) would either look plausible-but-401 or silently produce a bare
   * `token=` — a literal, obviously-not-real placeholder is honest about "you don't have
   * the real value to paste here yet" either way. */
  const TOKEN_PLACEHOLDER = '<token>';

  /** Whether every URL/snippet below can render a REAL, working token — false any time
   * this tab hasn't itself generated one this session (see `freshToken`'s doc comment). */
  const hasFreshToken = freshToken !== null;

  /** The full copy-paste webhook URL — `sourceId` omitted gives the generic base URL
   * (Webhook & agent panel), present gives that source's attributed URL (a `webhook`-type
   * row in the Sources table) so `POST`s to it stamp that specific source's
   * `lastTriggeredAt` (routes/presence.ts's `?source=` handling). Built by hand (not
   * `URLSearchParams`) specifically so the `freshToken === null` branch's
   * `TOKEN_PLACEHOLDER` renders as the literal text `<token>` rather than being
   * percent-encoded into `%3Ctoken%3E`. */
  function webhookUrl(sourceId?: string): string {
    // Narrows on `freshToken !== null` directly (not the `hasFreshToken` boolean above) so
    // TypeScript can actually see `freshToken` is a `string` on the `encodeURIComponent`
    // branch.
    const tokenPart = `token=${freshToken !== null ? encodeURIComponent(freshToken) : TOKEN_PLACEHOLDER}`;
    const sourcePart = sourceId ? `&source=${encodeURIComponent(sourceId)}` : '';
    return `${window.location.origin}/api/presence/motion?${tokenPart}${sourcePart}`;
  }

  const sourceRows: SourceRow[] = [
    ...sources.map((s): SourceRow => ({ id: s.source.id, kind: 'source', source: s.source, status: s.status })),
    ...cameraRows.map((c): SourceRow => ({ id: `camera:${c.wallSlug}`, kind: 'camera', ...c })),
  ];

  // Review fix F2: whether the panel-level fallback `ha-snippet` should render at all —
  // once a real webhook-type source exists, its own row's `ha-snippet-<id>` is the
  // promoted, attributed path.
  const hasWebhookSource = sources.some((s) => s.source.type === 'webhook');

  return (
    <PageTemplate
      testId="presence-page"
      title={wallsLoaded ? presenceHeadline(walls, zoneStates) : 'Presence'}
      sub="Screens rest after a quiet spell and wake when someone walks in or pours."
      drawer={(
        <>
          {sourceForm && (
            <SourceForm
              form={sourceForm}
              onChange={setSourceForm}
              walls={walls}
              submitting={sourceFormSubmitting}
              error={sourceFormError}
              onSave={() => { void saveSource(); }}
              onClose={closeSourceForm}
            />
          )}
          <ConfirmDialog
            open={deleteState !== null}
            onOpenChange={(open) => { if (!open) setDeleteState(null); }}
            title="Delete this motion source?"
            confirmLabel="Delete"
            busyLabel="Deleting…"
            busy={deleting}
            error={deleteState?.error}
            onConfirm={() => { void handleConfirmDeleteSource(); }}
            testId="source-delete-confirm-backdrop"
            confirmTestId="source-delete-confirm"
            cancelTestId="source-delete-cancel"
            errorTestId="source-delete-error"
          >
            {deleteState && (
              <p>
                {`This permanently deletes “${deleteState.name}”. Whatever it listens to (MQTT, GPIO or Bluetooth) stops waking screens at once. This can’t be undone.`}
              </p>
            )}
          </ConfirmDialog>
        </>
      )}
    >
      <ZonesPanel
        walls={walls}
        wallsLoaded={wallsLoaded}
        zoneStates={zoneStates}
        agentsBySlug={agentsBySlug}
        error={zoneError}
        onSetState={(wall, state) => { void handleSetState(wall, state); }}
      />
      <DisplayPowerPanel
        walls={walls}
        wallsLoaded={wallsLoaded}
        fieldsFor={(wall) => dpForm[wall.id] ?? dpFieldsFromWall(wall)}
        errors={dpErrors}
        onChange={updateDpField}
        onSave={(wall) => { void saveDisplayPower(wall); }}
      />
      <SourcesPanel
        rows={sourceRows}
        walls={walls}
        blinking={blinking}
        error={sourcesActionError}
        hasFreshToken={hasFreshToken}
        webhookUrl={webhookUrl}
        onAdd={openAddSource}
        onEdit={openEditSource}
        onDelete={requestDeleteSource}
        onToggleCamera={(slug, enabled) => { void toggleCameraMotion(slug, enabled); }}
      />
      <WebhookPanel
        token={webhookToken}
        hasFreshToken={hasFreshToken}
        hasWebhookSource={hasWebhookSource}
        submitting={tokenSubmitting}
        error={tokenError}
        webhookUrl={webhookUrl}
        onGenerate={() => { void handleGenerateToken(); }}
      />
    </PageTemplate>
  );
}

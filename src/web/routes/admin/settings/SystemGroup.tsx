import { useEffect, useState } from 'react';
import {
  getSystemVersion, checkForUpdates, triggerUpdate, pollSystemVersion,
  pollUpdateStatus, triggerOsUpdate, triggerKioskRestart, testPour,
  type UpdateCheck,
} from '../../../lib/adminApi';
import type { GroupProps } from './shared';
import { MaskedSecretField, useMaskedSecret } from './MaskedSecretField';
import { Switch } from '../ui';
import { useSettingsGroupForm } from './useSettingsGroupForm';

/** Update-in-progress state machine — see the block comment in `SystemGroup`. */
type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'triggering' }
  | { phase: 'waiting'; startedVersion: string; deadline: number }
  | { phase: 'success'; newVersion: string }
  | { phase: 'timedOut' }
  | { phase: 'failed'; message: string };

const UPDATE_POLL_MS = 3_000;

/** Human labels for the native updater's phase file (kegwall-update.sh writes
 * fetching/installing/building/restarting; anything else falls back to generic). */
const UPDATE_PHASE_LABELS: Record<string, string> = {
  fetching: 'downloading the release',
  installing: 'installing dependencies (the long step)',
  building: 'building the interface',
  restarting: 'restarting the server',
};
const UPDATE_DEADLINE_MS = 5 * 60_000;

/**
 * Settings → System: the in-app update card. One form holds both the update-mode
 * config (off / Watchtower / native — see routes/system.ts for what each does) and
 * the check/apply actions, so the "don't update while the config draft is dirty"
 * gate needs no cross-component plumbing.
 *
 * The apply flow is an inline two-step confirm (click → "Confirm — restarts
 * briefly" → click), deliberately NOT BackupPanel's typed-word gate: restore
 * destroys data irreversibly and earned that friction; an update is non-destructive.
 * After a 202 the server is expected to DIE mid-update, so progress is watched by
 * polling the version endpoint raw (`pollSystemVersion` — request()'s 401 redirect
 * would eject the admin mid-restart) until the reported version CHANGES, with a
 * 5-minute deadline. A page reload during the wait intentionally forgets the state —
 * the admin just sees the new version in the sidebar footer.
 */
export function SystemGroup({ settings, onSaved }: GroupProps) {
  const cfg = settings.updates;
  const [mode, setMode] = useState<'off' | 'watchtower' | 'native'>(cfg?.mode ?? 'off');
  const [url, setUrl] = useState(cfg?.watchtowerUrl ?? '');
  const token = useMaskedSecret();

  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<{ state: 'idle' } | { state: 'running' } | { state: 'done'; result: UpdateCheck }>({ state: 'idle' });
  const [update, setUpdate] = useState<UpdatePhase>({ phase: 'idle' });
  // The native updater's current phase (update-status file), shown inside the
  // updating banner; null = no info (watchtower, restart window).
  const [updatePhaseDetail, setUpdatePhaseDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSystemVersion().then((result) => {
      if (!cancelled && result.ok) setVersion(result.data.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The waiting poller: every 3s, raw-fetch the version; null (server down mid-swap)
  // is expected and ignored; a CHANGED version is success; the deadline trips the
  // timed-out warning. Alongside it, the native updater's phase file
  // (GET /api/system/update-status) feeds the live progress line — null there just
  // means "no phase info" (watchtower mode, restart window, older installer).
  useEffect(() => {
    if (update.phase !== 'waiting') return undefined;
    // Captured once per waiting-state entry — the waiting object is stable for the
    // whole wait (it's only replaced on a phase transition, which re-runs this effect
    // and clears the interval). Reading these here instead of inside a setUpdate
    // updater keeps the updaters below PURE, as React 19 requires — calling
    // setVersion from within an updater function is a side effect React may replay
    // (e.g. StrictMode double-invokes updaters).
    const { startedVersion, deadline } = update;
    const timer = setInterval(() => {
      void pollUpdateStatus().then((phase) => {
        setUpdatePhaseDetail(phase);
      });
      void pollSystemVersion().then((v) => {
        // The `u.phase === 'waiting'` guards keep a late-resolving in-flight poll
        // (the interval is cleared, but its last promise may still settle) from
        // stomping a state the UI already moved past.
        if (v && v !== startedVersion) {
          setVersion(v);
          setUpdate((u) => (u.phase === 'waiting' ? { phase: 'success', newVersion: v } : u));
        } else if (Date.now() > deadline) {
          setUpdate((u) => (u.phase === 'waiting' ? { phase: 'timedOut' } : u));
        }
      });
    }, UPDATE_POLL_MS);
    return () => clearInterval(timer);
  }, [update]);

  const dirty = mode !== (cfg?.mode ?? 'off')
    || (mode === 'watchtower' && url.trim() !== (cfg?.watchtowerUrl ?? ''))
    || token.dirty;
  const busy = update.phase === 'triggering' || update.phase === 'waiting';
  const savedMode = cfg?.mode ?? 'off';
  const canUpdate = savedMode !== 'off' && !dirty && !busy;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    // The "don't save while an update is being triggered/applied" gate.
    blocked: busy,
    onSaved,
    buildPatch: () => ({
      updates: mode === 'off' ? { mode } : {
        mode,
        ...(mode === 'watchtower' ? {
          watchtowerUrl: url.trim() || undefined,
          // A still-masked token round-trips through sanitizePatch's swap-back.
          watchtowerToken: token.newValue ?? cfg?.watchtowerToken,
        } : {}),
      },
    }),
    onSuccess: token.reset,
  });

  async function runCheck() {
    setCheck({ state: 'running' });
    const result = await checkForUpdates();
    setCheck({
      state: 'done',
      result: result.ok ? result.data : { ok: false, current: version ?? '?', message: result.message },
    });
  }

  async function runUpdate() {
    setUpdatePhaseDetail(null);
    setUpdate({ phase: 'triggering' });
    const startedVersion = version ?? '0.0.0';
    const result = await triggerUpdate(
      check.state === 'done' && check.result.ok ? check.result.latest : undefined,
    );
    if (!result.ok) {
      setUpdate({ phase: 'failed', message: result.message });
      return;
    }
    setUpdate({ phase: 'waiting', startedVersion, deadline: Date.now() + UPDATE_DEADLINE_MS });
  }

  return (
    <section className="settings-group" data-testid="settings-group-system">
      <h2 className="settings-group__title font-display">System</h2>

      <form className="channels-group__block" data-testid="settings-system-updates" onSubmit={handleSubmit}>
        <h3 className="channels-group__block-title">Software update</h3>
        <p className="admin-page-quiet">
          Current version: <span className="font-tabular" data-testid="settings-system-version">{version ? `v${version}` : '…'}</span>
        </p>
        <label className="admin-field">
          <span>Update mode</span>
          <select
            className="adm-select"
            data-testid="settings-system-mode"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as 'off' | 'watchtower' | 'native')}
          >
            <option value="off">Off (update manually)</option>
            <option value="watchtower">Docker — Watchtower sidecar</option>
            <option value="native">Bare metal — Pi installer</option>
          </select>
        </label>
        {mode === 'watchtower' && (
          <>
            <label className="admin-field">
              <span>Watchtower URL</span>
              <input
                type="text"
                data-testid="settings-system-watchtower-url"
                placeholder="http://127.0.0.1:8090"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <MaskedSecretField
              label="Watchtower API token (must match WATCHTOWER_HTTP_API_TOKEN in your compose file)"
              testId="settings-system-watchtower-token"
              maskedValue={cfg?.watchtowerToken}
              {...token.fieldProps}
            />
          </>
        )}
        {mode === 'native' && (
          <p className="admin-page-quiet">
            Requires the Pi installer&rsquo;s updater units (scripts/pi-install.sh) — the
            update runs in the background and restarts the server when done.
          </p>
        )}
        {error && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-error">{error}</p>
        )}
        <button
          type="submit"
          className="beer-form__submit"
          data-dirty={dirty || undefined}
          disabled={!dirty || submitting || busy}
          data-testid="settings-system-save"
        >
          {submitting ? 'Saving…' : 'Save changes'}
        </button>

        <h3 className="channels-group__block-title">Check &amp; apply</h3>
        <div className="settings-actions">
          <button
            type="button"
            data-testid="settings-system-check"
            disabled={check.state === 'running' || busy}
            onClick={runCheck}
          >
            {check.state === 'running' ? 'Checking…' : 'Check for updates'}
          </button>
          {update.phase === 'confirming' ? (
            <button
              type="button"
              data-testid="settings-system-update-confirm"
              onClick={runUpdate}
            >
              Confirm — server will restart briefly
            </button>
          ) : (
            <button
              type="button"
              data-testid="settings-system-update"
              disabled={!canUpdate}
              onClick={() => setUpdate({ phase: 'confirming' })}
            >
              Update now
            </button>
          )}
        </div>
        {check.state === 'done' && (
          <p className="admin-page-quiet" data-testid="settings-system-check-result">
            {check.result.ok
              ? check.result.updateAvailable
                ? (
                  <>
                    v{check.result.latest} available —{' '}
                    <a href={check.result.notesUrl} target="_blank" rel="noreferrer">Release notes ↗</a>
                  </>
                )
                : `Up to date (v${check.result.current})`
              : check.result.message}
          </p>
        )}
        {savedMode === 'off' && (
          <p className="admin-page-quiet" data-testid="settings-system-off-hint">
            Pick an update mode above (and save) to enable one-click updates.
          </p>
        )}
        {update.phase === 'waiting' && (
          <p className="beer-form__notice" data-testid="settings-system-updating">
            {updatePhaseDetail?.startsWith('failed')
              ? `Update ${updatePhaseDetail}`
              : `Updating — ${UPDATE_PHASE_LABELS[updatePhaseDetail ?? ''] ?? 'working in the background'}…
                 This can take a few minutes on a Pi. Don’t close the tab.`}
          </p>
        )}
        {update.phase === 'success' && (
          <p className="admin-page-quiet" data-testid="settings-system-updated">
            Updated to v{update.newVersion} ✓
          </p>
        )}
        {update.phase === 'timedOut' && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-update-timeout">
            The update didn&rsquo;t finish within 5 minutes — it may still be in progress.
            Check the Connection doctor or your container/journal logs. (Native mode
            requires the Pi installer&rsquo;s updater units.)
          </p>
        )}
        {update.phase === 'failed' && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-update-error">
            {update.message}
          </p>
        )}
      </form>

      {/* OS updates — NATIVE installs only (the trigger-file units only exist there);
          Docker/watchtower admins never see this block. Gated on the SAVED mode so
          merely flipping the select above doesn't flash it in and out. */}
      {savedMode === 'native' && <OsUpdatesBlock settings={settings} onSaved={onSaved} />}
      {savedMode === 'native' && <KioskRestartBlock />}
    </section>
  );
}

/** "Display" block: restart the kiosk chromium (kegwall-kiosk.service) via the
 * trigger-file units — the recovery lever when the TV wedges. Native installs only
 * (gated by the caller, same as OsUpdatesBlock). */
function KioskRestartBlock() {
  const [run, setRun] = useState<
    { state: 'idle' } | { state: 'confirming' } | { state: 'started'; message: string } | { state: 'failed'; message: string }
  >({ state: 'idle' });

  const [testPourMsg, setTestPourMsg] = useState('');

  async function runRestart() {
    const result = await triggerKioskRestart();
    setRun(result.ok
      ? { state: 'started', message: result.data.message }
      : { state: 'failed', message: result.message });
  }

  async function runTestPour() {
    setTestPourMsg('Firing a test pour…');
    const r = await testPour();
    setTestPourMsg(r.ok
      ? `Test pour sent to tap ${r.data.tapId} — the takeover should play on the wall now. If it appears instantly, the live socket is healthy.`
      : `Test pour failed: ${r.message}`);
  }

  return (
    <div className="channels-group__block" data-testid="settings-system-kiosk">
      <h3 className="channels-group__block-title">Display</h3>
      <p className="admin-page-quiet">
        Restarts the kiosk display on this screen (kiosk mode only) — use it if the wall ever looks
        stuck. Works for both the chromium and native (cog/WPE) clients.
      </p>
      <div className="settings-actions">
        {run.state === 'confirming' ? (
          <button
            type="button"
            data-testid="settings-system-kiosk-restart-confirm"
            onClick={runRestart}
          >
            Confirm — the screen goes black for a few seconds
          </button>
        ) : (
          <button
            type="button"
            data-testid="settings-system-kiosk-restart"
            onClick={() => setRun({ state: 'confirming' })}
          >
            Restart kiosk display
          </button>
        )}
      </div>
      {run.state === 'started' && (
        <p className="admin-page-quiet" data-testid="settings-system-kiosk-started">{run.message}</p>
      )}
      <p className="admin-page-quiet" style={{ marginTop: '0.75rem' }}>
        Fire a simulated pour on the live wall to check the takeover animation and that changes
        reach the screen instantly. Nothing is recorded.
      </p>
      <div className="settings-actions">
        <button type="button" data-testid="settings-system-test-pour" onClick={runTestPour}>
          Test pour (live)
        </button>
      </div>
      {testPourMsg && (
        <p className="admin-page-quiet" data-testid="settings-system-test-pour-result">{testPourMsg}</p>
      )}
      {run.state === 'failed' && (
        <p className="beer-form__notice" role="alert" data-testid="settings-system-kiosk-error">
          {run.message}
        </p>
      )}
    </div>
  );
}

/** The "Operating system" block inside SystemGroup: apt-update mode (off / manual /
 * unattended-upgrades) + auto-reboot, and the "Update OS now" trigger with an inline
 * two-step confirm (the software-update idiom above — NOT BackupPanel's typed-word
 * gate, which destructive restore alone has earned). */
function OsUpdatesBlock({ settings, onSaved }: GroupProps) {
  const cfg = settings.osUpdates;
  const [osMode, setOsMode] = useState<'off' | 'manual' | 'auto'>(cfg?.mode ?? 'off');
  const [autoReboot, setAutoReboot] = useState(cfg?.autoReboot ?? false);
  const [run, setRun] = useState<
    { state: 'idle' } | { state: 'confirming' } | { state: 'started'; message: string } | { state: 'failed'; message: string }
  >({ state: 'idle' });

  const savedOsMode = cfg?.mode ?? 'off';
  const dirty = osMode !== savedOsMode || autoReboot !== (cfg?.autoReboot ?? false);

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => ({ osUpdates: { mode: osMode, autoReboot } }),
  });

  async function runOsUpdate() {
    const result = await triggerOsUpdate();
    setRun(result.ok
      ? { state: 'started', message: result.data.message }
      : { state: 'failed', message: result.message });
  }

  return (
    <form className="channels-group__block" data-testid="settings-system-os" onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">Operating system</h3>
      <p className="admin-page-quiet">
        Keeps Raspberry Pi OS itself (apt packages, security fixes) updated — separate
        from Kegwall updates above.
      </p>
      <label className="admin-field">
        <span>OS updates</span>
        <select
          className="adm-select"
          data-testid="settings-system-os-mode"
          value={osMode}
          onChange={(e) => setOsMode(e.target.value as 'off' | 'manual' | 'auto')}
        >
          <option value="off">Off</option>
          <option value="manual">Manual — update from here</option>
          <option value="auto">Automatic — unattended-upgrades</option>
        </select>
      </label>
      {osMode === 'auto' && (
        <p className="admin-page-quiet" data-testid="settings-system-os-auto-hint">
          Automatic mode relies on unattended-upgrades set up by the Pi installer —
          re-run scripts/pi-install.sh (or see the Raspberry Pi docs) if it wasn&rsquo;t
          enabled at install time.
        </p>
      )}
      <Switch className="settings-toggle" data-testid="settings-system-os-autoreboot" checked={autoReboot} onCheckedChange={setAutoReboot} label={<>Reboot automatically when an update requires it</>} />
      {error && (
        <p className="beer-form__notice" role="alert" data-testid="settings-system-os-error">{error}</p>
      )}
      <button
        type="submit"
        className="beer-form__submit"
        data-dirty={dirty || undefined}
          disabled={!dirty || submitting}
        data-testid="settings-system-os-save"
      >
        {submitting ? 'Saving…' : 'Save changes'}
      </button>

      <div className="settings-actions">
        {run.state === 'confirming' ? (
          <button
            type="button"
            data-testid="settings-system-os-update-confirm"
            onClick={runOsUpdate}
          >
            Confirm — apt runs in the background; if a reboot is needed and auto-reboot
            is on, the Pi reboots immediately and the wall goes dark for ~1–2 minutes
          </button>
        ) : (
          <button
            type="button"
            data-testid="settings-system-os-update"
            disabled={savedOsMode === 'off' || dirty}
            onClick={() => setRun({ state: 'confirming' })}
          >
            Update OS now
          </button>
        )}
      </div>
      {run.state === 'started' && (
        <p className="admin-page-quiet" data-testid="settings-system-os-started">{run.message}</p>
      )}
      {run.state === 'failed' && (
        <p className="beer-form__notice" role="alert" data-testid="settings-system-os-run-error">
          {run.message}
        </p>
      )}
    </form>
  );
}

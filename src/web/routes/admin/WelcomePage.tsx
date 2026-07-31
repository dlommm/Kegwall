import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  createWall, getSettings, getSystemUrls, listMonitors, listWalls, patchSettings,
  setWallDevices, type SystemUrls, type Wall,
} from '../../lib/adminApi';
import { groupMonitors } from '../../lib/monitorDevices';
import { ThemeProvider } from '../../themes/ThemeProvider';

/**
 * `/admin/welcome`: the guided first-run wizard, entered right after SetupPage creates
 * the admin account (POST /api/auth/setup sets the session cookie, so this page runs
 * authenticated; adminApi's 401 redirect bounces logged-out visitors to login).
 *
 * Mounted OUTSIDE AdminLayout on purpose — full-screen, chrome-free (admin-auth
 * styling family), because the final screen is a "here are your URLs" handoff that
 * shouldn't fight a sidebar.
 *
 * Deliberately has NO "completed" flag: every step is an idempotent PATCH or a
 * 409-tolerated create, so revisiting the page is harmless (and the dashboard's
 * "finish setting up" hint only appears while no wall exists). Step navigation is an
 * internal state machine (SwapWizard precedent) — no sub-routes, no deep links.
 */

type WizardStep = 'site' | 'kegtron' | 'wall' | 'updates' | 'done';

const STEP_ORDER: WizardStep[] = ['site', 'kegtron', 'wall', 'updates', 'done'];

/** The site pages worth advertising on the final screen, composed client-side from
 * GET /api/system/urls (the endpoint stays dumb — addresses + port only). */
const PAGE_PATHS = [
  { path: '/admin', label: 'Admin' },
  { path: '/wall/main', label: 'Tap wall (TV)' },
  { path: '/menu', label: 'Guest menu' },
  { path: '/tablet/main', label: 'Pour tablet' },
  { path: '/board', label: 'Leaderboard' },
] as const;

export function WelcomePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('site');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [siteName, setSiteName] = useState('');
  const [siteNameLoaded, setSiteNameLoaded] = useState(false);
  const [kegtronKey, setKegtronKey] = useState('');
  const [wall, setWall] = useState<Wall | null>(null);
  const [assignedCount, setAssignedCount] = useState<number | null>(null);
  const [updateMode, setUpdateMode] = useState<'off' | 'watchtower' | 'native'>('off');
  const [urls, setUrls] = useState<SystemUrls | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSettings(), getSystemUrls()]).then(([settingsRes, urlsRes]) => {
      if (cancelled) return;
      if (settingsRes.ok) {
        setSiteName(settingsRes.data.siteName);
        const savedMode = settingsRes.data.updates?.mode;
        if (savedMode) setUpdateMode(savedMode);
        else if (urlsRes.ok && urlsRes.data.install === 'native') setUpdateMode('native');
      }
      if (urlsRes.ok) setUrls(urlsRes.data);
      setSiteNameLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  function goNext() {
    const next = STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
    if (next) setStep(next);
    setError(null);
  }

  function goBack() {
    const prev = STEP_ORDER[STEP_ORDER.indexOf(step) - 1];
    if (prev) setStep(prev);
    setError(null);
  }

  async function submitSite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await patchSettings({ siteName: siteName.trim() || 'Kegwall' });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    goNext();
  }

  async function submitKegtron(e: FormEvent) {
    e.preventDefault();
    if (!kegtronKey.trim()) { goNext(); return; }
    setBusy(true);
    // kegtronApiKey is a SOURCE_RESTART_KEY — sources restart live on save, so cloud
    // discovery can already be running by the wall step.
    const result = await patchSettings({ kegtronApiKey: kegtronKey.trim() });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    goNext();
  }

  async function submitWall() {
    setBusy(true);
    setError(null);
    try {
      const existing = await listWalls();
      if (!existing.ok) { setError(existing.message); return; }
      let target = existing.data[0] ?? null;
      if (!target) {
        const created = await createWall({ slug: 'main', name: siteName.trim() || 'Kegwall' });
        if (created.ok) {
          target = created.data;
        } else {
          // 409 slug conflict = someone else created it between listWalls and now —
          // that IS success for this step; refetch and move on.
          const refetched = await listWalls();
          if (!refetched.ok || !refetched.data[0]) { setError(created.message); return; }
          target = refetched.data[0];
        }
      }
      setWall(target);

      const monitors = await listMonitors();
      if (monitors.ok) {
        const kegtronGroups = groupMonitors(monitors.data)
          .filter((g): g is typeof g & { type: 'kegtron_pro' | 'kegtron_gen1' } =>
            g.type === 'kegtron_pro' || g.type === 'kegtron_gen1');
        if (kegtronGroups.length > 0) {
          const assigned = await setWallDevices(
            target.id,
            kegtronGroups.map((g) => ({ type: g.type, identifier: g.identifier })),
          );
          if (assigned.ok) setAssignedCount(kegtronGroups.length);
        } else {
          setAssignedCount(0);
        }
      }
      goNext();
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdates(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // watchtowerUrl/Token are schema-optional — the wizard only picks the MODE; the
    // token/url details live in Settings → System (linked below) rather than being
    // duplicated here.
    const result = await patchSettings({ updates: { mode: updateMode } });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    goNext();
  }

  if (!siteNameLoaded) return null;

  const stepNumber = STEP_ORDER.indexOf(step) + 1;

  return (
    <ThemeProvider className="admin-auth">
      <main className="admin-auth__page" data-testid="welcome-page">
        <div className="admin-auth__form welcome-wizard" data-testid={`welcome-step-${step}`}>
          <p className="admin-page-quiet welcome-wizard__progress">
            Step {stepNumber} of {STEP_ORDER.length}
          </p>

          {step === 'site' && (
            <form onSubmit={submitSite}>
              <h1 className="admin-auth__title font-display">Welcome to Kegwall</h1>
              <p className="admin-auth__intro">
                Let&rsquo;s get the basics set up — this takes about a minute.
              </p>
              <label className="admin-auth__field">
                <span>What should your taproom be called?</span>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Kegwall"
                  data-testid="welcome-site-name"
                  autoFocus
                />
              </label>
              <button type="submit" className="admin-auth__submit" disabled={busy} data-testid="welcome-next">
                {busy ? 'Saving…' : 'Next'}
              </button>
            </form>
          )}

          {step === 'kegtron' && (
            <form onSubmit={submitKegtron}>
              <h1 className="admin-auth__title font-display">Connect Kegtron</h1>
              <p className="admin-auth__intro">
                Paste your Kegtron cloud API key and your kegs appear automatically.
                You can also do this later in Settings.
              </p>
              <label className="admin-auth__field">
                <span>Kegtron API key (optional)</span>
                <input
                  type="text"
                  value={kegtronKey}
                  onChange={(e) => setKegtronKey(e.target.value)}
                  data-testid="welcome-kegtron-key"
                  autoFocus
                />
              </label>
              <div className="welcome-wizard__actions">
                <button type="button" className="admin-page-quiet welcome-wizard__back" onClick={goBack}>Back</button>
                <button type="submit" className="admin-auth__submit" disabled={busy} data-testid="welcome-next">
                  {busy ? 'Saving…' : kegtronKey.trim() ? 'Next' : 'Skip'}
                </button>
              </div>
            </form>
          )}

          {step === 'wall' && (
            <div>
              <h1 className="admin-auth__title font-display">Your tap wall</h1>
              {wall === null ? (
                <>
                  <p className="admin-auth__intro">
                    Kegwall shows your taps on a full-screen wall — perfect for a TV over
                    the kegerator. We&rsquo;ll create your first wall now.
                  </p>
                  <div className="welcome-wizard__actions">
                    <button type="button" className="admin-page-quiet welcome-wizard__back" onClick={goBack}>Back</button>
                    <button
                      type="button"
                      className="admin-auth__submit"
                      onClick={submitWall}
                      disabled={busy}
                      data-testid="welcome-create-wall"
                    >
                      {busy ? 'Creating…' : 'Create my wall'}
                    </button>
                  </div>
                </>
              ) : null}
              {error && (
                <p className="admin-auth__notice admin-auth__notice--error" role="alert">{error}</p>
              )}
            </div>
          )}

          {step === 'updates' && (
            <form onSubmit={submitUpdates}>
              <h1 className="admin-auth__title font-display">Stay up to date</h1>
              <p className="admin-auth__intro">
                {assignedCount !== null && wall && (
                  assignedCount > 0
                    ? `Wall “${wall.name}” is ready with ${assignedCount} Kegtron device${assignedCount === 1 ? '' : 's'} assigned. `
                    : `Wall “${wall.name}” is ready. Devices appear after your Kegtron first reports in — the server attaches the first one to this wall automatically, or assign them any time in Walls. `
                )}
                How should Kegwall update itself?
              </p>
              <label className="settings-toggle">
                <input
                  type="radio"
                  name="update-mode"
                  checked={updateMode === 'native'}
                  onChange={() => setUpdateMode('native')}
                  data-testid="welcome-updates-native"
                />
                <span>This Pi updates itself (native install)</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="radio"
                  name="update-mode"
                  checked={updateMode === 'watchtower'}
                  onChange={() => setUpdateMode('watchtower')}
                  data-testid="welcome-updates-watchtower"
                />
                <span>Docker with Watchtower (needs the token — finish in Settings → System)</span>
              </label>
              <label className="settings-toggle">
                <input
                  type="radio"
                  name="update-mode"
                  checked={updateMode === 'off'}
                  onChange={() => setUpdateMode('off')}
                  data-testid="welcome-updates-off"
                />
                <span>I&rsquo;ll update manually</span>
              </label>
              {error && (
                <p className="admin-auth__notice admin-auth__notice--error" role="alert">{error}</p>
              )}
              <div className="welcome-wizard__actions">
                <button type="button" className="admin-page-quiet welcome-wizard__back" onClick={goBack}>Back</button>
                <button type="submit" className="admin-auth__submit" disabled={busy} data-testid="welcome-next">
                  {busy ? 'Saving…' : 'Next'}
                </button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div data-testid="welcome-done">
              <h1 className="admin-auth__title font-display">You&rsquo;re all set 🍺</h1>
              <p className="admin-auth__intro">
                Open these from any device on your network:
              </p>
              {urls && (
                <div className="welcome-wizard__urls">
                  {[...urls.addresses.map((a) => ({ addr: a, note: null as string | null })),
                    { addr: `${urls.hostname}.local`, note: 'if your network supports mDNS' }]
                    .map(({ addr, note }) => (
                      <section key={addr} className="welcome-wizard__url-group">
                        <h2 className="admin-field__label-text">
                          http://{addr}:{urls.port}
                          {note && <span className="admin-page-quiet"> ({note})</span>}
                        </h2>
                        <ul>
                          {PAGE_PATHS.map(({ path, label }) => (
                            <li key={path}>
                              <code>{`http://${addr}:${urls.port}${path}`}</code>
                              {' '}<span className="admin-page-quiet">— {label}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                </div>
              )}
              <button
                type="button"
                className="admin-auth__submit"
                onClick={() => navigate('/admin', { replace: true })}
                data-testid="welcome-open-dashboard"
              >
                Open the dashboard →
              </button>
            </div>
          )}

          {step !== 'wall' && step !== 'updates' && error && (
            <p className="admin-auth__notice admin-auth__notice--error" role="alert">{error}</p>
          )}
        </div>
      </main>
    </ThemeProvider>
  );
}

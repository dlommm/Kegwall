import {
  useEffect, useMemo, useState, type FormEvent, type ReactNode,
  type CSSProperties,
} from 'react';
import type { Tap } from '../../../server/db/taps.js';
import type { TapState } from '../../../server/core/state.js';
import {
  listTaps, listMonitors, listDisplays, updateWall, getWallDevices, setWallDevices,
  type Display, type Wall, type WallDeviceRef,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { groupMonitors, type MonitorDeviceGroup } from '../../lib/monitorDevices';
import {
  configToFormState, parseWallConfigForm, safeParseWallConfig, type WallConfigFormState,
} from '../../lib/wallEditorConfig';
import { useWallDraft, WALL_SECTIONS, type WallSectionId } from '../../lib/wallDraft';
import { wallPagesFor } from '../../lib/wallPages';
import { beerColorFor } from '../../wall/wallModel';
import { lookLabel } from '../../lib/wallCatalog';
import { capitalize, countWord, listJoin } from '../../lib/tonightAttention';
import type { VolumeUnits } from '../../lib/units';
import { autoPageSize, resolveLook } from '../../components/looks/WallLook';
import { WallLivePreview, type PreviewMode } from '../../components/WallLivePreview';
import { PageTemplate } from './PageTemplate';
import { Button, Chips, ConfirmDialog, Tabs, tabId } from './ui';
import {
  ColorsSection, ContentSection, CssSection, FitSection, LookSection, PagesSection, RESOLUTIONS,
  RotationSection, TakeoverSection,
} from './screens/WallEditorSections';

export interface WallEditorProps {
  wall: Wall;
  onBack: () => void;
  onSaved: (wall: Wall) => void;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

// Fit / 100% is a per-person viewing preference, never wall config: it doesn't count as an
// edit and never reaches a TV.
const FIT_KEY = 'kegwall:wallEditor:fit';
function loadFit(): 'fit' | 'actual' {
  try {
    return localStorage.getItem(FIT_KEY) === 'actual' ? 'actual' : 'fit';
  } catch {
    return 'fit';
  }
}

/** "Taps 1–11" / "Taps 1, 3 and 5" / "No taps". */
function tapsPhrase(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 0) return 'No taps';
  if (sorted.length === 1) return `Tap ${sorted[0]}`;
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  if (contiguous) return `Taps ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `Taps ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/**
 * The Wall Editor studio (Kegwall V2 M9, blueprint §E.3; closes issue 12). A rail of eight
 * sections with a dot on each changed one, the live 16:9 stage of this wall's real taps (Wall /
 * Live pour / Screensaver, Fit / 100%, page picker), and an inspector for the chosen section.
 * One `useWallDraft` reducer holds saved vs draft, so Discard and the dots come from one
 * comparison. Saving runs the draft through `parseWallConfigForm` (the server's own schema)
 * before `PATCH /api/walls/:id`, then writes the device set; the server pushes the change to
 * every screen showing the wall.
 */
export function WallEditor({ wall, onBack, onSaved }: WallEditorProps) {
  const { draft, dirty, dispatch } = useWallDraft(() => ({
    form: configToFormState(safeParseWallConfig(wall.config)),
    name: wall.name,
    slug: wall.slug,
    devices: [],
  }));
  const { form, name, slug } = draft;
  const [currentWall, setCurrentWall] = useState(wall);
  const [section, setSection] = useState<WallSectionId>('look');
  const [taps, setTaps] = useState<Tap[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [liveTaps, setLiveTaps] = useState<TapState[]>([]);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [servingSizeMl, setServingSizeMl] = useState(473);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<MonitorDeviceGroup[]>([]);
  const [devicesStatus, setDevicesStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [errors, setErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  // The config PATCH went through but the device PUT failed: say exactly that, and keep the
  // device change in the draft so Save retries it.
  const [deviceSaveFailed, setDeviceSaveFailed] = useState(false);
  const [mode, setMode] = useState<PreviewMode>('wall');
  const [fit, setFit] = useState<'fit' | 'actual'>(loadFit);
  const [pageIndex, setPageIndex] = useState(0);
  const [simulateNonce, setSimulateNonce] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(FIT_KEY, fit); } catch { /* storage unavailable: keep it for this visit */ }
  }, [fit]);

  useEffect(() => {
    let cancelled = false;
    listTaps().then((result) => {
      if (cancelled) return;
      if (result.ok) { setTaps(result.data); setTapsStatus('loaded'); } else setTapsStatus('error');
    });
    // The preview draws the wall's real taps from the public snapshot (no owner cost in it).
    getMenu().then((result) => {
      if (cancelled || !result?.ok) return;
      setLiveTaps(result.data.taps);
      setUnits(result.data.units);
      if (result.data.servingSizeMl) setServingSizeMl(result.data.servingSizeMl);
    }).catch(() => { /* the preview falls back to sample beers */ });
    listDisplays().then((result) => {
      if (!cancelled && result?.ok) setDisplays(result.data);
    }).catch(() => { /* the "shown on" line just stays empty */ });
    Promise.all([listMonitors(), getWallDevices(wall.id)]).then(([monitorsRes, devicesRes]) => {
      if (cancelled) return;
      if (monitorsRes.ok && devicesRes.ok) {
        // Govee sensors are monitors too, but they measure rooms, not kegs: never wall-assignable.
        setDeviceGroups(groupMonitors(monitorsRes.data.filter((m) => m.type !== 'govee_sensor')));
        dispatch({ type: 'devicesLoaded', devices: devicesRes.data.map((d) => `${d.type}:${d.identifier}`) });
        setDevicesStatus('loaded');
      } else {
        setDevicesStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [wall.id, dispatch]);

  const selectedDevices = useMemo(() => new Set(draft.devices), [draft.devices]);
  /** The taps this wall may draw from: those bound to the checked monitors' ports. */
  const allowedTapIds = useMemo(() => new Set(
    deviceGroups
      .filter((g) => selectedDevices.has(g.key))
      .flatMap((g) => g.ports.map((p) => p.tapId))
      .filter((id): id is number => id != null),
  ), [deviceGroups, selectedDevices]);
  const allowedTaps = useMemo(() => taps.filter((t) => allowedTapIds.has(t.id)), [taps, allowedTapIds]);

  function patch(p: Partial<WallConfigFormState>) {
    dispatch({ type: 'patch', patch: p });
  }

  function toggleDevice(key: string, checked: boolean) {
    const next = new Set(draft.devices);
    if (checked) next.add(key); else next.delete(key);
    dispatch({ type: 'devices', devices: [...next] });
  }

  // The preview renders the DRAFT. An edit that doesn't validate yet falls back to the last
  // saved config, so the stage never breaks mid-typing.
  const draftParsed = parseWallConfigForm(form, allowedTaps.map((t) => t.id));
  const previewConfig = draftParsed.ok ? draftParsed.config : safeParseWallConfig(currentWall.config);
  const cssErrors = draftParsed.ok ? [] : draftParsed.errors.filter((e) => e.startsWith('customCss'));
  const previewTaps = useMemo(
    () => liveTaps.filter((t) => allowedTapIds.has(t.tapId) && !t.hidden),
    [liveTaps, allowedTapIds],
  );
  const pages = useMemo(
    () => wallPagesFor(previewConfig.pages, previewTaps, autoPageSize(resolveLook(previewConfig.look))),
    [previewConfig.pages, previewConfig.look, previewTaps],
  );
  const shownPage = Math.min(pageIndex, Math.max(0, pages.length - 1));

  const dirtyCount = dirty.size;
  const isDirty = dirtyCount > 0;
  const statusText = deviceSaveFailed
    ? 'Settings saved and sent to the screens, but the device assignment not saved.'
    : isDirty
      ? `Unsaved: ${countWord(dirtyCount)} ${dirtyCount === 1 ? 'section' : 'sections'} changed. The TVs still show the last save.`
      : savedNotice ? 'Saved and sent to the screens.' : 'In sync with the live wall.';

  const shownOn = displays.filter((d) => d.wallId === currentWall.id).map((d) => d.name);
  const resolution = RESOLUTIONS.find((r) => r.value === form.displayResolution)?.label ?? form.displayResolution;
  const spotlightTap = form.spotlightMode === 'pinned' ? taps.find((t) => t.id === form.spotlightTapId) : null;

  async function handleSave(e?: FormEvent) {
    e?.preventDefault();
    setSavedNotice(false);
    if (!name.trim()) { setErrors(['Give the wall a name.']); setSection('content'); return; }
    if (!SLUG_PATTERN.test(slug)) {
      setErrors(['The address can only use lowercase letters, numbers and hyphens.']);
      setSection('content');
      return;
    }
    // Pages may only list taps from the checked monitors; the parser prunes the rest.
    const parsed = parseWallConfigForm(form, allowedTaps.map((t) => t.id));
    if (!parsed.ok) { setErrors(parsed.errors); return; }

    setErrors(null);
    setSaving(true);
    const deviceRefs: WallDeviceRef[] = deviceGroups
      .filter((g) => selectedDevices.has(g.key))
      .map((g) => ({ type: g.type as WallDeviceRef['type'], identifier: g.identifier }));
    // The config PATCH runs first: it's the write that can be rejected (a taken address, a
    // schema error). Only once it lands does the device PUT run, so a rejected save never
    // re-scopes the live screens behind the editor's back.
    const result = await updateWall(currentWall.id, { name: name.trim(), slug, config: parsed.config });
    if (!result.ok) {
      setSaving(false);
      setErrors([result.message]);
      return;
    }
    const devicesResult = await setWallDevices(currentWall.id, deviceRefs);
    setSaving(false);
    setCurrentWall(result.data);
    onSaved(result.data);
    if (!devicesResult.ok) {
      dispatch({ type: 'saved', devices: false });
      setDeviceSaveFailed(true);
      setErrors([
        'Wall settings (name, address, layout) were saved and pushed to TVs, but the device '
        + `assignment was NOT updated: ${devicesResult.message}. Press Save to TVs again to retry it.`,
      ]);
      return;
    }
    dispatch({ type: 'saved', devices: true });
    setDeviceSaveFailed(false);
    setSavedNotice(true);
  }

  function back() {
    if (isDirty) setConfirmLeave(true); else onBack();
  }

  const sectionProps = { form, patch };
  const panels: Record<WallSectionId, ReactNode> = {
    look: <LookSection {...sectionProps} taps={allowedTaps.length > 0 ? allowedTaps : taps} />,
    colors: <ColorsSection {...sectionProps} />,
    content: (
      <ContentSection
        {...sectionProps}
        name={name}
        slug={slug}
        onName={(v) => dispatch({ type: 'meta', name: v })}
        onSlug={(v) => dispatch({ type: 'meta', slug: v })}
      />
    ),
    pages: (
      <PagesSection
        {...sectionProps}
        taps={taps}
        allowedTaps={allowedTaps}
        tapsStatus={tapsStatus}
        deviceGroups={deviceGroups}
        devicesStatus={devicesStatus}
        selectedDevices={selectedDevices}
        onToggleDevice={toggleDevice}
      />
    ),
    takeover: <TakeoverSection {...sectionProps} />,
    rotation: <RotationSection {...sectionProps} />,
    fit: <FitSection {...sectionProps} />,
    css: <CssSection {...sectionProps} cssErrors={cssErrors} />,
  };

  return (
    <PageTemplate
      testId="wall-editor"
      crumb={(
        <button type="button" className="studio-crumb" data-testid="wall-editor-back" onClick={back}>
          Screens / Walls
        </button>
      )}
      title={currentWall.name}
      sub={<span className={isDirty ? 'adm-warn-text' : undefined} data-testid="wall-editor-status">{statusText}</span>}
      actions={(
        <>
          <Button
            variant="quiet"
            data-testid="wall-editor-revert"
            disabled={!isDirty || saving}
            onClick={() => { dispatch({ type: 'revert' }); setErrors(null); }}
          >
            Discard changes
          </Button>
          <Button data-testid="wall-editor-simulate-pour" onClick={() => setSimulateNonce((n) => n + 1)}>
            Preview a pour
          </Button>
          <Button
            type="submit"
            form="wall-editor-form"
            variant="primary"
            data-testid="wall-editor-save"
            disabled={(!isDirty && !deviceSaveFailed) || saving}
          >
            {saving ? 'Saving…' : 'Save to TVs'}
          </Button>
        </>
      )}
      drawer={(
        <ConfirmDialog
          open={confirmLeave}
          onOpenChange={setConfirmLeave}
          title="Leave without saving?"
          confirmLabel="Leave and discard"
          onConfirm={() => { setConfirmLeave(false); onBack(); }}
          testId="wall-editor-leave-confirm"
          confirmTestId="wall-editor-leave-confirm-button"
        >
          <p>{`${capitalize(countWord(dirtyCount))} ${dirtyCount === 1 ? 'section has' : 'sections have'} changes that aren’t on the TVs. Leaving throws them away.`}</p>
        </ConfirmDialog>
      )}
    >
      <div className="studio" data-testid="wall-editor-studio">
        <Tabs
          orientation="vertical"
          label="Wall settings"
          idBase="wall-editor"
          testId="wall-editor-rail"
          value={section}
          onChange={setSection}
          items={WALL_SECTIONS.map((s) => ({
            value: s.id,
            testId: `wall-editor-rail-${s.id}`,
            label: (
              <span className="studio-rail__label">
                {s.label}
                {dirty.has(s.id) && <i className="studio-rail__dot" data-testid={`wall-editor-dirty-${s.id}`} aria-label="changed" />}
              </span>
            ),
          }))}
        />

        <div className="studio-stage" data-testid="wall-editor-preview">
          <div className="studio-stage__bar">
            <Chips
              label="Preview"
              testId="wall-editor-preview-mode"
              value={mode}
              onChange={setMode}
              options={[{ value: 'wall', label: 'Wall' }, { value: 'pour', label: 'Live pour' }, { value: 'screensaver', label: 'Screensaver' }]}
            />
            <Chips
              label="Preview size"
              testId="wall-editor-preview-fit"
              value={fit}
              onChange={setFit}
              options={[{ value: 'fit', label: 'Fit' }, { value: 'actual', label: '100%' }]}
            />
          </div>
          {/* The preview hangs on a wall lit by its leading beer, on a bezel whose light is on
              when the TVs have this version and amber while changes aren't saved yet. */}
          <div
            className="studio-tv"
            data-testid="wall-editor-tv"
            data-unsaved={isDirty || undefined}
            style={{ '--wall-tint': previewTaps[0]?.beer ? beerColorFor(previewTaps[0].beer.srm) : 'var(--accent)' } as CSSProperties}
          >
          <WallLivePreview
            config={previewConfig}
            title={form.headerTitle.trim() || name}
            units={units}
            servingSizeMl={servingSizeMl}
            menuUrl="/menu"
            taps={pages[shownPage] ?? []}
            allTaps={previewTaps}
            pageIndex={shownPage}
            pageCount={pages.length}
            mode={mode}
            fit={fit}
            simulateNonce={simulateNonce}
          />
            <span className="studio-tv__led" aria-hidden="true" />
          </div>
          <div className="studio-stage__meta">
            <span data-testid="wall-editor-preview-label">
              {`${resolution} · ${form.displaySizeIn} in · scale ${Math.round(form.displayUiScale * 100)}%`}
            </span>
            {pages.length > 1 ? (
              <span className="studio-pages" role="group" aria-label="Page">
                {pages.map((_, i) => (
                  <button
                    // eslint-disable-next-line react/no-array-index-key -- pages have no id
                    key={i}
                    type="button"
                    aria-pressed={i === shownPage}
                    data-testid={`wall-editor-page-${i + 1}`}
                    onClick={() => setPageIndex(i)}
                  >
                    {i + 1}
                  </button>
                ))}
                <span>{`of ${pages.length}`}</span>
              </span>
            ) : <span>page 1 of 1</span>}
          </div>
          <dl className="studio-facts" data-testid="wall-editor-live-note">
            <div>
              <dt>{previewTaps.length > 0 ? tapsPhrase(previewTaps.map((t) => t.tapNumber)) : 'Sample beers'}</dt>
              <dd>
                {selectedDevices.size === 0
                  ? 'No monitors checked'
                  : previewTaps.length > 0
                    ? `From ${countWord(selectedDevices.size)} Kegtron ${selectedDevices.size === 1 ? 'monitor' : 'monitors'}`
                    : 'Live preview: no beer on these taps yet'}
              </dd>
            </div>
            <div>
              <dt>{shownOn.length > 0 ? listJoin(shownOn) : `/wall/${currentWall.slug}`}</dt>
              <dd>{shownOn.length > 0 ? `${shownOn.length === 1 ? 'Gets' : 'All get'} this on save` : 'No paired screen shows it yet'}</dd>
            </div>
            <div>
              <dt>{lookLabel(form.look)}</dt>
              <dd>
                {form.look === 'just-tapped'
                  ? `Spotlight: ${spotlightTap ? (spotlightTap.name ?? `Tap ${spotlightTap.number}`) : 'the newest keg'}`
                  : 'Changes preview here before they reach a TV'}
              </dd>
            </div>
          </dl>
        </div>

        <form id="wall-editor-form" className="studio-inspector" data-testid="wall-editor-form" onSubmit={handleSave} noValidate>
          {WALL_SECTIONS.map((s) => (
            <section
              key={s.id}
              role="tabpanel"
              aria-labelledby={tabId('wall-editor', s.id)}
              hidden={s.id !== section}
              data-testid={`wall-editor-section-${s.id}`}
            >
              <header className="studio-inspector__head">
                <h2>{s.label}</h2>
                {dirty.has(s.id) && (
                  <Button variant="quiet" data-testid={`wall-editor-revert-${s.id}`} onClick={() => dispatch({ type: 'revert', section: s.id })}>
                    Undo
                  </Button>
                )}
              </header>
              <p className="studio-inspector__hint">{s.hint}</p>
              {panels[s.id]}
            </section>
          ))}
          {errors && (
            <ul className="adm-danger-text studio-errors" role="alert" data-testid="wall-editor-errors">
              {errors.map((err) => <li key={err}>{err}</li>)}
            </ul>
          )}
          {savedNotice && !isDirty && <p className="adm-ok-text" data-testid="wall-editor-saved-notice">Saved.</p>}
        </form>
      </div>
    </PageTemplate>
  );
}

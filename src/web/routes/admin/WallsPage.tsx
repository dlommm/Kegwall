import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import {
  listWalls, listDisplays, createWall, deleteWall, type Display, type Wall,
} from '../../lib/adminApi';
import { safeParseWallConfig } from '../../lib/wallEditorConfig';
import { lookLabel, lookThumbUrl, takeoverLabel } from '../../lib/wallCatalog';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { WallEditor } from './WallEditor';
import { WallPreview } from './WallPreview';
import { WallLivePreview } from '../../components/WallLivePreview';
import { autoPageSize, resolveLook } from '../../components/looks/WallLook';
import { wallPagesFor } from '../../lib/wallPages';
import { getMenu } from '../../lib/api';
import type { TapState } from '../../../server/core/state.js';
import { beerColorFor } from '../../wall/wallModel';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton,
} from './ui';
import { NEW_WALL_LOOK } from '../../../server/core/wallConfig.js';

type ListStatus = 'loading' | 'loaded' | 'error';
interface CreateState { name: string; slug: string; slugTouched: boolean; error: string | null; submitting: boolean }

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const COPY_FEEDBACK_MS = 1500;

/** `Front Patio Bar` -> `front-patio-bar`: the create form's address suggestion, applied only
 * until the address is edited by hand. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function wallUrl(slug: string): string {
  return `${window.location.origin}/wall/${slug}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n === 1 ? 'one' : countWord(n)} ${n === 1 ? one : many}`;
}

/** "Two walls on three screens." / "One wall, not on a paired screen yet." */
function wallsHeadline(walls: number, screens: number): string {
  if (walls === 0) return 'No walls yet.';
  const lead = capitalize(plural(walls, 'wall', 'walls'));
  if (screens === 0) return `${lead}, not on a paired screen yet.`;
  return `${lead} on ${plural(screens, 'screen', 'screens')}.`;
}

/** What a wall does, in one line: "Taps 1–11 · pours take over in Full screen · rotates to the leaderboard". */
function wallSummary(wall: Wall): string {
  const config = safeParseWallConfig(wall.config);
  const parts: string[] = [];
  parts.push(config.pages.length > 1 ? `${config.pages.length} pages` : 'Every tap from its monitors');
  parts.push(config.takeover.style === 'off'
    ? 'pours show a badge'
    : `pours take over in ${takeoverLabel(config.takeover.style)}`);
  if (config.viewRotation.enabled && config.viewRotation.views.some((v) => v.kind === 'leaderboard' && v.enabled)) {
    parts.push('rotates to the leaderboard');
  }
  return parts.join(' · ');
}

/**
 * `/admin/walls` (Kegwall V2 M9): each wall as a card with its look, what it does, the paired
 * screens showing it, and copy / open / preview for every role. Editors and admins also add,
 * edit (the Wall Editor studio replaces the list) and delete walls. A viewer gets the same
 * cards, read-only.
 */
/** Walls drawn as live TVs; past this many the rest show their look's picture (a cheap page). */
const LIVE_TVS = 12;
/** A paired screen heard from within this long is on. */
const SCREEN_ON_MS = 3 * 60_000;

function isLive(d: Display): boolean {
  return d.lastSeen != null && Date.now() - new Date(d.lastSeen).getTime() < SCREEN_ON_MS;
}

export function WallsPage() {
  const { me, units, servingSizeMl } = useAdminContext();
  const [walls, setWalls] = useState<Wall[]>([]);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [taps, setTaps] = useState<TapState[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Wall | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewWallId, setPreviewWallId] = useState<number | null>(null);
  const [editingWallId, setEditingWallId] = useState<number | null>(null);
  const [copiedWallId, setCopiedWallId] = useState<number | null>(null);

  const loadWalls = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    listWalls().then((result) => {
      if (result.ok) {
        setWalls(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
    Promise.resolve(listDisplays()).then((result) => {
      if (result?.ok) setDisplays(result.data);
    }).catch(() => { /* the cards just show no screens */ });
    // The taps each wall's TV shows; without them the TVs draw the sample beers.
    Promise.resolve(getMenu()).then((result) => {
      if (result?.ok) setTaps(result.data.taps.filter((t) => !t.hidden));
    }).catch(() => { /* sample beers */ });
  }, []);

  useEffect(() => {
    loadWalls();
  }, [loadWalls]);

  const canEdit = me.role === 'editor' || me.role === 'admin';

  async function handleCopy(wall: Wall) {
    try {
      await navigator.clipboard.writeText(wallUrl(wall.slug));
      setCopiedWallId(wall.id);
      setTimeout(() => {
        setCopiedWallId((id) => (id === wall.id ? null : id));
      }, COPY_FEEDBACK_MS);
    } catch {
      // Clipboard access can be denied (permissions, an insecure context); the address is on
      // the card to select by hand, so this fails quietly.
      setCopiedWallId(null);
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!createState) return;
    if (!createState.name.trim()) {
      setCreateState({ ...createState, error: 'Give the wall a name.' });
      return;
    }
    if (!SLUG_PATTERN.test(createState.slug)) {
      setCreateState({ ...createState, error: 'The address can only use lowercase letters, numbers and hyphens.' });
      return;
    }
    setCreateState({ ...createState, submitting: true, error: null });
    const result = await createWall({ name: createState.name.trim(), slug: createState.slug, config: { look: NEW_WALL_LOOK } });
    if (!result.ok) {
      setCreateState({ ...createState, submitting: false, error: result.message });
      return;
    }
    setCreateState(null);
    loadWalls();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteWall(deleteTarget.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteTarget(null);
      loadWalls();
      return;
    }
    setDeleteError(result.message);
  }

  if (editingWallId != null) {
    const editingWall = walls.find((w) => w.id === editingWallId);
    if (editingWall) {
      return (
        <section data-testid="admin-walls-page">
          <WallEditor
            wall={editingWall}
            onBack={() => { setEditingWallId(null); loadWalls(); }}
            onSaved={(saved) => setWalls((prev) => prev.map((w) => (w.id === saved.id ? saved : w)))}
          />
        </section>
      );
    }
    // The wall vanished underneath us (deleted in another tab): back to the list.
    setEditingWallId(null);
  }

  const pairedScreens = displays.filter((d) => d.wallId != null).length;

  return (
    <PageTemplate
      testId="admin-walls-page"
      title={status === 'loaded' ? wallsHeadline(walls.length, pairedScreens) : 'Walls'}
      sub="Each wall is a page any screen can open. Pair a screen under Displays to send it one."
      actions={canEdit && (
        <Button
          variant="primary"
          data-testid="walls-add-button"
          onClick={() => setCreateState({ name: '', slug: '', slugTouched: false, error: null, submitting: false })}
        >
          Add a wall
        </Button>
      )}
      drawer={(
        <>
          {createState && canEdit && (
            <Drawer
              open
              onOpenChange={(open) => { if (!open && !createState.submitting) setCreateState(null); }}
              title="Add a wall"
              description="It starts on the Just Tapped look with every tap. Change anything in the Wall Editor."
            >
              <form className="adm-form" data-testid="walls-create-form" aria-label="Add wall" onSubmit={handleCreateSubmit}>
                <label className="admin-field">
                  <span>Name</span>
                  <input
                    type="text"
                    data-testid="walls-create-name"
                    value={createState.name}
                    placeholder="Patio"
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer opens to type a name
                    autoFocus
                    onChange={(e) => {
                      const name = e.target.value;
                      setCreateState((s) => (s ? { ...s, name, slug: s.slugTouched ? s.slug : slugify(name) } : s));
                    }}
                  />
                </label>
                <label className="admin-field">
                  <span>Address</span>
                  <input
                    type="text"
                    data-testid="walls-create-slug"
                    value={createState.slug}
                    onChange={(e) => {
                      const slug = e.target.value;
                      setCreateState((s) => (s ? { ...s, slug, slugTouched: true } : s));
                    }}
                  />
                </label>
                <p className="adm-sub">{`Screens will open ${wallUrl(createState.slug || '…')}`}</p>
                {createState.error && (
                  <p className="adm-danger-text" role="alert" data-testid="walls-create-error">{createState.error}</p>
                )}
                <div className="adm-form__actions">
                  <Button type="submit" variant="primary" disabled={createState.submitting} data-testid="walls-create-submit">
                    {createState.submitting ? 'Adding…' : 'Add wall'}
                  </Button>
                  <Button variant="quiet" disabled={createState.submitting} data-testid="walls-create-cancel" onClick={() => setCreateState(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Drawer>
          )}
          <ConfirmDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}
            title={deleteTarget ? `Delete ${deleteTarget.name}?` : ''}
            confirmLabel="Delete wall"
            busyLabel="Deleting…"
            busy={deleting}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            testId="walls-delete-confirm"
            confirmTestId="walls-delete-confirm-button"
            cancelTestId="walls-delete-cancel-button"
            errorTestId="walls-delete-error"
          >
            {deleteTarget && (
              <p>
                {`This permanently deletes “${deleteTarget.name}”. Its address (/wall/${deleteTarget.slug}) stops working at once, and any screen showing it goes blank. This can’t be undone.`}
              </p>
            )}
          </ConfirmDialog>
        </>
      )}
    >
      {status === 'loading' && <div data-testid="walls-loading"><Skeleton height={180} /></div>}
      {status === 'error' && (
        <div data-testid="walls-error"><ErrorState title="Couldn’t load walls." onRetry={loadWalls} /></div>
      )}
      {status === 'loaded' && walls.length === 0 && (
        <div data-testid="walls-empty">
          <EmptyState title="No walls yet.">{canEdit ? 'Add one to put the taps on a TV or tablet.' : 'An editor can add one.'}</EmptyState>
        </div>
      )}

      {status === 'loaded' && walls.length > 0 && (
        <ul className="walls-v2" data-testid="walls-list">
          {walls.map((wall, index) => {
            const url = wallUrl(wall.slug);
            const config = safeParseWallConfig(wall.config);
            const previewing = previewWallId === wall.id;
            const onScreens = displays.filter((d) => d.wallId === wall.id);
            return (
              <li key={wall.id} className="walls-v2__card" data-testid="walls-row">
                {previewing ? (
                  <div className="walls-v2__preview" data-testid="walls-row-preview-row">
                    <WallPreview slug={wall.slug} className="walls-v2__frame" />
                  </div>
                ) : (
                  // The wall as the TV it is (Kegwall 2.1 "s-tvs"): its own taps, look and theme on
                  // a bezel, a strip of its beers above, a light that's on while a screen plays it.
                  <div className="walls-tv" data-on={onScreens.some((d) => isLive(d)) || undefined}>
                    {taps.length > 0 && (
                      <span className="walls-tv__rail" aria-hidden="true">
                        {taps.filter((t) => t.beer && t.keg?.status === 'on_tap').slice(0, 12).map((t) => (
                          <i key={t.tapId} style={{ background: beerColorFor(t.beer!.srm) } as CSSProperties} />
                        ))}
                      </span>
                    )}
                    <div className="walls-tv__screen" aria-hidden="true">
                      {index < LIVE_TVS ? (
                        <WallLivePreview
                          config={config}
                          title={config.header?.title || wall.name}
                          units={units}
                          servingSizeMl={servingSizeMl}
                          menuUrl="/menu"
                          taps={wallPagesFor(config.pages, taps, autoPageSize(resolveLook(config.look)))[0] ?? taps}
                          allTaps={taps}
                          fit="fit"
                        />
                      ) : (
                        <img className="walls-v2__thumb" src={lookThumbUrl(config.look)} alt="" loading="lazy" width={400} height={225} />
                      )}
                      <span className="walls-tv__led" />
                    </div>
                    <span className="walls-tv__stand" aria-hidden="true" />
                  </div>
                )}
                <div className="walls-v2__body">
                  <h2 className="walls-v2__name">{wall.name}</h2>
                  <p className="walls-v2__url">
                    <span className="adm-ell" data-testid="walls-row-url">{`${lookLabel(config.look)} · ${url}`}</span>
                  </p>
                  <p className="adm-sub">{wallSummary(wall)}</p>
                  <ul className="walls-v2__screens" aria-label="Paired screens">
                    {onScreens.length === 0 ? (
                      <li className="adm-sub">Not on a screen yet</li>
                    ) : onScreens.map((d) => (
                      <li key={d.id}>
                        <span className={isLive(d) ? 'walls-v2__dot is-on' : 'walls-v2__dot'} aria-hidden="true" />
                        {d.name}
                        <span className="adm-sub">{d.lastSeen ? ` · seen ${formatRelativeTime(d.lastSeen)}` : ' · never connected'}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="walls-v2__actions">
                    {canEdit && (
                      <Button variant="primary" data-testid="walls-row-edit" onClick={() => setEditingWallId(wall.id)}>Edit wall</Button>
                    )}
                    <Menu>
                      <MenuTrigger className="adm-btn adm-btn--secondary" data-testid="walls-row-more" aria-label={`More for ${wall.name}`}>
                        More
                      </MenuTrigger>
                      <MenuContent align="start">
                        <MenuItem asChild>
                          <a href={url} target="_blank" rel="noreferrer noopener" data-testid="walls-row-open">Open the wall</a>
                        </MenuItem>
                        <MenuItem data-testid="walls-row-copy" onSelect={(e) => { e.preventDefault(); handleCopy(wall); }}>
                          {copiedWallId === wall.id ? 'Copied!' : 'Copy link'}
                        </MenuItem>
                        <MenuItem data-testid="walls-row-preview" onSelect={() => setPreviewWallId(previewing ? null : wall.id)}>
                          {previewing ? 'Hide the full-size view' : 'Show the full-size view'}
                        </MenuItem>
                        {canEdit && (
                          <MenuItem
                            data-testid="walls-row-delete"
                            onSelect={() => { setDeleteError(null); setDeleteTarget(wall); }}
                          >
                            Delete wall
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageTemplate>
  );
}

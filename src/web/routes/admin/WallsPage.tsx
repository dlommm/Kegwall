import { Fragment, useCallback, useEffect, useState } from 'react';
import type { Role } from '../../../server/db/users.js';
import {
  getMe, listWalls, createWall, deleteWall, type Wall,
} from '../../lib/adminApi';
import { WallEditor } from './WallEditor';
import { WallPreview } from './WallPreview';

type ListStatus = 'loading' | 'loaded' | 'error';
interface CreateState { name: string; slug: string; slugTouched: boolean; error: string | null; submitting: boolean }
interface DeleteState { wall: Wall; error: string | null }

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const COPY_FEEDBACK_MS = 1500;

/** `Front Patio Bar` -> `front-patio-bar` — the create form's slug auto-suggestion, only
 * applied while the admin hasn't hand-edited the slug field themselves. */
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

/**
 * `/admin/walls` (Task 7): the walls list (name, slug, full URL with copy + open-in-new-
 * tab, and a read-only inline preview toggle available to every role) plus, for
 * editor/admin, create/delete and the full `WallEditor`. A viewer can copy a URL, open a
 * wall, and preview it inline, but never sees "Add wall" or any per-row Edit/Delete
 * control — same read-only shape as every other Task 4-6 admin page.
 *
 * Editing swaps the whole section for `WallEditor` (rather than an inline panel above
 * the list, like the simpler tap/beer forms) — the editor's field count and live preview
 * genuinely need the room.
 */
export function WallsPage() {
  const [role, setRole] = useState<Role | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewWallId, setPreviewWallId] = useState<number | null>(null);
  const [editingWallId, setEditingWallId] = useState<number | null>(null);
  const [copiedWallId, setCopiedWallId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe().then((result) => {
      if (!cancelled && result.ok) setRole(result.data.role);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, []);

  useEffect(() => {
    loadWalls();
  }, [loadWalls]);

  const canEdit = role === 'editor' || role === 'admin';

  async function handleCopy(wall: Wall) {
    const url = wallUrl(wall.slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWallId(wall.id);
      setTimeout(() => {
        setCopiedWallId((id) => (id === wall.id ? null : id));
      }, COPY_FEEDBACK_MS);
    } catch {
      // Clipboard access can be denied/unavailable (permissions, insecure context, an
      // older browser) — the URL is still right there in the row to select manually, so
      // this fails quietly rather than throwing up a dialog over a non-critical action.
      setCopiedWallId(null);
    }
  }

  function openCreateForm() {
    setCreateState({
      name: '', slug: '', slugTouched: false, error: null, submitting: false,
    });
  }

  function handleNameChange(name: string) {
    setCreateState((s) => (s ? {
      ...s, name, slug: s.slugTouched ? s.slug : slugify(name),
    } : s));
  }

  function handleSlugChange(slug: string) {
    setCreateState((s) => (s ? { ...s, slug, slugTouched: true } : s));
  }

  async function handleCreateSubmit() {
    if (!createState) return;
    if (!createState.name.trim()) {
      setCreateState({ ...createState, error: 'Name is required.' });
      return;
    }
    if (!SLUG_PATTERN.test(createState.slug)) {
      setCreateState({ ...createState, error: 'Slug must be lowercase letters, numbers, and hyphens only.' });
      return;
    }
    setCreateState({ ...createState, submitting: true, error: null });
    const result = await createWall({ name: createState.name.trim(), slug: createState.slug });
    if (!result.ok) {
      setCreateState({ ...createState, submitting: false, error: result.message });
      return;
    }
    setCreateState(null);
    loadWalls();
  }

  async function handleConfirmDelete() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteWall(deleteState.wall.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      loadWalls();
      return;
    }
    setDeleteState({ ...deleteState, error: result.message });
  }

  function handleEditorBack() {
    setEditingWallId(null);
    loadWalls();
  }

  function handleEditorSaved(saved: Wall) {
    setWalls((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
  }

  if (editingWallId != null) {
    const editingWall = walls.find((w) => w.id === editingWallId);
    if (editingWall) {
      return (
        <section data-testid="admin-walls-page">
          <WallEditor wall={editingWall} onBack={handleEditorBack} onSaved={handleEditorSaved} />
        </section>
      );
    }
    // The wall being edited vanished from the list underneath us (e.g. deleted in
    // another tab) — fall back to the list rather than rendering an editor for nothing.
    setEditingWallId(null);
  }

  return (
    <section data-testid="admin-walls-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Walls</h1>
        {canEdit && !createState && (
          <button
            type="button"
            className="admin-page-header__action"
            data-testid="walls-add-button"
            onClick={openCreateForm}
          >
            Add wall
          </button>
        )}
      </header>

      {createState && canEdit && (
        <form
          className="wall-create-form"
          data-testid="walls-create-form"
          aria-label="Add wall"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateSubmit();
          }}
        >
          <div className="wall-create-form__grid">
            <label className="admin-field">
              <span>Name</span>
              <input
                type="text"
                data-testid="walls-create-name"
                value={createState.name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
              />
            </label>
            <label className="admin-field">
              <span>Slug</span>
              <input
                type="text"
                data-testid="walls-create-slug"
                value={createState.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
              />
            </label>
          </div>
          {createState.error && (
            <p className="wall-create-form__notice" role="alert" data-testid="walls-create-error">
              {createState.error}
            </p>
          )}
          <div className="wall-create-form__actions">
            <button type="submit" disabled={createState.submitting} data-testid="walls-create-submit">
              {createState.submitting ? 'Adding…' : 'Add wall'}
            </button>
            <button
              type="button"
              disabled={createState.submitting}
              data-testid="walls-create-cancel"
              onClick={() => setCreateState(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {status === 'loading' && <p className="admin-page-quiet" data-testid="walls-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="walls-error">
          Couldn&rsquo;t load walls. Reload to try again.
        </p>
      )}
      {status === 'loaded' && walls.length === 0 && (
        <p className="admin-page-quiet" data-testid="walls-empty">
          No walls yet. {canEdit ? 'Add one to get a TV or tablet display live.' : ''}
        </p>
      )}

      {status === 'loaded' && walls.length > 0 && (
        <table className="admin-table walls-table" data-testid="walls-list">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Slug</th>
              <th scope="col">URL</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {walls.map((wall) => {
              const url = wallUrl(wall.slug);
              const previewing = previewWallId === wall.id;
              return (
                <Fragment key={wall.id}>
                  <tr data-testid="walls-row">
                    <td className="font-body">{wall.name}</td>
                    <td className="font-tabular">{wall.slug}</td>
                    <td>
                      <div className="walls-table__url">
                        <span className="walls-table__url-text" data-testid="walls-row-url">{url}</span>
                        <button type="button" data-testid="walls-row-copy" onClick={() => handleCopy(wall)}>
                          {copiedWallId === wall.id ? 'Copied!' : 'Copy'}
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          data-testid="walls-row-open"
                        >
                          Open
                        </a>
                      </div>
                    </td>
                    <td className="walls-table__actions">
                      <button
                        type="button"
                        data-testid="walls-row-preview"
                        onClick={() => setPreviewWallId(previewing ? null : wall.id)}
                      >
                        {previewing ? 'Hide preview' : 'Preview'}
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          data-testid="walls-row-edit"
                          onClick={() => setEditingWallId(wall.id)}
                        >
                          Edit
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          data-testid="walls-row-delete"
                          onClick={() => setDeleteState({ wall, error: null })}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {previewing && (
                    <tr data-testid="walls-row-preview-row">
                      <td colSpan={4}>
                        <WallPreview slug={wall.slug} className="walls-table__preview-frame" />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="walls-delete-confirm"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="walls-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="walls-delete-title" className="font-display">Delete wall</h3>
            <p>
              This will permanently delete &ldquo;{deleteState.wall.name}&rdquo; and its live URL
              (/wall/{deleteState.wall.slug}) will stop working immediately. This can&rsquo;t be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="walls-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="walls-delete-confirm-button"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete wall'}
              </button>
              <button
                type="button"
                data-testid="walls-delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

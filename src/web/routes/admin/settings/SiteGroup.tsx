import { useState, type ChangeEvent } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { uploadLabel } from '../../../lib/adminApi';
import type { GroupProps } from './shared';
import { useSettingsGroupForm } from './useSettingsGroupForm';

/** Site group (Task 8; Phase 5 Task 0 adds `siteLogo` upload + `servingSizeMl`):
 * siteName, displayUnits, a site logo (reuses the beers-form label-upload infra — same
 * generic `POST /api/uploads/label` endpoint, same stored-path convention), and the
 * default serving size (mL) used to estimate remaining servings. Nothing else in the
 * admin UI renders `siteLogo` yet (no consumer was in scope for this change — see the
 * Phase 4 final review's framing of this as "a two-sided gap"; this closes the upload
 * side only), same as `servingSizeMl` not yet feeding any estimate elsewhere. */
export function SiteGroup({ settings, onSaved }: GroupProps) {
  const [siteName, setSiteName] = useState(settings.siteName);
  const [displayUnits, setDisplayUnits] = useState(settings.displayUnits);
  const [siteLogo, setSiteLogo] = useState(settings.siteLogo);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [servingSizeMl, setServingSizeMl] = useState(String(settings.servingSizeMl));

  const dirty = siteName !== settings.siteName
    || displayUnits !== settings.displayUnits
    || siteLogo !== settings.siteLogo
    || servingSizeMl !== String(settings.servingSizeMl);

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      if (!siteName.trim()) return 'Site name is required.';
      const servingSize = Number(servingSizeMl.trim());
      if (!Number.isInteger(servingSize) || servingSize <= 0) {
        return 'Serving size must be a whole number of mL greater than 0.';
      }
      const patch: Partial<Settings> = {};
      if (siteName !== settings.siteName) patch.siteName = siteName.trim();
      if (displayUnits !== settings.displayUnits) patch.displayUnits = displayUnits;
      if (siteLogo !== settings.siteLogo) patch.siteLogo = siteLogo;
      if (servingSize !== settings.servingSizeMl) patch.servingSizeMl = servingSize;
      return patch;
    },
  });

  async function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-selected later (e.g. after an error)
    if (!file) return;
    setLogoError(null);
    setLogoBusy(true);
    const result = await uploadLabel(file);
    setLogoBusy(false);
    if (result.ok) {
      setSiteLogo(result.data.path);
    } else {
      setLogoError(result.message);
    }
  }

  return (
    <form className="settings-group" data-testid="settings-group-site" onSubmit={handleSubmit} aria-labelledby="settings-site-title">
      <h2 id="settings-site-title" className="admin-field__label-text">Site</h2>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Site name</span>
          <input
            type="text"
            data-testid="settings-site-name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Units</span>
          <select
            data-testid="settings-site-units"
            value={displayUnits}
            onChange={(e) => setDisplayUnits(e.target.value as Settings['displayUnits'])}
          >
            <option value="us">US (oz, °F)</option>
            <option value="metric">Metric (mL, °C)</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Default serving size (mL)</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="settings-site-serving-size"
            value={servingSizeMl}
            onChange={(e) => setServingSizeMl(e.target.value)}
          />
        </label>
      </div>

      <div className="beer-form__label">
        <span className="admin-field__label-text">Site logo</span>
        <div className="beer-form__label-row">
          {siteLogo ? (
            <img
              src={siteLogo}
              alt=""
              className="beer-form__label-thumb"
              data-testid="settings-site-logo-thumb"
            />
          ) : (
            <span className="beer-form__label-placeholder" data-testid="settings-site-logo-placeholder">
              No logo
            </span>
          )}

          <label className="beer-form__upload-button">
            {logoBusy ? 'Uploading…' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-testid="settings-site-logo-file"
              onChange={handleLogoFileChange}
              disabled={logoBusy}
              hidden
            />
          </label>

          {siteLogo && (
            <button
              type="button"
              className="beer-form__label-clear"
              data-testid="settings-site-logo-clear"
              onClick={() => setSiteLogo(null)}
            >
              Remove logo
            </button>
          )}
        </div>
        {logoError && (
          <p className="beer-form__notice" role="alert" data-testid="settings-site-logo-error">{logoError}</p>
        )}
      </div>

      {error && <p className="beer-form__notice" role="alert" data-testid="settings-site-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-site-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

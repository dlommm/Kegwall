import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { Beer, BeerInput } from '../../../server/db/beers.js';
import { createBeer, updateBeer, uploadLabel } from '../../lib/adminApi';
import { srmToColor } from '../../lib/srm';
import { BreweryAutocomplete } from './BreweryAutocomplete';
import { StyleAutocomplete } from './StyleAutocomplete';

interface BeerFormProps {
  mode: 'create' | 'edit';
  beer: Beer | null;
  onSaved: (beer: Beer) => void;
  onCancel: () => void;
}

/** Parses a numeric text field: empty -> `null` (field left blank), otherwise the parsed
 * number (which may be `NaN` for something unparseable — `validate()` below is what
 * turns that into a user-facing error; this helper stays a pure, non-throwing mapper). */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * Create/edit form for a single beer (Task 4) — all `BeerInput` fields, a live SRM color
 * swatch, and a label sourced from a direct file upload (`POST /api/uploads/label`, Task
 * 1). The style field is backed by `StyleAutocomplete` (an offline BJCP-2021-style
 * suggestion list, replacing the removed Untappd search sheet's style autofill — see that
 * component's doc comment) and the brewery field by `BreweryAutocomplete`; both are plain
 * text inputs underneath, so a custom/house name in either field is always allowed.
 */
export function BeerForm({ mode, beer, onSaved, onCancel }: BeerFormProps) {
  const [name, setName] = useState(beer?.name ?? '');
  const [brewery, setBrewery] = useState(beer?.brewery ?? '');
  const [style, setStyle] = useState(beer?.style ?? '');
  const [abv, setAbv] = useState(beer?.abv != null ? String(beer.abv) : '');
  const [ibu, setIbu] = useState(beer?.ibu != null ? String(beer.ibu) : '');
  const [srm, setSrm] = useState(beer?.srm != null ? String(beer.srm) : '');
  const [description, setDescription] = useState(beer?.description ?? '');
  const [labelImage, setLabelImage] = useState<string | null>(beer?.labelImage ?? null);

  const [labelBusy, setLabelBusy] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const srmNumber = srm.trim() === '' ? null : Number(srm);

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.';
    if (abv.trim() !== '' && Number.isNaN(Number(abv))) return 'ABV must be a number.';
    if (ibu.trim() !== '' && Number.isNaN(Number(ibu))) return 'IBU must be a number.';
    if (srm.trim() !== '' && Number.isNaN(Number(srm))) return 'SRM must be a number.';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const message = validate();
    if (message) {
      setValidationError(message);
      return;
    }
    setValidationError(null);

    const input: BeerInput = {
      name: name.trim(),
      brewery: brewery.trim() || null,
      style: style.trim() || null,
      abv: parseOptionalNumber(abv),
      ibu: parseOptionalNumber(ibu),
      srm: parseOptionalNumber(srm),
      description: description.trim() || null,
      labelImage,
    };

    setSubmitting(true);
    const result = mode === 'edit' && beer
      ? await updateBeer(beer.id, input)
      : await createBeer(input);
    setSubmitting(false);

    if (result.ok) {
      onSaved(result.data);
      return;
    }
    setServerError(result.message);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-selected later (e.g. after an error)
    if (!file) return;
    setLabelError(null);
    setLabelBusy(true);
    const result = await uploadLabel(file);
    setLabelBusy(false);
    if (result.ok) {
      setLabelImage(result.data.path);
    } else {
      setLabelError(result.message);
    }
  }

  return (
    <form
      className="beer-form"
      onSubmit={handleSubmit}
      data-testid="beer-form"
      aria-label={mode === 'edit' ? 'Edit beer' : 'Add beer'}
    >
      <h2 className="beer-form__title font-display">
        {mode === 'edit' ? `Edit ${beer?.name}` : 'Add beer'}
      </h2>

      <div className="beer-form__grid">
        <label className="admin-field">
          <span>Name</span>
          <input
            type="text"
            data-testid="beer-form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="admin-field">
          <span>Brewery</span>
          <BreweryAutocomplete value={brewery} onChange={setBrewery} />
        </label>

        <label className="admin-field">
          <span>Style</span>
          <StyleAutocomplete value={style} onChange={setStyle} />
        </label>

        <label className="admin-field">
          <span>ABV %</span>
          <input
            type="text"
            inputMode="decimal"
            data-testid="beer-form-abv"
            value={abv}
            onChange={(e) => setAbv(e.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>IBU</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="beer-form-ibu"
            value={ibu}
            onChange={(e) => setIbu(e.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>SRM</span>
          <div className="beer-form__srm">
            <input
              type="text"
              inputMode="decimal"
              data-testid="beer-form-srm"
              value={srm}
              onChange={(e) => setSrm(e.target.value)}
            />
            <span
              className="beer-form__srm-swatch"
              data-testid="beer-form-srm-swatch"
              aria-hidden="true"
              style={{ backgroundColor: srmToColor(srmNumber).liquid }}
            />
          </div>
        </label>
      </div>

      <label className="admin-field admin-field--full">
        <span>Description</span>
        <textarea
          data-testid="beer-form-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="beer-form__label">
        <span className="admin-field__label-text">Label</span>
        <div className="beer-form__label-row">
          {labelImage ? (
            <img
              src={labelImage}
              alt=""
              className="beer-form__label-thumb"
              data-testid="beer-form-label-thumb"
            />
          ) : (
            <span className="beer-form__label-placeholder" data-testid="beer-form-label-placeholder">
              No label
            </span>
          )}

          <label className="beer-form__upload-button">
            {labelBusy ? 'Uploading…' : 'Upload label'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-testid="beer-form-label-file"
              onChange={handleFileChange}
              disabled={labelBusy}
              hidden
            />
          </label>

          {labelImage && (
            <button
              type="button"
              className="beer-form__label-clear"
              data-testid="beer-form-label-clear"
              onClick={() => setLabelImage(null)}
            >
              Remove label
            </button>
          )}
        </div>
        {labelError && (
          <p className="beer-form__notice" role="alert" data-testid="beer-form-label-error">
            {labelError}
          </p>
        )}
      </div>

      {validationError && (
        <p className="beer-form__notice" role="alert" data-testid="beer-form-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="beer-form__notice" role="alert" data-testid="beer-form-server-error">
          {serverError}
        </p>
      )}

      <div className="beer-form__actions">
        <button type="submit" className="beer-form__submit" disabled={submitting} data-testid="beer-form-submit">
          {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add beer'}
        </button>
        <button type="button" className="beer-form__cancel" onClick={onCancel} data-testid="beer-form-cancel">
          Cancel
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Beer, BeerInput } from '../../../server/db/beers.js';
import { createBeer, updateBeer, uploadLabel, lookupBeers } from '../../lib/adminApi';
import { srmToColor } from '../../lib/srm';
import { BreweryAutocomplete } from './BreweryAutocomplete';
import { StyleAutocomplete } from './StyleAutocomplete';
import { BeerSearchSheet, type BeerImportedFields } from './BeerSearchSheet';
import { Button } from './ui';
import { beerMarkerModel } from '../../wall/wallModel';
import { TapMarker } from '../../wall/TapMarker';

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
 *
 * Also offers an OPTIONAL catalog.beer search (`BeerSearchSheet`) that fills
 * name/brewery/style/abv/ibu/description in one shot — the direct successor to the
 * removed Untappd search sheet, minus any label art (catalog.beer's API has none). The
 * "Search catalog.beer" trigger is hidden ENTIRELY (not just disabled) when a one-time
 * probe call on mount comes back 501 `not_configured` — same contract the removed
 * Untappd trigger had: an admin with no catalog.beer API key set should never see a
 * control for a feature that can't work.
 */
export function BeerForm({ mode, beer, onSaved, onCancel }: BeerFormProps) {
  const [name, setName] = useState(beer?.name ?? '');
  const [brewery, setBrewery] = useState(beer?.brewery ?? '');
  const [style, setStyle] = useState(beer?.style ?? '');
  const [abv, setAbv] = useState(beer?.abv != null ? String(beer.abv) : '');
  const [ibu, setIbu] = useState(beer?.ibu != null ? String(beer.ibu) : '');
  const [srm, setSrm] = useState(beer?.srm != null ? String(beer.srm) : '');
  const [description, setDescription] = useState(beer?.description ?? '');
  const [markupOverride, setMarkupOverride] = useState(beer?.markupOverridePct != null ? String(beer.markupOverridePct) : '');
  const [labelImage, setLabelImage] = useState<string | null>(beer?.labelImage ?? null);

  const [labelBusy, setLabelBusy] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [catalogBeerAvailable, setCatalogBeerAvailable] = useState(false);
  const [catalogBeerSheetOpen, setCatalogBeerSheetOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // One-time "is catalog.beer even configured?" probe — an empty query 501s without
  // needing real credentials to already be entered into the search box (see
  // routes/lookup.ts). Same pattern the removed UntappdSearchSheet trigger used.
  useEffect(() => {
    let cancelled = false;
    lookupBeers('').then((result) => {
      if (cancelled) return;
      setCatalogBeerAvailable(!(!result.ok && result.status === 501));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const srmNumber = srm.trim() === '' ? null : Number(srm);

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.';
    if (abv.trim() !== '' && Number.isNaN(Number(abv))) return 'ABV must be a number.';
    if (ibu.trim() !== '' && Number.isNaN(Number(ibu))) return 'IBU must be a number.';
    if (srm.trim() !== '' && Number.isNaN(Number(srm))) return 'SRM must be a number.';
    if (markupOverride.trim() !== '' && Number.isNaN(Number(markupOverride))) return 'Markup override must be a number.';
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
      markupOverridePct: parseOptionalNumber(markupOverride),
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

  function handleImported(fields: BeerImportedFields) {
    setName(fields.name);
    setBrewery(fields.brewery ?? '');
    setStyle(fields.style ?? '');
    setAbv(fields.abv != null ? String(fields.abv) : '');
    setIbu(fields.ibu != null ? String(fields.ibu) : '');
    setDescription(fields.description ?? '');
    setCatalogBeerSheetOpen(false);
  }

  const preview = beerMarkerModel({ name: name.trim() || null, srm: Number.isFinite(srmNumber) ? srmNumber : null, labelImage });

  return (
    <form
      className="beer-form adm-form"
      onSubmit={handleSubmit}
      data-testid="beer-form"
      aria-label={mode === 'edit' ? 'Edit beer' : 'Add beer'}
    >
      <div className="beer-form__preview" data-testid="beer-form-preview">
        {preview.name
          ? <TapMarker model={preview} size={64} showNumber={false} />
          : <span className="beer-form__preview-empty" aria-hidden="true" />}
        <div>
          <b>How it shows on screens</b>
          <p className="adm-sub">
            The marker is made from the beer&rsquo;s color and name. Add label art to use that instead.
          </p>
        </div>
      </div>

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

      <div className="adm-grid-2">
        <label className="admin-field">
          <span>Brewery</span>
          <BreweryAutocomplete value={brewery} onChange={setBrewery} />
        </label>

        <label className="admin-field">
          <span>Style</span>
          <StyleAutocomplete value={style} onChange={setStyle} />
        </label>
      </div>

      <div className="adm-grid-3">
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
          <span>Color (SRM)</span>
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

      <label className="admin-field">
        <span>Description</span>
        <textarea
          data-testid="beer-form-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span className="admin-field__unit-hint">Shown on the phone menu and on looks that print notes.</span>
      </label>

      <label className="admin-field">
        <span>Price markup override %</span>
        <input
          type="text"
          inputMode="numeric"
          data-testid="beer-form-markup"
          placeholder="Uses the global markup"
          value={markupOverride}
          onChange={(e) => setMarkupOverride(e.target.value)}
        />
        {/* DESIGN NOTE (4k): only affects the public price when pricing is enabled in Settings;
            owner cost is never shown here. Blank = fall back to the global markup. */}
        <span className="admin-field__unit-hint">Only used when prices are turned on in Settings.</span>
      </label>

      <div className="beer-form__label">
        <span className="admin-field__label-text">
          Label art <span className="adm-sub">(optional)</span>
        </span>
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

          <label className="adm-btn adm-btn--secondary beer-form__upload-button">
            {labelBusy ? 'Uploading…' : 'Upload label art'}
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
            <Button
              variant="quiet"
              data-testid="beer-form-label-clear"
              onClick={() => setLabelImage(null)}
            >
              Remove label
            </Button>
          )}
        </div>
        {labelError && (
          <p className="adm-danger-text" role="alert" data-testid="beer-form-label-error">
            {labelError}
          </p>
        )}
      </div>

      {catalogBeerAvailable && (
        <Button
          className="beer-form__catalogbeer-button"
          data-testid="beer-form-catalogbeer-button"
          onClick={() => setCatalogBeerSheetOpen(true)}
        >
          Fill in from catalog.beer
        </Button>
      )}

      {validationError && (
        <p className="adm-danger-text" role="alert" data-testid="beer-form-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="adm-danger-text" role="alert" data-testid="beer-form-server-error">
          {serverError}
        </p>
      )}

      <div className="adm-form__actions">
        <Button type="submit" variant="primary" disabled={submitting} data-testid="beer-form-submit">
          {submitting ? 'Saving…' : mode === 'edit' ? 'Save beer' : 'Add beer'}
        </Button>
        <Button variant="quiet" onClick={onCancel} data-testid="beer-form-cancel">
          Cancel
        </Button>
      </div>

      {catalogBeerSheetOpen && (
        <BeerSearchSheet onImported={handleImported} onClose={() => setCatalogBeerSheetOpen(false)} />
      )}
    </form>
  );
}

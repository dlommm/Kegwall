import { useEffect, useState, type FormEvent } from 'react';
import type { Tap } from '../../../server/db/taps.js';
import { getDrinkers, type PublicDrinker } from '../../lib/api';
import { createTap, updateTap } from '../../lib/adminApi';
import { Button } from './ui';

interface TapFormProps {
  mode: 'create' | 'edit';
  tap: Tap | null;
  onSaved: (tap: Tap) => void;
  onCancel: () => void;
}

/** Create/edit form for a single tap (Task 5; Phase 5 Task 0 adds the default-drinker
 * picker) — `number` (a required positive integer, unique per `taps.number`'s DB
 * constraint — a duplicate 409s and is surfaced as the server error below), an optional
 * display `name`, and an optional default drinker (see db/taps.ts's `defaultDrinkerId`
 * doc comment / core/state.ts's stamping logic). The drinker list reuses the same public
 * `getDrinkers()` endpoint the wall's claim sheet uses — non-sensitive, viewer-safe data,
 * and no admin-only listing endpoint exists for it. */
export function TapForm({ mode, tap, onSaved, onCancel }: TapFormProps) {
  const [number, setNumber] = useState(tap?.number != null ? String(tap.number) : '');
  const [name, setName] = useState(tap?.name ?? '');
  const [defaultDrinkerId, setDefaultDrinkerId] = useState(
    tap?.defaultDrinkerId != null ? String(tap.defaultDrinkerId) : '',
  );
  const [hidden, setHidden] = useState(tap?.hidden ?? false);
  const [drinkers, setDrinkers] = useState<PublicDrinker[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDrinkers().then((result) => {
      if (!cancelled && result.ok) setDrinkers(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): string | null {
    const trimmed = number.trim();
    if (trimmed === '') return 'Tap number is required.';
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1) return 'Tap number must be a whole number of 1 or more.';
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

    const input = {
      number: Number(number.trim()),
      name: name.trim() || null,
      defaultDrinkerId: defaultDrinkerId === '' ? null : Number(defaultDrinkerId),
      hidden,
    };
    setSubmitting(true);
    const result = mode === 'edit' && tap
      ? await updateTap(tap.id, input)
      : await createTap(input);
    setSubmitting(false);

    if (result.ok) {
      onSaved(result.data);
      return;
    }
    setServerError(result.message);
  }

  return (
    <form
      className="tap-form adm-form-wrap"
      onSubmit={handleSubmit}
      data-testid="tap-form"
      aria-label={mode === 'edit' ? 'Edit tap' : 'Add tap'}
    >
      <div className="adm-form">
        <label className="admin-field">
          <span>Tap number</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="tap-form-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoFocus
          />
        </label>

        <label className="admin-field">
          <span>Name</span>
          <input
            type="text"
            data-testid="tap-form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
          />
        </label>

        <label className="admin-field">
          <span>Default drinker</span>
          <select
            data-testid="tap-form-default-drinker"
            value={defaultDrinkerId}
            onChange={(e) => setDefaultDrinkerId(e.target.value)}
          >
            <option value="">No default</option>
            {drinkers.map((d) => (
              <option key={d.id} value={d.id}>{d.displayName}</option>
            ))}
          </select>
        </label>

        <label className="admin-field admin-field--checkbox">
          <input
            type="checkbox"
            data-testid="tap-form-hidden"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
          />
          <span>Hide from the wall and menu (the tap stays here for later)</span>
        </label>
      </div>

      {validationError && (
        <p className="adm-danger-text" role="alert" data-testid="tap-form-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="adm-danger-text" role="alert" data-testid="tap-form-server-error">
          {serverError}
        </p>
      )}

      <div className="adm-form__actions">
        <Button type="submit" variant="primary" disabled={submitting} data-testid="tap-form-submit">
          {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add tap'}
        </Button>
        <Button variant="quiet" onClick={onCancel} data-testid="tap-form-cancel">
          Cancel
        </Button>
      </div>
    </form>
  );
}

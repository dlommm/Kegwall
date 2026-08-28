import { useState, type FormEvent } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { patchSettings } from '../../../lib/adminApi';
import type { GroupProps } from './shared';
import { MaskedSecretField } from './MaskedSecretField';

/** Kegtron group (Task 8): just the mdash.net API key, masked with a Replace affordance. */
export function KegtronGroup({ settings, onSaved }: GroupProps) {
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = replacing && newKey.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = { kegtronApiKey: newKey.trim() };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="settings-group" data-testid="settings-group-kegtron" onSubmit={handleSubmit} aria-labelledby="settings-kegtron-title">
      <h2 id="settings-kegtron-title" className="admin-field__label-text">Kegtron</h2>
      <p className="admin-page-quiet">
        The mdash.net API key used to import Kegtron Pro devices and reset on-device volume counters.
      </p>
      <MaskedSecretField
        label="API key"
        testId="settings-kegtron-apikey"
        maskedValue={settings.kegtronApiKey}
        replacing={replacing}
        value={newKey}
        onStartReplace={() => { setReplacing(true); setNewKey(''); }}
        onCancelReplace={() => { setReplacing(false); setNewKey(''); }}
        onChangeValue={setNewKey}
      />
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-kegtron-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-kegtron-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

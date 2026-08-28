import { useState } from 'react';
import type { GroupProps } from './shared';
import { MaskedSecretField } from './MaskedSecretField';
import { useSettingsGroupForm } from './useSettingsGroupForm';

/** Kegtron group (Task 8): just the mdash.net API key, masked with a Replace affordance. */
export function KegtronGroup({ settings, onSaved }: GroupProps) {
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');

  const dirty = replacing && newKey.trim() !== '';

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => ({ kegtronApiKey: newKey.trim() }),
  });

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

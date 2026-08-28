import type { GroupProps } from './shared';
import { MaskedSecretField, useMaskedSecret } from './MaskedSecretField';
import { useSettingsGroupForm } from './useSettingsGroupForm';

/** Kegtron group (Task 8): just the mdash.net API key, masked with a Replace affordance. */
export function KegtronGroup({ settings, onSaved }: GroupProps) {
  const apiKey = useMaskedSecret();

  const dirty = apiKey.dirty;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    // `!`: the hook only submits while dirty, and this form's ONLY dirty term is a
    // freshly typed key — `newValue` is defined on every reachable path.
    buildPatch: () => ({ kegtronApiKey: apiKey.newValue! }),
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
        {...apiKey.fieldProps}
      />
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-kegtron-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-kegtron-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

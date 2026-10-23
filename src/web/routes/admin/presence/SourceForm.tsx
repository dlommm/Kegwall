import type { Wall } from '../../../lib/adminApi';
import type { MatchRule, MotionSource } from '../../../../server/db/settings.js';
import type { SourceFormState } from './presenceModel';
import { Button, Drawer } from '../ui';

export interface SourceFormProps {
  form: SourceFormState;
  onChange: (form: SourceFormState) => void;
  walls: Wall[];
  submitting: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
}

/**
 * Add or edit a motion source, in a drawer. The visible fields follow the source's type; the
 * draft keeps every type's fields so switching back and forth loses nothing, and only the
 * current type's fields are saved (see `buildSourceConfig`).
 */
export function SourceForm({
  form, onChange, walls, submitting, error, onSave, onClose,
}: SourceFormProps) {
  const set = (patch: Partial<SourceFormState>) => onChange({ ...form, ...patch });
  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open && !submitting) onClose(); }}
      title={form.id ? 'Edit motion source' : 'Add a motion source'}
      description="Anything that can say “someone’s here”: an MQTT sensor, a webhook, a GPIO pin or a Bluetooth sensor."
      testId="source-form"
    >
      <form className="adm-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        <div className="adm-grid-2">
          <label className="admin-field">
            <span>Name</span>
            <input type="text" data-testid="source-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="admin-field">
            <span>Type</span>
            <select
              data-testid="source-type-select"
              value={form.type}
              onChange={(e) => set({ type: e.target.value as MotionSource['type'] })}
            >
              <option value="mqtt">MQTT</option>
              <option value="webhook">Webhook</option>
              <option value="gpio">GPIO</option>
              <option value="ble">Bluetooth (BTHome)</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Wakes</span>
            <select data-testid="source-wall-select" value={form.wallSlug} onChange={(e) => set({ wallSlug: e.target.value })}>
              <option value="">Every wall</option>
              {walls.map((w) => <option key={w.id} value={w.slug}>{`${w.name} · /wall/${w.slug}`}</option>)}
            </select>
          </label>
          <label className="studio-check">
            <input type="checkbox" data-testid="source-enabled" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span>On</span>
          </label>
        </div>

        {form.type === 'mqtt' && (
          <fieldset className="studio-group">
            <legend className="studio-group__title">MQTT</legend>
            <label className="admin-field">
              <span>Topic</span>
              <input type="text" data-testid="source-mqtt-topic" value={form.mqttTopic} onChange={(e) => set({ mqttTopic: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Counts as motion when</span>
              <select
                data-testid="source-mqtt-match-mode"
                value={form.mqttMatchMode}
                onChange={(e) => set({ mqttMatchMode: e.target.value as MatchRule['mode'] })}
              >
                <option value="any">Any message arrives</option>
                <option value="json">A JSON field equals a value</option>
                <option value="exact">The message is exactly</option>
              </select>
            </label>
            {form.mqttMatchMode === 'json' && (
              <div className="adm-grid-2">
                <label className="admin-field">
                  <span>JSON field</span>
                  <input
                    type="text"
                    data-testid="source-mqtt-json-field"
                    value={form.mqttJsonField}
                    placeholder="occupancy"
                    onChange={(e) => set({ mqttJsonField: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  <span>Equals</span>
                  <input
                    type="text"
                    data-testid="source-mqtt-json-equals"
                    value={form.mqttJsonEquals}
                    placeholder="true"
                    onChange={(e) => set({ mqttJsonEquals: e.target.value })}
                  />
                </label>
              </div>
            )}
            {form.mqttMatchMode === 'exact' && (
              <label className="admin-field">
                <span>Message</span>
                <input
                  type="text"
                  data-testid="source-mqtt-exact-value"
                  value={form.mqttExactValue}
                  onChange={(e) => set({ mqttExactValue: e.target.value })}
                />
              </label>
            )}
          </fieldset>
        )}

        {form.type === 'gpio' && (
          <fieldset className="studio-group">
            <legend className="studio-group__title">GPIO</legend>
            <label className="admin-field studio-narrow">
              <span>Line</span>
              <input type="number" min={0} data-testid="source-gpio-line" value={form.gpioLine} onChange={(e) => set({ gpioLine: e.target.value })} />
            </label>
            <label className="studio-check">
              <input
                type="checkbox"
                data-testid="source-gpio-active-low"
                checked={form.gpioActiveLow}
                onChange={(e) => set({ gpioActiveLow: e.target.checked })}
              />
              <span>Active low (motion pulls the line down)</span>
            </label>
          </fieldset>
        )}

        {form.type === 'ble' && (
          <label className="admin-field">
            <span>MAC address (empty listens to any BTHome motion sensor)</span>
            <input type="text" data-testid="source-ble-mac" value={form.bleMac} onChange={(e) => set({ bleMac: e.target.value })} />
          </label>
        )}

        {form.type === 'webhook' && (
          <p className="adm-sub">
            A webhook is known by its address. Save it, then copy its URL from the list.
          </p>
        )}

        {error && <p className="adm-danger-text" role="alert" data-testid="source-form-error">{error}</p>}
        <div className="adm-form__actions">
          <Button type="submit" variant="primary" data-testid="source-save" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="quiet" data-testid="source-cancel" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Drawer>
  );
}

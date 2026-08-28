import { useState, type FormEvent } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { patchSettings } from '../../../lib/adminApi';

interface SettingsGroupFormOptions {
  /** The caller's own dirty comparison — submit is a no-op while clean. */
  dirty: boolean;
  /** Extra submit gate beyond `dirty` (SystemGroup refuses to save mid-update). */
  blocked?: boolean;
  /**
   * Validate the draft and build the PATCH body, in ONE function because every block
   * interleaved them (parsed/trimmed values feed straight into the patch). Returning a
   * string aborts the submit and shows it as the inline error — the old hand-rolled
   * `setError(msg); return;` branches. Returning a patch submits it.
   */
  buildPatch: () => Partial<Settings> | string;
  /** Post-success local cleanup (the masked-secret blocks' self-reset idiom). */
  onSuccess?: () => void;
  /** Bubbles `(updated, patch)` up to SettingsPage — see `GroupProps.onSaved`. */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
}

/**
 * The submit skeleton every settings form on this page used to repeat verbatim (a
 * dozen hand-rolled copies): dirty gate → client-side validation → `patchSettings` →
 * inline error on failure → optional local reset → bubble the fresh canonical
 * settings (plus the exact patch sent) up via `onSaved`. Only the parts that
 * genuinely varied per block are parameters — see `SettingsGroupFormOptions`.
 * A failed validation deliberately leaves any PREVIOUS error replaced (not stacked)
 * and never touches `submitting`, exactly like the originals.
 */
export function useSettingsGroupForm({
  dirty, blocked = false, buildPatch, onSuccess, onSaved,
}: SettingsGroupFormOptions) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || blocked) return;
    const patch = buildPatch();
    if (typeof patch === 'string') {
      setError(patch);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess?.();
    onSaved(result.data, patch);
  }

  return { submitting, error, handleSubmit };
}

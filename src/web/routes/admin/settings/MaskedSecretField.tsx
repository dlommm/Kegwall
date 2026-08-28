import { useState } from 'react';

/**
 * The masked-secret state trio every secret-bearing block used to hand-roll (~8
 * copies): `replacing` (Replace clicked), the typed draft, and the reset-on-save/
 * cancel. What callers consume:
 *
 * - `dirty` — a fresh value has actually been typed; every block's dirty term for
 *   its secret was exactly `replacing && draft.trim() !== ''`.
 * - `newValue` — the trimmed replacement, or `undefined` when untouched. Blocks that
 *   merge into a stored object fall back with `secret.newValue ?? cfg?.password` —
 *   an untouched secret re-sends its masked display value, which the server's
 *   `sanitizePatch` swaps back for the real stored one (never a literal new secret).
 * - `reset()` — the self-resetting blocks' post-save cleanup (also what Cancel does);
 *   blocks that instead rely on SettingsPage's version-counter remount just don't
 *   call it.
 * - `fieldProps` — spread into `<MaskedSecretField {...secret.fieldProps} />`
 *   alongside the caller's own `label`/`testId`/`maskedValue`.
 */
export function useMaskedSecret() {
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const newValue = replacing && trimmed !== '' ? trimmed : undefined;

  function reset() {
    setReplacing(false);
    setDraft('');
  }

  return {
    dirty: newValue !== undefined,
    newValue,
    reset,
    fieldProps: {
      replacing,
      value: draft,
      onStartReplace: () => { setReplacing(true); setDraft(''); },
      onCancelReplace: reset,
      onChangeValue: setDraft,
    },
  };
}

/**
 * A masked secret field with a "Replace" affordance (Task 8): shows the server's masked
 * display value (e.g. `••••ikey`, or "Not set") and a Replace button; clicking it swaps in
 * a real text input for a brand-new value. The masked string itself is NEVER treated as
 * a real value to submit — a caller only ever reads `value` (the freshly typed
 * replacement) while `replacing` is true.
 */
export function MaskedSecretField({
  label, testId, maskedValue, replacing, value, onStartReplace, onCancelReplace, onChangeValue,
}: {
  label: string;
  testId: string;
  maskedValue: string | null | undefined;
  replacing: boolean;
  value: string;
  onStartReplace: () => void;
  onCancelReplace: () => void;
  onChangeValue: (v: string) => void;
}) {
  return (
    <div className="admin-field masked-secret" data-testid={`${testId}-field`}>
      <span>{label}</span>
      {replacing ? (
        <div className="masked-secret__row">
          <input
            type="password"
            data-testid={`${testId}-input`}
            value={value}
            onChange={(e) => onChangeValue(e.target.value)}
            autoFocus
          />
          <button type="button" data-testid={`${testId}-cancel`} onClick={onCancelReplace}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="masked-secret__row">
          <span className="masked-secret__value" data-testid={`${testId}-masked`}>
            {maskedValue || 'Not set'}
          </span>
          <button type="button" data-testid={`${testId}-replace`} onClick={onStartReplace}>
            Replace
          </button>
        </div>
      )}
    </div>
  );
}

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

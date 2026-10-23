import type { ReactNode } from 'react';

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown after the label ("Needs a swap · 3"); omitted when undefined. */
  count?: number;
}

/**
 * A row of filter chips over a list ("All 12 · Needs a swap 3"). One is always on; each is a
 * toggle button so screen readers hear which filter is applied.
 */
export function Chips<T extends string>({
  options, value, onChange, label, testId,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the chips filter, for screen readers ("Show taps"). */
  label: string;
  testId?: string;
}) {
  return (
    <div className="adm-chips" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="adm-chip"
          aria-pressed={o.value === value}
          data-value={o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <>{' '}<span className="adm-chip__count">{o.count}</span></>}
        </button>
      ))}
    </div>
  );
}

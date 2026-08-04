import {
  DAY_KEYS, DAY_LABELS, blankHours, type DayKey, type SupplierHours,
} from '../../lib/supplierHours';

const DEFAULT_RANGE = { open: '09:00', close: '17:00' };

export interface SupplierHoursEditorProps {
  value: SupplierHours | null;
  onChange: (next: SupplierHours) => void;
}

/**
 * The weekly opening-hours grid on the supplier form — one row per day with an
 * open/closed toggle, two `<input type="time">` fields, and a "Copy to all" that stamps
 * that day's range onto the whole week (the common case: five identical weekdays). A
 * one-line note sits underneath for the things a grid can't say ("call ahead").
 */
export function SupplierHoursEditor({ value, onChange }: SupplierHoursEditorProps) {
  const hours = value ?? blankHours();

  function setDay(day: DayKey, next: { open: string; close: string } | null) {
    onChange({ ...hours, days: { ...hours.days, [day]: next } });
  }

  function copyToAll(day: DayKey) {
    const range = hours.days[day];
    if (range == null) return;
    const days = { ...hours.days };
    for (const key of DAY_KEYS) days[key] = { ...range };
    onChange({ ...hours, days });
  }

  return (
    <fieldset className="supplier-hours-editor" data-testid="supplier-hours-editor">
      <legend>Opening hours</legend>
      <ul className="supplier-hours-editor__days">
        {DAY_KEYS.map((day) => {
          const range = hours.days[day];
          const open = range != null;
          return (
            <li className="supplier-hours-editor__row" key={day} data-testid={`supplier-hours-row-${day}`}>
              <label className="supplier-hours-editor__toggle">
                <input
                  type="checkbox"
                  data-testid={`supplier-hours-open-${day}`}
                  checked={open}
                  onChange={(e) => setDay(day, e.target.checked ? { ...DEFAULT_RANGE } : null)}
                />
                <span className="supplier-hours-editor__day">{DAY_LABELS[day]}</span>
              </label>
              {open ? (
                <>
                  <input
                    type="time"
                    className="font-tabular"
                    aria-label={`${DAY_LABELS[day]} opening time`}
                    data-testid={`supplier-hours-from-${day}`}
                    value={range.open}
                    onChange={(e) => setDay(day, { ...range, open: e.target.value })}
                  />
                  <span className="supplier-hours-editor__dash" aria-hidden="true">–</span>
                  <input
                    type="time"
                    className="font-tabular"
                    aria-label={`${DAY_LABELS[day]} closing time`}
                    data-testid={`supplier-hours-to-${day}`}
                    value={range.close}
                    onChange={(e) => setDay(day, { ...range, close: e.target.value })}
                  />
                  <button
                    type="button"
                    className="supplier-hours-editor__copy"
                    data-testid={`supplier-hours-copy-${day}`}
                    onClick={() => copyToAll(day)}
                  >
                    Copy to all
                  </button>
                </>
              ) : (
                <span className="supplier-hours-editor__closed">Closed</span>
              )}
            </li>
          );
        })}
      </ul>
      <label className="supplier-hours-editor__note">
        <span>Hours note</span>
        <input
          type="text"
          data-testid="supplier-hours-note"
          placeholder="Call ahead, closed public holidays…"
          maxLength={200}
          value={hours.note ?? ''}
          onChange={(e) => onChange({ ...hours, note: e.target.value === '' ? null : e.target.value })}
        />
      </label>
    </fieldset>
  );
}

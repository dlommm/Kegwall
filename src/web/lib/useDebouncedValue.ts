import { useEffect, useState } from 'react';

/**
 * Returns `value`, but only updates after it has stayed stable for `delayMs` — the
 * standard debounce-for-a-controlled-input pattern, used by the beers form's brewery
 * autocomplete and Untappd search sheet (Task 4) so neither fires a lookup request on
 * every keystroke. Each call that lands before the delay elapses resets the timer, so
 * only the FINAL value in a burst of changes is ever committed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

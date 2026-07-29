/**
 * "Your phone remembers you" (design 3b): the phone claim flow stores the
 * pourer's identity in localStorage after they join or claim, so the next
 * visit can offer a one-tap "That was me — NAME" instead of the full picker.
 * Deliberately not a credential — it's a convenience pointer to a passwordless
 * pourer row; anyone with the phone could claim a pour as them anyway.
 */

const STORAGE_KEY = 'kegtron.pourer';

export interface RememberedPourer {
  id: number;
  name: string;
}

export function getRememberedPourer(): RememberedPourer | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null
      && typeof (parsed as { id?: unknown }).id === 'number'
      && typeof (parsed as { name?: unknown }).name === 'string'
    ) {
      return { id: (parsed as { id: number }).id, name: (parsed as { name: string }).name };
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberPourer(pourer: RememberedPourer): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pourer));
  } catch {
    // Private-mode/quota failures just mean the phone won't remember — fine.
  }
}

export function forgetPourer(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

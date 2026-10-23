import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a modal sheet on the public pages, where the admin's Radix
 * Dialog isn't loaded (ADR-0001: Radix is admin-only). While `active`: focus moves into the
 * sheet, Tab and Shift+Tab wrap around its controls, Escape calls `onEscape`, and on close focus
 * returns to whatever had it before the sheet opened.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const before = document.activeElement as HTMLElement | null;
    if (!el.contains(document.activeElement)) el.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (items.length === 0) { e.preventDefault(); el.focus(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (before && document.contains(before)) before.focus();
    };
  }, [ref, active, onEscape]);
}

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { AdminDestination } from './adminNav';
import { useAdminPortal } from './ui/portal';

export interface PaletteEntry {
  id: string;
  label: string;
  /** Where it lives, shown at the right ("Taps & kegs"). */
  hint: string;
  /** An admin path, or an absolute URL that opens in a new tab. */
  to: string;
  external?: boolean;
}

/** Every page the role can reach, one entry per sub-tab (a destination without tabs is its
 * own entry), plus the extra entries the shell adds (open the wall, notifications). */
export function paletteEntries(destinations: readonly AdminDestination[], extra: PaletteEntry[] = []): PaletteEntry[] {
  const pages = destinations.flatMap((d) => (d.tabs.length === 0
    ? [{ id: d.path, label: d.label, hint: 'Page', to: d.path }]
    : d.tabs.map((t) => ({ id: t.path, label: t.label, hint: d.label, to: t.path }))));
  return [...pages, ...extra];
}

/** Case-insensitive match on the label or where it lives; label-prefix matches first. */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const hits = entries.filter((e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q));
  const starts = (e: PaletteEntry) => (e.label.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: PaletteEntry[];
  onSelect: (entry: PaletteEntry) => void;
}

/** Ctrl K / ⌘K from anywhere in the admin: type, arrow to a result, Enter to open. */
export function CommandPalette({
  open, onOpenChange, entries, onSelect,
}: CommandPaletteProps) {
  const container = useAdminPortal();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterEntries(entries, query), [entries, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function close(next: boolean) {
    if (!next) {
      setQuery('');
      setActive(0);
    }
    onOpenChange(next);
  }

  function choose(entry: PaletteEntry | undefined) {
    if (!entry) return;
    close(false);
    onSelect(entry);
  }

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="adm-overlay adm-overlay--soft" />
        <Dialog.Content className="adm-palette" data-testid="admin-palette">
          <Dialog.Title className="adm-sr-only">Go to a page</Dialog.Title>
          <Dialog.Description className="adm-sr-only">
            Type to filter, use the arrow keys to move, Enter to open.
          </Dialog.Description>
          <input
            className="adm-palette__input"
            data-testid="admin-palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="adm-palette-list"
            aria-activedescendant={results[current] ? `adm-palette-${current}` : undefined}
            aria-autocomplete="list"
            placeholder="Go to a page or setting"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((current + 1) % Math.max(1, results.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((current - 1 + results.length) % Math.max(1, results.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[current]);
              }
            }}
          />
          {results.length === 0 ? (
            <p className="adm-palette__empty">Nothing matches “{query.trim()}”.</p>
          ) : (
            <ul className="adm-palette__list" id="adm-palette-list" role="listbox" aria-label="Pages">
              {results.map((entry, i) => (
                <li
                  key={entry.id}
                  id={`adm-palette-${i}`}
                  role="option"
                  aria-selected={i === current}
                  className="adm-palette__item"
                  data-testid="admin-palette-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(entry)}
                >
                  <span>{entry.label}</span>
                  <small>{entry.hint}</small>
                </li>
              ))}
            </ul>
          )}
          <p className="adm-palette__keys" aria-hidden="true">
            <span>↑↓ to move</span>
            <span>Enter to open</span>
            <span>Esc to close</span>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

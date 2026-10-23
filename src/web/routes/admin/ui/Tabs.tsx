import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown small after the label ("Pourers 7"). */
  count?: number;
  testId?: string;
}

/**
 * A page's own sections (People's Pourers / Accounts, Analytics' reports): a WAI-ARIA tablist
 * with roving focus, so arrow keys, Home and End move between tabs. The panels are the
 * caller's; give each `role="tabpanel"` and `aria-labelledby={tabId(idBase, value)}`.
 */
export function Tabs<T extends string>({
  items, value, onChange, label, idBase, testId,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Prefix for the tab ids, unique on the page. */
  idBase: string;
  testId?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="adm-tabs" role="tablist" aria-label={label} data-testid={testId}>
      {items.map((item, i) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={tabId(idBase, item.value)}
            className="adm-tabs__tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-testid={item.testId}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {item.label}
            {item.count !== undefined && <>{' '}<small>{item.count}</small></>}
          </button>
        );
      })}
    </div>
  );
}

export function tabId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`;
}

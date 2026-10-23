import type { ReactNode } from 'react';

/** The six run states (blueprint §F). Shape and color both carry the state, so it still
 * reads in grayscale and for color-blind staff. */
export type RunState = 'enabled' | 'disabled' | 'pending' | 'executing' | 'completed' | 'failed';

const GLYPHS: Record<RunState, { label: string; shape: ReactNode }> = {
  enabled: { label: 'On', shape: <circle cx="9" cy="9" r="6" fill="currentColor" /> },
  disabled: {
    label: 'Off',
    shape: <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />,
  },
  pending: {
    label: 'Waiting',
    shape: (
      <>
        <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9 5.5V9l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  executing: {
    label: 'Running',
    shape: <path d="M9 2.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  },
  completed: {
    label: 'Done',
    shape: <path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  },
  failed: {
    label: 'Failed',
    shape: <path d="M4.5 4.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  },
};

export interface StatusDotProps {
  state: RunState;
  /** Visible text; defaults to the state's own word ("On", "Failed", …). */
  label?: ReactNode;
  /** Glyph only; the label is still announced. */
  iconOnly?: boolean;
}

export function StatusDot({ state, label, iconOnly = false }: StatusDotProps) {
  const glyph = GLYPHS[state];
  const text = label ?? glyph.label;
  return (
    <span className={`adm-state adm-state--${state}`} data-state={state}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">{glyph.shape}</svg>
      {iconOnly ? <span className="adm-sr-only">{text}</span> : text}
    </span>
  );
}

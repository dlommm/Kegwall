import type { ReactNode } from 'react';

/**
 * A short confirmation in the corner ("Saved."), announced politely to screen readers. The
 * caller decides how long it stays; nothing here needs dismissing.
 */
export function Toast({ children, tone = 'ok', testId }: {
  children: ReactNode;
  /** `warn` for a confirmation that also needs noticing ("Sources restarted"). */
  tone?: 'ok' | 'warn';
  testId?: string;
}) {
  return (
    <p className={tone === 'warn' ? 'adm-toast adm-toast--warn' : 'adm-toast'} role="status" data-testid={testId}>
      {children}
    </p>
  );
}

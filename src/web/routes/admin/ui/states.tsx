import type { CSSProperties, ReactNode } from 'react';

/** Nothing here yet: a sentence that says so, one line of help, and the action that fixes it. */
export function EmptyState({ title, children, action }: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="adm-empty" data-testid="adm-empty">
      <p className="adm-empty__title">{title}</p>
      {children && <p className="adm-empty__body">{children}</p>}
      {action && <div className="adm-empty__action">{action}</div>}
    </div>
  );
}

/** A load or save failed: what happened, in a sentence, and a retry when there is one. */
export function ErrorState({ title = 'Couldn’t load this.', children, onRetry }: {
  title?: ReactNode;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="adm-error" role="alert" data-testid="adm-error">
      <p className="adm-error__title">{title}</p>
      {children && <p className="adm-error__body">{children}</p>}
      {onRetry && (
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

/** A placeholder block while data loads. Static (no shimmer) so it never draws attention. */
export function Skeleton({ width = '100%', height = 16, className }: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}) {
  return (
    <span
      className={className ? `adm-skeleton ${className}` : 'adm-skeleton'}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

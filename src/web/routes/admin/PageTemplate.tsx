import type { ReactNode } from 'react';

export interface PageTemplateProps {
  /** Where you are, above the title ("Screens · Main wall"); omit on a destination's own page. */
  crumb?: ReactNode;
  /** A sentence about the state of things, not a label ("Eleven on tap."). */
  title: ReactNode;
  /** One line of support under the title. */
  sub?: ReactNode;
  /** At most one primary action, plus secondary ones. */
  actions?: ReactNode;
  /** The page's one lead figure under the sentence (Kegwall 2.1 "w-lead"): a few
   * `PageLeadFigure`s, set in the display face. */
  lead?: ReactNode;
  /** The page's one main list or table. */
  children: ReactNode;
  /** A Drawer for the selected row, rendered last so it stacks over the page. */
  drawer?: ReactNode;
  testId?: string;
}

/**
 * Every Kegwall V2 admin page has the same frame (blueprint §C.1, "Admin, v0.4"): a sentence
 * header with one line of support and at most one primary action, then one main list, with
 * details and editing in a right-hand drawer. The destination's sub-tabs come from the shell.
 */
export function PageTemplate({
  crumb, title, sub, actions, lead, children, drawer, testId,
}: PageTemplateProps) {
  return (
    <section className="adm-page" data-testid={testId}>
      <header className="adm-page__head">
        <div className="adm-page__say">
          {crumb && <div className="adm-page__crumb">{crumb}</div>}
          <h1 className="adm-page__title">{title}</h1>
          {sub && <p className="adm-page__sub">{sub}</p>}
          {lead && <div className="adm-page__lead" data-testid="page-lead">{lead}</div>}
        </div>
        {actions && <div className="adm-page__actions">{actions}</div>}
      </header>
      {children}
      {drawer}
    </section>
  );
}

/** One lead figure: the number large, what it counts small beside it. */
export function PageLeadFigure({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: 'warn' }) {
  return (
    <span className={tone ? `adm-page__figure adm-page__figure--${tone}` : 'adm-page__figure'}>
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}

import type { TableHTMLAttributes } from 'react';

/** The admin list table: quiet header, a rule between rows, numbers right-aligned with the
 * `adm-num` cell class. Scrolls sideways inside its own box on narrow screens. */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="adm-table-wrap">
      <table className={className ? `adm-table ${className}` : 'adm-table'} {...rest} />
    </div>
  );
}

import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  help?: ReactNode;
}

/**
 * A labelled choice. A native `<select>` skinned with the admin tokens rather than a Radix
 * listbox: phones and tablets keep their own picker, and it needs no extra script.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, help, id, className, children, ...rest }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    const helpId = help ? `${selectId}-help` : undefined;
    return (
      <div className={className ? `adm-field ${className}` : 'adm-field'}>
        <label className="adm-field__label" htmlFor={selectId}>{label}</label>
        <select ref={ref} id={selectId} className="adm-select" aria-describedby={helpId} {...rest}>
          {children}
        </select>
        {help && <span className="adm-field__help" id={helpId}>{help}</span>}
      </div>
    );
  },
);
SelectField.displayName = 'SelectField';

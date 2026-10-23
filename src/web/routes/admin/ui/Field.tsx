import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
}

/** A labelled text input with optional help and an inline error, all wired for screen readers. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, help, error, id, className, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const helpId = help ? `${inputId}-help` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
    return (
      <div className={className ? `adm-field ${className}` : 'adm-field'}>
        <label className="adm-field__label" htmlFor={inputId}>{label}</label>
        <input
          ref={ref}
          id={inputId}
          className="adm-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {help && <span className="adm-field__help" id={helpId}>{help}</span>}
        {error && <span className="adm-field__error" id={errorId}>{error}</span>}
      </div>
    );
  },
);
Field.displayName = 'Field';

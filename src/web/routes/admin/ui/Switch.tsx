import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label; without one, pass `aria-label`. */
  label?: ReactNode;
}

/** An on/off switch: a 44 px tall hit area around a 46 × 28 track. */
export function Switch({
  checked, onCheckedChange, label, className, ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={className ? `adm-switch ${className}` : 'adm-switch'}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      <span className="adm-switch__track" aria-hidden="true" />
      {label && <span className="adm-switch__label">{label}</span>}
    </button>
  );
}

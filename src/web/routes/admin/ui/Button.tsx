import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react';
import { Link } from 'react-router';

/** primary: the page's one main action · secondary: outlined · quiet: text only · danger. */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

function buttonClass(variant: ButtonVariant, className?: string): string {
  return className ? `adm-btn adm-btn--${variant} ${className}` : `adm-btn adm-btn--${variant}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', className, type = 'button', ...rest }, ref) => (
    // eslint-disable-next-line react/button-has-type -- the default is set above
    <button ref={ref} type={type} className={buttonClass(variant, className)} {...rest} />
  ),
);
Button.displayName = 'Button';

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
}

/** A router link that looks like a button (row actions that go to another page). */
export function ButtonLink({ variant = 'secondary', className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, className)} {...rest} />;
}

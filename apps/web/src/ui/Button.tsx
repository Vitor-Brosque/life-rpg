import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../art/icons';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
}

/** Pixel button. Defaults to type="button"; icon-only buttons need an aria-label. */
export function Button({ variant = 'secondary', icon, size = 'md', className, type = 'button', children, ...rest }: ButtonProps) {
  const iconOnly = icon !== undefined && (children === undefined || children === null || children === false);
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, iconOnly && 'btn--icon-only', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 36 : 24} />}
      {children}
    </button>
  );
}

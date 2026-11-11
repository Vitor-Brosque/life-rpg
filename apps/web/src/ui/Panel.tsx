import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'parchment' | 'stone';
  children?: ReactNode;
  className?: string;
}

/** Framed surface: parchment (main cards, dark ink text) or stone (secondary, light text). */
export function Panel({ variant = 'parchment', className, children, ...rest }: PanelProps) {
  const cls = ['panel', `panel--${variant}`, 'px-border', 'px-shadow', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}

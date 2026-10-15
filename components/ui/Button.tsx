import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ICON_STROKE } from '@/components/shell/nav';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-border-strong text-ink hover:bg-surface-2',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-negative text-surface-1 hover:opacity-90',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: Size = 'md', iconOnly = false): string {
  const box = size === 'sm'
    ? iconOnly ? 'h-8 w-8' : 'min-h-8 px-3 text-[13px] leading-[18px]'
    : iconOnly ? 'h-11 w-11' : 'min-h-11 px-4';
  return `inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-2 disabled:text-ink-disabled ${box} ${VARIANTS[variant]} ${FOCUS_RING}`;
}

type Common = { variant?: ButtonVariant; size?: Size; icon?: LucideIcon; iconOnly?: boolean };

function Inner({ icon: Icon, size, iconOnly, children }: Common & { children?: React.ReactNode }) {
  return (
    <>
      {Icon && <Icon size={size === 'sm' ? 16 : 20} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      {!iconOnly && children}
    </>
  );
}

/** Icon-only buttons must carry an `aria-label` in Portuguese. */
export function Button({ variant, size = 'md', icon, iconOnly = false, className = '', children, type = 'button', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`${buttonClasses(variant, size, iconOnly)} ${className}`} {...rest}>
      <Inner icon={icon} size={size} iconOnly={iconOnly}>{children}</Inner>
    </button>
  );
}

export function ButtonLink({ variant, size = 'md', icon, iconOnly = false, className = '', children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={`${buttonClasses(variant, size, iconOnly)} ${className}`} {...rest}>
      <Inner icon={icon} size={size} iconOnly={iconOnly}>{children}</Inner>
    </Link>
  );
}

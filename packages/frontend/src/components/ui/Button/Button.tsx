import type React from 'react';
import { cn } from '../../../lib/cn';

/** The three button intents. Primary is the default call-to-action; ghost is secondary; danger is destructive. */
export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The base interactive button for the app. Extends the native button element so every HTML attribute
 * and event is available to callers without needing to patch this component.
 *
 * Minimum touch target is 48x48px via `min-h-12`. The incoming `className` is applied last so a
 * caller can override any default utility.
 */

// Variant classes are fully static so Tailwind's scanner can always find them; no interpolation.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-amber text-text-on-amber hover:brightness-110',
  ghost:
    'bg-transparent text-text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-text hover:bg-surface-sunken',
  danger: 'bg-danger text-white hover:brightness-110',
};

export function Button({ variant = 'primary', className, ref, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      // rest is spread before the composed className so callers never accidentally override it
      {...rest}
      ref={ref}
      className={cn(
        'inline-flex min-h-12 cursor-pointer items-center justify-center gap-[7px] rounded-[10px] border-0 px-[14px] text-[13.5px] font-[650]',
        variantClasses[variant],
        className,
      )}
    />
  );
}

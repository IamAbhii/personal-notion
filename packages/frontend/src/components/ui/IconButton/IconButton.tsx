import type React from 'react';
import { cn } from '../../../lib/cn';

export interface IconButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  /** The icon to display. Must be aria-hidden at the source. */
  icon: React.ReactNode;
  /** Required: the accessible name for screen readers. The icon carries no text. */
  'aria-label': string;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * An icon-only control: drag handle, block delete, row actions. The visual mark can be small
 * (16-24px) but the hit area is always at least 48x48px so a thumb can reach it reliably.
 * `aria-label` is required because the icon carries no accessible name.
 */
export function IconButton({ icon, className, ref, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      // rest is spread before className so caller-supplied props are never silently overwritten
      {...rest}
      ref={ref}
      className={cn(
        'inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-3 text-text-muted',
        'hover:bg-surface hover:text-text',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      {icon}
    </button>
  );
}

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

/** Controls the card shell appearance: no-border raised surface, bordered raised surface, or dashed sunken surface. */
export type StatusCardVariant = 'raised' | 'bordered' | 'sunken';

/** Controls the eyebrow accent color: amber (default), danger-red, or brand-blue. */
export type StatusCardEyebrowIntent = 'accent' | 'error' | 'info';

/** Maps card variant to the shell classes that differ between them. */
const variantClasses: Record<StatusCardVariant, string> = {
  raised: 'bg-surface shadow-panel',
  bordered: 'border border-border bg-surface shadow-panel',
  sunken: 'border border-dashed border-border bg-surface-sunken',
};

/** Maps eyebrow intent to its accessible accent color on the card surface.
 *  The -fg token variants swap to darker shades in light theme where the vivid brand palette
 *  fails WCAG AA 4.5:1 on white. In dark theme they resolve to the original vibrant values. */
const eyebrowClasses: Record<StatusCardEyebrowIntent, string> = {
  accent: 'text-amber-fg',
  error: 'text-danger-fg',
  info: 'text-blue-fg',
};

export interface StatusCardProps {
  /**
   * Shell appearance. 'raised' = surface + panel shadow (default). 'bordered' = surface + panel
   * shadow + solid border. 'sunken' = sunken surface + dashed border.
   */
  variant?: StatusCardVariant;
  /** Eyebrow accent color. 'accent' = amber (default), 'error' = danger-red, 'info' = brand-blue. */
  eyebrowIntent?: StatusCardEyebrowIntent;
  /** Short uppercase label above the title. */
  eyebrow: ReactNode;
  /** The primary message heading. */
  lead: ReactNode;
  /** Secondary body text below the lead. */
  note?: ReactNode;
  /** Extra className applied to the card shell — use to control width or add margin at the call site. */
  className?: string;
  /** Footer slot: action buttons, links, or any other follow-up content. */
  children?: ReactNode;
}

/**
 * The shared card shell for status screens and empty-state placeholders. Provides a consistent
 * eyebrow + lead + optional note + optional action layout across loading, error, empty and
 * not-found states.
 *
 * Use `variant` for the card shell appearance and `eyebrowIntent` for the label accent color.
 * Pass action buttons (or any content) via `children`. Sizing and margin are left to the caller
 * via `className` so the card fits in both full-screen centered layouts and inline content areas.
 *
 * Future: if additional variants are needed (success, warning), add them to `StatusCardVariant`
 * and `variantClasses` without touching the callers.
 */
export function StatusCard({
  variant = 'raised',
  eyebrowIntent = 'accent',
  eyebrow,
  lead,
  note,
  className,
  children,
}: StatusCardProps) {
  return (
    <div className={cn('rounded-lg p-7 text-left', variantClasses[variant], className)}>
      <p
        className={cn(
          'm-0 text-xs font-bold tracking-[0.11em] uppercase',
          eyebrowClasses[eyebrowIntent],
        )}
      >
        {eyebrow}
      </p>
      <p className="m-0 mt-2.5 text-lg font-[650]">{lead}</p>
      {note ? (
        <p className="m-0 mt-2 max-w-[56ch] text-sm leading-relaxed text-text-muted">{note}</p>
      ) : null}
      {children}
    </div>
  );
}

import type React from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import { cn } from '../../../lib/cn';

export interface PopoverProps {
  /** The element that opens the popover. Rendered via Radix Trigger so positioning is automatic. */
  trigger: React.ReactNode;
  /** The popover panel content. */
  children: React.ReactNode;
  /** Controls the open state externally. Uncontrolled when omitted. */
  open?: boolean;
  /** Called when Radix wants to open or close: trigger click, Escape key, outside click. */
  onOpenChange?: (open: boolean) => void;
  /** Alignment of the panel relative to the trigger. */
  align?: 'start' | 'center' | 'end';
  /** Extra className on the content panel. */
  className?: string;
}

/**
 * A collision-aware popover built on Radix Popover. Radix handles Escape, outside-click, and
 * automatic viewport collision avoidance. Use the `trigger` slot prop so the anchor is always
 * the element the popover is semantically tied to.
 */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  className,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          // Keep the popover 8px away from viewport edges so it never clips on narrow screens.
          collisionPadding={8}
          // Constrain width so a 340px picker does not overflow a 320px viewport.
          className={cn(
            'max-w-[calc(100vw-1rem)] overflow-hidden rounded-[var(--radius-md)] bg-surface shadow-[var(--shadow-pop)]',
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

import type React from 'react';
import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import { cn } from '../../../lib/cn';

export interface DropdownMenuProps {
  /**
   * The element that opens the menu. Rendered via Radix Trigger with asChild so the element keeps
   * its own accessible name, role and keyboard behaviour.
   */
  trigger: React.ReactNode;
  /** Menu items, typically DropdownMenuItem elements. */
  children: React.ReactNode;
  /** Controls open state externally. Uncontrolled when omitted. */
  open?: boolean;
  /** Called when Radix wants to change open state: trigger click, Escape, outside click. */
  onOpenChange?: (open: boolean) => void;
  /** Alignment of the menu panel relative to the trigger. Defaults to end for row-action menus. */
  align?: 'start' | 'center' | 'end';
  /** Extra className on the content panel. */
  className?: string;
}

// Inheriting Radix Item props gives TypeScript-safe data-*, aria-*, onSelect and disabled handling.
type RadixItemProps = React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>;

export interface DropdownMenuItemProps extends RadixItemProps {
  /** Destructive actions use danger colors; all others use the default neutral token. */
  variant?: 'default' | 'danger';
}

// Fully static variant class map so Tailwind's scanner can always find them; no interpolation.
// The menu panel renders on bg-surface (white in light theme, dark gray in dark), so text tokens
// must be surface-appropriate rather than panel-appropriate. text-text is readable on surface in
// both themes; text-danger-fg is a theme-switching token (dark red in light, soft red in dark).
const itemVariantClasses: Record<NonNullable<DropdownMenuItemProps['variant']>, string> = {
  default: 'text-text data-[highlighted]:bg-surface-hover',
  danger: 'text-danger-fg data-[highlighted]:bg-danger/10',
};

/**
 * A single item inside a DropdownMenu. The data-[highlighted] variant fires on keyboard focus or
 * pointer hover — Radix manages it, no manual state needed.
 *
 * Pass data-testid for end-to-end selectors: the testid must be on both the desktop row button and
 * the corresponding menu item so specs can find the action at either viewport.
 */
export function DropdownMenuItem({
  variant = 'default',
  className,
  ...rest
}: DropdownMenuItemProps) {
  return (
    <RadixDropdownMenu.Item
      {...rest}
      className={cn(
        // min-h-12 keeps the touch target at 48px even when the icon alone would be shorter.
        'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-sm px-3 text-sm outline-none select-none',
        itemVariantClasses[variant],
        className,
      )}
    />
  );
}

/**
 * A collision-aware dropdown menu built on Radix DropdownMenu. Radix owns focus management,
 * Escape, outside-click and typeahead — none of that is hand-rolled here.
 *
 * The trigger slot prop keeps the anchor semantically tied to the panel it controls.
 */
export function DropdownMenu({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  className,
}: DropdownMenuProps) {
  return (
    <RadixDropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align={align}
          // 8px breathing room so the panel never clips on narrow viewports.
          collisionPadding={8}
          // Prevent Radix from returning focus to the trigger on close: the selected action may
          // open its own focused element (a rename input, a dialog), and stealing focus back would
          // immediately blur that element and dismiss it.
          onCloseAutoFocus={(e) => e.preventDefault()}
          // z-50 lifts the menu above the sidebar and any other stacked content.
          className={cn(
            // border-border gives the panel a defined edge in dark theme where --shadow-pop
            // (dark rgba) renders invisibly against the dark canvas.
            'z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-surface p-1 shadow-[var(--shadow-pop)]',
            className,
          )}
        >
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

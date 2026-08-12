import type React from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '../../../lib/cn';

export interface DialogContentProps {
  /** Controls whether the dialog is visible. */
  open: boolean;
  /** Called when Radix wants to close: Escape key, overlay click. Forward to the parent's close handler. */
  onOpenChange: (open: boolean) => void;
  /** The dialog heading. Rendered as an accessible label for the dialog. */
  title: React.ReactNode;
  /** Optional description shown below the title. */
  description?: React.ReactNode;
  /** Footer content, typically action buttons. */
  footer?: React.ReactNode;
  /** The main dialog body. */
  children?: React.ReactNode;
  /** Additional className for the content panel. */
  className?: string;
}

/**
 * A modal dialog built on Radix Dialog. Radix handles focus trap, focus return, scroll lock,
 * Escape key, and overlay click — no hand-rolled effects needed at the call site.
 *
 * Compose via slot props (`title`, `description`, `footer`, `children`) rather than boolean flags.
 * The `open` / `onOpenChange` pattern matches Radix's controlled API and lets the parent decide
 * when the dialog is visible without internal state.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: DialogContentProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* Semi-opaque backdrop; Radix dismisses on click. */}
        <RadixDialog.Overlay className="fixed inset-0 z-20 grid place-items-center bg-[rgba(12,11,16,0.55)]">
          <RadixDialog.Content
            className={cn(
              'w-[min(440px,calc(100vw-2rem))] rounded-[var(--radius-lg)] bg-surface p-6 text-text shadow-[var(--shadow-pop)]',
              className,
            )}
          >
            <RadixDialog.Title className="m-0 text-[19px] font-bold tracking-[-0.015em]">
              {title}
            </RadixDialog.Title>

            {description && (
              <RadixDialog.Description asChild>
                <div className="mt-2">{description}</div>
              </RadixDialog.Description>
            )}

            {children && <div>{children}</div>}

            {footer && <div className="mt-[22px] flex justify-end gap-[10px]">{footer}</div>}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

import { Suspense, lazy } from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import type { EmojiClickData, Theme } from 'emoji-picker-react';

// The picker is a large dependency and only opens on demand, so it is code-split out of the shell.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

export interface EmojiPickerPopoverProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * The emoji chooser for a page icon. The scrim, Escape and outside-click are handled by Radix
 * Popover so no useEffect is needed. The picker itself (emoji-picker-react) stays lazy-loaded.
 *
 * The component is conditionally rendered by its parent (`{isPickingIcon ? ... : null}`), so the
 * Radix Popover is always `open` when mounted. Radix calling `onOpenChange(false)` (Escape or
 * outside click) is forwarded to `onClose`, which unmounts this component.
 *
 * At 320px the picker is constrained by `collisionPadding` in the Popover primitive so it never
 * overflows the viewport edge.
 */
export function EmojiPickerPopover({ onPick, onClose }: EmojiPickerPopoverProps) {
  // Match the picker's own chrome to the app theme, which is set on <html> before first paint.
  const isDark = document.documentElement.dataset.theme === 'dark';
  // Cap the picker at the viewport width minus 16px of edge padding (8px each side) so it stays
  // fully usable at 320px. The third-party EmojiPicker renders at a fixed width set by its `width`
  // prop; constraining from the outside (max-w on the popover) clips it without making it
  // scrollable, so we size the picker itself to fit rather than fighting its internals.
  const pickerWidth = Math.min(340, window.innerWidth - 16);

  return (
    <RadixPopover.Root
      open
      onOpenChange={(open) => {
        // Radix calls this with false on Escape or a click outside the content area.
        if (!open) onClose();
      }}
    >
      {/*
        A zero-size anchor inside the page icon wrap positions the popover next to the icon button.
        This component is rendered as a sibling to that button, so the anchor sits at the same
        origin and Radix's collision avoidance handles viewport edges.
      */}
      <RadixPopover.Anchor className="absolute inset-0 h-0 w-0" />
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          // 8px away from viewport edges keeps the picker on screen at 320px.
          collisionPadding={8}
          className="overflow-hidden rounded-md bg-surface shadow-[var(--shadow-pop)]"
          role="dialog"
          aria-label="Choose a page icon"
          onInteractOutside={onClose}
        >
          {/* The fallback div matches the picker's width/height so the placeholder holds the same
              space as the loaded picker and avoids a layout shift on load. */}
          <Suspense
            fallback={
              <div
                className="grid h-[400px] place-items-center bg-surface text-sm text-text-muted"
                style={{ width: pickerWidth }}
              >
                Loading emoji...
              </div>
            }
          >
            <EmojiPicker
              // The Theme enum is a value export; casting the literal keeps the import type-only
              // so the picker stays code-split.
              theme={(isDark ? 'dark' : 'light') as Theme}
              lazyLoadEmojis
              width={pickerWidth}
              height={400}
              onEmojiClick={(data: EmojiClickData) => {
                onPick(data.emoji);
                onClose();
              }}
            />
          </Suspense>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

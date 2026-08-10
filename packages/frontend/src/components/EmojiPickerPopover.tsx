import { Suspense, lazy, useEffect } from 'react';
import type { EmojiClickData, Theme } from 'emoji-picker-react';

// The picker is a large dependency and only opens on demand, so it is code-split out of the shell.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

export interface EmojiPickerPopoverProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * The emoji chooser for a page icon, from the maintained emoji-picker-react library rather than a
 * hand-rolled grid. Closes on Escape or on a click outside.
 */
export function EmojiPickerPopover({ onPick, onClose }: EmojiPickerPopoverProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Match the picker's own chrome to the app theme, which is set on <html> before first paint.
  const isDark = document.documentElement.dataset.theme === 'dark';

  return (
    <div className="popover-scrim" onMouseDown={onClose}>
      <div
        className="popover"
        role="dialog"
        aria-label="Choose a page icon"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Suspense fallback={<div className="popover__loading">Loading emoji...</div>}>
          <EmojiPicker
            // The Theme enum is a value export; casting the literal keeps the import type-only so
            // the picker stays code-split.
            theme={(isDark ? 'dark' : 'light') as Theme}
            lazyLoadEmojis
            width={340}
            height={400}
            onEmojiClick={(data: EmojiClickData) => {
              onPick(data.emoji);
              onClose();
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

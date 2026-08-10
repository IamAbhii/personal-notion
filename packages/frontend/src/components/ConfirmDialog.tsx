import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  title: string;
  /** Lines of body copy. Kept as an array so the caller can spell out consequences line by line. */
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation. Destructive actions route through this so nothing irreversible - deleting a
 * page and everything nested inside it - happens on a single click.
 */
export function ConfirmDialog({
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button and let Escape cancel, so the dialog is usable from the keyboard.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="confirm-dialog-title">
          {title}
        </h2>
        <div className="dialog__body">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            ref={confirmRef}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { Dialog } from './ui/Dialog/Dialog';
import { Button } from './ui/Button/Button';

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
 *
 * Radix Dialog handles focus trap, focus return, scroll lock, Escape and overlay click, so no
 * hand-rolled keydown listener or stopPropagation is needed here. `autoFocus` on the confirm button
 * directs Radix's focus-scope to land on it when the dialog opens.
 */
export function ConfirmDialog({
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Radix calls this with false on Escape or overlay click; forward to the parent's handler.
        if (!open) onCancel();
      }}
      title={title}
      description={lines.map((line) => (
        // first:mt-0 removes the top margin from the first paragraph since the Dialog's description
        // wrapper already provides spacing below the title. mt-2.5 matches the original
        // .dialog__body p { margin: 10px 0 0 } rule.
        <p key={line} className="m-0 mt-2.5 text-sm leading-relaxed text-text-muted first:mt-0">
          {line}
        </p>
      ))}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {/* autoFocus directs Radix's focus-scope to land here when the dialog opens. */}
          <Button variant="danger" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

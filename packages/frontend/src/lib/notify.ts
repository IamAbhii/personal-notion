import { toast } from 'sonner';

// The user-facing channel for things the app has to say about a write: a server rejection, or a
// write that could not be sent. Kept separate from the mutations so any later feature can post one.

/** The tone of a notice. `warning` is a dropped or refused write; `info` is a plain statement. */
export type NoticeTone = 'warning' | 'info';

/**
 * How long a notice stays on screen before auto-dismissing. 2 seconds is long enough to read a
 * short warning without the user having to act, and short enough that an accidental notice does
 * not linger. The user can still dismiss it earlier by clicking the close button.
 */
export const NOTICE_DURATION_MS = 2000;

/**
 * Posts a message to the sonner toast stack. Notices auto-dismiss after NOTICE_DURATION_MS but
 * can be closed earlier. A stable `id` derived from the message text prevents identical messages
 * from stacking: calling notify twice with the same string replaces the existing toast rather than
 * adding a second card.
 *
 * Future: Phase 6's sync status indicator reads the same list for "N pending / offline / failed".
 */
export function notify(message: string, tone: NoticeTone = 'warning'): void {
  const options = {
    // The message itself is the id so repeated identical notices collapse to one card.
    id: message,
    duration: NOTICE_DURATION_MS,
    // testId renders as data-testid on the toast element, keeping the e2e selector [data-testid="notice"] working.
    testId: 'notice',
  };
  if (tone === 'info') {
    toast.info(message, options);
  } else {
    toast.warning(message, options);
  }
}

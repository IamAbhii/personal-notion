import { useCallback, useRef, useState } from 'react';

// The user-facing channel for things the app has to say about a write: a server rejection, or a
// write that could not be sent. Kept separate from the mutations so any later feature can post one.

/** The tone of a notice. `warning` is a dropped or refused write; `info` is a plain statement. */
export type NoticeTone = 'warning' | 'info';

export interface Notice {
  id: string;
  tone: NoticeTone;
  /** One sentence, plainly worded: what was dropped and why. */
  message: string;
}

export interface Notices {
  notices: Notice[];
  notify: (message: string, tone?: NoticeTone) => void;
  dismiss: (id: string) => void;
}

/**
 * Holds the notices currently on screen. They stay until dismissed rather than fading, because a
 * dropped write is something the user has to read before it is safe to hide.
 * Future: Phase 6's sync status indicator reads the same list for "N pending / offline / failed".
 */
export function useNotices(): Notices {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((message: string, tone: NoticeTone = 'warning') => {
    nextId.current += 1;
    const id = `notice-${nextId.current}`;
    // Repeating the same message would stack identical cards, which reads as a bug, so replace it.
    setNotices((current) => [
      ...current.filter((n) => n.message !== message),
      { id, tone, message },
    ]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  return { notices, notify, dismiss };
}

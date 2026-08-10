import type { Notice } from '../hooks/useNotices';

export interface NoticeStackProps {
  notices: Notice[];
  onDismiss: (id: string) => void;
}

/**
 * The stack of write notices in the corner of the shell. It is a live region, so a rejection the
 * server reported while the user was looking elsewhere is announced rather than only drawn.
 */
export function NoticeStack({ notices, onDismiss }: NoticeStackProps) {
  return (
    <div className="notices" role="status" aria-live="polite" aria-label="Notices">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice notice--${notice.tone}`}>
          <p className="notice__message">{notice.message}</p>
          <button
            type="button"
            className="notice__dismiss"
            aria-label={`Dismiss notice: ${notice.message}`}
            onClick={() => onDismiss(notice.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

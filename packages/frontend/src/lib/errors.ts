import { ApiError } from '../api/client';
import { OpRejectedError } from '../sync/ops';

// Turns a failed read or write into something a person can act on. One place, because every op in
// the product fails in the same three ways: the server rejected it, the network was not there, or
// the API answered with a status.

/**
 * True when the failure is because the device is offline. An ApiError always means the server
 * replied, so it is never offline. A network-ish TypeError (the browser's text for a fetch that
 * never reached a server) is only treated as offline when navigator.onLine confirms it — if the
 * device reports online, a TypeError is more likely a large-body keepalive rejection or a CORS
 * failure, not an actual offline condition, so we return false and let it fall through to a
 * generic retry message instead of the misleading "you are offline" one.
 */
export function isOfflineError(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // If the browser says we are online, do not claim the user is offline even if the error looks
  // network-ish. A TypeError here is more likely a keepalive body-size rejection (64 KiB cap) or
  // a connection refused — not the absence of network.
  return false;
}

/** Every reason the server gave for the ops it refused, deduplicated and lower-cased for a sentence. */
function rejectionReasons(error: OpRejectedError): string {
  const reasons = error.results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason ?? 'the server refused it');
  return [...new Set(reasons)].join('; ');
}

/**
 * The sentence shown when a write did not happen. `action` names what was attempted, in the past
 * tense subject form - `Renaming "Lisbon"` - so any op type reads correctly without a special case.
 * A server rejection is reported with the reason verbatim, because the reason is the whole point:
 * the client cannot know whether the target was deleted, the title too long or the key invalid.
 */
export function describeWriteFailure(action: string, error: unknown): string {
  if (error instanceof OpRejectedError) {
    return `${action} was dropped by the server: ${rejectionReasons(error)}. The workspace has been refreshed.`;
  }
  if (isOfflineError(error)) {
    // Future: Phase 6 queues the op durably instead, so this becomes "saved locally, will sync".
    return `${action} could not be saved because you are offline. Try again once you are back online.`;
  }
  if (error instanceof TypeError) {
    // A TypeError that is not offline (navigator.onLine is true) is a transient network problem —
    // a keepalive body-size rejection, a connection reset, or similar. Give a retry prompt without
    // claiming the user is offline, which would be false and confusing.
    return `${action} could not be saved. Please try again.`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `${action} could not be saved: ${detail}`;
}

/** What the full-window failure screen says. Offline is the common case and gets its own wording. */
export function describeLoadFailure(error: unknown): { title: string; detail: string } {
  if (isOfflineError(error)) {
    return {
      title: 'You are offline',
      // Future: with the IndexedDB-persisted snapshot from Phase 6 this screen is not reached at all.
      detail:
        'Personal Space could not reach the server, so it cannot show your workspace yet. Reconnect and try again.',
    };
  }
  if (error instanceof ApiError) {
    return {
      title: 'The server refused the request',
      detail: `${error.status}: ${error.message}`,
    };
  }
  return {
    title: 'Something went wrong',
    detail: error instanceof Error ? error.message : String(error),
  };
}

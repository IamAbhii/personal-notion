import { describe, expect, it } from 'vitest';
import { describeWriteFailure, describeLoadFailure, isOfflineError } from './errors';
import { ApiError } from '../api/client';
import { OpRejectedError } from '../sync/ops';

// ── isOfflineError ─────────────────────────────────────────────────────────────

describe('isOfflineError', () => {
  it('returns false for an ApiError (the server replied)', () => {
    expect(isOfflineError(new ApiError(500, 'Internal error'))).toBe(false);
  });

  it('returns false for a "Failed to fetch" TypeError when navigator.onLine is true', () => {
    // With the fix, a network-ish TypeError is only offline when navigator.onLine is false.
    // When the browser says we are online, a TypeError is more likely a keepalive body-size
    // rejection (the 64 KiB Fetch spec cap) than genuine offline, so we return false.
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('returns false for a "Load failed" TypeError when navigator.onLine is true', () => {
    expect(isOfflineError(new TypeError('Load failed'))).toBe(false);
  });

  it('returns false for a generic application error', () => {
    expect(isOfflineError(new Error('something blew up'))).toBe(false);
  });

  it('returns false for a non-Error non-network string', () => {
    // Covers the String(error) path in isOfflineError — a plain string that does not mention "fetch".
    expect(isOfflineError('database constraint violation')).toBe(false);
  });

  it('returns true when navigator.onLine is false regardless of the error type (line 11)', () => {
    // Simulate the browser reporting it is offline via navigator.onLine. The check on line 11
    // short-circuits before the message pattern match, so any error passed returns true.
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      expect(isOfflineError(new Error('some random error'))).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, 'onLine', original);
      } else {
        Object.defineProperty(window.navigator, 'onLine', {
          value: true,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

// ── describeWriteFailure ───────────────────────────────────────────────────────

describe('describeWriteFailure', () => {
  it('uses the default rejection description when the server provides no reason', () => {
    // Covers the `?? 'the server refused it'` fallback (line 21 of errors.ts).
    const err = new OpRejectedError([
      // reason is undefined here — no reason provided
      { opId: 'op-1', status: 'rejected', reason: undefined, entityId: 'p-1', version: 1 },
    ]);
    const msg = describeWriteFailure('Creating a block', err);
    expect(msg).toContain('the server refused it');
  });

  it('mentions the rejection reason when the server refused the op', () => {
    const err = new OpRejectedError([
      { opId: 'op-1', status: 'rejected', reason: 'page not found', entityId: 'p-1', version: 1 },
    ]);
    const msg = describeWriteFailure('Renaming "Lisbon"', err);
    expect(msg).toContain('page not found');
    expect(msg).toContain('Renaming "Lisbon"');
  });

  it('says "offline" when navigator.onLine is false', () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      const msg = describeWriteFailure('Creating a page', new TypeError('Failed to fetch'));
      expect(msg).toMatch(/offline/i);
      expect(msg).toContain('Creating a page');
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, 'onLine', original);
      } else {
        Object.defineProperty(window.navigator, 'onLine', {
          value: true,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it('says "Please try again" (not "offline") for a TypeError when navigator.onLine is true', () => {
    // This is the keepalive 64 KiB cap case: fetch() rejects with a TypeError even though the
    // device is online. We must not say "offline" — that is the bug this fix addresses.
    const msg = describeWriteFailure('Adding a image block', new TypeError('Failed to fetch'));
    expect(msg).not.toMatch(/offline/i);
    expect(msg).toMatch(/please try again/i);
    expect(msg).toContain('Adding a image block');
  });

  it('includes the error message as detail for a plain Error (fallback path)', () => {
    // This covers line 39: the general-error fallback in describeWriteFailure.
    const msg = describeWriteFailure('Saving the page', new Error('unexpected state'));
    expect(msg).toContain('Saving the page');
    expect(msg).toContain('unexpected state');
  });

  it('stringifies a non-Error throw (fallback path with a string)', () => {
    const msg = describeWriteFailure('Deleting a block', 'string error');
    expect(msg).toContain('Deleting a block');
    expect(msg).toContain('string error');
  });
});

// ── describeLoadFailure ────────────────────────────────────────────────────────

describe('describeLoadFailure', () => {
  it('returns "You are offline" when navigator.onLine is false', () => {
    // isOfflineError only returns true when navigator.onLine is explicitly false.
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    try {
      const { title } = describeLoadFailure(new TypeError('Failed to fetch'));
      expect(title).toBe('You are offline');
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, 'onLine', original);
      } else {
        Object.defineProperty(window.navigator, 'onLine', {
          value: true,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it('returns "Something went wrong" for a fetch TypeError when navigator.onLine is true', () => {
    // A TypeError while online is not an offline error — it falls through to the generic path.
    const { title } = describeLoadFailure(new TypeError('Failed to fetch'));
    expect(title).toBe('Something went wrong');
  });

  it('returns the API status for an ApiError', () => {
    const { title, detail } = describeLoadFailure(new ApiError(401, 'unauthorized'));
    expect(title).toBe('The server refused the request');
    expect(detail).toBe('401: unauthorized');
  });

  it('returns "Something went wrong" for a generic Error', () => {
    const { title, detail } = describeLoadFailure(new Error('parse error'));
    expect(title).toBe('Something went wrong');
    expect(detail).toBe('parse error');
  });

  it('stringifies a non-Error throw in the detail field (String(error) path)', () => {
    // Covers line 61 of errors.ts: `String(error)` when `error` is not an Error instance.
    const { title, detail } = describeLoadFailure('raw string error');
    expect(title).toBe('Something went wrong');
    expect(detail).toBe('raw string error');
  });
});

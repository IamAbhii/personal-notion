import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushStashedOps,
  isLeaving,
  readStashedOps,
  stashOps,
  submitOnUnload,
  watchForUnload,
} from './ops';
import { buildBlockUpdateOp } from './blockOps';

// DEF-013: an edit inside the 500ms debounce window was lost on a reload, because nothing flushed at
// the unload boundary and, once something did, a fetch started there never left the document.

const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

// Registered once, as the app does at start-up.
watchForUnload();

beforeEach(() => {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('watchForUnload', () => {
  it('reads as staying put while the page is just being used', () => {
    expect(isLeaving()).toBe(false);
  });

  it('knows the page is leaving on pagehide, which is a reload or a navigation away', () => {
    window.dispatchEvent(new Event('pagehide'));

    expect(isLeaving()).toBe(true);
  });

  it('knows the page is leaving when it is backgrounded, which is all a phone gives', () => {
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(isLeaving()).toBe(true);
  });

  it('goes back to normal when the page comes back, so later writes read their response', () => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));

    expect(isLeaving()).toBe(false);
  });
});

describe('submitOnUnload', () => {
  const op = () =>
    buildBlockUpdateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      baseVersion: 3,
      changes: { text: 'LOSTTEXT' },
    });

  it('drops what it wrote down once the write is known to have landed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [], versionMismatches: [], etag: 'e' }), {
          status: 200,
        }),
      ),
    );

    submitOnUnload('ws-1', [op()]);
    // A backgrounded tab is still alive, so the request completes and the stash must not grow.
    await vi.waitFor(() => expect(readStashedOps()).toEqual([]));
  });

  it('writes the ops down before anything else, so an unload cannot lose them', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('the page went away')));
    const sent = op();

    submitOnUnload('ws-1', [sent]);

    expect(readStashedOps()).toEqual([sent]);
  });

  it('replays what was written down on the next start, in clientSeq order, and clears it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [], versionMismatches: [], etag: 'e' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const second = { ...op(), clientSeq: 9 };
    const first = { ...op(), clientSeq: 4 };
    stashOps([second, first]);
    // An op for another workspace is left alone rather than posted to this one.
    stashOps([{ ...op(), workspaceId: 'ws-2', clientSeq: 5 }]);

    expect(await flushStashedOps('ws-1')).toBe(2);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ops: [first, second] });
    // Cleared for this workspace, so a rejected op is not retried on every start for ever.
    expect(readStashedOps().map((stashed) => stashed.workspaceId)).toEqual(['ws-2']);
  });

  it('sends nothing when nothing was written down', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushStashedOps('ws-1')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts the request in the same synchronous step, with keepalive so it outlives the page', () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [], versionMismatches: [], etag: 'e' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const sent = op();

    submitOnUnload('ws-1', [sent]);

    // No await anywhere above: the request must already be on its way, or the navigation eats it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workspaces/ws-1/sync');
    expect(init.keepalive).toBe(true);
    // The same op shape the ordinary path posts, so the server sees nothing new.
    expect(JSON.parse(init.body as string)).toEqual({ ops: [sent] });
  });

  it('says nothing when the write fails, because there is no page left to say it on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('gone')));

    expect(() => submitOnUnload('ws-1', [op()])).not.toThrow();
    // Let the rejection settle, so an unhandled rejection would surface here rather than later.
    await Promise.resolve();
  });
});

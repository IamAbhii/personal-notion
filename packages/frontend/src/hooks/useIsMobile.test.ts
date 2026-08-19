import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * jsdom does not implement window.matchMedia, so we stub it with a minimal mock that exposes
 * `matches`, `addEventListener` and `removeEventListener`.
 */
function stubMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mq = {
    matches,
    media: '',
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.push(fn);
    }),
    removeEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    dispatchEvent: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList);
  return {
    mq,
    fire: (newMatches: boolean) => {
      listeners.forEach((fn) => fn({ matches: newMatches } as MediaQueryListEvent));
    },
  };
}

describe('useIsMobile', () => {
  it('returns false when the viewport is wider than the md breakpoint', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true when the viewport is narrower than the md breakpoint', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when the media query fires a change event', () => {
    const { fire } = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => fire(true));
    expect(result.current).toBe(true);

    act(() => fire(false));
    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    const { mq } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

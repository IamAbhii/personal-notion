import { useEffect, useState } from 'react';

// md breakpoint in pixels, matching Tailwind's default md:768px.
const MD_BREAKPOINT = 768;

/**
 * Returns true when the viewport is narrower than the md breakpoint (768px). Subscribes to
 * MediaQueryList change events so the value stays in sync if the window is resized.
 *
 * Used to gate behaviour that only applies on mobile — e.g. marking the off-canvas drawer inert
 * when closed, so it is not reachable from the tab order at mobile width.
 *
 * Future: if the md breakpoint in the Tailwind config changes, update MD_BREAKPOINT here to match.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

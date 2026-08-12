import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

// Future: Phase 5's theme toggle (light/dark) is the next tenant of this store.

interface UiState {
  /** Whether the off-canvas sidebar drawer is open. Only meaningful below the md breakpoint. */
  isSidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  /**
   * Page ids the user has explicitly collapsed in the sidebar tree. Tracked globally so the
   * collapse state survives navigation between pages without server round trips.
   */
  collapsedPageIds: ReadonlySet<string>;
  /** Toggles the collapsed state of one page row. Immutably replaces the set. */
  togglePageCollapsed: (pageId: string) => void;
}

// The curried create<T>()(...) form is required for correct inference in zustand v5.
export const useUiStore = create<UiState>()((set) => ({
  isSidebarOpen: false,
  openSidebar: () => set({ isSidebarOpen: true }),
  closeSidebar: () => set({ isSidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  collapsedPageIds: new Set(),
  togglePageCollapsed: (pageId: string) =>
    set((s) => {
      // Replace the set rather than mutating it so React sees a referential change.
      const next = new Set(s.collapsedPageIds);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return { collapsedPageIds: next };
    }),
}));

/**
 * Reads multiple values from the UI store in one call without causing spurious re-renders.
 * Prefer this over multiple individual `useUiStore` calls when you need two or more values.
 */
export function useUiStoreShallow<T>(selector: (s: UiState) => T): T {
  return useUiStore(useShallow(selector));
}

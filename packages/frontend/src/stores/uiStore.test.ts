import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

// Reset the store to initial state after each test to avoid cross-test interference.
afterEach(() => {
  useUiStore.setState({
    isSidebarOpen: false,
    collapsedPageIds: new Set(),
    activeViewKindByDb: {},
  });
});

describe('useUiStore — sidebar', () => {
  it('openSidebar sets isSidebarOpen to true', () => {
    useUiStore.getState().openSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(true);
  });

  it('closeSidebar sets isSidebarOpen to false', () => {
    useUiStore.setState({ isSidebarOpen: true });
    useUiStore.getState().closeSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(false);
  });

  it('toggleSidebar flips the open state', () => {
    // false → true
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(true);
    // true → false
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(false);
  });
});

describe('useUiStore — collapsed page ids', () => {
  it('togglePageCollapsed adds a page id to the set', () => {
    useUiStore.getState().togglePageCollapsed('p-1');
    expect(useUiStore.getState().collapsedPageIds.has('p-1')).toBe(true);
  });

  it('togglePageCollapsed removes a page id that is already in the set', () => {
    useUiStore.setState({ collapsedPageIds: new Set(['p-1']) });
    useUiStore.getState().togglePageCollapsed('p-1');
    expect(useUiStore.getState().collapsedPageIds.has('p-1')).toBe(false);
  });
});

describe('useUiStore — active view kind', () => {
  it('setActiveViewKind records the view kind for a database page id', () => {
    useUiStore.getState().setActiveViewKind('db-1', 'board');
    expect(useUiStore.getState().activeViewKindByDb['db-1']).toBe('board');
  });

  it('setActiveViewKind updates the kind when called again for the same db', () => {
    useUiStore.getState().setActiveViewKind('db-1', 'table');
    useUiStore.getState().setActiveViewKind('db-1', 'list');
    expect(useUiStore.getState().activeViewKindByDb['db-1']).toBe('list');
  });
});

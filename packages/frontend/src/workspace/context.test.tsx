import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { WorkspaceContext, useWorkspace } from './context';
import type { WorkspaceContextValue } from './context';

/** A minimal stub value — tests only need the types to satisfy TypeScript. */
function makeStubValue(): WorkspaceContextValue {
  return {
    userId: 'u-1',
    workspaceId: 'ws-1',
    pages: [],
    blocks: [],
    properties: [],
    values: [],
    views: [],
    mutations: {
      createPage: vi.fn(),
      updatePage: vi.fn(),
      deletePage: vi.fn(),
      isMutating: false,
    },
    blockMutations: {
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
    },
    propertyMutations: {
      createProperty: vi.fn(),
      updateProperty: vi.fn(),
      deleteProperty: vi.fn(),
      setValue: vi.fn(),
    },
    viewMutations: {
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
      createDefaultViews: vi.fn(),
    },
    selectPage: vi.fn(),
    notify: vi.fn(),
    createAndOpenPage: vi.fn(),
    createAndOpenDatabase: vi.fn(),
    createAndOpenRow: vi.fn(),
    createRowInPlace: vi.fn(),
  };
}

describe('useWorkspace', () => {
  it('throws with a clear message when used outside the workspace shell', () => {
    // Suppress the console.error that React emits for uncaught errors in renderHook.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWorkspace())).toThrow(
      'useWorkspace must be used inside the workspace shell',
    );
    spy.mockRestore();
  });

  it('returns the context value when used inside the WorkspaceContext provider', () => {
    const value = makeStubValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.workspaceId).toBe('ws-1');
    expect(result.current.userId).toBe('u-1');
  });

  it('exposes the pages, blocks, and mutations from the context', () => {
    const value = makeStubValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.pages).toEqual([]);
    expect(result.current.blocks).toEqual([]);
    expect(result.current.mutations).toBe(value.mutations);
  });
});

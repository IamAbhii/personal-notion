import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceHome } from './WorkspaceHome';
import { WorkspaceContext } from '../workspace/context';
import type { WorkspaceContextValue } from '../workspace/context';

/** A minimal workspace context stub that satisfies the type without touching the network. */
function makeStub(overrides?: Partial<WorkspaceContextValue>): WorkspaceContextValue {
  return {
    userId: 'u-1',
    workspaceId: 'ws-1',
    pages: [],
    blocks: [],
    properties: [],
    values: [],
    views: [],
    mutations: { createPage: vi.fn(), updatePage: vi.fn(), deletePage: vi.fn(), isMutating: false },
    blockMutations: { createBlock: vi.fn(), updateBlock: vi.fn(), deleteBlock: vi.fn() },
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
    ...overrides,
  };
}

function wrap(stub: WorkspaceContextValue) {
  return ({ children }: { children: ReactNode }) => (
    <WorkspaceContext.Provider value={stub}>{children}</WorkspaceContext.Provider>
  );
}

describe('WorkspaceHome', () => {
  it('renders the welcome heading and prompt', () => {
    render(<WorkspaceHome />, { wrapper: wrap(makeStub()) });
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('renders the "Create a page" button', () => {
    render(<WorkspaceHome />, { wrapper: wrap(makeStub()) });
    expect(screen.getByRole('button', { name: /create a page/i })).toBeInTheDocument();
  });

  it('calls createAndOpenPage with null when "Create a page" is clicked', async () => {
    const user = userEvent.setup();
    const createAndOpenPage = vi.fn();
    render(<WorkspaceHome />, { wrapper: wrap(makeStub({ createAndOpenPage })) });
    await user.click(screen.getByRole('button', { name: /create a page/i }));
    expect(createAndOpenPage).toHaveBeenCalledWith(null);
  });
});

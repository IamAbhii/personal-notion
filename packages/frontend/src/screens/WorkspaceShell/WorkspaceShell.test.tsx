/**
 * Tests for the mobile drawer in WorkspaceShell: open from toggle, close on Escape, focus return.
 *
 * WorkspaceShell is coupled to TanStack Router and Query, so all external dependencies are mocked
 * here. The tests are deliberately narrow - only the drawer open/close flow is exercised.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from './WorkspaceShell';
import { useUiStore } from '../../stores/uiStore';

// --- External dependency mocks ---

vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ workspaceId: 'ws-test' })),
  useNavigate: vi.fn(() => vi.fn()),
  Outlet: () => <div data-testid="outlet" />,
}));

// vi.hoisted ensures this mock function is initialized before vi.mock factories run.
const mockUseSuspenseQuery = vi.hoisted(() => vi.fn());

const mockQueryClient = { invalidateQueries: vi.fn() };
const mockMe = {
  user: { id: 'u-1', name: 'Test User', email: 'test@example.com' },
  memberships: [{ workspaceId: 'ws-test', name: 'My Workspace', role: 'owner' }],
};
const mockSnapshot = { pages: [], blocks: [] };

// Mock @tanstack/react-query. queryOptions must be included because api/queries.ts calls it
// at module load time to build the query option objects.
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
  useSuspenseQuery: mockUseSuspenseQuery,
  useQueryClient: vi.fn(() => mockQueryClient),
}));

vi.mock('../../hooks/usePageMutations', () => ({
  usePageMutations: vi.fn(() => ({
    createPage: vi.fn(),
    updatePage: vi.fn(),
    deletePage: vi.fn(),
  })),
}));

vi.mock('../../hooks/useBlockMutations', () => ({
  useBlockMutations: vi.fn(() => ({
    updateBlock: vi.fn(),
    createBlock: vi.fn(),
    deleteBlock: vi.fn(),
    moveBlock: vi.fn(),
  })),
}));

vi.mock('../../hooks/usePropertyMutations', () => ({
  usePropertyMutations: vi.fn(() => ({
    createProperty: vi.fn(),
    updateProperty: vi.fn(),
    deleteProperty: vi.fn(),
    setValue: vi.fn(),
  })),
}));

vi.mock('../../hooks/useViewMutations', () => ({
  useViewMutations: vi.fn(() => ({
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi.fn(),
    createDefaultViews: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../sync/ops', () => ({
  flushStashedOps: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('../../lib/notify', () => ({
  notify: { warning: vi.fn(), info: vi.fn() },
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
}));

vi.mock('../../hooks/useIsMobile', () => ({
  // Treat the test environment as mobile so inert behaviour is exercised.
  useIsMobile: vi.fn(() => true),
}));

beforeEach(() => {
  // Reset the UI store so each test starts with a closed drawer.
  useUiStore.setState({ isSidebarOpen: false, collapsedPageIds: new Set() });

  // useSuspenseQuery is called on every render of WorkspaceShell. Use mockImplementation (not
  // mockReturnValueOnce) so the mock survives re-renders when the drawer opens/closes.
  mockUseSuspenseQuery.mockReset();
  mockUseSuspenseQuery.mockImplementation((queryOpts: { queryKey: string[] }) => {
    if (queryOpts.queryKey[0] === 'me') return { data: mockMe };
    return { data: mockSnapshot };
  });
});

describe('WorkspaceShell mobile drawer', () => {
  it('marks the drawer inert when closed so off-canvas elements are not reachable by keyboard', () => {
    // DEF-028: a closed off-canvas drawer must be genuinely inert, not just visually translated
    // away. The `inert` attribute removes all descendants from the tab order and pointer events.
    render(<WorkspaceShell />);

    // useIsMobile is mocked to true above so the inert gate is active.
    // Sidebar is closed initially (isSidebarOpen=false in beforeEach).
    const drawerPanel = screen.getByTestId('sidebar').closest('[inert]');
    expect(drawerPanel).not.toBeNull();
  });

  it('removes inert from the drawer panel when the sidebar is opened', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);

    // Verify inert is set while closed.
    expect(screen.getByTestId('sidebar').closest('[inert]')).not.toBeNull();

    // Open the drawer.
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    // After opening, the drawer panel must not carry inert — all elements are now reachable.
    expect(screen.getByTestId('sidebar').closest('[inert]')).toBeNull();
  });

  it('opens from the hamburger toggle, closes on Escape, and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);

    // The toggle is always in the DOM (hidden via CSS at md+, but CSS is disabled in tests).
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Open the drawer.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // The sidebar is present and accessible.
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();

    // Close via Escape key.
    await user.keyboard('{Escape}');

    // Drawer is now closed.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    // Focus must return to the toggle so keyboard users have a clear continuation point.
    expect(document.activeElement).toBe(toggle);
  });

  it('closes the drawer when Escape is pressed inside the sidebar', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell />);

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Focus the sidebar panel and press Escape.
    const sidebar = screen.getByTestId('sidebar');
    sidebar.focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    // Focus returns to the toggle via Sidebar's onKeyDown → onClose → WorkspaceShell callback.
    expect(document.activeElement).toBe(toggle);
  });
});

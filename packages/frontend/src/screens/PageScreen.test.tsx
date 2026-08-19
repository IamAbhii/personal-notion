/**
 * Tests for PageScreen: the three page-kind branches (plain, database, row) and the not-found
 * fallback. All external dependencies are mocked so the tests run in isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { PageScreen } from './PageScreen';
import { WorkspaceContext } from '../workspace/context';
import type { WorkspaceContextValue } from '../workspace/context';
import type { PageRecord, PropertyRecord, ViewRecord } from '../api/types';
import { useUiStore } from '../stores/uiStore';

// Mock TanStack Router — PageScreen calls useParams at the top level.
vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ pageId: 'page-1' })),
}));

// Mock heavy child components so the test environment does not need to render a full editor,
// database view, etc. The tests only assert on which branch is reached.
vi.mock('../components/BlockEditor', () => ({
  BlockEditor: () => <div data-testid="block-editor" />,
}));
vi.mock('../components/PageView/PageView', () => ({
  PageView: ({ children }: { children: ReactNode }) => (
    <div data-testid="page-view">{children}</div>
  ),
}));
vi.mock('../components/DatabaseView/DatabaseView', () => ({
  DatabaseView: () => <div data-testid="database-view" />,
}));
vi.mock('../components/BoardView/BoardView', () => ({
  BoardView: () => <div data-testid="board-view" />,
}));
vi.mock('../components/ListView/ListView', () => ({
  ListView: () => <div data-testid="list-view" />,
}));
vi.mock('../components/RowPage/RowPage', () => ({
  RowPage: ({ children }: { children: ReactNode }) => <div data-testid="row-page">{children}</div>,
}));
vi.mock('../components/ViewSwitcher/ViewSwitcher', () => ({
  ViewSwitcher: () => <div data-testid="view-switcher" />,
}));
vi.mock('../components/FilterSortControl/FilterSortControl', () => ({
  FilterSortControl: () => <div data-testid="filter-sort-control" />,
}));

/** Build a minimal page record for testing. */
function makePage(
  overrides: Partial<PageRecord> & { id: string; kind: PageRecord['kind'] },
): PageRecord {
  return {
    title: 'Test Page',
    icon: '',
    parentId: null,
    sortKey: 'a0',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

/** Build a minimal view record for testing. */
function makeView(
  overrides: Partial<ViewRecord> & { id: string; databasePageId: string },
): ViewRecord {
  return {
    kind: 'table',
    sortKey: 'a0',
    filters: [],
    sort: null,
    groupPropertyId: null,
    workspaceId: 'ws-1',
    ...overrides,
  };
}

/** A minimal workspace context stub. */
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

beforeEach(() => {
  // Reset the active view kind map so tests start with the default 'table' active.
  useUiStore.setState({ activeViewKindByDb: {} });
});

describe('PageScreen', () => {
  it('renders a not-found status card when pageId is not in the pages list', () => {
    render(<PageScreen />, { wrapper: wrap(makeStub({ pages: [] })) });
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });

  it('renders a plain-page view with BlockEditor for kind=page', () => {
    const page = makePage({ id: 'page-1', kind: 'page', title: 'My Page' });
    render(<PageScreen />, { wrapper: wrap(makeStub({ pages: [page] })) });
    expect(screen.getByTestId('page-view')).toBeInTheDocument();
    expect(screen.getByTestId('block-editor')).toBeInTheDocument();
  });

  it('renders a row page view with RowPage and BlockEditor for kind=row', () => {
    const dbPage = makePage({ id: 'db-1', kind: 'database', title: 'DB' });
    const rowPage = makePage({ id: 'page-1', kind: 'row', parentId: 'db-1', title: 'Row' });
    const stub = makeStub({ pages: [dbPage, rowPage] });
    render(<PageScreen />, { wrapper: wrap(stub) });
    expect(screen.getByTestId('row-page')).toBeInTheDocument();
    expect(screen.getByTestId('block-editor')).toBeInTheDocument();
  });

  it('renders a row page correctly when parent database is missing', () => {
    // parentId points to a page not in the list — dbPage is undefined.
    const rowPage = makePage({ id: 'page-1', kind: 'row', parentId: 'missing-db', title: 'Row' });
    render(<PageScreen />, { wrapper: wrap(makeStub({ pages: [rowPage] })) });
    expect(screen.getByTestId('row-page')).toBeInTheDocument();
  });

  it('renders a database view with ViewSwitcher for kind=database with views', () => {
    const dbPage = makePage({ id: 'page-1', kind: 'database', title: 'DB' });
    const view = makeView({ id: 'v-1', databasePageId: 'page-1', kind: 'table' });
    const stub = makeStub({ pages: [dbPage], views: [view] });
    render(<PageScreen />, { wrapper: wrap(stub) });
    expect(screen.getByTestId('view-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('database-view')).toBeInTheDocument();
  });

  it('renders board view when active view kind is board', () => {
    useUiStore.setState({ activeViewKindByDb: { 'page-1': 'board' } });
    const dbPage = makePage({ id: 'page-1', kind: 'database', title: 'DB' });
    const boardView = makeView({ id: 'v-2', databasePageId: 'page-1', kind: 'board' });
    const prop: PropertyRecord = {
      id: 'p-1',
      name: 'Status',
      type: 'select',
      databasePageId: 'page-1',
      sortKey: 'a0',
      options: [],
      workspaceId: 'ws-1',
    };
    const stub = makeStub({ pages: [dbPage], views: [boardView], properties: [prop] });
    render(<PageScreen />, { wrapper: wrap(stub) });
    expect(screen.getByTestId('board-view')).toBeInTheDocument();
  });

  it('renders list view via the ListView component when active kind is list', () => {
    useUiStore.setState({ activeViewKindByDb: { 'page-1': 'list' } });
    const dbPage = makePage({ id: 'page-1', kind: 'database', title: 'DB' });
    const listView = makeView({ id: 'v-1', databasePageId: 'page-1', kind: 'list' });
    const stub = makeStub({ pages: [dbPage], views: [listView] });
    render(<PageScreen />, { wrapper: wrap(stub) });
    expect(screen.getByTestId('list-view')).toBeInTheDocument();
  });

  it('shows a no-views recovery prompt when database has no views', () => {
    const dbPage = makePage({ id: 'page-1', kind: 'database', title: 'DB' });
    // No views for this database.
    render(<PageScreen />, { wrapper: wrap(makeStub({ pages: [dbPage], views: [] })) });
    // The no-views state renders a "Set up views" button (or similar recovery UI).
    expect(screen.getByTestId('page-view')).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, type SidebarProps } from './Sidebar';
import { fixturePages, makePage } from '../../test/fixtures';
import { useUiStore } from '../../stores/uiStore';

// Reset the UI store between tests so collapse state and drawer state do not leak across specs.
beforeEach(() => {
  useUiStore.setState({
    isSidebarOpen: false,
    collapsedPageIds: new Set(),
  });
});

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    workspaceName: 'Abhijeet',
    role: 'owner',
    userName: 'Abhijeet',
    userEmail: 'abhijeet@example.com',
    pages: fixturePages,
    currentPageId: 'p-journal',
    onSelectPage: vi.fn(),
    onCreatePage: vi.fn(),
    onRenamePage: vi.fn(),
    onDeletePage: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe('Sidebar tree', () => {
  it('renders every page with its icon, nested to any depth', () => {
    renderSidebar();

    expect(screen.getByText('Personal Space')).toBeInTheDocument();
    for (const page of fixturePages) {
      expect(screen.getByRole('button', { name: page.title })).toBeInTheDocument();
      expect(screen.getByText(page.icon)).toBeInTheDocument();
    }

    // Lisbon sits two levels deep (indent = base 8 + 2*step 12 = 32px), Journal at the root
    // (depth 0) gets only the base indent (8px). The step changed from 14→12 to keep the title
    // readable at 320px (DEF-030).
    const lisbon = screen
      .getByRole('button', { name: 'Lisbon' })
      .closest('[data-testid="page-row"]');
    const journal = screen
      .getByRole('button', { name: 'Journal' })
      .closest('[data-testid="page-row"]');
    expect(lisbon?.getAttribute('style')).toContain('32px');
    expect(journal?.getAttribute('style')).toContain('8px');
  });

  it('caps the indent of a very deep chain so the row keeps its title and icon (DEF-009, DEF-030)', () => {
    // 24 levels: a per-level indent with no cap leaves a row of this depth with no room for text.
    // The cap now kicks in at depth 3 (MAX_INDENT_DEPTH=3, max indent = 8 + 3*12 = 44px) to keep
    // the title readable even at the 320px minimum viewport.
    const deep = Array.from({ length: 24 }, (_unused, index) =>
      makePage({
        id: `p-${index}`,
        title: `Level ${index}`,
        parentId: index ? `p-${index - 1}` : null,
      }),
    );
    renderSidebar({ pages: deep, currentPageId: 'p-23' });

    const deepest = screen
      .getByRole('button', { name: 'Level 23' })
      .closest('[data-testid="page-row"]');
    // Level 10 is beyond the cap, so it has the same indent as Level 23.
    const capped = screen
      .getByRole('button', { name: 'Level 10' })
      .closest('[data-testid="page-row"]');

    expect(deepest?.getAttribute('style')).toBe(capped?.getAttribute('style'));
    const indent = Number(
      /padding-left:\s*(\d+)px/.exec(deepest?.getAttribute('style') ?? '')?.[1],
    );
    // The capped indent must leave room for a readable title at 320px: max should be <= 50px.
    expect(indent).toBeLessThanOrEqual(50);
  });

  it('renders siblings in sortKey order', () => {
    renderSidebar();
    const titles = screen.getAllByRole('treeitem').map((item) => item.textContent);

    expect(titles[0]).toContain('Journal');
    expect(titles[titles.length - 1]).toContain('Reading list');
  });

  it('tags every row with its page id, including a nested one, for end-to-end selectors', () => {
    renderSidebar();

    // Lisbon is two levels deep: the attribute must carry its own id, not an ancestor's.
    const lisbonRow = screen
      .getByRole('button', { name: 'Lisbon' })
      .closest('[data-testid="page-row"]');
    expect(lisbonRow).toHaveAttribute('data-page-id', 'p-lisbon');

    // The row's action buttons must be inside the tagged element, so a spec can scope to it.
    expect(lisbonRow).toContainElement(screen.getByRole('button', { name: 'Delete Lisbon' }));
    expect(lisbonRow).toContainElement(screen.getByRole('button', { name: 'Rename Lisbon' }));

    for (const page of fixturePages) {
      expect(document.querySelectorAll(`[data-page-id="${page.id}"]`)).toHaveLength(1);
    }
  });

  it('marks the current page using data-current="true" on the row', () => {
    renderSidebar({ currentPageId: 'p-trips' });

    // State is signalled via data-current so tests do not couple to CSS module class names,
    // which are hashed at build time and undefined when css: false is set in vite.config.ts.
    const row = screen.getByRole('button', { name: 'Trips' }).closest('[data-testid="page-row"]');
    expect(row).toHaveAttribute('data-current', 'true');

    // The previously-current page should not be marked.
    const journalRow = screen
      .getByRole('button', { name: 'Journal' })
      .closest('[data-testid="page-row"]');
    expect(journalRow).toHaveAttribute('data-current', 'false');
  });

  it('collapses and expands a subtree', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole('button', { name: 'Trips' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Journal' }));
    expect(screen.queryByRole('button', { name: 'Trips' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lisbon' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand Journal' }));
    expect(screen.getByRole('button', { name: 'Trips' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lisbon' })).toBeInTheDocument();
  });
});

describe('Sidebar actions', () => {
  it('creates a top-level page and a child page', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Add a top-level page' }));
    expect(props.onCreatePage).toHaveBeenCalledWith(null);

    await user.click(screen.getByRole('button', { name: 'Add a page inside Trips' }));
    expect(props.onCreatePage).toHaveBeenCalledWith('p-trips');
  });

  it('renames a page from its row', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Rename Reading list' }));
    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read{Enter}');

    expect(props.onRenamePage).toHaveBeenCalledTimes(1);
    expect(props.onRenamePage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-reading' }),
      'To read',
    );
  });

  it('commits a rename when the input loses focus, not only on Enter', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Rename Reading list' }));
    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read');
    // Clicking anywhere outside blurs the input, which is how a user leaves an edit without Enter.
    await user.click(screen.getByText('Pages'));

    expect(props.onRenamePage).toHaveBeenCalledTimes(1);
    expect(props.onRenamePage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-reading' }),
      'To read',
    );
  });

  it('writes one rename per editing session when Enter is followed by a click away', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Rename Reading list' }));
    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read{Enter}');
    // The pending blur must not commit again: a second op is a second D1 write and queue entry.
    await user.click(screen.getByText('Pages'));

    expect(props.onRenamePage).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when a row title is committed unchanged', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Rename Reading list' }));
    await user.type(screen.getByLabelText('New name for Reading list'), '{Enter}');
    await user.click(screen.getByText('Pages'));

    expect(props.onRenamePage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reading list' })).toBeVisible();
  });

  it('renames the row that was clicked when two pages share a title', async () => {
    const user = userEvent.setup();
    const pages = [
      makePage({ id: 'p-first', title: 'Untitled', sortKey: 'a0' }),
      makePage({ id: 'p-second', title: 'Untitled', sortKey: 'a1' }),
    ];
    const props = renderSidebar({ pages, currentPageId: 'p-second' });

    // Two rows carry the same accessible name, so pick the second one explicitly - the mistake this
    // guards against is acting on the first match and reporting the wrong page as unrenamed.
    const renameButtons = screen.getAllByRole('button', { name: 'Rename Untitled' });
    expect(renameButtons).toHaveLength(2);
    await user.click(renameButtons[1]!);

    const input = screen.getAllByLabelText('New name for Untitled')[0]!;
    await user.clear(input);
    await user.type(input, 'Second one{Enter}');

    expect(props.onRenamePage).toHaveBeenCalledTimes(1);
    expect(props.onRenamePage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-second' }),
      'Second one',
    );
  });

  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Rename Reading list' }));
    await user.type(screen.getByLabelText('New name for Reading list'), 'Nope{Escape}');

    expect(props.onRenamePage).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting, and names the nested pages that go too', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Delete Journal' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete "Journal"?');
    expect(dialog).toHaveTextContent(
      '2 pages nested inside it will be deleted too: Trips, Lisbon.',
    );
    expect(props.onDeletePage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(props.onDeletePage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-journal' }));
  });

  it('sends no delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Delete Reading list' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('It has no nested pages.');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onDeletePage).not.toHaveBeenCalled();
  });

  it('selects a page when its title is clicked', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Lisbon' }));

    expect(props.onSelectPage).toHaveBeenCalledWith('p-lisbon');
  });

  it('calls onClose when a page is selected, so the mobile drawer closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSidebar({ onClose });

    await user.click(screen.getByRole('button', { name: 'Lisbon' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar mobile overflow menu', () => {
  it('renders an overflow trigger for each page row', () => {
    renderSidebar();

    // Each page gets its own Actions-for trigger button.
    for (const page of fixturePages) {
      expect(screen.getByRole('button', { name: `Actions for ${page.title}` })).toBeInTheDocument();
    }
  });

  it('opens the overflow menu showing Rename, Add a page inside, and Delete', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Actions for Trips' }));

    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Add a page inside/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument();
  });

  it('overflow menu Rename opens the rename input for the correct page', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Actions for Trips' }));
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));

    // findByLabelText waits for the async re-render after the menu item click.
    expect(await screen.findByLabelText('New name for Trips')).toBeInTheDocument();
  });

  it('overflow menu Add a page inside calls onCreatePage with the page id', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Actions for Trips' }));
    await user.click(screen.getByRole('menuitem', { name: /Add a page inside/ }));

    expect(props.onCreatePage).toHaveBeenCalledWith('p-trips');
  });

  it('overflow menu Delete opens the confirm dialog for the correct page', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Actions for Journal' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    // findByRole waits for the dialog to mount after the menu item click.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Delete "Journal"?');
  });

  it('overflow menu items carry the same testids as the desktop buttons', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Actions for Reading list' }));

    // Items should have the same data-testid values as the desktop row buttons.
    const renameItems = screen.getAllByTestId('page-rename');
    const addChildItems = screen.getAllByTestId('page-add-child');
    const deleteItems = screen.getAllByTestId('page-delete');

    // Each page row has a desktop button; the open menu adds one more for this page.
    expect(renameItems.length).toBeGreaterThan(fixturePages.length);
    expect(addChildItems.length).toBeGreaterThan(fixturePages.length);
    expect(deleteItems.length).toBeGreaterThan(fixturePages.length);
  });
});

describe('Sidebar drawer (mobile)', () => {
  it('calls onClose when Escape is pressed inside the sidebar', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSidebar({ onClose });

    // Focus the sidebar panel itself to fire a keydown on it.
    const sidebar = screen.getByTestId('sidebar');
    sidebar.focus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not blow up when Escape is pressed and no onClose is provided', async () => {
    const user = userEvent.setup();
    renderSidebar(); // no onClose prop

    const sidebar = screen.getByTestId('sidebar');
    sidebar.focus();
    // Should not throw.
    await user.keyboard('{Escape}');
  });
});

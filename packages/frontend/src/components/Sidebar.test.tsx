import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, type SidebarProps } from './Sidebar';
import { fixturePages } from '../test/fixtures';

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

    // Lisbon sits two levels deep, so its row is indented further than its grandparent's.
    const lisbon = screen.getByRole('button', { name: 'Lisbon' }).closest('.row');
    const journal = screen.getByRole('button', { name: 'Journal' }).closest('.row');
    expect(lisbon?.getAttribute('style')).toContain('40px');
    expect(journal?.getAttribute('style')).toContain('8px');
  });

  it('renders siblings in sortKey order', () => {
    renderSidebar();
    const titles = screen.getAllByRole('treeitem').map((item) => item.textContent);

    expect(titles[0]).toContain('Journal');
    expect(titles[titles.length - 1]).toContain('Reading list');
  });

  it('marks the current page', () => {
    renderSidebar({ currentPageId: 'p-trips' });

    expect(screen.getByRole('button', { name: 'Trips' }).closest('.row')).toHaveClass(
      'row--current',
    );
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

    expect(props.onRenamePage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-reading' }),
      'To read',
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
});

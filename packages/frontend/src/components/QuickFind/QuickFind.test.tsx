import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickFind } from './QuickFind';
import { makePage } from '../../test/fixtures';
import type { PageRecord } from '../../api/types';

const pages: PageRecord[] = [
  makePage({ id: 'p1', title: 'Alpha Page', kind: 'page' }),
  makePage({ id: 'p2', title: 'Beta Page', kind: 'page' }),
  makePage({ id: 'db1', title: 'Tasks', kind: 'database' }),
  makePage({ id: 'r1', title: 'Fix the bug', kind: 'row', parentId: 'db1' }),
];

const defaultProps = {
  pages,
  onClose: vi.fn(),
  onSelect: vi.fn(),
};

function renderQuickFind(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, onClose: vi.fn(), onSelect: vi.fn(), ...overrides };
  render(<QuickFind {...props} />);
  return props;
}

describe('QuickFind: initial state', () => {
  it('focuses the search input on mount', () => {
    renderQuickFind();
    expect(screen.getByTestId('quickfind-input')).toHaveFocus();
  });

  it('shows a prompt when the query is empty', () => {
    renderQuickFind();
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it('renders the dialog with correct aria attributes', () => {
    renderQuickFind();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Quick find');
  });
});

describe('QuickFind: search results', () => {
  it('shows matching results as the user types', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    const results = screen.getAllByTestId('quickfind-result');
    expect(results).toHaveLength(2); // "Alpha Page" and "Beta Page"
  });

  it('shows a no-results message when nothing matches', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'zzznomatch');
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('shows the result title, kind and parent info', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'bug');
    const result = screen.getByTestId('quickfind-result');
    expect(within(result).getByText('Fix the bug')).toBeInTheDocument();
    expect(within(result).getByText(/row/i)).toBeInTheDocument();
    expect(within(result).getByText(/tasks/i)).toBeInTheDocument();
  });
});

describe('QuickFind: keyboard navigation', () => {
  it('ArrowDown moves the active selection down', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    await user.keyboard('{ArrowDown}');
    const results = screen.getAllByTestId('quickfind-result');
    expect(results[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp moves the active selection up', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    // Go down then back up
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    const results = screen.getAllByTestId('quickfind-result');
    expect(results[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown does not go past the last item', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    const results = screen.getAllByTestId('quickfind-result');
    // Still on the last item, not out of bounds
    expect(results[results.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter calls onSelect with the highlighted page id and calls onClose', async () => {
    const user = userEvent.setup();
    const props = renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'alpha');
    await user.keyboard('{Enter}');
    expect(props.onSelect).toHaveBeenCalledWith('p1');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Escape calls onClose without selecting', async () => {
    const user = userEvent.setup();
    const props = renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('Enter on no results does not call onSelect', async () => {
    const user = userEvent.setup();
    const props = renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'zzznomatch');
    await user.keyboard('{Enter}');
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

describe('QuickFind: mouse interaction', () => {
  it('clicking a result calls onSelect with the page id', async () => {
    const user = userEvent.setup();
    const props = renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'tasks');
    const result = screen.getByTestId('quickfind-result');
    await user.click(result);
    expect(props.onSelect).toHaveBeenCalledWith('db1');
    expect(props.onClose).toHaveBeenCalled();
  });
});

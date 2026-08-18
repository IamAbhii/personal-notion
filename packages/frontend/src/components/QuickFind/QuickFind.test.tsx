import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickFind } from './QuickFind';
import { makePage } from '../../test/fixtures';
import type { PageRecord } from '../../api/types';

const pages: PageRecord[] = [
  makePage({ id: 'p1', title: 'Alpha Page', kind: 'page', icon: '📄' }),
  makePage({ id: 'p2', title: 'Beta Page', kind: 'page', icon: '📋' }),
  makePage({ id: 'db1', title: 'Tasks', kind: 'database', icon: '📊' }),
  makePage({ id: 'r1', title: 'Fix the bug', kind: 'row', parentId: 'db1', icon: '🐛' }),
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

  it('renders the dialog with the correct accessible name', () => {
    renderQuickFind();
    // getByRole with name checks the accessible name, which comes from the sr-only Radix title.
    // aria-modal is set by Radix's focus-scope machinery at runtime; testing its DOM attribute
    // would couple the test to Radix internals, so we verify the accessible name and presence only.
    const dialog = screen.getByRole('dialog', { name: /quick find/i });
    expect(dialog).toBeInTheDocument();
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

  it('shows the page icon in each result row', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'alpha');
    const result = screen.getByTestId('quickfind-result');
    // The icon emoji is in an aria-hidden span; check its text content directly.
    expect(result.textContent).toContain('📄');
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

  it('Home jumps to the first result', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Home}');
    const results = screen.getAllByTestId('quickfind-result');
    expect(results[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('End jumps to the last result', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    await user.keyboard('{End}');
    const results = screen.getAllByTestId('quickfind-result');
    expect(results[results.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('PageDown advances the selection by five positions', async () => {
    const user = userEvent.setup();
    // Need more results: search for 'e' to hit all pages
    const manyPages: PageRecord[] = Array.from({ length: 10 }, (_, i) =>
      makePage({ id: `pg-${i}`, title: `Entry ${i}`, kind: 'page' }),
    );
    renderQuickFind({ pages: manyPages });
    await user.type(screen.getByTestId('quickfind-input'), 'e');
    await user.keyboard('{PageDown}');
    const results = screen.getAllByTestId('quickfind-result');
    // Started at 0, jumped 5 positions.
    expect(results[5]).toHaveAttribute('aria-selected', 'true');
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

describe('QuickFind: option tab order', () => {
  it('result options are not in the tab order (combobox pattern)', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    const results = screen.getAllByTestId('quickfind-result');
    // Options must have tabIndex=-1 so focus stays in the input.
    for (const result of results) {
      expect(result).toHaveAttribute('tabindex', '-1');
    }
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

describe('QuickFind: live region', () => {
  it('announces the result count when results are shown', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'page');
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/2 results/i);
  });

  it('announces singular when there is exactly one result', async () => {
    const user = userEvent.setup();
    renderQuickFind();
    await user.type(screen.getByTestId('quickfind-input'), 'alpha');
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/1 result$/i);
  });

  it('live region is empty before the user types', () => {
    renderQuickFind();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseView } from './DatabaseView';
import { fixtureDatabase, fixtureRows, fixtureProperty, fixtureValue } from '../../test/fixtures';

function renderDB(overrides: Partial<React.ComponentProps<typeof DatabaseView>> = {}) {
  const props: React.ComponentProps<typeof DatabaseView> = {
    dbPage: fixtureDatabase,
    rowPages: fixtureRows,
    properties: [fixtureProperty],
    values: [fixtureValue],
    onSelectRow: vi.fn(),
    onCreateRow: vi.fn(),
    onDeleteRow: vi.fn(),
    onCreateProperty: vi.fn(),
    onUpdateProperty: vi.fn(),
    onDeleteProperty: vi.fn(),
    onSetValue: vi.fn(),
    ...overrides,
  };
  render(<DatabaseView {...props} />);
  return props;
}

describe('DatabaseView', () => {
  it('renders a title column and a column per property', () => {
    renderDB();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders one row per row page with its title', () => {
    renderDB();
    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(screen.getByText('Row 2')).toBeInTheDocument();
  });

  it('clicking the row title calls onSelectRow', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    const titleCells = screen.getAllByTestId('row-title-cell');
    // Non-null: getAllByTestId always returns at least one element when it succeeds.
    await user.click(titleCells[0]!);
    expect(props.onSelectRow).toHaveBeenCalledWith(fixtureRows[0]!.id);
  });

  it('shows the "add row" button', () => {
    renderDB();
    expect(screen.getByTestId('add-row-btn')).toBeInTheDocument();
  });

  it('calls onCreateRow when add row is clicked', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    await user.click(screen.getByTestId('add-row-btn'));
    expect(props.onCreateRow).toHaveBeenCalled();
  });

  it('shows the "add property" button', () => {
    renderDB();
    expect(screen.getByTestId('add-property-btn')).toBeInTheDocument();
  });

  it('shows a cell with the selected option chip', () => {
    renderDB();
    // fixtureValue has value: JSON.stringify('opt-1') which is the 'Todo' option on row-1
    expect(screen.getByText('Todo')).toBeInTheDocument();
  });

  it('renders an empty view with no rows', () => {
    renderDB({ rowPages: [] });
    expect(screen.queryAllByTestId('database-row')).toHaveLength(0);
    expect(screen.getByTestId('add-row-btn')).toBeInTheDocument();
  });
});

describe('DatabaseView — add property', () => {
  it('opens the add property form when the + button is clicked', async () => {
    const user = userEvent.setup();
    renderDB();
    await user.click(screen.getByTestId('add-property-btn'));
    expect(screen.getByPlaceholderText('Property name')).toBeInTheDocument();
  });

  it('calls onCreateProperty with name and type', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    await user.click(screen.getByTestId('add-property-btn'));
    const nameInput = screen.getByPlaceholderText('Property name');
    await user.type(nameInput, 'Due date');
    // Submit with Enter
    await user.keyboard('{Enter}');
    expect(props.onCreateProperty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Due date', type: expect.any(String) }),
    );
  });
});

describe('DatabaseView — delete row', () => {
  it('shows a confirm dialog when delete row is selected', async () => {
    const user = userEvent.setup();
    renderDB();
    // Open the row action menu for the first row
    const rowMenuButtons = screen.getAllByRole('button', {
      name: /Actions for/,
    });
    // Non-null: getAllByRole returns at least one element when it succeeds.
    await user.click(rowMenuButtons[0]!);
    const deleteItem = screen.getByTestId('delete-row');
    await user.click(deleteItem);
    expect(screen.getByText(/Delete permanently/)).toBeInTheDocument();
  });

  it('calls onDeleteRow after confirming the dialog', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    const rowMenuButtons = screen.getAllByRole('button', { name: /Actions for/ });
    await user.click(rowMenuButtons[0]!);
    await user.click(screen.getByTestId('delete-row'));
    await user.click(screen.getByText('Delete permanently'));
    expect(props.onDeleteRow).toHaveBeenCalledWith(fixtureRows[0]!);
  });
});

describe('DatabaseView — option management', () => {
  it('shows options when the select cell is open', async () => {
    const user = userEvent.setup();
    renderDB();
    // The select cell trigger shows the current value or "Select..."
    // For row-2 (no value), the cell shows "Select..."
    const selectTriggers = screen.getAllByText('Select...');
    expect(selectTriggers.length).toBeGreaterThan(0);
    await user.click(selectTriggers[0]!);
    // 'In progress' and 'Done' only appear in the opened popover (not in the table cells).
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    // 'Todo' appears in both row-1's cell (fixtureValue) and in the opened popover.
    expect(screen.getAllByText('Todo').length).toBeGreaterThan(1);
  });
});

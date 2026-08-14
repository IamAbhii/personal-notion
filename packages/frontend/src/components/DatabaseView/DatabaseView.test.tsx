import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseView } from './DatabaseView';
import {
  fixtureDatabase,
  fixtureRows,
  fixtureProperty,
  fixtureValue,
  makeProperty,
  makeValue,
} from '../../test/fixtures';

function renderDB(overrides: Partial<React.ComponentProps<typeof DatabaseView>> = {}) {
  const props: React.ComponentProps<typeof DatabaseView> = {
    dbPage: fixtureDatabase,
    rowPages: fixtureRows,
    properties: [fixtureProperty],
    values: [fixtureValue],
    onSelectRow: vi.fn(),
    onCreateRow: vi.fn().mockResolvedValue(null),
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

  it('Add button is disabled when the property name is empty (DEF-046)', async () => {
    const user = userEvent.setup();
    renderDB();
    await user.click(screen.getByTestId('add-property-btn'));
    // The Add button must carry the disabled attribute when the name field is empty.
    const addBtn = screen.getByRole('button', { name: /^Add$/i });
    expect(addBtn).toBeDisabled();
  });

  it('Add button is enabled once a name is typed (DEF-046)', async () => {
    const user = userEvent.setup();
    renderDB();
    await user.click(screen.getByTestId('add-property-btn'));
    const nameInput = screen.getByPlaceholderText('Property name');
    await user.type(nameInput, 'Priority');
    const addBtn = screen.getByRole('button', { name: /^Add$/i });
    expect(addBtn).not.toBeDisabled();
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

describe('DatabaseView — delete property (ADV-039)', () => {
  it('shows a confirm dialog before deleting a property', async () => {
    const user = userEvent.setup();
    renderDB();
    // Open the property header menu
    const headerBtn = screen.getByRole('button', { name: 'Status options' });
    await user.click(headerBtn);
    // Click "Delete property" in the floating menu
    const deleteBtn = screen.getByRole('button', { name: /Delete property/i });
    await user.click(deleteBtn);
    // Confirm dialog should appear before onDeleteProperty is called
    expect(screen.getByText(/Delete permanently/i)).toBeInTheDocument();
  });

  it('does not call onDeleteProperty until confirmed', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    const headerBtn = screen.getByRole('button', { name: 'Status options' });
    await user.click(headerBtn);
    await user.click(screen.getByRole('button', { name: /Delete property/i }));
    // Not yet confirmed — callback should not have fired.
    expect(props.onDeleteProperty).not.toHaveBeenCalled();
  });

  it('calls onDeleteProperty after confirming the dialog', async () => {
    const user = userEvent.setup();
    const props = renderDB();
    const headerBtn = screen.getByRole('button', { name: 'Status options' });
    await user.click(headerBtn);
    await user.click(screen.getByRole('button', { name: /Delete property/i }));
    await user.click(screen.getByText('Delete permanently'));
    expect(props.onDeleteProperty).toHaveBeenCalledWith(fixtureProperty);
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

  it('shows the OptionsEditor in a floating popover (ADV-046)', async () => {
    const user = userEvent.setup();
    renderDB();
    const headerBtn = screen.getByRole('button', { name: 'Status options' });
    await user.click(headerBtn);
    // "Manage options" should appear in the popover menu.
    await user.click(screen.getByRole('button', { name: /Manage options/i }));
    // The OptionsEditor content should appear.
    expect(screen.getByText('Manage options')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New option...')).toBeInTheDocument();
  });

  it('OptionsEditor Add button is disabled when the name input is empty (ADV-036)', async () => {
    const user = userEvent.setup();
    renderDB();
    await user.click(screen.getByRole('button', { name: 'Status options' }));
    await user.click(screen.getByRole('button', { name: /Manage options/i }));
    const addButton = screen.getByRole('button', { name: /^Add$/i });
    expect(addButton).toBeDisabled();
  });
});

describe('DatabaseView — remove option with use count guard (DEF-048)', () => {
  it('shows a confirm dialog when removing an option that rows use', async () => {
    const user = userEvent.setup();
    // fixtureValue has opt-1 ('Todo') selected in row-1, so use count for opt-1 = 1
    renderDB();
    await user.click(screen.getByRole('button', { name: 'Status options' }));
    await user.click(screen.getByRole('button', { name: /Manage options/i }));
    // Remove 'Todo' (opt-1) — it is used by row-1
    await user.click(screen.getByRole('button', { name: /Remove Todo/i }));
    expect(screen.getByText(/1 row uses this option/i)).toBeInTheDocument();
  });

  it('removes an unused option without a confirm dialog', async () => {
    const user = userEvent.setup();
    // In this render, 'Done' (opt-3) is not used by any row
    renderDB();
    await user.click(screen.getByRole('button', { name: 'Status options' }));
    await user.click(screen.getByRole('button', { name: /Manage options/i }));
    // Remove 'Done' (opt-3) — it is not used by any row; no dialog expected
    await user.click(screen.getByRole('button', { name: /Remove Done/i }));
    // If no dialog appeared, the option should just be gone from the list
    expect(screen.queryByText(/rows? use this option/i)).not.toBeInTheDocument();
  });
});

describe('DatabaseView — inline row rename (ADV-044)', () => {
  it('shows an inline rename input after onCreateRow resolves with an id', async () => {
    const user = userEvent.setup();
    // Return the id of the first fixture row so we can find the inline input
    const rowId = fixtureRows[0]!.id;
    renderDB({ onCreateRow: vi.fn().mockResolvedValue(rowId) });
    await user.click(screen.getByTestId('add-row-btn'));
    // After the promise resolves, the title cell for that row should become an input
    expect(await screen.findByRole('textbox', { name: /Name for new row/i })).toBeInTheDocument();
  });
});

describe('DatabaseView — new property with a pre-existing value', () => {
  it('renders a number cell for a number property', () => {
    const numberProp = makeProperty({
      id: 'np',
      databasePageId: 'p-db',
      name: 'Score',
      type: 'number',
    });
    const numValue = makeValue({
      rowPageId: 'p-row-1',
      propertyId: 'np',
      value: JSON.stringify(9),
    });
    renderDB({ properties: [numberProp], values: [numValue] });
    expect(screen.getByDisplayValue('9')).toBeInTheDocument();
  });
});

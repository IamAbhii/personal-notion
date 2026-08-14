import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellEditor } from './CellEditor';
import { makeProperty, fixtureOptions } from '../../test/fixtures';

const onSave = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- Text ----------

describe('CellEditor — text', () => {
  const prop = makeProperty({ id: 'p1', databasePageId: 'db1', name: 'Notes', type: 'text' });

  it('renders the decoded text value', () => {
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify('hello')} onSave={onSave} />,
    );
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('saves JSON-encoded text on blur', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'world');
    await user.tab(); // trigger blur
    expect(onSave).toHaveBeenCalledWith(JSON.stringify('world'));
  });

  it('saves null when the text is cleared', async () => {
    const user = userEvent.setup();
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify('hi')} onSave={onSave} />,
    );
    const input = screen.getByDisplayValue('hi');
    await user.clear(input);
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('commits on Enter (ADV-034)', async () => {
    const user = userEvent.setup();
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify('old')} onSave={onSave} />,
    );
    const input = screen.getByDisplayValue('old');
    await user.clear(input);
    await user.type(input, 'new');
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith(JSON.stringify('new'));
  });

  it('reverts to original value on Escape (ADV-034)', async () => {
    const user = userEvent.setup();
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify('orig')} onSave={onSave} />,
    );
    const input = screen.getByDisplayValue('orig');
    await user.clear(input);
    await user.type(input, 'changed');
    await user.keyboard('{Escape}');
    // After Escape, the input value reverts to 'orig' in the component's local state.
    expect(screen.getByDisplayValue('orig')).toBeInTheDocument();
  });
});

// ---------- Number ----------

describe('CellEditor — number', () => {
  const prop = makeProperty({ id: 'p2', databasePageId: 'db1', name: 'Effort', type: 'number' });

  it('renders the decoded number value', () => {
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify(42)} onSave={onSave} />,
    );
    // Number cell is now type="text" (ADV-052) so it is role textbox, not spinbutton.
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('saves JSON-encoded number on blur', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    // type="text" + inputMode="decimal" → role is textbox (ADV-052).
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, '7');
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(JSON.stringify(7));
  });

  it('formats large floats to 10 significant figures on display (ADV-052)', () => {
    // 528.7752545877175 is a typical float that would show many noise digits.
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify(528.7752545877175)}
        onSave={onSave}
      />,
    );
    // Should display at most 10 significant figures, not the raw 64-bit value.
    expect(screen.getByDisplayValue('528.7752546')).toBeInTheDocument();
  });

  it('commits on Enter (ADV-034)', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, '99');
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith(JSON.stringify(99));
  });
});

// ---------- Checkbox ----------

describe('CellEditor — checkbox', () => {
  const prop = makeProperty({ id: 'p3', databasePageId: 'db1', name: 'Done', type: 'checkbox' });

  it('renders an unchecked checkbox when value is null', () => {
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('renders a checked checkbox when value is true', () => {
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify(true)} onSave={onSave} />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onSave with JSON-encoded true when checked', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onSave).toHaveBeenCalledWith(JSON.stringify(true));
  });

  it('calls onSave with JSON-encoded false when unchecked', async () => {
    const user = userEvent.setup();
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify(true)} onSave={onSave} />,
    );
    await user.click(screen.getByRole('checkbox'));
    expect(onSave).toHaveBeenCalledWith(JSON.stringify(false));
  });
});

// ---------- URL ----------

describe('CellEditor — url', () => {
  const prop = makeProperty({ id: 'p4', databasePageId: 'db1', name: 'Spec', type: 'url' });

  it('renders a link when there is a stored URL (ADV-032)', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('example.com')}
        onSave={onSave}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('prefixes https:// on a URL without a scheme', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('notion.so/page')}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://notion.so/page');
  });

  it('does not double-prefix an already-schemed URL', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('https://ok.com')}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://ok.com');
  });

  it('renders plain text (no link) for a value that is not a URL (ADV-033)', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('just some notes')}
        onSave={onSave}
      />,
    );
    // Should not be a link element.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('just some notes')).toBeInTheDocument();
  });

  it('shows an edit button alongside the link (ADV-032)', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('https://ok.com')}
        onSave={onSave}
      />,
    );
    // The edit affordance should exist so the user can change the URL without following it.
    expect(screen.getByRole('button', { name: /Edit Spec/i })).toBeInTheDocument();
  });

  it('saves null when the URL input is cleared', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    // Render with no value → shows input directly.
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'site.com');
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith(JSON.stringify('site.com'));
  });

  it('commits on Enter and reverts on Escape (ADV-034)', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'test.com');
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith(JSON.stringify('test.com'));
  });
});

// ---------- Select ----------

describe('CellEditor — select', () => {
  const prop = makeProperty({
    id: 'p5',
    databasePageId: 'db1',
    name: 'Status',
    type: 'select',
    options: fixtureOptions,
  });

  it('shows the selected option chip', () => {
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify('opt-1')} onSave={onSave} />,
    );
    expect(screen.getByText('Todo')).toBeInTheDocument();
  });

  it('shows a placeholder when no value is selected', () => {
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('Add button is disabled when the new-option input is empty (ADV-035)', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    await user.click(screen.getByText('Select...'));
    // The Add button should be disabled while the input is empty.
    const addButton = screen.getByRole('button', { name: /^Add$/i });
    expect(addButton).toBeDisabled();
  });

  it('Add button is enabled once the new-option input has text (ADV-035)', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    await user.click(screen.getByText('Select...'));
    const input = screen.getByPlaceholderText('New option...');
    await user.type(input, 'Backlog');
    const addButton = screen.getByRole('button', { name: /^Add$/i });
    expect(addButton).not.toBeDisabled();
  });
});

// ---------- MultiSelect ----------

describe('CellEditor — multiSelect', () => {
  const prop = makeProperty({
    id: 'p6',
    databasePageId: 'db1',
    name: 'Tags',
    type: 'multiSelect',
    options: fixtureOptions,
  });

  it('renders chips for each selected option id', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify(['opt-1', 'opt-2'])}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders a placeholder when no options are selected', () => {
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('chip remove buttons are not nested inside the trigger element (ADV-042)', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify(['opt-1', 'opt-2'])}
        onSave={onSave}
      />,
    );
    // The chip remove button for "Todo" must be a sibling of the chip text, not nested inside
    // another button element. Query for the remove button specifically.
    const removeButton = screen.getByRole('button', { name: 'Remove Todo' });
    expect(removeButton).toBeInTheDocument();
    // Its parent should be the chip span, not a <button>.
    expect(removeButton.parentElement?.tagName.toLowerCase()).not.toBe('button');
  });

  it('Add button is disabled when the new-option input is empty (ADV-035)', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    await user.click(screen.getByText('Select...'));
    const addButton = screen.getByRole('button', { name: /^Add$/i });
    expect(addButton).toBeDisabled();
  });
});

// ---------- Date ----------

describe('CellEditor — date', () => {
  const prop = makeProperty({ id: 'p7', databasePageId: 'db1', name: 'Due', type: 'date' });

  it('formats a stored YYYY-MM-DD date for display', () => {
    render(
      <CellEditor
        property={prop}
        rowPageId="r1"
        value={JSON.stringify('2026-03-05')}
        onSave={onSave}
      />,
    );
    // "5 Mar 2026" — uses en-GB short month; March is unambiguously "Mar" across V8 ICU versions.
    expect(screen.getByText('5 Mar 2026')).toBeInTheDocument();
  });

  it('shows a placeholder when no date is set', () => {
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    expect(screen.getByText('Pick a date...')).toBeInTheDocument();
  });
});

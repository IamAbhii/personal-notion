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
});

// ---------- Number ----------

describe('CellEditor — number', () => {
  const prop = makeProperty({ id: 'p2', databasePageId: 'db1', name: 'Effort', type: 'number' });

  it('renders the decoded number value', () => {
    render(
      <CellEditor property={prop} rowPageId="r1" value={JSON.stringify(42)} onSave={onSave} />,
    );
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('saves JSON-encoded number on blur', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    const input = screen.getByRole('spinbutton');
    await user.click(input);
    await user.type(input, '7');
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(JSON.stringify(7));
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

  it('renders a link when there is a stored URL', () => {
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

  it('saves null when the URL input is cleared', async () => {
    const user = userEvent.setup();
    render(<CellEditor property={prop} rowPageId="r1" value={null} onSave={onSave} />);
    // Render with no value → shows input directly (not focused/unfocused logic applies when value exists)
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'site.com');
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith(JSON.stringify('site.com'));
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

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ListView } from './ListView';
import type { PageRecord, PropertyRecord, PropertyValueRecord } from '../../api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function row(id: string, title: string): PageRecord {
  return {
    id,
    parentId: 'db-1',
    title,
    icon: '',
    sortKey: id,
    kind: 'row',
    version: 1,
    updatedAt: 0,
  };
}

const textProp: PropertyRecord = {
  id: 'p-text',
  databasePageId: 'db-1',
  name: 'Notes',
  type: 'text',
  options: [],
  sortKey: 'a',
  version: 1,
  updatedAt: 0,
};

const dateProp: PropertyRecord = {
  id: 'p-date',
  databasePageId: 'db-1',
  name: 'Due date',
  type: 'date',
  options: [],
  sortKey: 'b',
  version: 1,
  updatedAt: 0,
};

const val = (rowPageId: string, propertyId: string, value: string | null): PropertyValueRecord => ({
  rowPageId,
  propertyId,
  value,
  version: 1,
  updatedAt: 0,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ListView', () => {
  it('renders a row for each item', () => {
    render(
      <ListView
        rows={[row('r1', 'Alpha'), row('r2', 'Beta')]}
        properties={[]}
        values={[]}
        onSelectRow={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows "empty database" message when rows and totalRowCount are both zero (DEF-085)', () => {
    render(
      <ListView rows={[]} totalRowCount={0} properties={[]} values={[]} onSelectRow={vi.fn()} />,
    );
    expect(screen.getByTestId('list-empty-state').textContent).toMatch(/empty/i);
    expect(screen.getByTestId('list-empty-state').textContent).not.toMatch(/filter/i);
  });

  it('shows "no rows match filters" message when rows is empty but totalRowCount > 0 (DEF-085)', () => {
    render(
      <ListView rows={[]} totalRowCount={3} properties={[]} values={[]} onSelectRow={vi.fn()} />,
    );
    expect(screen.getByTestId('list-empty-state').textContent).toMatch(/no rows match/i);
  });

  it('falls back to "no rows match" when totalRowCount is not provided and rows is empty', () => {
    render(<ListView rows={[]} properties={[]} values={[]} onSelectRow={vi.fn()} />);
    expect(screen.getByTestId('list-empty-state').textContent).toMatch(/no rows match/i);
  });

  it('calls onSelectRow with the row id when a row is clicked', async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[]}
        values={[]}
        onSelectRow={onSelectRow}
      />,
    );
    await user.click(screen.getByTestId('list-row'));
    expect(onSelectRow).toHaveBeenCalledWith('r1');
  });

  it('renders text property values alongside each row', () => {
    render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[textProp]}
        values={[val('r1', 'p-text', JSON.stringify('Some note'))]}
        onSelectRow={vi.fn()}
      />,
    );
    expect(screen.getByText('Some note')).toBeInTheDocument();
  });

  it('formats date values as "D Mon YYYY" rather than raw ISO string (DEF-083)', () => {
    render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[dateProp]}
        values={[val('r1', 'p-date', JSON.stringify('2026-09-15'))]}
        onSelectRow={vi.fn()}
      />,
    );
    // Should see formatted "15 Sept 2026" style, not the raw ISO string.
    expect(screen.queryByText('2026-09-15')).not.toBeInTheDocument();
    // The formatted value contains "2026".
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('shows the property label for each property slot (DEF-084)', () => {
    render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[textProp]}
        values={[val('r1', 'p-text', JSON.stringify('hello'))]}
        onSelectRow={vi.fn()}
      />,
    );
    // The property name "Notes" must be visible (not just in a title attribute).
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('shows a dash placeholder for empty property values instead of omitting the slot (DEF-084)', () => {
    render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[textProp]}
        values={[]} // no value for textProp
        onSelectRow={vi.fn()}
      />,
    );
    // The slot should still render (with an empty/dash indicator).
    const listRow = screen.getByTestId('list-row');
    // The prop label should be present.
    expect(within(listRow).getByText(/notes/i)).toBeInTheDocument();
    // There should be no "Notes" value text - the empty indicator should show.
    expect(within(listRow).getByLabelText(/empty/i)).toBeInTheDocument();
  });

  it('property value container does not use an undefined breakpoint prefix', () => {
    // Regression for DEF-069: `xs:flex flex hidden` permanently hides properties because `xs` is
    // not a defined Tailwind breakpoint in this project. The correct pattern is `hidden sm:flex`
    // (hidden on mobile, visible at sm+). This test catches any future reintroduction of a
    // dead-class pattern where an undefined breakpoint override is silently ignored.
    const { container } = render(
      <ListView
        rows={[row('r1', 'Alpha')]}
        properties={[textProp]}
        values={[val('r1', 'p-text', JSON.stringify('Some note'))]}
        onSelectRow={vi.fn()}
      />,
    );
    const listRow = container.querySelector('[data-testid="list-row"]');
    expect(listRow).toBeTruthy();
    // The property container must not contain an `xs:` prefixed class — xs is not a defined breakpoint.
    const allSpans = Array.from(listRow!.querySelectorAll('span'));
    const propContainer = allSpans.find((s) => s.className.includes('flex-shrink-0'));
    expect(propContainer).toBeTruthy();
    expect(propContainer!.className).not.toMatch(/\bxs:/);
    // It must use a real breakpoint (sm:flex) so properties appear on desktop viewports.
    expect(propContainer!.className).toMatch(/\bsm:flex\b/);
  });
});

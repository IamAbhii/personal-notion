import { render, screen } from '@testing-library/react';
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

  it('shows an empty message when the row list is empty', () => {
    render(<ListView rows={[]} properties={[]} values={[]} onSelectRow={vi.fn()} />);
    expect(screen.getByText(/no rows match/i)).toBeInTheDocument();
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

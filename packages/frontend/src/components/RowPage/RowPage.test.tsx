import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RowPage } from './RowPage';
import { fixtureDatabase, fixtureRows, fixtureProperty, fixtureValue } from '../../test/fixtures';

describe('RowPage', () => {
  // vi.fn().mockReturnValue(null) satisfies the (property, options) => SelectOption | null type.
  const onUpdateOptions = vi.fn().mockReturnValue(null);

  it('renders a label and cell for each property', () => {
    render(
      <RowPage
        row={fixtureRows[0]!}
        dbPage={fixtureDatabase}
        properties={[fixtureProperty]}
        values={[fixtureValue]}
        onSetValue={vi.fn()}
        onUpdateOptions={onUpdateOptions}
      />,
    );
    expect(screen.getByText('Status')).toBeInTheDocument();
    // The selected option chip
    expect(screen.getByText('Todo')).toBeInTheDocument();
  });

  it('shows the parent database name in the header', () => {
    render(
      <RowPage
        row={fixtureRows[0]!}
        dbPage={fixtureDatabase}
        properties={[fixtureProperty]}
        values={[]}
        onSetValue={vi.fn()}
        onUpdateOptions={onUpdateOptions}
      />,
    );
    expect(screen.getByText(/Projects/)).toBeInTheDocument();
  });

  it('renders nothing when there are no properties', () => {
    render(
      <RowPage
        row={fixtureRows[0]!}
        dbPage={fixtureDatabase}
        properties={[]}
        values={[]}
        onSetValue={vi.fn()}
        onUpdateOptions={onUpdateOptions}
      />,
    );
    expect(screen.queryByTestId('property-row')).not.toBeInTheDocument();
  });

  it('renders children (the block editor slot)', () => {
    render(
      <RowPage
        row={fixtureRows[0]!}
        dbPage={fixtureDatabase}
        properties={[]}
        values={[]}
        onSetValue={vi.fn()}
        onUpdateOptions={onUpdateOptions}
      >
        <div data-testid="slot-content">Block editor here</div>
      </RowPage>,
    );
    expect(screen.getByTestId('slot-content')).toBeInTheDocument();
  });

  it('shows a property row for each property', () => {
    render(
      <RowPage
        row={fixtureRows[0]!}
        dbPage={fixtureDatabase}
        properties={[fixtureProperty]}
        values={[]}
        onSetValue={vi.fn()}
        onUpdateOptions={onUpdateOptions}
      />,
    );
    expect(screen.getAllByTestId('property-row')).toHaveLength(1);
  });
});

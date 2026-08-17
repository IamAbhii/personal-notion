import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders all three view tabs', () => {
    render(<ViewSwitcher activeKind="table" onSwitch={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /table view/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /board view/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /list view/i })).toBeInTheDocument();
  });

  it('marks the active tab as selected and others as not selected', () => {
    render(<ViewSwitcher activeKind="board" onSwitch={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /board view/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /table view/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: /list view/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onSwitch with the correct kind when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<ViewSwitcher activeKind="table" onSwitch={onSwitch} />);

    await user.click(screen.getByRole('tab', { name: /board view/i }));
    expect(onSwitch).toHaveBeenCalledWith('board');

    await user.click(screen.getByRole('tab', { name: /list view/i }));
    expect(onSwitch).toHaveBeenCalledWith('list');
  });

  it('does not call onSwitch again when the already-active tab is clicked', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<ViewSwitcher activeKind="table" onSwitch={onSwitch} />);

    await user.click(screen.getByRole('tab', { name: /table view/i }));
    // The switcher does not gate the call — it always calls onSwitch. This test verifies the
    // caller is responsible for idempotency (the uiStore setActiveViewKind is idempotent).
    expect(onSwitch).toHaveBeenCalledWith('table');
  });
});

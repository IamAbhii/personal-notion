import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu';

function renderMenu(overrides: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const onRename = vi.fn();
  const onDelete = vi.fn();

  render(
    <DropdownMenu trigger={<button type="button">Open menu</button>} {...overrides}>
      <DropdownMenuItem data-testid="item-rename" onSelect={onRename}>
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="item-delete" variant="danger" onSelect={onDelete}>
        Delete
      </DropdownMenuItem>
    </DropdownMenu>,
  );

  return { onRename, onDelete };
}

describe('DropdownMenu', () => {
  it('renders the trigger element', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('shows items when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides items when the menu is closed', async () => {
    const user = userEvent.setup();
    renderMenu();

    // Open, then Escape to close.
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('is open when open=true', () => {
    renderMenu({ open: true });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('is closed when open=false', () => {
    renderMenu({ open: false });
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Escape is pressed while open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderMenu({ open: true, onOpenChange });

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls the item onSelect handler when the item is clicked', async () => {
    const user = userEvent.setup();
    const { onRename } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('applies data-testid to items so end-to-end selectors can find them', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByTestId('item-rename')).toBeInTheDocument();
    expect(screen.getByTestId('item-delete')).toBeInTheDocument();
  });

  it('applies additional className to the content panel', () => {
    render(
      <DropdownMenu open trigger={<button type="button">T</button>} className="test-class">
        <DropdownMenuItem>Item</DropdownMenuItem>
      </DropdownMenu>,
    );
    // The item's parent is the Content element.
    const item = screen.getByRole('menuitem', { name: 'Item' });
    expect(item.closest('.test-class')).toBeInTheDocument();
  });
});

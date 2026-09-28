import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';

function renderDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Confirm action',
    ...overrides,
  };
  render(<Dialog {...props} />);
  return props;
}

describe('Dialog', () => {
  it('renders the dialog with the given title', () => {
    renderDialog({ title: 'Delete item' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete item')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    renderDialog({ description: <p>Are you sure?</p> });
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders children in the body', () => {
    renderDialog({ children: <span data-testid="body-content">Body</span> });
    expect(screen.getByTestId('body-content')).toBeInTheDocument();
  });

  it('renders footer slot', () => {
    renderDialog({ footer: <button type="button">OK</button> });
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('is not in the DOM when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when Escape is pressed', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies additional className to the content panel', () => {
    renderDialog({ className: 'test-extra-class' });
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('test-extra-class');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './Popover';

describe('Popover', () => {
  it('renders the trigger element', () => {
    render(
      <Popover trigger={<button type="button">Open</button>}>
        <p>Popover content</p>
      </Popover>,
    );
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('shows content when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<button type="button">Open</button>}>
        <p>Popover content</p>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Popover content')).toBeInTheDocument();
  });

  it('is open when open=true', () => {
    render(
      <Popover open trigger={<button type="button">Trigger</button>}>
        <p data-testid="content">Content</p>
      </Popover>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('is closed when open=false', () => {
    render(
      <Popover open={false} trigger={<button type="button">Trigger</button>}>
        <p data-testid="content">Content</p>
      </Popover>,
    );
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when Escape is pressed while open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Popover open onOpenChange={onOpenChange} trigger={<button type="button">Trigger</button>}>
        <p>Content</p>
      </Popover>,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies additional className to the content panel', () => {
    render(
      <Popover open trigger={<button type="button">T</button>} className="test-class">
        <p data-testid="content">Body</p>
      </Popover>,
    );
    // The data-testid content's parent is the Popover.Content element
    const content = screen.getByTestId('content').parentElement;
    expect(content?.className).toContain('test-class');
  });
});

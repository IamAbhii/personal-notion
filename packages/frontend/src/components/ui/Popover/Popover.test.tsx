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

  it('content panel is assigned z-index 50 so it paints above the mobile drawer (z-index: 40)', () => {
    // Regression guard: the mobile drawer wrapper is fixed inset-0 with z-index: 40. Any portalled
    // layer without a higher z-index paints under the scrim and is untappable on mobile.
    // We inject the @utility z-overlay rule directly so getComputedStyle reflects the production
    // value — jsdom does not process external stylesheets, but does honour injected <style> blocks.
    const style = document.createElement('style');
    style.textContent = '.z-overlay { z-index: 50; }';
    document.head.appendChild(style);

    render(
      <Popover open trigger={<button type="button">T</button>}>
        <p data-testid="content">Body</p>
      </Popover>,
    );
    const panel = screen.getByTestId('content').parentElement as HTMLElement;
    expect(getComputedStyle(panel).zIndex).toBe('50');

    style.remove();
  });

  it('content has role="dialog" so the drawer Escape guard fires and leaves the drawer open', () => {
    // WorkspaceShell and Sidebar have a document-level Escape listener that bails when
    // document.querySelector('[role="dialog"]') is non-null, preventing the drawer from closing
    // while a popover is open. Radix Popover.Content carries role="dialog" by default.
    render(
      <Popover open trigger={<button type="button">T</button>} contentLabel="Test popover">
        <p>Body</p>
      </Popover>,
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

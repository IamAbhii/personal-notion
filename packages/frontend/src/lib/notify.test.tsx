import { describe, expect, it, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toaster } from 'sonner';
import { notify } from './notify';

// The Toaster must be mounted in the document for toasts to render.
function renderWithToaster() {
  return render(<Toaster duration={Infinity} />);
}

afterEach(() => {
  // Sonner stores toasts in a module-level singleton; reset between tests by unmounting.
  // The toast state resets when the Toaster unmounts, which cleanup() handles.
});

describe('notify', () => {
  it('displays the message as a toast', async () => {
    renderWithToaster();
    notify('Something failed');
    expect(await screen.findByText('Something failed')).toBeInTheDocument();
  });

  it('does not stack a second card when the same message is notified twice', async () => {
    renderWithToaster();
    notify('Duplicate message');
    notify('Duplicate message');
    const matches = await screen.findAllByText('Duplicate message');
    // Only one toast should appear regardless of how many times the same message is notified.
    expect(matches).toHaveLength(1);
  });

  it('shows a second card for a different message', async () => {
    renderWithToaster();
    notify('First error');
    notify('Second error');
    expect(await screen.findByText('First error')).toBeInTheDocument();
    expect(await screen.findByText('Second error')).toBeInTheDocument();
  });
});

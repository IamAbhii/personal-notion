import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { IconButton } from './IconButton';

const TestIcon = () => <svg aria-hidden="true" />;

describe('IconButton', () => {
  it('renders a button with the given aria-label', () => {
    render(<IconButton icon={<TestIcon />} aria-label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders the icon slot', () => {
    render(<IconButton icon={<svg data-testid="my-icon" aria-hidden="true" />} aria-label="Go" />);
    expect(screen.getByTestId('my-icon')).toBeInTheDocument();
  });

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} icon={<TestIcon />} aria-label="Action" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('spreads rest props onto the native button', () => {
    render(<IconButton icon={<TestIcon />} aria-label="Item" data-testid="icon-btn" disabled />);
    const btn = screen.getByTestId('icon-btn');
    expect(btn).toBeDisabled();
  });

  it('merges incoming className after defaults so caller wins', () => {
    render(
      <IconButton icon={<TestIcon />} aria-label="X" className="text-danger" data-testid="btn" />,
    );
    expect(screen.getByTestId('btn').className).toContain('text-danger');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon={<TestIcon />} aria-label="Click me" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Click me' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

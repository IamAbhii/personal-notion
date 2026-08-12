import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Button } from './Button';

describe('Button', () => {
  it('renders a button element with the given text', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('spreads rest props onto the native button', () => {
    render(
      <Button aria-label="Close dialog" data-testid="close-btn">
        X
      </Button>,
    );
    const btn = screen.getByTestId('close-btn');
    expect(btn).toHaveAttribute('aria-label', 'Close dialog');
  });

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Click</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('merges incoming className after defaults so caller wins a conflict', () => {
    render(
      <Button className="px-0" data-testid="btn">
        Test
      </Button>,
    );
    // The incoming px-0 overrides the default horizontal padding; twMerge resolves the conflict.
    const btn = screen.getByTestId('btn');
    expect(btn.className).toContain('px-0');
    // The default px-[14px] is removed by twMerge when px-0 is supplied.
    expect(btn.className).not.toContain('px-[14px]');
  });

  it('defaults to the primary variant', () => {
    render(<Button data-testid="btn">Primary</Button>);
    expect(screen.getByTestId('btn').className).toContain('bg-amber');
  });

  it('applies the ghost variant classes', () => {
    render(
      <Button variant="ghost" data-testid="btn">
        Ghost
      </Button>,
    );
    expect(screen.getByTestId('btn').className).toContain('bg-transparent');
  });

  it('applies the danger variant classes', () => {
    render(
      <Button variant="danger" data-testid="btn">
        Delete
      </Button>,
    );
    expect(screen.getByTestId('btn').className).toContain('bg-danger');
  });

  it('is disabled when the disabled prop is set', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

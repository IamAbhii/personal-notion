import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCard } from './StatusCard';

describe('StatusCard', () => {
  it('renders eyebrow, lead and note', () => {
    render(
      <StatusCard
        eyebrow="Personal Space"
        lead="Nothing here yet."
        note="Add a page to get started."
      />,
    );
    expect(screen.getByText('Personal Space')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.getByText('Add a page to get started.')).toBeInTheDocument();
  });

  it('omits the note element when note is not provided', () => {
    const { container } = render(<StatusCard eyebrow="Loading" lead="Loading your workspace..." />);
    // Only eyebrow and lead <p> tags, no note <p>
    expect(container.querySelectorAll('p').length).toBe(2);
  });

  it('renders children in the footer slot', () => {
    render(
      <StatusCard eyebrow="Error" lead="Something went wrong.">
        <button type="button">Try again</button>
      </StatusCard>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('applies the raised variant classes by default', () => {
    const { container } = render(<StatusCard eyebrow="x" lead="y" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-surface');
    expect(card.className).toContain('shadow-panel');
    expect(card.className).not.toContain('border');
  });

  it('applies the bordered variant classes', () => {
    const { container } = render(<StatusCard variant="bordered" eyebrow="x" lead="y" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-surface');
    expect(card.className).toContain('border');
  });

  it('applies the sunken variant classes', () => {
    const { container } = render(<StatusCard variant="sunken" eyebrow="x" lead="y" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-surface-sunken');
    expect(card.className).toContain('border-dashed');
  });

  it('applies the accent eyebrow color by default', () => {
    render(<StatusCard eyebrow="Label" lead="y" />);
    expect(screen.getByText('Label').className).toContain('text-amber');
  });

  it('applies the error eyebrow color', () => {
    render(<StatusCard eyebrowIntent="error" eyebrow="Oh no" lead="y" />);
    expect(screen.getByText('Oh no').className).toContain('text-danger');
  });

  it('applies the info eyebrow color', () => {
    render(<StatusCard eyebrowIntent="info" eyebrow="Info" lead="y" />);
    expect(screen.getByText('Info').className).toContain('text-blue');
  });

  it('merges the incoming className onto the card shell', () => {
    const { container } = render(<StatusCard eyebrow="x" lead="y" className="extra-class mt-8" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('mt-8');
    expect(card.className).toContain('extra-class');
  });
});

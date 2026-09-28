import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkipLink } from './SkipLink';

// DEF-020: reaching the page body by keyboard took 118 Tab presses through the sidebar, because
// nothing let a keyboard user jump past the page tree.

describe('SkipLink', () => {
  it('is the first tab stop and moves focus to the target in one press', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SkipLink targetId="page-body">Skip to the page body</SkipLink>
        <nav>
          <button type="button">A sidebar control</button>
        </nav>
        <div id="page-body" tabIndex={-1}>
          <textarea aria-label="Paragraph block" />
        </div>
      </div>,
    );

    const link = screen.getByRole('link', { name: 'Skip to the page body' });
    await user.tab();
    expect(document.activeElement).toBe(link);

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.getElementById('page-body'));

    // And from there the editor is the very next stop, rather than the rest of the sidebar.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Paragraph block'));
  });

  it('leaves the URL alone, since the router owns it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink targetId="page-body">Skip to the page body</SkipLink>
        <div id="page-body" tabIndex={-1} />
      </>,
    );

    await user.click(screen.getByRole('link', { name: 'Skip to the page body' }));

    expect(window.location.hash).toBe('');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageView } from './PageView';
import { fixturePages } from '../test/fixtures';
import { ancestorChain } from '../lib/pageTree';

const lisbon = fixturePages.find((page) => page.id === 'p-lisbon')!;

function renderPageView() {
  const props = {
    page: lisbon,
    breadcrumb: ancestorChain(fixturePages, lisbon.id),
    childCount: 0,
    onSelectPage: vi.fn(),
    onRename: vi.fn(),
    onChangeIcon: vi.fn(),
  };
  render(<PageView {...props} />);
  return props;
}

describe('PageView', () => {
  it('shows the icon, the title and the breadcrumb down to the page', () => {
    renderPageView();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lisbon');
    expect(screen.getByRole('button', { name: 'Change the icon for Lisbon' })).toHaveTextContent(
      lisbon.icon,
    );
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Journal');
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Trips');
  });

  it('marks the block editor as a placeholder rather than rendering blocks', () => {
    renderPageView();

    expect(screen.getByLabelText('Page body')).toHaveTextContent('Editor placeholder');
  });

  it('renames the page from the header', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: 'Rename Lisbon' }));
    const input = screen.getByLabelText('New name for Lisbon');
    await user.clear(input);
    await user.type(input, 'Lisbon 2026{Enter}');

    expect(props.onRename).toHaveBeenCalledWith('Lisbon 2026');
  });

  it('navigates from a breadcrumb link', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: /Journal/ }));

    expect(props.onSelectPage).toHaveBeenCalledWith('p-journal');
  });
});

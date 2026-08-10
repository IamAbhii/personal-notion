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

  it('tags the header with the page id, so a spec need not parse the URL', () => {
    renderPageView();

    const header = screen.getByRole('heading', { level: 1 }).closest('.page__header');
    expect(header).toHaveAttribute('data-page-id', 'p-lisbon');
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

    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('Lisbon 2026');
  });

  it('writes one rename per editing session, even when Enter is followed by a click away', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: 'Rename Lisbon' }));
    const input = screen.getByLabelText('New name for Lisbon');
    await user.clear(input);
    await user.type(input, 'Lisbon 2026{Enter}');
    // Each op is a D1 write and a queue entry, so the blur after Enter must not write a second one.
    await user.click(screen.getByLabelText('Breadcrumb'));

    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it('renames from the header on a blur with no Enter, exactly once', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: 'Rename Lisbon' }));
    const input = screen.getByLabelText('New name for Lisbon');
    await user.clear(input);
    await user.type(input, 'Lisbon 2026');
    await user.click(screen.getByLabelText('Breadcrumb'));

    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('Lisbon 2026');
  });

  it('writes nothing when the header title is committed unchanged', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: 'Rename Lisbon' }));
    await user.type(screen.getByLabelText('New name for Lisbon'), '{Enter}');

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lisbon');
  });

  it('navigates from a breadcrumb link', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: /Journal/ }));

    expect(props.onSelectPage).toHaveBeenCalledWith('p-journal');
  });
});

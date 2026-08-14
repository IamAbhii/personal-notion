import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageView } from './PageView';
import { fixturePages, makePage } from '../../test/fixtures';
import { ancestorChain } from '../../lib/pageTree';

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
  render(
    <PageView {...props}>
      <section aria-label="Page body">Block editor</section>
    </PageView>,
  );
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

    const header = screen.getByTestId('page-header');
    expect(header).toHaveAttribute('data-page-id', 'p-lisbon');
  });

  it('renders the page body it is given, which is the block editor', () => {
    renderPageView();

    expect(screen.getByLabelText('Page body')).toHaveTextContent('Block editor');
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

  it('truncates each breadcrumb crumb in its own element, with the full title on hover (DEF-008)', () => {
    const longTitle = 'L'.repeat(500);
    render(
      <PageView
        page={{ ...lisbon, title: longTitle }}
        breadcrumb={[{ ...lisbon, title: longTitle }]}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );

    // The label is a separate element so it can be clipped without pushing the icon out of the button.
    const label = screen.getByTestId('breadcrumb-label');
    expect(label).toHaveTextContent(longTitle);
    expect(screen.getByTestId('breadcrumb-link')).toHaveAttribute('title', longTitle);
  });

  it('applies the 860px prose constraint to a plain page but not a database page (DEF-042)', () => {
    const db = makePage({ id: 'p-db', title: 'My DB', kind: 'database' });
    const { rerender } = render(
      <PageView
        page={lisbon}
        breadcrumb={[lisbon]}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );
    // Plain page: main must carry the 860px constraint class.
    const main = document.querySelector('main')!;
    expect(main.className).toContain('max-w-[860px]');

    rerender(
      <PageView
        page={db}
        breadcrumb={[db]}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );
    // Database page: max-w constraint must be absent so the table can use the full content width.
    expect(main.className).not.toContain('max-w-[860px]');
  });

  it('collapses a deep breadcrumb to a bounded row of crumbs (DEF-009)', () => {
    const chain = Array.from({ length: 26 }, (_unused, index) =>
      makePage({
        id: `p-${index}`,
        title: `Level ${index}`,
        parentId: index ? `p-${index - 1}` : null,
      }),
    );
    render(
      <PageView
        page={chain[25]!}
        breadcrumb={chain}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );

    const crumbs = screen.getAllByTestId('breadcrumb-item');
    expect(crumbs).toHaveLength(4);
    // The current page is what tells the user where they are, so it is never the crumb dropped.
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Level 25');
    expect(screen.getByTestId('breadcrumb-gap')).toHaveAttribute(
      'title',
      expect.stringContaining('23 pages between'),
    );
  });

  it('navigates from a breadcrumb link', async () => {
    const user = userEvent.setup();
    const props = renderPageView();

    await user.click(screen.getByRole('button', { name: /Journal/ }));

    expect(props.onSelectPage).toHaveBeenCalledWith('p-journal');
  });

  it('does not render an empty icon tile when page.icon is empty (row pages)', () => {
    // Row pages are seeded with icon: null. The header must show an "Add icon" affordance
    // instead of a blank bordered tile so the UI does not look broken.
    const rowPage = makePage({ id: 'p-row', title: 'My Row', kind: 'row', icon: '' });
    render(
      <PageView
        page={rowPage}
        breadcrumb={[rowPage]}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );
    // The icon button that shows the emoji must be absent.
    expect(
      screen.queryByRole('button', { name: 'Change the icon for My Row' }),
    ).not.toBeInTheDocument();
    // An "Add icon" affordance must be present so the picker is still reachable.
    expect(screen.getByRole('button', { name: 'Add an icon for My Row' })).toBeInTheDocument();
  });

  it('renders the normal icon button when page.icon is set', () => {
    // When an icon is present the full 76px tile must appear; the "Add icon" affordance must not.
    render(
      <PageView
        page={lisbon}
        breadcrumb={[lisbon]}
        childCount={0}
        onSelectPage={vi.fn()}
        onRename={vi.fn()}
        onChangeIcon={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Change the icon for Lisbon' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add an icon for Lisbon' }),
    ).not.toBeInTheDocument();
  });
});

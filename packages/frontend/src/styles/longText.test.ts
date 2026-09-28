// DEF-008 regression guard: a 500-character title must still wrap in the page header and
// ellipsise in the breadcrumb after the Tailwind utility migration (no more CSS rules to assert).
//
// This version renders the component and checks that the required utility classes are present on
// the elements - overflow-wrap:anywhere on the heading and button (prevents horizontal overflow
// for a spaceless title), text-ellipsis + max-w on the breadcrumb label (clips without widening
// the fixed-height top bar), and flex-nowrap + overflow-hidden on the breadcrumb container.
//
// We use React.createElement so the file stays .ts rather than requiring a .tsx rename.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageView } from '../components/PageView/PageView';
import { makePage } from '../test/fixtures';

const longTitle = 'L'.repeat(500);
const longPage = makePage({ id: 'p-long', title: longTitle });

function renderLongTitle() {
  render(
    React.createElement(PageView, {
      page: longPage,
      breadcrumb: [longPage],
      childCount: 0,
      onSelectPage: vi.fn(),
      onRename: vi.fn(),
      onChangeIcon: vi.fn(),
    }),
  );
}

describe('a very long title (DEF-008)', () => {
  it('wraps in the page header, including a title with no spaces to break at', () => {
    renderLongTitle();

    // The h1 carries overflow-wrap:anywhere so a spaceless 500-char title cannot run off screen.
    const h1 = screen.getByTestId('page-title');
    expect(h1).toHaveAttribute('class', expect.stringContaining('[overflow-wrap:anywhere]'));

    // The title button inherits the h1 typography; max-w-full stops it exceeding the column.
    const titleButton = screen.getByRole('button', { name: /Rename/ });
    expect(titleButton).toHaveAttribute(
      'class',
      expect.stringContaining('[overflow-wrap:anywhere]'),
    );
    expect(titleButton).toHaveAttribute('class', expect.stringContaining('max-w-full'));
  });

  it('is clipped in the breadcrumb rather than widening the top bar', () => {
    renderLongTitle();

    // The label element is a separate inline span so clipping does not push the icon out of view.
    const label = screen.getByTestId('breadcrumb-label');
    expect(label).toHaveAttribute('class', expect.stringContaining('text-ellipsis'));
    expect(label).toHaveAttribute('class', expect.stringMatching(/max-w-/));
  });

  it('cannot make the breadcrumb wrap out of the fixed-height top bar', () => {
    renderLongTitle();

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    // flex-nowrap prevents the trail from wrapping; overflow-hidden clips excess crumbs.
    expect(breadcrumb).toHaveAttribute('class', expect.stringContaining('flex-nowrap'));
    expect(breadcrumb).toHaveAttribute('class', expect.stringContaining('overflow-hidden'));
  });
});

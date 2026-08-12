import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockEditor } from './BlockEditor';
import { blocksForPage, sortKeyAfterIndex } from '../lib/blocks';
import { makeBlock } from '../test/fixtures';
import type { BlockRecord, BlockType, BlockUpdatePayload } from '../api/types';

// The editor is driven through a harness that applies the writes to local state, the way the
// optimistic snapshot patch in useBlockMutations does, so focus moves and re-renders are exercised.
// The create is synchronous here because it is synchronous in useBlockMutations: the id is minted
// and the snapshot patched before any network call, which is what lets the caret move inside the
// keystroke that asked for the block.

interface Recorded {
  created: { type: BlockType; afterBlockId: string | null }[];
  updates: { id: string; changes: BlockUpdatePayload }[];
  deleted: string[];
  notices: string[];
}

function renderEditor(initial: BlockRecord[]): Recorded {
  const recorded: Recorded = { created: [], updates: [], deleted: [], notices: [] };

  function Harness() {
    const [blocks, setBlocks] = useState(initial);

    return (
      <BlockEditor
        blocks={blocks}
        onNotice={(message) => recorded.notices.push(message)}
        onCreateBlock={(args) => {
          recorded.created.push(args);
          const id = `b-new-${recorded.created.length}`;
          setBlocks((current) => {
            const ordered = blocksForPage(current, 'p-1');
            const afterIndex = args.afterBlockId
              ? ordered.findIndex((block) => block.id === args.afterBlockId)
              : ordered.length - 1;
            const sortKey = sortKeyAfterIndex(ordered, afterIndex);
            return blocksForPage([...current, makeBlock({ id, pageId: 'p-1', sortKey })], 'p-1');
          });
          return id;
        }}
        onUpdateBlock={(block, changes) => {
          recorded.updates.push({ id: block.id, changes });
          setBlocks((current) =>
            blocksForPage(
              current.map((candidate) =>
                candidate.id === block.id ? { ...candidate, ...changes } : candidate,
              ),
              'p-1',
            ),
          );
        }}
        onDeleteBlock={(block) => {
          recorded.deleted.push(block.id);
          setBlocks((current) => current.filter((candidate) => candidate.id !== block.id));
        }}
      />
    );
  }

  render(<Harness />);
  return recorded;
}

/** The textarea of one block, found through the wrapper's data-block-id. */
function editorFor(blockId: string): HTMLTextAreaElement {
  const wrapper = document.querySelector(`[data-block-id="${blockId}"]`);
  return within(wrapper as HTMLElement).getByRole('textbox') as HTMLTextAreaElement;
}

/** Puts the caret in a block's textarea at `caret`, which is what Backspace behaviour turns on. */
async function focusAt(blockId: string, caret: number) {
  const element = editorFor(blockId);
  await act(async () => {
    element.focus();
    element.setSelectionRange(caret, caret);
  });
  return element;
}

const paragraph = makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: 'First block' });

describe('the eleven block types', () => {
  it('tags every block with its id and type for the stack the page renders', () => {
    renderEditor([paragraph]);

    const stack = screen.getByTestId('block-editor');
    const wrapper = stack.querySelector('[data-block-id="b-1"]');
    expect(wrapper).toHaveAttribute('data-block-type', 'paragraph');
    expect(within(wrapper as HTMLElement).getByTestId('block-drag-handle')).toBeInTheDocument();
  });

  it('renders each type as its own distinct element', () => {
    renderEditor([
      makeBlock({ id: 'h1', pageId: 'p-1', type: 'heading1', text: 'One', sortKey: 'a0' }),
      makeBlock({ id: 'h2', pageId: 'p-1', type: 'heading2', text: 'Two', sortKey: 'a1' }),
      makeBlock({ id: 'h3', pageId: 'p-1', type: 'heading3', text: 'Three', sortKey: 'a2' }),
      makeBlock({ id: 'bul', pageId: 'p-1', type: 'bulletedList', text: 'Bullet', sortKey: 'a3' }),
      makeBlock({ id: 'num', pageId: 'p-1', type: 'numberedList', text: 'Number', sortKey: 'a4' }),
      makeBlock({ id: 'todo', pageId: 'p-1', type: 'todo', text: 'Pack', sortKey: 'a5' }),
      makeBlock({ id: 'quote', pageId: 'p-1', type: 'quote', text: 'Said', sortKey: 'a6' }),
      makeBlock({ id: 'div', pageId: 'p-1', type: 'divider', sortKey: 'a7' }),
      makeBlock({
        id: 'code',
        pageId: 'p-1',
        type: 'code',
        text: 'const a = 1',
        props: '{"language":"typescript"}',
        sortKey: 'a8',
      }),
      makeBlock({
        id: 'call',
        pageId: 'p-1',
        type: 'callout',
        text: 'Remember',
        props: '{"emoji":"\u{1F525}"}',
        sortKey: 'a9',
      }),
      makeBlock({ id: 'para', pageId: 'p-1', type: 'paragraph', text: 'Plain', sortKey: 'b0' }),
    ]);

    // Headings are real headings, scaling h1 to h3.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    // The list markers are drawn by real list elements rather than typed into the text.
    expect(document.querySelector('[data-block-id="bul"] ul li')).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="num"] ol li')).toBeInTheDocument();
    // Tailwind preflight sets list-style:none on all ul/ol; list-disc/list-decimal must be
    // explicit or the browser draws no marker at all.
    expect(document.querySelector('[data-block-id="bul"] ul')).toHaveClass('list-disc');
    expect(document.querySelector('[data-block-id="num"] ol')).toHaveClass('list-decimal');
    // A to-do is a working checkbox named by its own text.
    expect(screen.getByRole('checkbox', { name: 'Pack' })).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="quote"] blockquote')).toBeInTheDocument();
    // The divider has no text at all, only a rule.
    expect(document.querySelector('[data-block-id="div"] hr')).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="div"] textarea')).toBeNull();
    // Code shows the language it is in; a callout shows its emoji.
    // data-testid selectors are used rather than class names because the migration replaced
    // legacy class names with Tailwind utilities.
    expect(
      document.querySelector('[data-block-id="code"] [data-testid="block-code-lang"]'),
    ).toHaveTextContent('typescript');
    expect(
      document.querySelector('[data-block-id="call"] [data-testid="block-callout-emoji"]'),
    ).toHaveTextContent('\u{1F525}');
    expect(document.querySelector('[data-block-id="para"] textarea')).toHaveValue('Plain');
  });

  it('numbers a numbered run correctly and restarts it after a paragraph', () => {
    renderEditor([
      makeBlock({ id: 'n1', pageId: 'p-1', type: 'numberedList', text: 'One', sortKey: 'a0' }),
      makeBlock({ id: 'n2', pageId: 'p-1', type: 'numberedList', text: 'Two', sortKey: 'a1' }),
      makeBlock({ id: 'p', pageId: 'p-1', type: 'paragraph', text: 'Aside', sortKey: 'a2' }),
      makeBlock({ id: 'n3', pageId: 'p-1', type: 'numberedList', text: 'Again', sortKey: 'a3' }),
    ]);

    expect(document.querySelector('[data-block-id="n1"] ol')).toHaveAttribute('start', '1');
    expect(document.querySelector('[data-block-id="n2"] ol')).toHaveAttribute('start', '2');
    expect(document.querySelector('[data-block-id="n3"] ol')).toHaveAttribute('start', '1');
  });

  it('shows the default language and emoji when a block carries no props', () => {
    renderEditor([
      makeBlock({ id: 'code', pageId: 'p-1', type: 'code', text: 'x', sortKey: 'a0' }),
      makeBlock({ id: 'call', pageId: 'p-1', type: 'callout', text: 'Note', sortKey: 'a1' }),
    ]);

    expect(
      document.querySelector('[data-block-id="code"] [data-testid="block-code-lang"]'),
    ).toHaveTextContent('plain text');
    expect(
      document.querySelector('[data-block-id="call"] [data-testid="block-callout-emoji"]'),
    ).toHaveTextContent('\u{1F4A1}');
  });
});

describe('the to-do checkbox', () => {
  it('writes one update carrying only the checked flag', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', type: 'todo', text: 'Pack', sortKey: 'a0' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Pack' }));

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { checked: true } }]);
    expect(screen.getByRole('checkbox', { name: 'Pack' })).toBeChecked();
  });

  it('strikes the text through once the to-do is done', () => {
    renderEditor([
      makeBlock({
        id: 'b-1',
        pageId: 'p-1',
        type: 'todo',
        text: 'Pack',
        checked: true,
        sortKey: 'a0',
      }),
    ]);

    // data-done is used rather than a class name because the migration replaced legacy class names
    // with a data attribute on the todo wrapper.
    expect(document.querySelector('[data-block-id="b-1"] [data-done="true"]')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pack' })).toBeChecked();
  });
});

describe('autosave', () => {
  it('writes one update per settled edit rather than one per keystroke', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.clear(editorFor('b-1'));
    await user.type(editorFor('b-1'), 'Hello there');
    // Eleven keystrokes, and no write yet: the debounce is what keeps one op per settled edit.
    expect(recorded.updates).toEqual([]);

    await waitFor(() =>
      expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: 'Hello there' } }]),
    );
    // And it settles at exactly one, not one per keystroke that happened to land late.
    expect(recorded.updates).toHaveLength(1);
  });

  it('flushes the pending edit immediately on blur, so nothing is lost', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.type(editorFor('b-1'), '!');
    await user.tab();

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: 'First block!' } }]);
  });
});

describe('Enter', () => {
  it('inserts a paragraph below the current block and focuses it', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      paragraph,
      makeBlock({ id: 'b-2', pageId: 'p-1', sortKey: 'a1', text: 'Second block' }),
    ]);

    await focusAt('b-1', 'First block'.length);
    await user.keyboard('{Enter}');

    expect(recorded.created).toEqual([{ type: 'paragraph', afterBlockId: 'b-1' }]);
    // The new block lands between the two, not at the end of the page.
    const ids = [...document.querySelectorAll('[data-block-id]')].map((node) =>
      node.getAttribute('data-block-id'),
    );
    expect(ids).toEqual(['b-1', 'b-new-1', 'b-2']);
    await waitFor(() => expect(document.activeElement).toBe(editorFor('b-new-1')));
  });

  it('flushes the current block before inserting, so the edit and the new block both survive', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.type(editorFor('b-1'), ' edited');
    await user.keyboard('{Enter}');

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: 'First block edited' } }]);
    expect(recorded.created).toHaveLength(1);
  });

  it('inserts a newline inside a code block instead of a new block', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', type: 'code', text: 'const a = 1', sortKey: 'a0' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('{Enter}const b = 2');

    expect(recorded.created).toEqual([]);
    expect(editorFor('b-1')).toHaveValue('const a = 1\nconst b = 2');
  });
});

describe('Backspace', () => {
  it('deletes an empty block and puts the caret at the end of the block above', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      paragraph,
      makeBlock({ id: 'b-2', pageId: 'p-1', sortKey: 'a1', text: '' }),
    ]);

    await focusAt('b-2', 0);
    await user.keyboard('{Backspace}');

    expect(recorded.deleted).toEqual(['b-2']);
    await waitFor(() => expect(document.activeElement).toBe(editorFor('b-1')));
    expect(editorFor('b-1').selectionStart).toBe('First block'.length);
  });

  it('does nothing destructive at the start of a block that has text', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await focusAt('b-1', 0);
    await user.keyboard('{Backspace}');

    expect(recorded.deleted).toEqual([]);
    expect(editorFor('b-1')).toHaveValue('First block');
  });

  it('deletes nothing when the caret is inside an empty block but not at its start', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      paragraph,
      makeBlock({ id: 'b-2', pageId: 'p-1', sortKey: 'a1', text: 'ab' }),
    ]);

    await focusAt('b-2', 2);
    await user.keyboard('{Backspace}');

    expect(recorded.deleted).toEqual([]);
    expect(editorFor('b-2')).toHaveValue('a');
  });
});

describe('the slash menu', () => {
  it('opens on "/" in an empty block and offers all eleven types', async () => {
    const user = userEvent.setup();
    renderEditor([makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' })]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/');

    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
    expect(screen.getAllByTestId('slash-menu-item')).toHaveLength(11);
  });

  it('stays shut when "/" is typed after text, so a slash can be written', async () => {
    const user = userEvent.setup();
    renderEditor([paragraph]);

    await focusAt('b-1', 'First block'.length);
    await user.keyboard('/');

    expect(screen.queryByTestId('slash-menu')).toBeNull();
  });

  it('filters as the query is typed', async () => {
    const user = userEvent.setup();
    renderEditor([makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' })]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/head');

    const items = screen.getAllByTestId('slash-menu-item');
    expect(items.map((item) => item.getAttribute('data-block-type'))).toEqual([
      'heading1',
      'heading2',
      'heading3',
    ]);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderEditor([makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' })]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/zzz');

    expect(screen.queryAllByTestId('slash-menu-item')).toEqual([]);
    expect(screen.getByTestId('slash-menu')).toHaveTextContent('No block type matches that.');
  });

  it('moves the highlight with the arrow keys and wraps at both ends', async () => {
    const user = userEvent.setup();
    renderEditor([makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' })]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/');
    const selected = () =>
      screen
        .getAllByTestId('slash-menu-item')
        .find((item) => item.getAttribute('aria-selected') === 'true')
        ?.getAttribute('data-block-type');

    expect(selected()).toBe('paragraph');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe('heading2');
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe('heading1');
    // Up from the first entry wraps to the last rather than sticking.
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(selected()).toBe('callout');
  });

  it('converts the block with Enter, in one update, and clears the query it saved', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/quote{Enter}');

    // The query text is autosaved while it is typed, so the conversion clears it on the server too,
    // in the same op that changes the type.
    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { type: 'quote', text: '' } }]);
    expect(screen.queryByTestId('slash-menu')).toBeNull();
    expect(document.querySelector('[data-block-id="b-1"]')).toHaveAttribute(
      'data-block-type',
      'quote',
    );
    // The "/quote" text was a command, not content, so the block is left empty.
    expect(editorFor('b-1')).toHaveValue('');
  });

  it('keeps the caret in the converted block, so typing continues into it', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    // A callout wraps its textarea in a different element, so React remounts it on conversion and
    // the focus has to be restored afterwards or the next keystrokes land nowhere.
    await user.keyboard('/callout{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(editorFor('b-1')));
    await user.keyboard('Remember this');

    expect(editorFor('b-1')).toHaveValue('Remember this');
    await waitFor(() =>
      expect(recorded.updates).toEqual([
        { id: 'b-1', changes: { type: 'callout', text: '' } },
        { id: 'b-1', changes: { text: 'Remember this' } },
      ]),
    );
  });

  it('is usable by mouse: clicking an entry converts the block', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/');
    const todo = screen
      .getAllByTestId('slash-menu-item')
      .find((item) => item.getAttribute('data-block-type') === 'todo');
    await user.click(todo as HTMLElement);

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { type: 'todo', text: '' } }]);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('closes on Escape, leaving the typed slash as ordinary text', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/code{Escape}');

    expect(screen.queryByTestId('slash-menu')).toBeNull();
    expect(editorFor('b-1')).toHaveValue('/code');
    // Escape is not a conversion; the only write is the text the user is left with.
    expect(recorded.updates).toEqual([]);
    await user.tab();
    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: '/code' } }]);
  });

  it('never opens inside a code block, where "/" is content', async () => {
    const user = userEvent.setup();
    renderEditor([makeBlock({ id: 'b-1', pageId: 'p-1', type: 'code', sortKey: 'a0', text: '' })]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/');

    expect(screen.queryByTestId('slash-menu')).toBeNull();
    expect(editorFor('b-1')).toHaveValue('/');
  });
});

describe('typing across a block boundary (DEF-011)', () => {
  it('moves the caret to the new block inside the Enter keystroke itself', () => {
    const recorded = renderEditor([paragraph]);
    const first = editorFor('b-1');
    act(() => {
      first.focus();
      first.setSelectionRange(first.value.length, first.value.length);
    });

    // No await, no waitFor and no timer: by the time the keydown has been handled the caret must
    // already be in the new block. Anything asynchronous here - awaiting the op, or a passive
    // effect - is a window in which the next character lands in the block the user just left.
    fireEvent.keyDown(first, { key: 'Enter' });

    expect(recorded.created).toEqual([{ type: 'paragraph', afterBlockId: 'b-1' }]);
    expect(document.activeElement).toBe(editorFor('b-new-1'));
  });

  it('keeps each line whole when typed at a human pace of 100ms per keystroke', async () => {
    // The default synthetic typing is far faster than a person and never hit the race that lost the
    // first character of every line, so this test types at the speed the defect was found at.
    const user = userEvent.setup({ delay: 100 });
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('Alpha{Enter}Beta');

    expect(editorFor('b-1')).toHaveValue('Alpha');
    expect(editorFor('b-new-1')).toHaveValue('Beta');
    // And the writes match the screen: no character crossed the boundary on the way to the server.
    await waitFor(() =>
      expect(recorded.updates).toEqual([
        { id: 'b-1', changes: { text: 'Alpha' } },
        { id: 'b-new-1', changes: { text: 'Beta' } },
      ]),
    );
  }, 15000);
});

describe('text typed while the slash menu is open (DEF-012)', () => {
  it('is autosaved like any other text, so clicking away keeps it', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/my important note');
    // The menu is still open, because the text still begins with a slash.
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();

    // Blurring is the case that used to lose it: the keystrokes never marked the block dirty, so the
    // flush had nothing to write while the text stayed on screen.
    await user.tab();

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: '/my important note' } }]);
    expect(editorFor('b-1')).toHaveValue('/my important note');
  });

  it('is written even if the debounce has not settled when the page goes away (DEF-013)', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.type(editorFor('b-1'), 'LOSTTEXT');
    // Inside the 500ms window there is nothing written yet; a reload here used to drop the edit.
    expect(recorded.updates).toEqual([]);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: 'First blockLOSTTEXT' } }]);
  });

  it('is written when the tab is backgrounded, which is all the warning a phone gives (DEF-013)', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.type(editorFor('b-1'), '!');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: 'First block!' } }]);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});

describe('Enter with a slash query that matches nothing (DEF-018)', () => {
  it('closes the menu and leaves the text alone rather than swallowing the key', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    await user.click(editorFor('b-1'));
    await user.keyboard('/nomatch');
    expect(screen.getByTestId('slash-menu')).toHaveTextContent('No block type matches that.');

    await user.keyboard('{Enter}');

    expect(screen.queryByTestId('slash-menu')).toBeNull();
    expect(editorFor('b-1')).toHaveValue('/nomatch');
    // Enter here is a dismissal, not an insertion, and it converts nothing.
    expect(recorded.created).toEqual([]);
    await waitFor(() =>
      expect(recorded.updates).toEqual([{ id: 'b-1', changes: { text: '/nomatch' } }]),
    );
  });
});

describe('a paste longer than the block limit (DEF-014, DEF-015)', () => {
  it('cuts on a whole character and says that the end was dropped', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([
      makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: '' }),
    ]);

    // 9999 plain characters, then an emoji whose two UTF-16 units straddle the 10000th.
    const pasted = `${'a'.repeat(9999)}\u{1F600} and more text after it`;
    await user.click(editorFor('b-1'));
    await user.paste(pasted);

    const stored = editorFor('b-1').value;
    // Cut before the emoji rather than through it: no lone surrogate, and inside the server's limit.
    expect(stored).toBe('a'.repeat(9999));
    expect(stored.length).toBeLessThanOrEqual(10000);
    expect(stored).not.toContain('�');
    expect(recorded.notices).toHaveLength(1);
    expect(recorded.notices[0]).toContain('10,000 characters');
  });
});

describe('the empty page', () => {
  it('offers a first block and focuses it once created', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([]);

    await user.click(screen.getByRole('button', { name: /This page is empty/ }));

    expect(recorded.created).toEqual([{ type: 'paragraph', afterBlockId: null }]);
    await waitFor(() => expect(document.activeElement).toBe(editorFor('b-new-1')));
  });

  it('appends a block when the space under the last one is clicked', async () => {
    const user = userEvent.setup();
    const recorded = renderEditor([paragraph]);

    await user.click(screen.getByRole('button', { name: 'Add a block at the end of the page' }));

    expect(recorded.created).toEqual([{ type: 'paragraph', afterBlockId: 'b-1' }]);
  });
});

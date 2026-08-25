import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlashMenu } from './SlashMenu';
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  DEFAULT_CALLOUT_EMOJI,
  DEFAULT_CODE_LANGUAGE,
  MAX_BLOCK_TEXT_LENGTH,
  blockTypeLabel,
  clampBlockText,
  filterBlockTypes,
  parseBlockProps,
} from '../lib/blocks';
import { useAutosavedText } from '../hooks/useAutosavedText';
import type { BlockRecord, BlockType } from '../api/types';
import type { BlockTypeOption } from '../lib/blocks';
import { DropdownMenu, DropdownMenuItem } from './ui/DropdownMenu/DropdownMenu';
import styles from './BlockRow.module.css';

export interface BlockRowProps {
  block: BlockRecord;
  /** Its position in the unbroken run of numbered items, so an interrupted list restarts at 1. */
  listNumber: number;
  onChangeText: (text: string) => void;
  /** Applies a slash-menu choice: the new type, and an empty text, since the query was a command. */
  onConvertType: (type: BlockType) => void;
  onToggleChecked: (checked: boolean) => void;
  /**
   * Enter: creates a new block of the given type below this block, which the editor then focuses.
   * The type is the current block's type when inside a list (so a bulleted run continues as
   * bulleted), and undefined for all other types, which the editor defaults to paragraph.
   */
  onEnter: (type?: BlockType) => void;
  /** Backspace at the start of an empty block: delete it and put the caret in the block above. */
  onDeleteEmpty: () => void;
  onDelete: () => void;
  /** Hands the textarea to the editor, which owns focus moves between blocks. */
  registerEditor: (blockId: string, element: HTMLTextAreaElement | null) => void;
  /** Says something to the user - used when a paste is clamped to the block text limit. */
  onNotice: (message: string) => void;
  /**
   * True when the previous block is the same list type (bulletedList/numberedList/todo), so
   * consecutive items in a run render with tighter spacing than blocks of different types.
   */
  continuesList: boolean;
  /**
   * Only used when block.type === 'toggleList'. Whether the toggle is currently open.
   * Absent (or undefined) means open — the default on first render.
   */
  isToggleOpen?: boolean;
  /** Only used when block.type === 'toggleList'. Called when the arrow is clicked. */
  onToggleOpenChange?: (open: boolean) => void;
  /**
   * Called instead of onEnter when Enter is pressed in a toggleList header block.
   * BlockEditor creates the first child inside the toggle and opens it if collapsed.
   */
  onEnterToggleHeader?: () => void;
  /**
   * Called instead of onEnter when Enter is pressed in a toggle child paragraph.
   * isEmpty=true signals that the last child is empty, which exits the toggle.
   */
  onEnterToggleChild?: (isEmpty: boolean) => void;
}

/** What an empty block of each type invites the user to do. */
function placeholderFor(type: BlockType): string {
  if (type === 'paragraph') return "Type '/' for commands";
  if (type === 'code') return 'Code';
  return `${blockTypeLabel(type)}...`;
}

/**
 * Base textarea classes shared by every block type. The textarea is one element regardless of
 * type so the caret, Enter and Backspace behave identically everywhere.
 */
const TEXTAREA_BASE =
  'block w-full border-0 bg-transparent text-text py-0.5 m-0 font-sans text-base leading-relaxed resize-none overflow-hidden focus:outline-none placeholder:text-text-muted/75';

/**
 * Additional textarea classes per block type. These are static strings resolved by lookup rather
 * than by string interpolation, so Tailwind can see every class at scan time. Divider has no
 * textarea and is included only to satisfy the complete Record type.
 */
const textareaTypeClasses: Record<BlockType, string> = {
  paragraph: '',
  heading1: 'text-3xl font-[750] leading-tight tracking-tight',
  heading2: 'text-2xl font-bold leading-snug tracking-tight',
  heading3: 'text-lg font-bold leading-snug',
  bulletedList: '',
  numberedList: '',
  todo: '',
  quote: 'italic',
  // font-mono, whitespace-pre and text-code-text are code-specific; they cannot be on the base.
  // Horizontal scroll is handled by styles.codeTextarea (CSS Module) rather than a utility: the
  // overflow-hidden shorthand from TEXTAREA_BASE and overflow-x-auto have equal CSS specificity so
  // the build-time order is non-deterministic; the module rule is loaded last and always wins.
  code: 'font-mono text-sm leading-relaxed text-code-text whitespace-pre',
  callout: '',
  divider: '',
  // toggleList textarea shares paragraph styling; visual distinction comes from the arrow button.
  toggleList: '',
};

/**
 * Extra padding-top for the block body on heading types, where the design adds visual breathing
 * room above the heading level. Resolved by lookup so Tailwind scans all classes statically.
 */
const bodyTopPaddingClasses: Partial<Record<BlockType, string>> = {
  heading1: 'pt-4.5',
  heading2: 'pt-3.5',
  heading3: 'pt-3.5',
};

/**
 * Top-offset class for the drag handle button per block type. The button is absolutely positioned
 * inside a zero-height gutter cell, so it does not contribute to the row height. The offset
 * centres the handle on the first text line of each block type.
 *
 * Values are derived from getBoundingClientRect() measurements in a real browser at 1280x800:
 *   paragraph/bulletedList/numberedList/todo/quote: delta +7px → -top-1.5 (-6px) → delta ~+1px
 *   callout: delta -6px (language header above textarea) → top-1.5 (+6px) → delta ~0px
 *   code: delta -22.4px (language label shifts textarea down) → top-5.5 (+22px) → delta ~-0.4px
 *   headings: delta +1–2px already, kept as-is (positive offsets follow bodyTopPaddingClasses)
 * All class strings are static so the Tailwind scanner generates every one.
 */
const handleTopClasses: Partial<Record<BlockType, string>> = {
  heading1: 'top-4',
  heading2: 'top-2.5',
  heading3: 'top-1.5',
  // Non-heading types: handle sits 7px below the first-line centre at top-0; raise it 6px.
  paragraph: '-top-1.5',
  bulletedList: '-top-1.5',
  numberedList: '-top-1.5',
  todo: '-top-1.5',
  quote: '-top-1.5',
  // Callout: emoji + border box raises the first text line; handle must move down 6px to match.
  callout: 'top-1.5',
  // Code: language-label header (~22px tall) sits above the textarea first line; push down 22px.
  code: 'top-5.5',
  // toggleList: header uses paragraph textarea styling, so the same offset applies.
  toggleList: '-top-1.5',
};

/**
 * One block: its drag handle and delete action in the gutter, and its type-specific body. Every
 * textual type edits through one textarea so the caret, Enter and Backspace behave identically
 * everywhere, and the type only decides the wrapper element and the styling.
 */
export function BlockRow({
  block,
  listNumber,
  onChangeText,
  onConvertType,
  onToggleChecked,
  onEnter,
  onDeleteEmpty,
  onDelete,
  registerEditor,
  onNotice,
  continuesList,
  isToggleOpen,
  onToggleOpenChange,
  onEnterToggleHeader,
  onEnterToggleChild,
}: BlockRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set when the slash menu converted this block, so the caret returns to it after the remount.
  const refocusAfterConvert = useRef(false);
  // null means closed; a string is the text typed after the "/".
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Tracks the per-block actions dropdown: forced closed while dragging so a press-then-drag does
  // not leave the menu open once the drag activates (the pointer sensor requires 4px movement).
  const [menuOpen, setMenuOpen] = useState(false);
  const { value, edit, reset, flush } = useAutosavedText(block.text, onChangeText);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const options = slashQuery === null ? [] : filterBlockTypes(slashQuery);
  const props = parseBlockProps(block.props);

  // The textarea grows with its content: a fixed height would either clip a long paragraph or leave
  // a tall empty box on every one-line block.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || !element.scrollHeight) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value, block.type]);

  const attachEditor = (element: HTMLTextAreaElement | null) => {
    textareaRef.current = element;
    registerEditor(block.id, element);
  };

  const closeSlashMenu = () => {
    setSlashQuery(null);
    setHighlightedIndex(0);
  };

  const pick = (option: BlockTypeOption) => {
    closeSlashMenu();
    // The query text is autosaved as it is typed, so it may already be on the server; `reset` drops
    // the local text and cancels the pending debounce, and the conversion op clears the stored text.
    reset('');
    // Focusing here would be lost: the new type wraps the textarea in a different element, so React
    // remounts it. The effect below puts the caret back once the converted block has rendered.
    refocusAfterConvert.current = true;
    onConvertType(option.type);
  };

  useEffect(() => {
    if (!refocusAfterConvert.current) return;
    refocusAfterConvert.current = false;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [block.type]);

  const handleChange = (next: string) => {
    const { text: clamped, truncated } = clampBlockText(next);
    // Clamping is defensible; clamping silently is not — the user must know their text was cut.
    // This fires for both paste and keyboard input, so the message avoids saying "pasted" (DEF-021).
    if (truncated) {
      onNotice(
        `A block holds at most ${MAX_BLOCK_TEXT_LENGTH.toLocaleString('en-GB')} characters, so some of the text was not kept. Split it across several blocks to keep all of it.`,
      );
    }
    if (slashQuery !== null) {
      // Still a command as long as it starts with the slash; deleting the slash makes it text again.
      if (clamped.startsWith('/')) {
        setSlashQuery(clamped.slice(1));
        setHighlightedIndex(0);
        // Autosaved like any other text: the menu may never be used, and text the user can see must
        // never be text the server has not got. A conversion clears it again in one op.
        edit(clamped);
        return;
      }
      closeSlashMenu();
      edit(clamped);
      return;
    }
    // A slash only opens the menu at the start of an empty block, and never inside code, where "/"
    // is ordinary content.
    if (clamped === '/' && value === '' && block.type !== 'code') {
      setSlashQuery('');
      setHighlightedIndex(0);
      edit(clamped);
      return;
    }
    edit(clamped);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashQuery !== null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (options.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : options.length - 1;
        setHighlightedIndex((current) => (current + step) % options.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const option = options[highlightedIndex];
        if (option) {
          pick(option);
          return;
        }
        // Nothing matches the query, so there is nothing to convert to. Enter dismisses the menu and
        // leaves the text as content rather than being swallowed until the user finds Escape.
        closeSlashMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // The user wants a literal slash, so the menu closes and the text becomes content.
        closeSlashMenu();
        edit(value);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      // Inside code a newline is the point of the block, so Enter is left to the textarea.
      if (block.type === 'code') return;
      event.preventDefault();

      // Toggle header Enter: open the toggle (if collapsed) and create the first child inside it.
      if (block.type === 'toggleList') {
        flush();
        onEnterToggleHeader?.();
        return;
      }

      // Toggle child Enter: create a sibling child, or exit the toggle if this is the last empty child.
      const parentToggleId = parseBlockProps(block.props).parentToggleId;
      if (parentToggleId) {
        flush();
        onEnterToggleChild?.(value === '');
        return;
      }

      const isList =
        block.type === 'bulletedList' || block.type === 'numberedList' || block.type === 'todo';
      if (isList && value === '') {
        // Empty list item: exit the list by converting the block to a paragraph and leaving the
        // caret in it. The same refocusAfterConvert mechanism used by slash-menu conversions
        // restores focus once the element remounts under the new block type.
        refocusAfterConvert.current = true;
        onConvertType('paragraph');
        return;
      }
      flush();
      // A non-empty list item continues its own type; every other block type creates a paragraph.
      onEnter(isList ? block.type : undefined);
      return;
    }

    if (event.key === 'Backspace') {
      const element = event.currentTarget;
      const atStart = element.selectionStart === 0 && element.selectionEnd === 0;
      // Only an empty block is removed by Backspace; merging text into the block above is not in
      // this phase, so a non-empty block does nothing destructive here.
      if (atStart && value === '') {
        event.preventDefault();
        onDeleteEmpty();
      }
    }
  };

  const editor = (
    <textarea
      ref={attachEditor}
      className={cn(
        TEXTAREA_BASE,
        textareaTypeClasses[block.type],
        // CSS Module rule that guarantees overflow-x: auto wins for code blocks (see module file).
        block.type === 'code' && styles.codeTextarea,
        block.type === 'todo' && block.checked && 'text-text-muted line-through',
      )}
      value={value}
      rows={1}
      spellCheck
      aria-label={`${blockTypeLabel(block.type)} block`}
      aria-controls={slashQuery === null ? undefined : 'slash-menu'}
      aria-activedescendant={
        slashQuery === null ? undefined : `slash-option-${options[highlightedIndex]?.type ?? ''}`
      }
      placeholder={placeholderFor(block.type)}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        closeSlashMenu();
        flush();
      }}
    />
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // `group` enables group-hover: on the gutter so handles appear when any part of the block is hovered.
        // The gutter column is 48px — just wide enough for one 48px touch target per row.
        // mt-3 is the base inter-block gap (12px); mt-0 keeps consecutive same-list items flush,
        // giving a clear 3:1 visual ratio between "new block" and "list continuation" spacing.
        'group relative grid grid-cols-[48px_minmax(0,1fr)] items-start',
        continuesList ? 'mt-0' : 'mt-3',
        isDragging && 'z-10 rounded-sm border border-border bg-surface shadow-pop',
      )}
      data-block-id={block.id}
      data-block-type={block.type}
      // data-dragging is the stable hook for e2e drag tests; styling classes are not a contract.
      data-dragging={isDragging ? 'true' : 'false'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/*
        Gutter: one 48×48px drag handle that also opens a small actions menu on click or ArrowDown.
        The gutter cell has height 0 (h-0) so the body column alone determines the row height;
        the button is absolutely positioned within it and does not push rows taller than their
        text. handleTopClasses shifts the button down per block type so it centres on the first
        text line rather than the row top.
        Drag (pointer: 4px movement; keyboard: Space/Enter) and menu (pointer: click; keyboard:
        ArrowDown) do not conflict — dnd-kit calls event.preventDefault() on Space/Enter keydown,
        which prevents Radix's onKeyDown handler from firing on those keys, so ArrowDown is the
        dedicated keyboard path to the menu. The menu is forced closed when isDragging becomes true
        so a press-then-drag does not leave it open. On hover:none devices the gutter is always
        visible; on pointer devices it appears on group-hover or when focus is inside the row.

        For toggleList the gutter holds TWO buttons: the always-visible collapse/expand arrow and
        the hover-visible drag handle that overlays it. The drag handle wrapper uses
        pointer-events-none when invisible so the arrow below it can still receive clicks; on
        hover/focus-within both pointer-events and opacity are restored. The always-on-touch rule
        is omitted from the toggle's drag handle so the arrow remains tappable on phones.
        Future: add a touch-friendly drag affordance for toggle blocks (e.g. long-press activation).
      */}
      {block.type === 'toggleList' ? (
        /*
         * Toggle gutter: one button that is both the collapse/expand arrow and the drag activator.
         * A plain click (pointer up with <4px movement) fires onClick → toggles open/closed.
         * Pressing and moving ≥4px activates dnd-kit's pointer sensor and reorders the block.
         *
         * There is no DropdownMenu here. Putting the arrow inside a DropdownMenu trigger makes
         * Radix aria-hide the rest of the DOM when the menu opens, which breaks getByRole queries
         * in tests and the user's ability to type in the header immediately after collapsing. Toggle
         * blocks are deleted by pressing Backspace on an empty header, the same as every other block.
         * Future: add a hover-only ⋮ button in the body column's right margin for a delete action
         * that does not conflict with the primary arrow/drag affordance.
         */
        <div className="relative h-0 overflow-visible">
          <button
            type="button"
            // h-12 w-12 satisfies the 48px touch target requirement.
            // setActivatorNodeRef + listeners make this the dnd-kit drag activator for this block.
            // activationConstraint: { distance: 4 } on the sensor means click and drag do not
            // interfere: a small pointer motion triggers drag, a stationary press triggers onClick.
            ref={setActivatorNodeRef}
            className={cn(
              'absolute left-0 grid h-12 w-12 cursor-grab place-items-center border-0 bg-transparent p-0 text-text-muted hover:text-text',
              handleTopClasses['toggleList'],
            )}
            data-testid="block-toggle-arrow"
            aria-expanded={isToggleOpen ?? true}
            aria-controls={`toggle-children-${block.id}`}
            aria-label={(isToggleOpen ?? true) ? 'Collapse toggle' : 'Expand toggle'}
            onClick={() => onToggleOpenChange?.(!(isToggleOpen ?? true))}
            {...attributes}
            {...listeners}
          >
            {(isToggleOpen ?? true) ? (
              <ChevronDown size={16} aria-hidden />
            ) : (
              <ChevronRight size={16} aria-hidden />
            )}
          </button>
        </div>
      ) : (
        <div
          className={cn(
            // h-0: this grid cell contributes zero height, so row height comes from the body only.
            // relative: establishes the containing block for the absolutely positioned button.
            // overflow-visible: lets the 48px button extend beyond the h-0 boundary.
            'relative h-0 overflow-visible',
            'opacity-0 transition-opacity duration-100 ease-in-out',
            'group-focus-within:opacity-100 group-hover:opacity-100',
            // Without pointer-hover there is no way to reveal gutter controls, so always show them.
            '[@media(hover:none)]:opacity-100',
          )}
        >
          <DropdownMenu
            open={menuOpen && !isDragging}
            onOpenChange={(next) => {
              // Ignore open requests while dragging: the pointer sensor needs 4px before it
              // activates, and a fast tap can set open=true before isDragging becomes true.
              if (!isDragging) setMenuOpen(next);
            }}
            align="start"
            trigger={
              <button
                type="button"
                ref={setActivatorNodeRef}
                className={cn(
                  // absolute + left-0: places the button flush with the gutter column's left edge.
                  // The top class shifts it down so its centre aligns with the block's first text line.
                  'absolute left-0 grid h-12 w-12 cursor-grab place-items-center rounded-sm border-0 bg-transparent p-0 text-text-muted hover:bg-surface hover:text-text hover:ring-1 hover:ring-border hover:ring-inset',
                  handleTopClasses[block.type] ?? 'top-0',
                )}
                data-testid="block-drag-handle"
                aria-label={`Move the ${blockTypeLabel(block.type).toLowerCase()} block`}
                {...attributes}
                {...listeners}
              >
                <GripVertical size={16} aria-hidden />
              </button>
            }
          >
            <DropdownMenuItem
              variant="danger"
              data-testid="block-delete"
              aria-label={`Delete the ${blockTypeLabel(block.type).toLowerCase()} block`}
              onSelect={onDelete}
            >
              <Trash2 size={14} aria-hidden />
              Delete block
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      )}

      {/* Body: the type-specific wrapper around the shared textarea (or hr for divider). */}
      <div className={cn('min-w-0 py-0.5', bodyTopPaddingClasses[block.type])}>
        {block.type === 'divider' ? (
          <hr className="my-3 h-px border-0 bg-border" aria-label="Divider block" />
        ) : block.type === 'heading1' ? (
          // m-0 and tracking-tight match the original heading wrapper styles; the textarea itself
          // also sets tracking-tight, overriding inheritance for fine-grained control.
          <h1 className="m-0 tracking-tight">{editor}</h1>
        ) : block.type === 'heading2' ? (
          <h2 className="m-0 tracking-tight">{editor}</h2>
        ) : block.type === 'heading3' ? (
          <h3 className="m-0 tracking-tight">{editor}</h3>
        ) : block.type === 'bulletedList' ? (
          // list-disc restores the marker that Tailwind preflight removes from all ul/ol/menu elements.
          <ul className="m-0 list-disc pl-5.5">
            <li className={styles.bulletedMarker}>{editor}</li>
          </ul>
        ) : block.type === 'numberedList' ? (
          // A one-item <ol start> per block: the browser draws the marker, and `start` is what makes
          // a run number 1, 2, 3 while a run broken by a paragraph starts again at 1.
          // list-decimal restores the marker that Tailwind preflight removes.
          <ol className="m-0 list-decimal pl-5.5" start={listNumber}>
            <li className={styles.numberedMarker}>{editor}</li>
          </ol>
        ) : block.type === 'todo' ? (
          // data-done is used by the unit test to check the done state without a class dependency.
          <div
            className="flex items-start gap-2.5"
            data-testid="block-todo"
            data-done={block.checked ? 'true' : 'false'}
          >
            <input
              type="checkbox"
              className="mt-2 size-4 flex-none cursor-pointer accent-blue"
              checked={block.checked}
              // The accessible name is the to-do's own text, which is what a screen reader and a
              // test both need to tell two checkboxes apart.
              aria-label={value || 'Empty to-do'}
              onChange={(event) => onToggleChecked(event.target.checked)}
            />
            {editor}
          </div>
        ) : block.type === 'quote' ? (
          // border-l-4 snaps from the original 3px; pl-4 snaps from 15px — both within one scale step.
          <blockquote className="m-0 border-l-4 border-purple pl-4">{editor}</blockquote>
        ) : block.type === 'code' ? (
          <div className="rounded-md border border-code-border bg-code-surface px-3.5 pt-2.5 pb-3">
            {/* data-testid used by unit tests to verify the language label without a class selector */}
            <span
              className="mb-1 block font-mono text-xs font-bold tracking-[0.1em] text-text-muted uppercase"
              data-testid="block-code-lang"
            >
              {props.language ?? DEFAULT_CODE_LANGUAGE}
            </span>
            {editor}
          </div>
        ) : block.type === 'callout' ? (
          <aside className="flex items-start gap-3 rounded-md border border-callout-border bg-callout-surface px-3.5 py-3">
            {/* data-testid used by unit tests to verify the emoji without a class selector */}
            <span
              className="flex-none font-emoji text-base leading-normal"
              aria-hidden="true"
              data-testid="block-callout-emoji"
            >
              {props.emoji ?? DEFAULT_CALLOUT_EMOJI}
            </span>
            {editor}
          </aside>
        ) : block.type === 'toggleList' ? (
          /*
           * Toggle header: the arrow button lives in the gutter (above), aligned with the block's
           * first text line, so the editor textarea starts at the same left edge as every other
           * block type. This wrapper carries the testid used by tests and e2e to find the header's
           * textarea.
           * Future: to support nested toggles, BlockEditor's grouping logic would need to recurse
           * into toggleList children and this render would pass isToggleOpen/onToggleOpenChange
           * to child BlockRows whose block.type is also toggleList.
           */
          <div data-testid="block-toggle-header">{editor}</div>
        ) : (
          editor
        )}
      </div>

      {slashQuery === null ? null : (
        <SlashMenu
          options={options}
          highlightedIndex={highlightedIndex}
          query={slashQuery}
          onPick={pick}
          onHighlight={setHighlightedIndex}
        />
      )}
    </div>
  );
}

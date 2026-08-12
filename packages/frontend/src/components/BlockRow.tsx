import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlashMenu } from './SlashMenu';
import { GripVertical, Trash2 } from 'lucide-react';
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
import styles from './BlockRow.module.css';

export interface BlockRowProps {
  block: BlockRecord;
  /** Its position in the unbroken run of numbered items, so an interrupted list restarts at 1. */
  listNumber: number;
  onChangeText: (text: string) => void;
  /** Applies a slash-menu choice: the new type, and an empty text, since the query was a command. */
  onConvertType: (type: BlockType) => void;
  onToggleChecked: (checked: boolean) => void;
  /** Enter: a new paragraph below this block, which the editor then focuses. */
  onEnter: () => void;
  /** Backspace at the start of an empty block: delete it and put the caret in the block above. */
  onDeleteEmpty: () => void;
  onDelete: () => void;
  /** Hands the textarea to the editor, which owns focus moves between blocks. */
  registerEditor: (blockId: string, element: HTMLTextAreaElement | null) => void;
  /** Says something to the user - used when a paste is clamped to the block text limit. */
  onNotice: (message: string) => void;
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
  code: 'font-mono text-sm leading-relaxed text-code-text whitespace-pre',
  callout: '',
  divider: '',
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
}: BlockRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set when the slash menu converted this block, so the caret returns to it after the remount.
  const refocusAfterConvert = useRef(false);
  // null means closed; a string is the text typed after the "/".
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
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
    // Clamping is defensible; clamping silently is not, so a dropped paste is said out loud.
    if (truncated) {
      onNotice(
        `A block holds at most ${MAX_BLOCK_TEXT_LENGTH.toLocaleString('en-GB')} characters, so the end of what you pasted was not kept. Split it across several blocks to keep all of it.`,
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
      flush();
      onEnter();
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
        'group relative grid grid-cols-[46px_minmax(0,1fr)] items-start',
        isDragging && 'z-10 rounded-sm border border-border bg-surface shadow-pop',
      )}
      data-block-id={block.id}
      data-block-type={block.type}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/*
        Gutter: drag handle + delete action, hidden until the block is hovered or focused.
        On touch devices (hover: none) the gutter is always visible since there is no hover.
      */}
      <div
        className={cn(
          'flex justify-end gap-0.5 pt-1 pr-2',
          'opacity-0 transition-opacity duration-100 ease-in-out',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          // Without pointer-hover there is no way to reveal gutter controls, so always show them.
          '[@media(hover:none)]:opacity-100',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="grid h-6 w-5.5 flex-none cursor-grab place-items-center rounded-sm border-0 bg-transparent p-0 text-text-muted hover:bg-surface hover:text-text hover:ring-1 hover:ring-border hover:ring-inset"
          data-testid="block-drag-handle"
          aria-label={`Move the ${blockTypeLabel(block.type).toLowerCase()} block`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="grid h-6 w-5.5 flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-text-muted hover:bg-danger/14 hover:text-danger"
          data-testid="block-delete"
          aria-label={`Delete the ${blockTypeLabel(block.type).toLowerCase()} block`}
          onClick={onDelete}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

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

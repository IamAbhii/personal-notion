import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SlashMenu } from './SlashMenu';
import { DragHandleIcon, TrashIcon } from './icons';
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
      className={`block__text block__text--${block.type}`}
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
      className={`block block--${block.type}${isDragging ? ' block--dragging' : ''}`}
      data-block-id={block.id}
      data-block-type={block.type}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="block__gutter">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="block__handle"
          data-testid="block-drag-handle"
          aria-label={`Move the ${blockTypeLabel(block.type).toLowerCase()} block`}
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
        <button
          type="button"
          className="block__remove"
          data-testid="block-delete"
          aria-label={`Delete the ${blockTypeLabel(block.type).toLowerCase()} block`}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="block__body">
        {block.type === 'divider' ? (
          <hr className="block__divider" aria-label="Divider block" />
        ) : block.type === 'heading1' ? (
          <h1 className="block__heading block__heading--1">{editor}</h1>
        ) : block.type === 'heading2' ? (
          <h2 className="block__heading block__heading--2">{editor}</h2>
        ) : block.type === 'heading3' ? (
          <h3 className="block__heading block__heading--3">{editor}</h3>
        ) : block.type === 'bulletedList' ? (
          <ul className="block__list block__list--bulleted">
            <li className="block__list-item">{editor}</li>
          </ul>
        ) : block.type === 'numberedList' ? (
          // A one-item <ol start> per block: the browser draws the marker, and `start` is what makes
          // a run number 1, 2, 3 while a run broken by a paragraph starts again at 1.
          <ol className="block__list block__list--numbered" start={listNumber}>
            <li className="block__list-item">{editor}</li>
          </ol>
        ) : block.type === 'todo' ? (
          <div className={`block__todo${block.checked ? ' block__todo--done' : ''}`}>
            <input
              type="checkbox"
              className="block__checkbox"
              checked={block.checked}
              // The accessible name is the to-do's own text, which is what a screen reader and a
              // test both need to tell two checkboxes apart.
              aria-label={value || 'Empty to-do'}
              onChange={(event) => onToggleChecked(event.target.checked)}
            />
            {editor}
          </div>
        ) : block.type === 'quote' ? (
          <blockquote className="block__quote">{editor}</blockquote>
        ) : block.type === 'code' ? (
          <div className="block__code">
            <span className="block__code-lang">{props.language ?? DEFAULT_CODE_LANGUAGE}</span>
            {editor}
          </div>
        ) : block.type === 'callout' ? (
          <aside className="block__callout">
            <span className="block__callout-emoji" aria-hidden="true">
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

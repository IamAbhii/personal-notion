import { useEffect, useRef, useState } from 'react';

/**
 * The server rejects a longer title, so the limit is enforced where the user types rather than
 * arriving as a rejection notice after the fact.
 */
export const MAX_TITLE_LENGTH = 500;

export interface InlineTitleInputProps {
  value: string;
  ariaLabel: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * An input that replaces a title in place: Enter or blur commits, Escape reverts. Shared by the
 * sidebar row and the page header so renaming behaves the same in both places.
 */
export function InlineTitleInput({
  value,
  ariaLabel,
  className,
  onCommit,
  onCancel,
}: InlineTitleInputProps) {
  const [draft, setDraft] = useState(value);
  // A blank title is refused rather than silently thrown away: the edit stays open with this hint,
  // so an accidental clear is never indistinguishable from a lost write.
  const [isRefused, setRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against blur firing a second commit after Enter or Escape has already resolved the edit.
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (fromBlur: boolean) => {
    if (settled.current) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      // On blur there is nowhere to show the hint, so the edit closes and the old title reappears.
      if (fromBlur) {
        settled.current = true;
        onCancel();
        return;
      }
      setRefused(true);
      setDraft(value);
      inputRef.current?.select();
      return;
    }
    settled.current = true;
    if (trimmed !== value) onCommit(trimmed);
    else onCancel();
  };

  return (
    <span className="inline-edit">
      <input
        ref={inputRef}
        className={className}
        aria-label={ariaLabel}
        aria-invalid={isRefused || undefined}
        maxLength={MAX_TITLE_LENGTH}
        value={draft}
        onChange={(event) => {
          setRefused(false);
          setDraft(event.target.value);
        }}
        onBlur={() => commit(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(false);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            settled.current = true;
            onCancel();
          }
        }}
        autoFocus
      />
      {isRefused ? (
        <span className="inline-edit__hint" role="alert">
          A page needs a name, so the old one was kept.
        </span>
      ) : null}
    </span>
  );
}

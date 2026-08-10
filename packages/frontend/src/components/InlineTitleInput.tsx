import { useEffect, useRef, useState } from 'react';

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
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against blur firing a second commit after Enter or Escape has already resolved the edit.
  const settled = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
      autoFocus
    />
  );
}

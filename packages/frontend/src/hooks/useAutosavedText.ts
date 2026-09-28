import { useCallback, useEffect, useRef, useState } from 'react';

/** The debounced text editing state of one block, plus the two ways to leave it. */
export interface AutosavedText {
  value: string;
  /** A keystroke: updates the value and schedules one save for when typing settles. */
  edit: (next: string) => void;
  /** Sets the value with no save scheduled - used while the slash menu owns the text. */
  reset: (next: string) => void;
  /** Saves now and cancels the pending debounce. Called on blur, and on unmount. */
  flush: () => void;
}

/**
 * Autosave for one editable value. There is no save button anywhere in the app, so a settled edit
 * is written once after `delayMs` rather than once per keystroke, and any pending write is flushed
 * on blur and on unmount - which is what makes navigating away mid-sentence safe.
 */
export function useAutosavedText(
  text: string,
  save: (next: string) => void,
  delayMs = 500,
): AutosavedText {
  const [value, setValue] = useState(text);
  const valueRef = useRef(text);
  // Whether there is a local edit the server has not been told about yet.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  // The caller passes a fresh closure every render; the ref keeps `flush` stable so it can be an
  // unmount cleanup without re-running the effect on every render.
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const cancel = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    cancel();
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    saveRef.current(valueRef.current);
  }, []);

  // Adopt the server's text when it changes underneath, but never over an unsaved local edit: a
  // snapshot refetch mid-typing would otherwise rewind the field to the last saved text.
  useEffect(() => {
    if (dirtyRef.current) return;
    valueRef.current = text;
    setValue(text);
  }, [text]);

  // Navigating away unmounts the editor, so the pending debounce is written here rather than lost.
  useEffect(() => flush, [flush]);

  // Leaving the page does not unmount anything, so a reload, a closed tab or a backgrounded app
  // inside the debounce window would drop the edit. `pagehide` covers reload, navigation and the
  // back/forward cache; `visibilitychange` covers mobile, where an app switch is often all the
  // warning there is. The debounce itself stays as designed - this closes its window rather than
  // shortening it. The write rides on fetch keepalive so it survives the document going away.
  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
    };
  }, [flush]);

  const edit = useCallback(
    (next: string) => {
      valueRef.current = next;
      setValue(next);
      dirtyRef.current = true;
      cancel();
      timerRef.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  const reset = useCallback((next: string) => {
    cancel();
    dirtyRef.current = false;
    valueRef.current = next;
    setValue(next);
  }, []);

  return { value, edit, reset, flush };
}

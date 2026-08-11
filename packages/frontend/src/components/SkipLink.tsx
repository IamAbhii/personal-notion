export interface SkipLinkProps {
  /** The id of the element focus jumps to. It must be focusable, so `tabIndex={-1}` at minimum. */
  targetId: string;
  children: string;
}

/**
 * The first focusable thing in the app: a link that jumps focus past the sidebar to the page body.
 * The sidebar's page tree is five controls per row, so a keyboard user otherwise walks the whole
 * workspace - over a hundred Tab presses on the seeded tree - before reaching the editor. Hidden
 * off screen until focused, so it costs a pointer user nothing.
 */
export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a
      className="skip-link"
      href={`#${targetId}`}
      onClick={(event) => {
        // Focus is moved by hand rather than left to the fragment: the router owns the URL, and a
        // hash left on it would outlive the jump.
        event.preventDefault();
        document.getElementById(targetId)?.focus();
      }}
    >
      {children}
    </a>
  );
}

// Small inline SVG icons. Inline rather than an icon font or sprite so they inherit currentColor
// and cost no extra request.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/** Disclosure chevron; points right when collapsed and rotates via CSS when open. */
export function ChevronIcon() {
  return (
    <svg {...base} className="icon icon--chevron">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/** Plus, for the create-page controls. */
export function PlusIcon() {
  return (
    <svg {...base} className="icon">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/** Pencil, for rename. */
export function PencilIcon() {
  return (
    <svg {...base} className="icon">
      <path d="M11.2 2.8a1.7 1.7 0 0 1 2.4 2.4L5.9 12.9l-3.2.9.9-3.2 7.6-7.8Z" />
    </svg>
  );
}

/** Six dots, the conventional drag handle for a block. */
export function DragHandleIcon() {
  return (
    <svg {...base} strokeWidth={0} fill="currentColor" className="icon">
      <circle cx="6" cy="4" r="1.3" />
      <circle cx="10" cy="4" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="10" cy="12" r="1.3" />
    </svg>
  );
}

/** Trash, for delete. */
export function TrashIcon() {
  return (
    <svg {...base} className="icon">
      <path d="M2.8 4.6h10.4M6.2 4.6V3.2h3.6v1.4M4.4 4.6l.6 8.2h6l.6-8.2M6.6 7v3.6M9.4 7v3.6" />
    </svg>
  );
}

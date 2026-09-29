# 05 — Component structure

> Read [`.claude/skills/react-standards/`](../../.claude/skills/react-standards/) before writing or
> changing any component. It is the enforced standard for composition, typing, refs, hooks and
> layout. This page maps what exists and the conventions the existing code follows.

## Folder conventions

Two shapes, both in use, and the choice is mechanical:

```
components/
  ConfirmDialog.tsx              # flat file: single file, no co-located CSS
  BlockRow.tsx
  BlockRow.module.css            # a CSS Module sits next to its component
  BlockRow.test.tsx

  Sidebar/                       # folder: when the component has siblings
    Sidebar.tsx
    Sidebar.test.tsx

  BoardView/
    BoardView.tsx
    BoardView.test.tsx
    boardKeyboard.ts             # extracted pure logic, unit-tested on its own

  ui/                            # presentational primitives
    Button/
      Button.tsx
      Button.test.tsx
```

- **A test file is co-located with what it tests**, named `*.test.tsx` / `*.test.ts`. Nearly every
  component and every `lib/` helper has one.
- **A component gets its own folder** once it has more than one file besides the test, or once it
  has extracted logic modules.
- **`screens/`** holds route-level components; **`components/`** holds everything composed inside
  them. `screens/` also uses the folder shape (`WorkspaceShell/`, `SignInScreen/`).

## The three tiers

### `components/ui/` — primitives

`Button`, `IconButton`, `Dialog`, `DropdownMenu`, `Popover`, `StatusCard`.

They know nothing about the domain: no workspace, no ops, no pages. `Dialog`, `DropdownMenu` and
`Popover` wrap Radix UI; the rest are thin native-element extensions.

`Button.tsx` is the canonical example and demonstrates four conventions at once:

```tsx
export interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  ref?: React.Ref<HTMLButtonElement>;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-amber text-text-on-amber hover:brightness-110',
  ghost: 'bg-transparent text-text-muted shadow-[inset_0_0_0_1px_var(--border)] …',
  danger: 'bg-danger text-white hover:brightness-110',
};

export function Button({ variant = 'primary', className, ref, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest} // spread BEFORE className
      ref={ref}
      className={cn('inline-flex min-h-12 …', variantClasses[variant], className)}
    />
  );
}
```

1. **Extend the native element** with `ComponentPropsWithoutRef<'button'>` so every HTML attribute
   and event is available without patching the component later.
2. **A `variant` union, not boolean props.** Not `isPrimary` + `isDanger`. Composition over flags.
3. **`rest` is spread before the composed `className`**, and the incoming `className` goes _last_
   inside `cn()`, so a caller can override any default utility and nothing can accidentally
   clobber the base classes.
4. **Variant class strings are fully static.** No interpolation — Tailwind's scanner cannot find
   `bg-${color}`. See [06](./06-styling-and-theming.md).

`ref` is a plain prop here (React 19); there is no `forwardRef` in this codebase.

### `components/` — feature components

| Component                 | Role                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `Sidebar/`                | The page tree, create/rename/delete affordances, quick-find and sign-out entry |
| `BlockEditor.tsx`         | The page body: block list, keyboard handling, drag context (~490 lines)        |
| `BlockRow.tsx`            | One block, dispatching on its 13 possible types                                |
| `SlashMenu.tsx`           | Block-type picker opened by `/` in an empty block                              |
| `ImageBlock/`             | Image block rendering and paste handling                                       |
| `PageView/`               | Breadcrumb, icon + title header, and the body its caller supplies              |
| `InlineTitleInput/`       | The reusable inline-rename input                                               |
| `EmojiPickerPopover`      | Page icon picker                                                               |
| `DatabaseView/`           | The database surface: view switcher, table (~844 lines)                        |
| `BoardView/`, `ListView/` | The other two view kinds                                                       |
| `CellEditor/`             | Per-property-type cell editing                                                 |
| `FilterSortControl/`      | View filter and sort configuration                                             |
| `RowPage/`                | A database row opened as a page                                                |
| `ViewSwitcher/`           | Table / board / list toggle                                                    |
| `QuickFind/`              | Cmd+K search dialog                                                            |
| `ThemeToggle/`            | Light/dark switch                                                              |
| `ConfirmDialog.tsx`       | Shared destructive-action confirmation                                         |
| `SkipLink.tsx`            | Accessibility skip-to-content link                                             |

### `screens/` — route level

`WorkspaceShell` (the provider and layout), `PageScreen` (dispatches on page `kind`),
`WorkspaceHome`, `SignInScreen`, `StatusScreens` (`AppLoading`, `AppError`, `NoWorkspace`).

## Extract logic out of components

`BlockEditor.tsx` and `DatabaseView/DatabaseView.tsx` are the two large files, and both were kept
manageable by pushing their logic out:

| Extracted to                            | What                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lib/blocks.ts`                         | ordering, fractional keys, list numbering, props parsing, the slash-menu catalogue, text clamping |
| `lib/viewData.ts`                       | legal operators per type, filter evaluation, sorting, board grouping                              |
| `lib/ordering.ts`                       | fractional key generation for drag-and-drop                                                       |
| `lib/pageTree.ts`, `lib/treeLayout.ts`  | tree derivation and sidebar flattening with collapse state                                        |
| `lib/search.ts`                         | quick-find matching and ranking                                                                   |
| `lib/dragAnnouncements.ts`              | live-region announcement strings for dnd-kit                                                      |
| `components/BoardView/boardKeyboard.ts` | board keyboard navigation                                                                         |

**This is the pattern to follow.** When a component grows, the question is not "should I split the
component" but "what pure function is hiding in here". A pure function in `lib/` gets a direct unit
test with no rendering; the same logic inside a component needs a full render to test.

`lib/blocks.ts` also re-declares the server's limits (`MAX_BLOCK_TEXT_LENGTH = 10000`) and clamps
on **code-point boundaries** — a plain `slice()` can cut between the two UTF-16 units of an emoji
and store a lone surrogate. The client enforces the limit so that a server rejection is not how the
user finds out.

## Accessibility conventions in use

Not aspirational — these are in the code and covered by tests:

- **`SlashMenu` is a listbox with `aria-activedescendant`.** Focus stays in the textarea because
  the user keeps typing to filter, so the highlight is communicated by attribute rather than by
  moving focus. Positioning flips above the block when there is no room below the fold.
- **`QuickFind` follows the ARIA modal pattern**, and `WorkspaceShell` holds a `lastFocusRef` so
  focus returns to whatever opened it.
- **The mobile drawer is `inert` when closed**, gated on `useIsMobile()` so the desktop sidebar is
  never inerted.
- **Escape handling defers to dialogs.** The shell's Escape handler checks
  `document.querySelector('[role="dialog"]')` first, because Radix portals dialogs to `<body>` and
  must handle its own Escape.
- **Drag operations announce themselves** via `lib/dragAnnouncements.ts`.
- **48x48px minimum touch target** (`min-h-12`).

## Notifications

`lib/notify.ts` wraps `sonner`. One function, used by every mutation hook:

```ts
notify(message: string, tone: NoticeTone = 'warning'): void
```

- The **message itself is the toast id**, so calling `notify` twice with the same string replaces
  the card rather than stacking a second one.
- `NOTICE_DURATION_MS = 2000`, dismissible earlier.
- `testId: 'notice'` renders as `data-testid="notice"`, which is the e2e selector — do not change
  it without updating `e2e/`.
- The `Toaster` lives in `WorkspaceShell` and reads the theme reactively from `themeStore`, not by
  a one-time DOM read at mount.

Message _wording_ for failed writes comes from `lib/errors.ts`, not from call sites:
`describeWriteFailure(action, error)` builds the sentence, and a server rejection is reported with
its reason verbatim, because the client cannot know whether the target was deleted, the title too
long, or the key invalid.

## Testing components

`@testing-library/react` + `@testing-library/user-event`, `happy-dom` environment, globals enabled,
`css: false`. `src/test/fixtures.ts` holds shared record builders — use it rather than hand-rolling
a `PageRecord`.

Query by role and accessible name, not by class or test id, except where a `data-testid` already
exists for e2e purposes. See [14](./14-testing.md).

## Checklist for a new component

1. Does a `ui/` primitive already do this? Compose it instead.
2. Does it need domain data? If not, it belongs in `ui/`.
3. Extend the native element; take a `variant` union rather than boolean props.
4. Spread `rest` before `className`; put the incoming `className` last inside `cn()`.
5. Static class strings only.
6. Any non-trivial logic goes to `lib/` as a pure function with its own test.
7. Doc comment on the exported component saying what it does **and why** — this is a review
   criterion, see [16](./16-conventions-and-workflow.md).
8. `// Future:` comment at any scalability seam, naming the change that would be made.
9. Co-locate a `*.test.tsx`.
10. Mobile-first from 320px, 48px touch targets.

## Next

- [06 — Styling and theming](./06-styling-and-theming.md)
- [04 — State management](./04-state-management.md)

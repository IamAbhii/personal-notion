---
name: react-standards
description: React and CSS architecture, mobile-first PWA layout, reusable-component and performance standards for this project. Read before writing or changing any React component, hook, context, stylesheet or client-side data fetch (.tsx/.ts/.css under packages/frontend), and before reviewing a frontend diff. Covers strict typing, composition over boolean props, native-attribute extension and refs, custom hooks, immutable and derived state, async waterfalls, lazy state init, render cascades, styling with Tailwind utilities in the JSX rather than hand-written CSS or one monolithic stylesheet (co-located CSS Modules only for what a utility cannot express), and mobile-first layout from 320px with 48px touch targets.
---

# React standards

These are the rules for every React file in this repo. They are review criteria: a frontend task is
not done while a rule below is broken, and the orchestrator sends work back for it.

The stack is **React 19** with **TanStack Router and Query** in **TypeScript**. React 19 matters for
two rules specifically (refs, and `use`), so check the version before copying a React 18 pattern from
memory.

## 1. Components and types

- **Functional components only.** No classes, except a single error boundary if one is needed.
- **Strict props.** Every component has an explicit `interface` or `type` for its props. Never `any`,
  never implicit `any`, never `object`. Prefer a precise union over a wide string.
- **No `React.FC`.** Type the props parameter directly; `React.FC` adds nothing and gets in the way of
  generics and `ref`.

```tsx
interface PageTitleProps {
  title: string;
  onRename: (next: string) => void;
}

export function PageTitle({ title, onRename }: PageTitleProps) { /* ... */ }
```

## 2. Composition over configuration

Avoid boolean prop soup — `hasHeader`, `isLarge`, `showIcon`, `withBorder`. Each boolean added to a
component multiplies the states it can be in, and none of them let the caller put something the
component's author did not anticipate on screen.

Instead:

- **`children` for the main content.**
- **Named `ReactNode` slot props** for the rest: `header`, `footer`, `trigger`, `actions`, `icon`. The
  parent composes the layout; the component only positions the slots.
- **Discriminated unions, not independent booleans,** where the variants are genuinely mutually
  exclusive. A closed set of names beats a set of flags whose illegal combinations still typecheck.

```tsx
// Avoid
<Panel hasHeader showIcon isLarge title="Blocks" />

// Prefer
<Panel size="lg" header={<PanelHeader icon={<BlockIcon />}>Blocks</PanelHeader>}>
  {blocks}
</Panel>
```

```tsx
// Variants as a union, not three booleans
type ToastProps = { message: string } & ({ kind: 'info' } | { kind: 'error'; retry: () => void });
```

## 3. Primitives extend native HTML

A wrapper around a DOM element must accept everything that element accepts, so callers never have to
patch the wrapper to pass `aria-*`, `type`, `onKeyDown` or `data-testid`.

- Extend `React.ComponentPropsWithoutRef<'button'>` (or `ComponentProps<typeof OtherComponent>`).
- Spread the rest props onto the element, **before** the props you control, so your handlers and
  `className` composition are not silently overwritten.
- **Forward the DOM node.** In React 19 `ref` is an ordinary prop — declare it in the props type and
  pass it down. `forwardRef` is unnecessary here and is being deprecated; use it only in code that
  must also run on React 18.

```tsx
interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'ghost';
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button {...rest} className={cx('btn', `btn-${variant}`, className)} />;
}
```

Use `useImperativeHandle` only to expose a small named API (`focus`, `scrollToBlock`) — never to hand
the parent the whole internal state.

## 4. Custom hooks own state, effects and I/O

UI components render. Anything else — state machines, subscriptions, timers, network calls, storage
access, keyboard wiring — moves into a `use*.ts` hook under `hooks/`.

- One hook, one concern. `usePageBlocks`, `useSlashMenu`, `useOfflineQueue`.
- A hook returns a stable, named object; it does not return a tuple of five positional values.
- Server state belongs to **TanStack Query**, not to `useState`. Never copy fetched data into local
  state — read it from the query and, if the user can edit it, keep only the local draft.
- Rules of hooks are non-negotiable: top level, unconditional, and `eslint-plugin-react-hooks` clean
  (no disable comments to silence the dependency rule — fix the dependency instead).

## 5. State: immutable, minimal, derived

- **Functional, immutable updates.** `setItems((prev) => [...prev, next])`. Never mutate state, never
  read the current value from the closure when the next value depends on it.
- **Derive during render. Do not sync with `useEffect`.** If a value can be computed from props or
  other state, compute it in the render body. An effect that only sets state from other state is a
  bug: it renders twice, and it goes stale.
- **`key` to reset, not an effect.** To discard component state when the subject changes, remount it
  with `key={pageId}` rather than clearing fields in an effect.
- **`useEffect` is for synchronizing with something outside React** — the DOM, the network, a
  subscription, `localStorage`. Every such effect cleans up after itself, and any effect that awaits
  guards against the stale response (an `ignore` flag or an `AbortSignal`).
- Keep state as local as the component that uses it; lift only when a second consumer appears. Values
  that do not affect the render go in a `useRef`, not in state.

```tsx
// Avoid: effect-synced derived state
const [visible, setVisible] = useState<Block[]>([]);
useEffect(() => setVisible(blocks.filter((b) => !b.archived)), [blocks]);

// Prefer: derived during render
const visible = blocks.filter((b) => !b.archived);
```

## 6. Performance

- **No async waterfalls.** Independent awaits run together with `Promise.all` (or as parallel
  TanStack queries / `useQueries`). Serial `await` is only for a call that genuinely needs the
  previous result.
- **Lazy state initialization.** Anything expensive passed to `useState` goes in a factory callback,
  so it runs once instead of on every render: `useState(() => JSON.parse(raw))`. Same for a
  `localStorage` read or a big default structure.
- **No render cascades.** Put an event's state updates in the callback handler that caused them. Do
  not chain `useEffect`s where one effect's `setState` triggers the next — it costs extra renders and
  makes the order of updates hard to reason about.
- **Measure before memoizing.** Write pure components with stable data flow first; add `useMemo`,
  `useCallback` or `memo` when a real cost is identified, or where a value is a dependency of another
  hook and must be referentially stable. Blanket memoization is noise.
- **Stable keys.** Keys come from entity ids. Never the array index for a list that reorders, inserts
  or deletes — that is a correctness bug in the editor, not a performance nit.
- Long lists get virtualized; heavy, rarely-opened surfaces get `React.lazy`.

## 7. CSS: modular, scoped, co-located

**No monolithic stylesheets.** A single global CSS file that styles every page and component is the
pattern this project rejects: nothing is scoped, no rule can be deleted safely, class names collide,
and the file only ever grows. Styling lives next to the component it styles.

### Co-located directory pattern

One directory per component, holding the implementation, its scoped styles and its unit test:

```
src/components/PageView/PageView.tsx
src/components/PageView/PageView.module.css
src/components/PageView/PageView.test.tsx
```

Import the file directly (`import { PageView } from '../PageView/PageView'`) — no barrel `index.ts`,
which only adds indirection and hurts tree-shaking. A component with no styles of its own simply has
no `.module.css` file; do not create an empty one.

### Tailwind utilities are the default, and almost all of the styling

**Style with Tailwind utility classes in the JSX. That is the rule.** Tailwind owns the design tokens
— spacing, color, type scale, radii — so the UI is consistent by construction instead of by hundreds
of lines of hand-written rules. Utilities also generate no CSS of their own, so styling this way
shrinks the stylesheet instead of relocating it.

**Writing plain CSS declarations to do what a utility already does is the single most common way this
rule gets broken.** Moving a global stylesheet into per-component `.module.css` files is *not* this
project's CSS architecture — it is the monolith in smaller pieces, and it will be sent back. Three
specific tells, all forbidden:

- **Hand-written declarations that map to a utility.** `display: flex; gap: 6px; padding: 18px 14px`
  is `flex gap-1.5 px-3.5 py-4.5`. If a utility exists, use the utility.
- **Off-scale values.** No `gap: 6px`, `border-radius: 11px`, `font-size: 17px`, `width: 36px`. Snap
  to the scale (`gap-1.5`, `rounded-md`, `text-base`, `size-9`). A small visual shift from snapping is
  expected and acceptable.
- **Hand-rolled media queries.** Never `@media (min-width: 768px)` — that is the `md:` variant, and
  the variant is mobile-first by default while the hand-rolled query invites desktop-first thinking.

### When a `.module.css` is allowed

A component with no `.module.css` is the normal, healthy case; do not create an empty one. A module
rule is justified **only where a utility genuinely cannot express it**:

- pseudo-elements with no utility — `::marker`, `::-webkit-scrollbar`, and `::placeholder` where a
  utility will not do
- `@keyframes`
- a rule that must target a child element you do not own (a third-party widget's internals)

**Write a one-line comment on every rule you keep, saying why a utility could not do it.** If you
cannot write that justification, the rule does not belong in the module. Keep whatever remains using
project tokens (`var(--surface)`) or `@apply` on a token — never a raw value.

- Import as `import styles from './PageView.module.css'` and use as `className={styles.header}`. CSS
  Modules hash the class names, so collisions are impossible by construction.
- Class names inside a module are **local and semantic** — `.header`, `.row`, `.rowSelected`. They are
  already scoped, so they need no component prefix.
- Never reach into another component's module, and never use `:global` to style something you do not
  own. If two components need the same look, that look is a shared primitive or a theme token.
- **`@apply` is a readability tool, not the destination.** Reach for it only when one class is reused
  across several elements in the component, or a single utility string has grown genuinely unreadable.
  It is never the reason to move a component's whole appearance out of the JSX.
- **Tailwind v4 requires `@reference`.** A `.module.css` file is bundled separately from the main
  stylesheet, so it cannot see the theme, custom utilities or custom variants unless it references
  them. Without this line `@apply` silently fails on any custom token:

```css
/* PageView.module.css */
@reference "../../styles/app.css";

.header {
  @apply flex items-center gap-2 border-b border-border px-4 py-3;
}
```

- Where a plain custom property does the job, **use the theme variable directly** rather than
  `@apply` — `padding: var(--spacing-4)` needs no Tailwind processing and is faster to build.
- Setup, once: `npm install tailwindcss @tailwindcss/vite`, add `tailwindcss()` to the Vite plugins,
  and `@import "tailwindcss";` at the top of `src/styles/app.css`.

**For how to use Tailwind itself — the token bridge, the `data-theme` dark variant, why interpolated
class names silently fail, `cn()` for conditional and overridable classes, custom utilities — invoke
the `tailwind-standards` skill.** This section only decides where the styles live.

### What stays global

`src/styles/app.css` keeps only what is genuinely global and nothing else: the Tailwind import, the
theme and custom-property definitions, the dark-mode variables, resets, and base element styles. It
does not accumulate component rules. If you are adding a selector for one component to it, that rule
belongs in that component's module instead.

## 8. Mobile first, because this is a PWA

Personal Space is a **Progressive Web App**: it is installable and it runs on a phone as a primary
surface, not as an afterthought. A layout that only works at desktop width is a broken feature here,
not a polish item.

- **Design from 320px up.** Start with the narrow layout and add breakpoints outward. The unprefixed
  styles are the phone; `sm:`/`md:`/`lg:` layer on the wider cases. 320px is the floor that must not
  overflow horizontally, and nothing may require horizontal scrolling to use.
- **48x48px minimum for every touch target** — buttons, icon buttons, menu items, sidebar rows,
  checkboxes, the emoji picker's cells, the block handle. If the visual mark is smaller (a 16px icon),
  keep the mark small and grow the hit area with padding, or use a pseudo-element. Two adjacent
  targets need space between them so a thumb cannot hit both.
- **No hover-only affordances.** A control that appears only on `:hover` is unreachable on touch.
  Anything hover-revealed on desktop needs a touch route: always visible at small widths, or behind a
  long-press or an explicit menu button.
- **Design for the keyboard covering half the screen.** The block editor is used with the on-screen
  keyboard up; keep the caret visible and do not pin essential controls to the bottom of the viewport
  where the keyboard lands. Use `dvh` rather than `vh` for full-height layouts.
- **Test the layout at a phone size yourself before reporting done** — not only at 1280x800. Capture
  at a device preset and look at it.
- Offline is part of the mobile story: the service worker and the sync queue mean the UI must have a
  sensible state when there is no network, not a spinner that never resolves.

## 9. Accessibility and DOM hygiene

- Use the native element (`button`, `a`, `input`, `dialog`) before adding `role` to a `div`.
- Every control has an accessible name; every input is associated with a label.
- Keyboard reachability and visible focus for anything clickable; manage focus explicitly when a menu
  or dialog opens and closes.
- No layout-affecting work in `useLayoutEffect` unless you are measuring the DOM.

## Review checklist

Run this over the diff before reporting done:

- [ ] No `any`, no implicit `any`, no `@ts-expect-error` added; `npx tsc --noEmit` clean.
- [ ] No new boolean presentation props; slots and unions used instead.
- [ ] Wrapper primitives extend the native attribute type, spread rest props, and forward `ref`.
- [ ] No fetching, subscribing or storage access inside a component body — it is in a `use*` hook.
- [ ] No `useEffect` that only mirrors props or state into state.
- [ ] All state updates immutable and functional.
- [ ] Independent async calls parallelized.
- [ ] Expensive `useState` initializers wrapped in a callback.
- [ ] No effect chains driving what a single event handler could do.
- [ ] List keys are entity ids.
- [ ] Every new component sits in its own directory with its `.test.tsx`, and a `.module.css` only if
      it needs one — most do not.
- [ ] Styling is Tailwind utilities in the JSX; no hand-written declaration duplicates a utility, no
      off-scale values, no hand-rolled `@media` query where a breakpoint variant applies.
- [ ] Every rule left in a `.module.css` carries a one-line justification for why a utility could not
      express it.
- [ ] No component rules added to a global stylesheet; no `:global`; no cross-module class imports.
- [ ] Any `.module.css` using `@apply` starts with `@reference "../../styles/app.css";`.
- [ ] The feature was checked at 320px and at a phone device preset, not only at 1280x800.
- [ ] Every new interactive element has a 48x48px minimum hit area.
- [ ] Nothing essential is hover-only.
- [ ] `npm run lint` and `npm run format:check` clean, with no hook-rule disables.

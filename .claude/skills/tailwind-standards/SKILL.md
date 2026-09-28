---
name: tailwind-standards
description: How to use Tailwind CSS well in this project (Tailwind v4 with Vite). Read before writing Tailwind utility classes, adding a design token, theming for light and dark, styling a variant-driven component, or setting Tailwind up. Covers the @theme token bridge, the data-theme dark variant, why dynamic class strings silently fail, clsx plus tailwind-merge for conditional and overridable classes, @apply and @reference in CSS Modules, custom utilities with @utility, and class ordering.
---

# Tailwind standards

Tailwind is the design system's delivery mechanism in this project: the tokens live in CSS, the
utilities apply them, and consistency comes from nobody being able to invent a spacing value or a
color in passing.

This is **Tailwind v4**, which is configured **in CSS, not in JavaScript**. There is no
`tailwind.config.js` and none should be added. For where styles live (per-component
`*.module.css`, no monolithic stylesheet), see the `react-standards` skill; this skill is about the
utilities and the tokens.

## 1. Setup, once

```bash
npm install tailwindcss @tailwindcss/vite
```

```ts
// packages/frontend/vite.config.ts
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()] });
```

```css
/* packages/frontend/src/styles/app.css - first line */
@import 'tailwindcss';
```

Do not use the PostCSS or CLI path; the Vite plugin is the supported one here.

## 2. Tokens are the contract

This project already has a semantic palette in `src/styles/theme.css` — `--canvas`, `--surface`,
`--text`, `--text-muted`, `--border`, `--panel`, `--radius-md`, and so on — swapped per theme under
`[data-theme='light']` and `[data-theme='dark']`. **Do not duplicate that palette into Tailwind.**
Bridge it, so every existing token becomes a utility:

```css
@import 'tailwindcss';
@import './theme.css';

/* `inline` is required: these values reference other custom properties that change per theme, so the
   utility must emit var(--surface) rather than a snapshot of its current value. */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
  --color-panel: var(--panel);
}
```

That yields `bg-surface`, `text-text-muted`, `border-border`, `bg-panel` — the same names the theme
already uses, now available as utilities.

Rules that follow from this:

- **Never put a raw color in a utility.** No `bg-[#191820]`, no `text-slate-500`. If the color is a
  product color it is a token; if it is not a token, it does not belong on screen.
- **Never invent a scale value.** Use `p-4`, `gap-2`, `rounded-md` — not `p-[13px]`. Arbitrary values
  are for genuine one-offs (a magic sprite offset, a `max-w-[62ch]` reading measure), and each one
  should look deliberate.
- **New tokens go in `@theme`**, not in a component. A value used by two components is a token.
- Note the repo's `--radius-sm|md|lg` names sit in Tailwind's own `--radius-*` namespace, so declaring
  them in `@theme` intentionally redefines `rounded-sm|md|lg` to this project's radii. That is wanted;
  just know it is what is happening.

## 3. Light and dark

The active theme is `data-theme` on `<html>`, set before first paint. Tailwind's default `dark:`
variant keys off `prefers-color-scheme`, which is the wrong signal here, so override it once:

```css
@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));
```

**Then reach for `dark:` almost never.** Because the tokens are semantic and swap per theme,
`bg-surface text-text` is already correct in both themes. A `dark:` utility is a signal that you are
styling a raw color instead of a token, and it is the main way a two-theme UI drifts. Legitimate uses
are rare: an image treatment, a shadow that needs a different alpha, an inverted illustration.

## 4. Class names must be complete and static

Tailwind scans source files as **plain text**. It never evaluates your JavaScript, so an interpolated
class name is simply not generated, and the style is missing at runtime with no error anywhere.

```tsx
// Broken: `bg-blue-600` never appears in the source, so it is never generated
<button className={`bg-${color}-600`} />;

// Correct: map the prop to complete class names
const variantClass = {
  primary: 'bg-panel text-panel-text hover:bg-panel-hover',
  danger: 'bg-danger text-white hover:brightness-110',
} satisfies Record<Variant, string>;

<button className={variantClass[variant]} />;
```

The lookup object also types the variants and keeps the whole set readable in one place. Never
"solve" a dynamic class by adding it to a safelist.

## 5. Conditional and overridable classes

Two problems appear as soon as components take a `className`: composing conditionals readably, and
making the caller's utility actually win over the component's default. String concatenation solves
neither — `'p-2' + ' p-4'` leaves both in the class list and CSS source order decides, not the caller.

```bash
npm install clsx tailwind-merge
```

```ts
// src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Composes conditional class names and resolves conflicting Tailwind utilities, last one winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- Use `cn()` for every `className` that has a condition in it or accepts an incoming `className`.
- **The incoming `className` goes last**, so a caller's `p-6` beats the component's `p-4`.
- For a component with several variants and sizes, `class-variance-authority` (`cva`) is worth it;
  below three variants, the plain lookup object in section 4 is simpler.

## 6. Utilities in JSX, `@apply` in the module

- **Default to utilities in the JSX.** They generate no new CSS and keep the styling next to the
  markup it applies to.
- **Move to the component's `.module.css` with `@apply`** when a class is reused across elements, or
  the utility string has grown past readability. The rule stays scoped to the component.
- **Never hand-write a CSS declaration that a utility already expresses.** `display: flex; gap: 6px;
  padding: 18px 14px` is `flex gap-1.5 px-3.5 py-4.5`. Relocating a global stylesheet into per-component
  `*.module.css` files is not modular CSS — it is the same monolith in smaller files, and it defeats the
  point: utilities emit no new CSS, hand-written rules do. If a migration leaves the total CSS line
  count roughly unchanged, it was a copy-paste, not a migration.
- **No off-scale values and no hand-rolled media queries in a module.** `border-radius: 11px` is
  `rounded-md`; `font-size: 17px` is `text-base`; `@media (min-width: 768px)` is the `md:` variant,
  which is mobile-first by default where the hand-rolled query is not.
- **Justify every rule that stays in a module** with a one-line comment saying why a utility could not
  do it — a utility-less pseudo-element (`::marker`, `::-webkit-scrollbar`), `@keyframes`, or a
  third-party child you do not own. No justification means the rule belongs in the JSX.
- A `.module.css` that uses `@apply` **must** start with `@reference '../../styles/app.css';` —
  separately bundled stylesheets cannot see the theme, custom utilities or custom variants otherwise,
  and `@apply` on a project token fails silently.
- Where a plain custom property does the job, use it directly (`background: var(--surface)`) rather
  than `@apply`; it needs no Tailwind processing.
- **Never `@apply` a whole component's look into one god-class.** If a rule has fifteen utilities in
  it, the component wanted composition, not a class.

## 7. Variants over JavaScript state

Prefer a CSS variant to a piece of React state whose only job is styling.

- `hover:`, `focus-visible:`, `active:`, `disabled:` instead of tracking interaction in state.
- `group`/`group-hover:` for a parent-driven child style — the sidebar row's hover actions are exactly
  this; `peer`/`peer-checked:` for sibling-driven ones.
- `data-*` variants for component state you already put in the DOM: `data-[state=open]:rotate-90`
  reads the attribute rather than duplicating it in state.
- **Mobile first, and it is not optional — this is a PWA that runs on a phone.** Unprefixed utilities
  are the phone layout, and they must work from **320px** up; `sm:`/`md:`/`lg:` layer the wider cases
  on top. Never write `md:` styles first and then patch the small screen, and never hand-roll a media
  query in a module for something a variant covers.
- **Touch targets are `min-h-12 min-w-12` (48px) minimum** on anything tappable. Where the visual mark
  must stay small, grow the hit area with padding (`p-3` around a 24px icon) rather than shrinking the
  target. Do not put two tap targets adjacent without a gap.
- Prefer `min-h-dvh` over `min-h-screen` for full-height layouts, so the on-screen keyboard does not
  push content out of view.
- `hover:` alone is not an affordance on touch. Pair it with a state that works without a pointer, or
  keep the control visible at small widths.
- `@container` and `cq` variants when a component must respond to its own width rather than the
  viewport's — a block editor inside a resizable pane is the case for it.
- Respect `motion-reduce:` on anything that animates.

## 8. Custom utilities

Use `@utility`, not `@layer utilities` (which was the v3 idiom and does not participate correctly in
v4's ordering or variants):

```css
@utility scrollbar-none {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

Base element styles (a default `body` color, link styling) go in `@layer base` in `app.css`, and
nowhere else.

## 9. Readability

- Install `prettier-plugin-tailwindcss` so class order is mechanical and diffs stop churning on it.
  Nobody hand-sorts classes and nobody reviews their order.
- Keep long class strings on the element rather than hiding them behind a variable named `classes`;
  if it is too long to read, that is section 6's signal to move to the module.
- No `!important` and no `!` utility prefix to win a specificity fight. If a style will not apply,
  find out why — usually it is a conflict `cn()` should have resolved, or CSS source order.
- No arbitrary `z-[9999]`. Layering values are tokens.

## Checklist

- [ ] No raw hex, `rgb()` or default-palette color in any utility; project tokens only.
- [ ] No arbitrary value where a scale step exists.
- [ ] No interpolated or concatenated class name anywhere.
- [ ] `cn()` used for conditional classes, with the incoming `className` last.
- [ ] No `dark:` utility that a semantic token would have handled.
- [ ] Any `.module.css` with `@apply` begins with `@reference '../../styles/app.css';`.
- [ ] Styling is Tailwind utilities in the JSX; no hand-written declaration duplicates a utility.
- [ ] Every rule left in a `.module.css` carries a one-line justification for why a utility could not do it.
- [ ] No hand-rolled `@media` query where a breakpoint variant applies.
- [ ] New shared values added to `@theme`, not inlined in a component.
- [ ] Custom utilities declared with `@utility`; no `tailwind.config.js` added.
- [ ] No `!important`, no `!` prefix, no safelist workaround.
- [ ] Unprefixed utilities describe the phone layout and hold at 320px; breakpoints only widen it.
- [ ] Tappable elements are at least 48px in both directions.
- [ ] `npm run format:check` clean with the Tailwind Prettier plugin active.

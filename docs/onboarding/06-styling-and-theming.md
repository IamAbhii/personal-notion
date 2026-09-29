# 06 — Styling and theming

> Read [`.claude/skills/tailwind-standards/`](../../.claude/skills/tailwind-standards/) before
> writing utility classes, adding a token, or theming a component. This page maps the actual setup.

Tailwind CSS 4 with the Vite plugin (`@tailwindcss/vite`), over a hand-written CSS
custom-property token layer. There is **no `tailwind.config.js`** — Tailwind 4 is configured in CSS.

## The two stylesheets

```
src/styles/
  theme.css   the palette and the two themes, as CSS custom properties
  app.css     @import tailwindcss, the dark variant, the @theme bridge, base styles
```

Both are imported once, in `main.tsx`:

```ts
import './styles/theme.css';
import './styles/app.css';
```

### `theme.css` — tokens

A fixed palette (amber, blue, purple over grays, plus danger, teal, rose) and then semantic tokens
per theme. **Every component reads only these custom properties, never a raw hex value.**

```css
:root {
  --amber: #ecad0a;
  --blue: #209dd7;
  --purple: #753991;
  --danger: #cf3b34;
  --teal: #0f9080;
  --rose: #c2335e;
  /* …and -soft variants */
}
```

The semantic layer (`--canvas`, `--panel`, `--surface`, `--surface-sunken`, `--text`,
`--text-muted`, `--border`, and the `-fg` foregrounds for each option colour) is what components
actually consume, and it is what changes between themes.

### `app.css` — the Tailwind bridge

```css
@import 'tailwindcss';
@import './theme.css';

@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@theme inline {
  --color-canvas: var(--canvas);
  /* …one line per semantic token */
}
```

Two lines here are load-bearing and easy to get wrong:

1. **`@custom-variant dark`** points the `dark:` variant at the `data-theme` attribute. Tailwind's
   default `dark:` uses `prefers-color-scheme`, which is the wrong signal in this app — the theme is
   an explicit per-device choice, not an OS preference.
2. **`@theme inline`** — the `inline` keyword is **required**. These values reference other custom
   properties that change per theme, so the generated utility must emit `var(--surface)` rather
   than a snapshot of its current value. Without `inline`, theme switching stops working for those
   utilities.

The bridge is what makes `bg-canvas`, `text-text-muted`, `border-border` etc. valid Tailwind
utilities.

## How the theme switches

Three places cooperate, in this order:

1. **`index.html`, inline, before first paint:**

   ```js
   var stored = localStorage.getItem('personal-space:theme');
   document.documentElement.dataset.theme = stored === 'dark' ? 'dark' : 'light';
   ```

   This is why there is no flash of the wrong theme. It runs before any JS bundle loads.

2. **`stores/themeStore.ts`** after React mounts: keeps `data-theme`, the
   `<meta name="theme-color">` tag and `localStorage` in sync, and listens for the `storage` event
   so a change in another tab applies here. It writes the theme as a **raw string**, not JSON,
   because the inline script reads the key directly — this is why theme is its own store rather
   than part of `uiStore`'s `persist` block. See [04](./04-state-management.md).

3. **CSS** reacts to the attribute: `theme.css` for the token values, `app.css`'s `dark:` variant
   for anything expressed as a utility.

Theme is **per device, not per account** — a phone in bed and a laptop at a desk reasonably want
different answers, it works offline, and it needs no round trip.

## Rules for writing styles

### Utilities in the JSX, first choice

Style with Tailwind utilities in the markup. That is the default and it covers nearly everything
here. A co-located CSS Module is the exception, used only for what a utility genuinely cannot
express — there are exactly three in the codebase:

- `components/BlockRow.module.css`
- `components/CellEditor/CellEditor.module.css`
- `components/PageView/PageView.module.css`

There is no monolithic hand-written stylesheet, and adding one would be a regression.

### `cn()` for anything conditional

```ts
import { cn } from '../lib/cn'; // clsx + tailwind-merge
```

Use it for **every** `className` that has a condition in it or accepts an incoming `className`
prop. `clsx` handles the conditionals; `tailwind-merge` resolves conflicting utilities with the
last one winning — which is what makes "caller can override any default" actually true.

### Class strings must be static

```tsx
// Wrong — Tailwind's scanner never sees this class, so it is not generated.
<div className={`bg-${color}-500`} />;

// Right — a static lookup table.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-amber text-text-on-amber',
  danger: 'bg-danger text-white',
};
```

This is the single most common Tailwind bug and it fails **silently**: the element simply has no
background. `Button.tsx` and `lib/optionColors.ts` both use the static-lookup pattern —
`optionColors.ts` maps the six option colour names from the API contract to their Tailwind classes.

The six option colours (`gray`, `amber`, `blue`, `purple`, `teal`, `rose`) are exported from **both**
`packages/worker/src/sync/ops.ts` and `packages/frontend/src/api/types.ts`, so the server validates
against the same list the client renders, and Phase 4's board columns inherit the colours for free.

### Arbitrary values are fine where a token is not warranted

The codebase uses them where a designed value is genuinely one-off:

```tsx
'rounded-[10px] px-[14px] text-[13.5px] font-[650]';
'shadow-[inset_0_0_0_1px_var(--border)]';
```

Note the second one references a token inside an arbitrary value. That is the right way to reach a
theme colour from a property Tailwind does not tokenise.

### Class ordering

`prettier-plugin-tailwindcss` is installed and configured, so **class order is Prettier's job**.
Do not hand-sort; run `npm run format`.

## Mobile-first

Write the 320px layout first, then add `md:` and up. `md` is 768px and is the breakpoint where the
sidebar changes from an off-canvas drawer to a persistent grid column.

- `hooks/useIsMobile.ts` mirrors that breakpoint in JS (`MD_BREAKPOINT = 768`) for **behaviour**
  only — `inert`, focus management — never for styling. If the breakpoint ever changes, both places
  must change; the hook carries a `// Future:` note saying so.
- Minimum touch target 48x48px. `Button` enforces it with `min-h-12`.
- `styles/longText.test.ts` exists to pin down text-overflow behaviour — long titles and long block
  text are a recurring source of layout defects here, so they have a test.

## PWA chrome

The installed app's status bar colour comes from `<meta name="theme-color">`, kept in sync by
`themeStore.applyTheme()`:

```ts
const THEME_COLOR: Record<Theme, string> = {
  light: '#17161c', // --panel in light theme
  dark: '#0b0b0f', // --panel in dark theme
};
```

The manifest's `background_color` (`#f7f6f3`) and `theme_color` (`#16151b`) are set in
`vite.config.ts` and are separate values used for the splash screen — changing the theme tokens
does not update those, so keep them in mind if the palette shifts.

## Checklist

1. Utilities in the JSX. CSS Module only for what a utility cannot express.
2. Semantic token, never a raw hex, and never a palette colour directly if a semantic one exists.
3. New token? Add it to `theme.css` for **both** themes, then bridge it in `app.css`'s
   `@theme inline`.
4. `cn()` for every conditional or overridable `className`.
5. Static class strings — no interpolation.
6. Mobile-first, 48px touch targets.
7. `npm run format` before committing; do not hand-sort classes.
8. Check both themes. Light and dark are equal citizens here, not a default plus an afterthought.

## Next

- [05 — Component structure](./05-component-structure.md)
- [03 — Frontend architecture](./03-frontend-architecture.md)

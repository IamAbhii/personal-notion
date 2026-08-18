import { create } from 'zustand';

/** The two app themes. Matches the `data-theme` values the CSS tokens key off. */
export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  /** Flips the active theme, persists it, and updates the DOM. */
  toggleTheme: () => void;
}

/**
 * The browser chrome `theme-color` meta tag should match the app topbar / panel color so the
 * status bar and browser frame blend with the UI when installed as a PWA.
 */
const THEME_COLOR: Record<Theme, string> = {
  light: '#17161c', // --panel in light theme
  dark: '#0b0b0f', // --panel in dark theme
};

/**
 * Reads the theme that the inline pre-paint script already wrote. Returns 'light' if nothing
 * is stored, which matches the inline script's own default.
 */
function readStoredTheme(): Theme {
  try {
    return localStorage.getItem('personal-space:theme') === 'dark' ? 'dark' : 'light';
  } catch {
    // localStorage is blocked in some contexts (private browsing, embedded iframe). Fall back
    // to whatever the inline script already set on the html element.
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
}

/**
 * Applies a theme change to the DOM and to localStorage.
 *
 * Writes the theme as a raw string under 'personal-space:theme' — not as a JSON value — because
 * the inline script in index.html reads that key directly with `=== 'dark'`. Using zustand's JSON
 * persist middleware would wrap the value in `{"state":{...},"version":0}`, breaking the script.
 * This is why theme lives in its own store rather than in uiStore's persist block.
 */
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;

  // Sync the browser chrome color so the status bar matches the panel on mobile.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];

  try {
    localStorage.setItem('personal-space:theme', theme);
  } catch {
    // Storage write failure is not fatal; the visual state is already correct.
  }
}

// Sync the meta tag on first load — the inline script sets data-theme but does not touch the
// meta tag, so the browser chrome color may be stale until the toggle is used without this.
applyTheme(readStoredTheme());

/**
 * Theme store. Keeps the active theme in sync across the DOM attribute, the meta theme-color tag,
 * and localStorage, so toggling takes effect immediately and survives a page reload.
 *
 * The persistence key 'personal-space:theme' is a raw string rather than a JSON blob so the
 * inline pre-paint script in index.html can read it before React mounts.
 *
 * Future: expose a `setTheme` action when a picker (auto/light/dark) lands; today only toggle
 * is needed.
 */
export const useThemeStore = create<ThemeState>()((set) => ({
  theme: readStoredTheme(),
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),
}));

// DEF-101: when another tab changes the theme, the storage event fires on all other tabs.
// Apply the new theme to the DOM and update the store so the toggle label stays consistent.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === 'personal-space:theme') {
      const next: Theme = event.newValue === 'dark' ? 'dark' : 'light';
      applyTheme(next);
      useThemeStore.setState({ theme: next });
    }
  });
}

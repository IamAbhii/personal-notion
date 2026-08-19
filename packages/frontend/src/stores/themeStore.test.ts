import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from './themeStore';

// Reset after each test so DOM and localStorage state does not bleed across.
afterEach(() => {
  localStorage.clear();
  useThemeStore.setState({ theme: 'light' });
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('useThemeStore — toggleTheme', () => {
  it('toggles from light to dark and back', () => {
    useThemeStore.setState({ theme: 'light' });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('writes the theme to localStorage on toggle', () => {
    useThemeStore.setState({ theme: 'light' });
    useThemeStore.getState().toggleTheme();
    expect(localStorage.getItem('personal-space:theme')).toBe('dark');
  });

  it('updates data-theme on the html element on toggle', () => {
    useThemeStore.setState({ theme: 'light' });
    useThemeStore.getState().toggleTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('readStoredTheme: localStorage blocked (line 31 fallback to document.documentElement)', () => {
  it('reads the theme from data-theme when localStorage is unavailable (line 31)', async () => {
    // The catch branch in readStoredTheme (line 31) reads document.documentElement.dataset.theme
    // when localStorage.getItem throws. Trigger it by replacing window.localStorage with a
    // proxy that throws, clearing the module registry, then re-importing.
    vi.resetModules();
    document.documentElement.dataset.theme = 'dark';

    // Replace window.localStorage with an object whose getItem always throws.
    const realStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('SecurityError: localStorage blocked');
        },
        setItem: () => {
          /* silent */
        },
        removeItem: () => {
          /* silent */
        },
        clear: () => {
          /* silent */
        },
        key: () => null,
        length: 0,
      },
      writable: true,
      configurable: true,
    });

    try {
      const { useThemeStore: freshStore } = await import('./themeStore');
      // readStoredTheme fired during module init with getItem throwing → fell back to data-theme.
      expect(freshStore.getState().theme).toBe('dark');
    } finally {
      // Restore the real localStorage so later tests are not affected.
      Object.defineProperty(window, 'localStorage', {
        value: realStorage,
        writable: true,
        configurable: true,
      });
    }
  });
});

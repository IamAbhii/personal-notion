import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { useThemeStore } from '../../stores/themeStore';

// Reset the theme store and DOM state before each test so tests are independent.
beforeEach(() => {
  useThemeStore.setState({ theme: 'light' });
  document.documentElement.dataset.theme = 'light';
  localStorage.clear();
});

describe('ThemeToggle: rendering', () => {
  it('shows "Switch to dark theme" label when in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('shows "Switch to light theme" label when in dark mode', () => {
    useThemeStore.setState({ theme: 'dark' });
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});

describe('ThemeToggle: toggling', () => {
  it('toggles from light to dark, updating the DOM attribute', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('toggles from dark to light, updating the DOM attribute', async () => {
    useThemeStore.setState({ theme: 'dark' });
    document.documentElement.dataset.theme = 'dark';

    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('persists the chosen theme to localStorage', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button'));

    // After toggling from light to dark, the key the inline script reads must hold 'dark'.
    expect(localStorage.getItem('personal-space:theme')).toBe('dark');
  });

  it('uses the aria-pressed attribute to reflect current state', () => {
    useThemeStore.setState({ theme: 'dark' });
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ThemeToggle: cross-tab sync', () => {
  it('adopts a theme change from another tab via the storage event', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to dark/i })).toBeInTheDocument();

    // Simulate another tab writing 'dark' to localStorage and firing the storage event.
    act(() => {
      const event = new StorageEvent('storage', {
        key: 'personal-space:theme',
        newValue: 'dark',
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    // The store and DOM attribute should now reflect dark, and the button label should update.
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: /switch to light/i })).toBeInTheDocument();
  });

  it('ignores storage events for unrelated keys', () => {
    render(<ThemeToggle />);

    act(() => {
      const event = new StorageEvent('storage', {
        key: 'some-other-key',
        newValue: 'dark',
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    // Theme should not have changed.
    expect(useThemeStore.getState().theme).toBe('light');
  });
});

import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { cn } from '../../lib/cn';

interface ThemeToggleProps {
  /** Additional Tailwind classes forwarded to the root button. */
  className?: string;
}

/**
 * A 48px toggle button that switches the app between light and dark themes. It reads the active
 * theme from the theme store and writes back to it on click, which also updates the DOM attribute
 * and the meta theme-color tag in a single synchronous step (no flash, no reload).
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      onClick={toggleTheme}
      className={cn(
        'grid min-h-12 min-w-12 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-panel-text-muted hover:bg-panel-hover hover:text-panel-text',
        className,
      )}
    >
      {isDark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}

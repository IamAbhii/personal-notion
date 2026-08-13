import type { OptionColor } from '../api/types';

/**
 * The one place that maps an option color name to Tailwind classes. Every chip, badge and board
 * column that needs a color reads from here so the mapping is never duplicated.
 *
 * Background uses a low-opacity overlay so the chip reads on both light and dark surfaces.
 * Foreground uses the -fg token family, which swaps to a darker shade in light theme where the
 * vivid palette colors fail WCAG AA on white.
 */
export const OPTION_COLOR_CLASSES: Record<OptionColor, { bg: string; text: string }> = {
  gray: { bg: 'bg-border/50', text: 'text-text-muted' },
  amber: { bg: 'bg-amber/20', text: 'text-amber-fg' },
  blue: { bg: 'bg-blue/20', text: 'text-blue-fg' },
  purple: { bg: 'bg-purple/20', text: 'text-purple-fg' },
  teal: { bg: 'bg-teal/20', text: 'text-teal-fg' },
  rose: { bg: 'bg-rose/20', text: 'text-rose-fg' },
};

/** Builds the combined className string for an option chip. */
export function optionColorClass(color: OptionColor): string {
  const classes = OPTION_COLOR_CLASSES[color];
  return `${classes.bg} ${classes.text}`;
}

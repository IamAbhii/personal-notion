// Shared date-formatting helpers used by both the cell editors and the list view.
// Keeping them in one place ensures "15 Sept 2026" format is consistent everywhere (DEF-083).

/** Parses a YYYY-MM-DD string into a Date, using local midnight so no timezone shift occurs. */
export function parseDateString(raw: string | null | undefined): Date | undefined {
  if (!raw) return undefined;
  const parts = raw.split('-');
  if (parts.length !== 3) return undefined;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Formats a YYYY-MM-DD string for human display, e.g. "1 Sep 2026". Returns '' for invalid input. */
export function formatDateString(raw: string | null | undefined): string {
  const d = parseDateString(raw);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

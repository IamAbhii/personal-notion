import { cn } from '../../lib/cn';
import { formatDateString } from '../../lib/dateFormat';
import { optionColorClass } from '../../lib/optionColors';
import type { OptionColor, PageRecord, PropertyRecord, PropertyValueRecord } from '../../api/types';

// ── Cell value renderers ──────────────────────────────────────────────────────

/** Renders a single cell value as a plain inline node for the list row. */
function renderCellValue(raw: string | null, property: PropertyRecord): React.ReactNode {
  if (raw === null) return null;
  try {
    switch (property.type) {
      case 'text':
      case 'url':
        return JSON.parse(raw) as string;
      case 'number':
        return String(JSON.parse(raw) as number);
      case 'date':
        // Use the shared formatter so dates show as "15 Sept 2026" everywhere (DEF-083).
        return formatDateString(JSON.parse(raw) as string);
      case 'checkbox':
        return (JSON.parse(raw) as boolean) ? 'Yes' : 'No';
      case 'select': {
        const optId = JSON.parse(raw) as string;
        const opt = property.options.find((o) => o.id === optId);
        if (!opt) return null;
        return (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              optionColorClass(opt.color as OptionColor),
            )}
          >
            {opt.name}
          </span>
        );
      }
      case 'multiSelect': {
        const optIds = JSON.parse(raw) as string[];
        return (
          <span className="flex flex-wrap gap-1">
            {optIds.map((id) => {
              const opt = property.options.find((o) => o.id === id);
              if (!opt) return null;
              return (
                <span
                  key={id}
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    optionColorClass(opt.color as OptionColor),
                  )}
                >
                  {opt.name}
                </span>
              );
            })}
          </span>
        );
      }
    }
  } catch {
    return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ListViewProps {
  /** The rows to display, already filtered and sorted by the calling screen. */
  rows: PageRecord[];
  /** All properties of the database, in display order. */
  properties: PropertyRecord[];
  /** All property values across all displayed rows. */
  values: PropertyValueRecord[];
  onSelectRow: (rowPageId: string) => void;
  /**
   * Total number of rows before any filter is applied. Used to distinguish a genuinely empty
   * database ("no rows yet") from one that has rows but they are all filtered out (DEF-085).
   */
  totalRowCount?: number;
}

/**
 * List view: a compact vertical list showing each row's title and up to three labelled property
 * slots. Each slot always occupies the same horizontal position regardless of whether the value
 * is empty, so the same property lines up across all rows (DEF-084). Clicking a row opens its
 * row page. Mobile-first: each row is at least 48px tall.
 */
export function ListView({ rows, properties, values, onSelectRow, totalRowCount }: ListViewProps) {
  // Build a fast lookup for cell values: rowId → propertyId → raw JSON
  const valuesMap = new Map<string, Map<string, string | null>>();
  for (const v of values) {
    if (!valuesMap.has(v.rowPageId)) valuesMap.set(v.rowPageId, new Map());
    valuesMap.get(v.rowPageId)!.set(v.propertyId, v.value);
  }

  // Show up to the first 3 properties as metadata columns.
  const visibleProps = properties.slice(0, 3);

  if (rows.length === 0) {
    // Distinguish a genuinely empty database from a filtered-to-empty one (DEF-085).
    const message =
      totalRowCount === 0
        ? 'This database is empty. Add a row to get started.'
        : 'No rows match the current filters.';
    return (
      <div className="py-8 text-center text-sm text-text-muted" data-testid="list-empty-state">
        {message}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border" data-testid="list-view">
      {rows.map((row) => {
        const rowValues = valuesMap.get(row.id) ?? new Map<string, string | null>();
        return (
          <button
            key={row.id}
            type="button"
            className="flex min-h-12 w-full items-center gap-3 px-2 py-2 text-left hover:bg-surface-hover/50"
            onClick={() => onSelectRow(row.id)}
            data-testid="list-row"
            data-row-id={row.id}
          >
            {/* Icon + title */}
            <span className="flex-none font-emoji text-sm" aria-hidden>
              {row.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
              {row.title}
            </span>

            {/* Property columns: hidden on mobile (320px base), shown from sm (640px) up (DEF-069).
                Each slot always renders — empty values show "—" so column positions are consistent
                across all rows (DEF-084). The label above the value associates the value with its
                property, replacing the invisible title-attribute-only approach. */}
            {visibleProps.length > 0 && (
              <span className="hidden flex-shrink-0 items-start gap-4 sm:flex">
                {visibleProps.map((prop) => {
                  const raw = rowValues.get(prop.id) ?? null;
                  const rendered = renderCellValue(raw, prop);
                  return (
                    <span
                      key={prop.id}
                      className="flex max-w-[120px] min-w-[72px] flex-col gap-0.5"
                      aria-label={prop.name}
                    >
                      {/* Property label — tiny, muted, all-caps, visible (DEF-084) */}
                      <span className="truncate text-[10px] font-medium tracking-wide text-text-muted/60 uppercase">
                        {prop.name}
                      </span>
                      {/* Property value — dash when empty so the slot is never absent (DEF-084) */}
                      <span className="truncate text-xs text-text-muted">
                        {rendered !== null ? (
                          rendered
                        ) : (
                          <span className="text-text-muted/30" aria-label="empty">
                            —
                          </span>
                        )}
                      </span>
                    </span>
                  );
                })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

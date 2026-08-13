import type { ReactNode } from 'react';
import { CellEditor } from '../CellEditor/CellEditor';
import { cn } from '../../lib/cn';
import type { PageRecord, PropertyRecord, PropertyValueRecord } from '../../api/types';

export interface RowPageProps {
  /** The row page record. */
  row: PageRecord;
  /** The database page this row belongs to. */
  dbPage: PageRecord | undefined;
  /** All properties for the parent database. */
  properties: PropertyRecord[];
  /** All values for this row. */
  values: PropertyValueRecord[];
  onSetValue: (args: { rowPageId: string; propertyId: string; value: string | null }) => void;
  onUpdateOptions: (
    property: PropertyRecord,
    options: import('../../api/types').SelectOption[],
  ) => import('../../api/types').SelectOption | null;
  /** The block editor, composed by the route screen. */
  children?: ReactNode;
}

/**
 * The properties panel for a row page: one label/value row per property, using the same cell
 * editors as the table view. The block editor is placed below by the route screen.
 */
export function RowPage({
  row,
  dbPage,
  properties,
  values,
  onSetValue,
  onUpdateOptions,
  children,
}: RowPageProps) {
  const valuesByPropId = new Map(values.map((v) => [v.propertyId, v]));

  return (
    <div data-testid="row-page-properties">
      {properties.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          {dbPage ? (
            <div className="border-b border-border bg-surface-sunken px-3 py-1.5 text-xs font-medium text-text-muted">
              {dbPage.icon} {dbPage.title}
            </div>
          ) : null}
          <div className="divide-y divide-border">
            {properties.map((prop) => {
              const record = valuesByPropId.get(prop.id);
              const rawValue = record?.value ?? null;
              return (
                <div
                  key={prop.id}
                  className="flex min-h-12 items-center gap-2"
                  data-testid="property-row"
                  data-property-id={prop.id}
                >
                  {/* Label column */}
                  <div
                    className={cn(
                      'w-[140px] flex-none px-3 py-2 text-xs font-medium text-text-muted',
                      'sm:w-[180px]',
                    )}
                  >
                    {prop.name}
                  </div>
                  {/* Value column */}
                  <div className="min-w-0 flex-1 pr-2">
                    <CellEditor
                      property={prop}
                      rowPageId={row.id}
                      value={rawValue}
                      onSave={(v) =>
                        onSetValue({ rowPageId: row.id, propertyId: prop.id, value: v })
                      }
                      onUpdateOptions={onUpdateOptions}
                      variant="panel"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}

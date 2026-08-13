import { useMemo, useState } from 'react';
import { ChevronDown, Ellipsis, Plus, Trash2 } from 'lucide-react';
import { CellEditor } from '../CellEditor/CellEditor';
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu/DropdownMenu';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '../../lib/cn';
import { optionColorClass } from '../../lib/optionColors';
import { OPTION_COLORS } from '../../api/types';
import type {
  PageRecord,
  PropertyRecord,
  PropertyType,
  PropertyValueRecord,
  SelectOption,
} from '../../api/types';

// Future: Phase 4 adds a view switcher here (table / board / calendar) and persists per-view
// settings (column widths, hidden fields, sort/filter configuration) in the views table.

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multiSelect: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
};

export interface DatabaseViewProps {
  /** The database page itself (for the add-row op). */
  dbPage: PageRecord;
  /** The row pages, in sortKey order. */
  rowPages: PageRecord[];
  /** All properties for this database, in sortKey order. */
  properties: PropertyRecord[];
  /** All property values across all rows of this database. */
  values: PropertyValueRecord[];
  onSelectRow: (rowPageId: string) => void;
  onCreateRow: () => void;
  onDeleteRow: (row: PageRecord) => void;
  onCreateProperty: (args: { name: string; type: PropertyType; options?: SelectOption[] }) => void;
  onUpdateProperty: (
    property: PropertyRecord,
    changes: { name?: string; options?: SelectOption[] },
  ) => void;
  onDeleteProperty: (property: PropertyRecord) => void;
  onSetValue: (args: { rowPageId: string; propertyId: string; value: string | null }) => void;
}

// ---------- Property header menu ----------

interface PropertyHeaderMenuProps {
  property: PropertyRecord;
  onRename: (name: string) => void;
  onDelete: () => void;
  onManageOptions?: (options: SelectOption[]) => void;
}

function PropertyHeaderMenu({
  property,
  onRename,
  onDelete,
  onManageOptions,
}: PropertyHeaderMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(property.name);
  const [managingOptions, setManagingOptions] = useState(false);

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <input
          type="text"
          className="min-h-9 flex-1 rounded-sm border border-blue bg-surface px-2 py-1 text-xs focus:outline-none"
          value={nameInput}
          autoFocus
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const name = nameInput.trim();
              if (name) onRename(name);
              setRenaming(false);
            }
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={() => {
            const name = nameInput.trim();
            if (name) onRename(name);
            setRenaming(false);
          }}
        />
      </div>
    );
  }

  if (managingOptions && onManageOptions) {
    return (
      <OptionsEditor
        property={property}
        onSave={(options) => {
          onManageOptions(options);
          setManagingOptions(false);
        }}
        onClose={() => setManagingOptions(false)}
      />
    );
  }

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="flex min-h-10 min-w-8 cursor-pointer items-center gap-1 truncate rounded-sm border-0 bg-transparent px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
          aria-label={`${property.name} options`}
        >
          <span className="truncate">{property.name}</span>
          <ChevronDown size={10} className="flex-none opacity-50" aria-hidden />
        </button>
      }
      align="start"
    >
      <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
        Rename
      </DropdownMenuItem>
      {property.type === 'select' || property.type === 'multiSelect' ? (
        <DropdownMenuItem onSelect={() => setTimeout(() => setManagingOptions(true), 0)}>
          Manage options
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem variant="danger" onSelect={onDelete}>
        <Trash2 size={14} aria-hidden />
        Delete property
      </DropdownMenuItem>
    </DropdownMenu>
  );
}

// ---------- Options editor ----------

interface OptionsEditorProps {
  property: PropertyRecord;
  onSave: (options: SelectOption[]) => void;
  onClose: () => void;
}

/** Inline editor for managing select/multiSelect options: add, rename, recolor, remove. */
function OptionsEditor({ property, onSave, onClose }: OptionsEditorProps) {
  const [options, setOptions] = useState<SelectOption[]>(() => [...property.options]);
  const [newName, setNewName] = useState('');

  const addOption = () => {
    const name = newName.trim();
    if (!name) return;
    const color = OPTION_COLORS[options.length % OPTION_COLORS.length] ?? 'gray';
    setOptions((prev) => [...prev, { id: crypto.randomUUID(), name, color }]);
    setNewName('');
  };

  const updateOption = (id: string, changes: Partial<Omit<SelectOption, 'id'>>) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...changes } : o)));
  };

  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  };

  return (
    <div className="flex min-w-[240px] flex-col gap-1 p-2">
      <p className="px-1 text-xs font-medium text-text-muted">Manage options</p>
      {options.map((opt) => (
        <div key={opt.id} className="flex items-center gap-1.5">
          {/* Color picker: cycles through the palette */}
          <button
            type="button"
            aria-label={`Color: ${opt.color}`}
            className={cn(
              'size-5 min-w-5 cursor-pointer rounded-full border-2 border-border/50 transition-transform hover:scale-110',
              optionColorClass(opt.color),
            )}
            onClick={() => {
              const idx = OPTION_COLORS.indexOf(opt.color);
              const next = OPTION_COLORS[(idx + 1) % OPTION_COLORS.length] ?? 'gray';
              updateOption(opt.id, { color: next });
            }}
          />
          <input
            type="text"
            className="min-h-8 flex-1 rounded-sm border border-border bg-transparent px-2 py-0.5 text-xs focus:border-blue focus:outline-none"
            value={opt.name}
            onChange={(e) => updateOption(opt.id, { name: e.target.value })}
          />
          <button
            type="button"
            aria-label={`Remove ${opt.name}`}
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-muted hover:bg-danger/10 hover:text-danger"
            onClick={() => removeOption(opt.id)}
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </div>
      ))}
      <div className="mt-0.5 flex items-center gap-1 border-t border-border pt-1">
        <input
          type="text"
          className="min-h-9 flex-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs placeholder:text-text-muted/60 focus:border-blue focus:outline-none"
          placeholder="New option..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
        />
        <button
          type="button"
          className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20"
          onClick={addOption}
        >
          Add
        </button>
      </div>
      <div className="mt-0.5 flex items-center justify-end gap-1.5 border-t border-border pt-1">
        <button
          type="button"
          className="min-h-9 rounded-sm px-3 py-1 text-xs text-text-muted hover:bg-surface-hover"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="min-h-9 rounded-sm bg-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          onClick={() => onSave(options)}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ---------- Add property form ----------

const PROPERTY_TYPES: PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
];

interface AddPropertyFormProps {
  onAdd: (name: string, type: PropertyType) => void;
  onClose: () => void;
}

function AddPropertyForm({ onAdd, onClose }: AddPropertyFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('text');

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, type);
    onClose();
  };

  return (
    <div className="flex min-w-[220px] flex-col gap-2 p-2">
      <p className="px-1 text-xs font-medium text-text-muted">Add property</p>
      <input
        type="text"
        className="min-h-9 rounded-sm border border-border bg-transparent px-2 py-1 text-sm placeholder:text-text-muted/60 focus:border-blue focus:outline-none"
        placeholder="Property name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape') onClose();
        }}
      />
      <div>
        <label className="mb-1 block text-xs text-text-muted">
          Type <span className="text-text-muted/70">(fixed once created)</span>
        </label>
        <select
          className="min-h-9 w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm text-text focus:border-blue focus:outline-none"
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType)}
        >
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROPERTY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          className="min-h-9 rounded-sm px-3 py-1 text-xs text-text-muted hover:bg-surface-hover"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="min-h-9 rounded-sm bg-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          onClick={handleSubmit}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------- Main component ----------

/**
 * The table view for a database page. Renders one column per property with inline cell editors, a
 * header menu per column (rename, delete, manage options for select types), and controls to add
 * rows and properties.
 *
 * Uses semantic <table> markup. Phase 4 adds a view switcher above this table. Views and per-view
 * settings (sort, filter, hidden fields, column widths) land here with the views table.
 *
 * Future: Phase 4 adds sorting and filtering. The current structure is already keyed per-property
 * so column order changes are a re-sort of the properties array, not a re-build of the table.
 */
export function DatabaseView({
  // dbPage accepted but not consumed at this layer; reserved for Phase 4 view metadata header.
  rowPages,
  properties,
  values,
  onSelectRow,
  onCreateRow,
  onDeleteRow,
  onCreateProperty,
  onUpdateProperty,
  onDeleteProperty,
  onSetValue,
}: DatabaseViewProps) {
  const [pendingDeleteRow, setPendingDeleteRow] = useState<PageRecord | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);

  // Build a lookup: rowPageId → propertyId → raw JSON value string
  const valuesMap = useMemo(() => {
    const map = new Map<string, Map<string, string | null>>();
    for (const v of values) {
      if (!map.has(v.rowPageId)) map.set(v.rowPageId, new Map());
      map.get(v.rowPageId)!.set(v.propertyId, v.value);
    }
    return map;
  }, [values]);

  return (
    <div className="w-full overflow-x-auto" data-testid="database-view">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            {/* Title column */}
            <th className="min-w-[180px] border-r border-border">
              <span className="block px-3 py-2 text-left text-xs font-semibold tracking-wide text-text-muted uppercase">
                Title
              </span>
            </th>
            {/* One header per property */}
            {properties.map((prop) => (
              <th key={prop.id} className="min-w-[140px] border-r border-border">
                <PropertyHeaderMenu
                  property={prop}
                  onRename={(name) => onUpdateProperty(prop, { name })}
                  onDelete={() => onDeleteProperty(prop)}
                  onManageOptions={
                    prop.type === 'select' || prop.type === 'multiSelect'
                      ? (options) => onUpdateProperty(prop, { options })
                      : undefined
                  }
                />
              </th>
            ))}
            {/* "Add property" header cell */}
            <th className="w-10 border-r-0">
              {addingProperty ? (
                <DropdownMenu
                  open
                  onOpenChange={(o) => !o && setAddingProperty(false)}
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-10 min-w-10 items-center justify-center rounded-sm border-0 bg-transparent text-text-muted hover:bg-surface-hover"
                      aria-label="Add property"
                    >
                      <Plus size={14} aria-hidden />
                    </button>
                  }
                  align="start"
                >
                  <AddPropertyForm
                    onAdd={(name, type) => onCreateProperty({ name, type })}
                    onClose={() => setAddingProperty(false)}
                  />
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  className="flex min-h-10 min-w-10 items-center justify-center rounded-sm border-0 bg-transparent text-text-muted hover:bg-surface-hover hover:text-text"
                  aria-label="Add property"
                  title="Add property"
                  data-testid="add-property-btn"
                  onClick={() => setAddingProperty(true)}
                >
                  <Plus size={14} aria-hidden />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rowPages.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border hover:bg-surface-hover/50"
              data-testid="database-row"
              data-row-id={row.id}
            >
              {/* Title cell */}
              <td className="border-r border-border p-0">
                <button
                  type="button"
                  className="flex min-h-[40px] w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-text hover:text-blue-fg"
                  onClick={() => onSelectRow(row.id)}
                  data-testid="row-title-cell"
                >
                  <span className="font-emoji text-xs" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="truncate">{row.title}</span>
                </button>
              </td>
              {/* One cell per property */}
              {properties.map((prop) => {
                const cellValue = valuesMap.get(row.id)?.get(prop.id) ?? null;
                return (
                  <td key={prop.id} className="border-r border-border p-0">
                    <CellEditor
                      property={prop}
                      rowPageId={row.id}
                      value={cellValue}
                      onSave={(v) =>
                        onSetValue({ rowPageId: row.id, propertyId: prop.id, value: v })
                      }
                      onUpdateOptions={(p, options) => {
                        onUpdateProperty(p, { options });
                        // Return the last option as the newly created one (appended by the caller).
                        return options[options.length - 1] ?? null;
                      }}
                    />
                  </td>
                );
              })}
              {/* Row action menu cell */}
              <td className="w-10 p-0">
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-10 min-w-10 items-center justify-center rounded-sm border-0 bg-transparent text-transparent hover:text-text-muted"
                      aria-label={`Actions for ${row.title}`}
                    >
                      <Ellipsis size={14} aria-hidden />
                    </button>
                  }
                  align="end"
                >
                  <DropdownMenuItem onSelect={() => onSelectRow(row.id)}>
                    Open row page
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="danger"
                    data-testid="delete-row"
                    onSelect={() => setPendingDeleteRow(row)}
                  >
                    <Trash2 size={14} aria-hidden />
                    Delete row
                  </DropdownMenuItem>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add row */}
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-2 border-b border-border px-3 text-sm text-text-muted hover:bg-surface-hover hover:text-text"
        data-testid="add-row-btn"
        onClick={onCreateRow}
      >
        <Plus size={14} aria-hidden />
        New row
      </button>

      {pendingDeleteRow ? (
        <ConfirmDialog
          title={`Delete "${pendingDeleteRow.title}"?`}
          lines={[
            'This will permanently delete the row, its content, and all its property values.',
            'Deletion is permanent — there is no trash.',
          ]}
          confirmLabel="Delete permanently"
          onConfirm={() => {
            const row = pendingDeleteRow;
            setPendingDeleteRow(null);
            onDeleteRow(row);
          }}
          onCancel={() => setPendingDeleteRow(null)}
        />
      ) : null}
    </div>
  );
}

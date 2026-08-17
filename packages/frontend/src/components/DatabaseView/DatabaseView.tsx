import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { CellEditor } from '../CellEditor/CellEditor';
import { Popover } from '../ui/Popover/Popover';
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu/DropdownMenu';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '../../lib/cn';
import { OPTION_COLORS } from '../../api/types';
import type { OptionColor } from '../../api/types';
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
  /**
   * Creates a row and returns its id (or null on failure) so the table can switch the title cell
   * into inline rename mode without navigating away (ADV-044).
   */
  onCreateRow: () => Promise<string | null>;
  onDeleteRow: (row: PageRecord) => void;
  onCreateProperty: (args: { name: string; type: PropertyType; options?: SelectOption[] }) => void;
  /**
   * Persists a property change. Returns null on success or the rejection reason on failure.
   * The options-update path uses the return value to surface inline errors in the OptionsEditor
   * without closing the dialog (DEF-079).
   */
  onUpdateProperty: (
    property: PropertyRecord,
    changes: { name?: string; options?: SelectOption[] },
  ) => Promise<string | null>;
  onDeleteProperty: (property: PropertyRecord) => void;
  onSetValue: (args: { rowPageId: string; propertyId: string; value: string | null }) => void;
  /** Renames a row in-place; called after the inline title input commits (ADV-044). */
  onRenameRow?: (row: PageRecord, title: string) => void;
  /**
   * Total row count before any filter is applied. Used to distinguish a genuinely empty database
   * ("no rows yet") from filtered-to-empty ("no rows match filters") (DEF-085).
   */
  totalRowCount?: number;
}

// ---------- Color swatch classes (higher opacity for the picker so swatches are distinguishable
//            in dark theme — the chip classes use bg-amber/20 which is nearly invisible; ADV-043) ----------

const COLOR_SWATCH_CLASS: Record<OptionColor, string> = {
  gray: 'bg-border',
  amber: 'bg-amber/70',
  blue: 'bg-blue/70',
  purple: 'bg-purple/70',
  teal: 'bg-teal/70',
  rose: 'bg-rose/70',
};

// ---------- Options editor ----------

interface OptionsEditorProps {
  property: PropertyRecord;
  /**
   * Submits the updated options array. Returns null on success or the server rejection reason
   * on failure so the editor can show an inline error and stay open (DEF-079).
   */
  onSave: (options: SelectOption[]) => Promise<string | null>;
  onClose: () => void;
  /**
   * How many rows currently use each option id. Before removing an option that is in use the
   * editor shows a confirmation dialog (DEF-048).
   */
  optionUseCounts?: Map<string, number>;
}

/** Floating editor for managing select/multiSelect options: add, rename, recolor, remove. */
function OptionsEditor({ property, onSave, onClose, optionUseCounts }: OptionsEditorProps) {
  const [options, setOptions] = useState<SelectOption[]>(() => [...property.options]);
  const [newName, setNewName] = useState('');
  // Id of the option pending removal confirmation (DEF-048).
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  // Whether the color picker is open for a given option id.
  const [pickerOpenId, setPickerOpenId] = useState<string | null>(null);
  // Inline validation error shown when an option name would be rejected by the server (DEF-079).
  const [validationError, setValidationError] = useState<string | null>(null);

  // MAX_OPTION_NAME_LENGTH mirrors the server-enforced limit so we catch errors client-side and
  // never lose a good batch of edits because one name is invalid (DEF-079).
  const MAX_OPTION_NAME_LENGTH = 100;

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

  // Called after the user either confirms removal or when the option is unused.
  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
    setPendingRemoveId(null);
  };

  const requestRemove = (opt: SelectOption) => {
    const useCount = optionUseCounts?.get(opt.id) ?? 0;
    if (useCount > 0) {
      // Defer removal behind a confirmation dialog so the user knows cells will be cleared (DEF-048).
      setPendingRemoveId(opt.id);
    } else {
      removeOption(opt.id);
    }
  };

  const pendingOpt = pendingRemoveId ? options.find((o) => o.id === pendingRemoveId) : null;
  const pendingUseCount = pendingRemoveId ? (optionUseCounts?.get(pendingRemoveId) ?? 0) : 0;

  return (
    <>
      <div className="flex min-w-[240px] flex-col gap-1 p-2">
        <p className="px-1 text-xs font-medium text-text-muted">Manage options</p>
        {options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-1.5">
            {/* Color picker: shows all 6 colors as swatches (ADV-043). Each swatch uses a higher
                opacity so they are distinguishable in dark theme. */}
            <Popover
              open={pickerOpenId === opt.id}
              onOpenChange={(v) => setPickerOpenId(v ? opt.id : null)}
              trigger={
                <button
                  type="button"
                  aria-label={`Pick color for ${opt.name}`}
                  className={cn(
                    'size-5 min-w-5 cursor-pointer rounded-full border-2 border-border/50 transition-transform hover:scale-110',
                    COLOR_SWATCH_CLASS[opt.color],
                  )}
                />
              }
            >
              <div className="flex gap-1 p-1.5">
                {OPTION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    className={cn(
                      'size-6 cursor-pointer rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                      COLOR_SWATCH_CLASS[c],
                      opt.color === c ? 'scale-110 border-text' : 'border-transparent',
                    )}
                    onClick={() => {
                      updateOption(opt.id, { color: c });
                      setPickerOpenId(null);
                    }}
                  />
                ))}
              </div>
            </Popover>
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
              onClick={() => requestRemove(opt)}
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
          {/* Disabled when the input is empty so the user has a clear signal before clicking (ADV-035). */}
          <button
            type="button"
            disabled={newName.trim() === ''}
            className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={addOption}
          >
            Add
          </button>
        </div>
        {/* Inline validation message: shown when an option name violates server rules (DEF-079). */}
        {validationError && (
          <p className="mt-0.5 text-xs text-danger" role="alert">
            {validationError}
          </p>
        )}
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
            onClick={() => {
              // Validate all option names client-side before submitting, so a single bad name
              // does not silently discard the whole batch of valid edits (DEF-079).
              const emptyOpt = options.find((o) => !o.name.trim());
              if (emptyOpt) {
                setValidationError('Option names cannot be empty.');
                return;
              }
              const longOpt = options.find((o) => o.name.trim().length > MAX_OPTION_NAME_LENGTH);
              if (longOpt) {
                setValidationError(
                  `Option names must be ${MAX_OPTION_NAME_LENGTH} characters or fewer.`,
                );
                return;
              }
              setValidationError(null);
              // Await the server result: if the server rejects (e.g. a duplicate option name),
              // stay open and show the reason inline rather than silently discarding (DEF-079).
              void onSave(options).then((reason) => {
                if (reason !== null) {
                  setValidationError(reason);
                }
              });
            }}
          >
            Save
          </button>
        </div>
      </div>

      {pendingOpt ? (
        <ConfirmDialog
          title={`Remove "${pendingOpt.name}"?`}
          lines={[
            `${pendingUseCount} ${pendingUseCount === 1 ? 'row uses' : 'rows use'} this option. Removing it will clear ${pendingUseCount === 1 ? 'that cell' : 'those cells'} permanently.`,
            'This cannot be undone.',
          ]}
          confirmLabel="Remove option"
          onConfirm={() => removeOption(pendingOpt.id)}
          onCancel={() => setPendingRemoveId(null)}
        />
      ) : null}
    </>
  );
}

// ---------- Property header menu ----------

interface PropertyHeaderMenuProps {
  property: PropertyRecord;
  onRename: (name: string) => void;
  onDelete: () => void;
  /**
   * Persists updated options. Returns null on success or the rejection reason on failure so
   * the OptionsEditor can surface it inline (DEF-079).
   */
  onManageOptions?: (options: SelectOption[]) => Promise<string | null>;
  /** How many rows use each option id (passed through for the OptionsEditor confirm guard). */
  optionUseCounts?: Map<string, number>;
}

/**
 * The column header button and its context menu. The menu floats in a Popover so that the
 * OptionsEditor panel does not expand the `<th>` element when the user opens it (ADV-046).
 */
function PropertyHeaderMenu({
  property,
  onRename,
  onDelete,
  onManageOptions,
  optionUseCounts,
}: PropertyHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(property.name);
  const [managingOptions, setManagingOptions] = useState(false);

  // Inline rename input renders in the <th> (not the popover) to keep it stable while typing.
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

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Close the options editor when the popover closes so it resets on next open.
        if (!v) setManagingOptions(false);
      }}
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
    >
      {/* The popover content switches between the menu-items view and the OptionsEditor. This
          keeps OptionsEditor floating over the table rather than expanding the <th> (ADV-046). */}
      {managingOptions && onManageOptions ? (
        <OptionsEditor
          property={property}
          optionUseCounts={optionUseCounts}
          onSave={async (options) => {
            // Pass the result through — null means success (close the dialog), a string is a
            // rejection reason that OptionsEditor will display inline (DEF-079).
            const reason = await onManageOptions(options);
            if (reason === null) {
              setManagingOptions(false);
              setOpen(false);
            }
            return reason;
          }}
          onClose={() => {
            setManagingOptions(false);
            setOpen(false);
          }}
        />
      ) : (
        <div className="flex min-w-[160px] flex-col gap-0.5 p-1">
          <button
            type="button"
            className="flex min-h-10 w-full items-center rounded-sm px-2.5 py-1.5 text-sm text-text hover:bg-surface-hover"
            onClick={() => {
              setOpen(false);
              // Defer so focus returns before the input mounts (same pattern as the sidebar).
              setTimeout(() => setRenaming(true), 0);
            }}
          >
            Rename
          </button>
          {property.type === 'select' || property.type === 'multiSelect' ? (
            <button
              type="button"
              className="flex min-h-10 w-full items-center rounded-sm px-2.5 py-1.5 text-sm text-text hover:bg-surface-hover"
              onClick={() => setManagingOptions(true)}
            >
              Manage options
            </button>
          ) : null}
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm text-danger hover:bg-danger/10"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={14} aria-hidden />
            Delete property
          </button>
        </div>
      )}
    </Popover>
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
          disabled={name.trim() === ''}
          className="min-h-9 rounded-sm bg-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
  onRenameRow,
  totalRowCount,
}: DatabaseViewProps) {
  const [pendingDeleteRow, setPendingDeleteRow] = useState<PageRecord | null>(null);
  const [pendingDeleteProperty, setPendingDeleteProperty] = useState<PropertyRecord | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  // Tracks which row has its title in inline-rename mode after being created in place (ADV-044).
  const [renamingRowId, setRenamingRowId] = useState<string | null>(null);

  // Build a lookup: rowPageId → propertyId → raw JSON value string
  const valuesMap = useMemo(() => {
    const map = new Map<string, Map<string, string | null>>();
    for (const v of values) {
      if (!map.has(v.rowPageId)) map.set(v.rowPageId, new Map());
      map.get(v.rowPageId)!.set(v.propertyId, v.value);
    }
    return map;
  }, [values]);

  // For each property, build a Map<optionId, useCount> so the OptionsEditor can guard destructive
  // removals with a confirmation when rows still hold that value (DEF-048).
  const optionUseCountsByProperty = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const prop of properties) {
      if (prop.type !== 'select' && prop.type !== 'multiSelect') continue;
      const counts = new Map<string, number>();
      for (const row of rowPages) {
        const raw = valuesMap.get(row.id)?.get(prop.id) ?? null;
        if (!raw) continue;
        try {
          if (prop.type === 'select') {
            const id = JSON.parse(raw) as string;
            counts.set(id, (counts.get(id) ?? 0) + 1);
          } else {
            const ids = JSON.parse(raw) as string[];
            for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        } catch {
          // Malformed value: skip rather than crashing the table.
        }
      }
      result.set(prop.id, counts);
    }
    return result;
  }, [properties, rowPages, valuesMap]);

  // Ref for the rename input in inline-row-create mode, so we can focus it programmatically.
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleCreateRow = async () => {
    const rowId = await onCreateRow();
    if (rowId) {
      setRenamingRowId(rowId);
      // The input mounts after the snapshot re-reads (onCreateRow invalidates the query), so
      // autoFocus handles the focus; this ref is a belt-and-suspenders fallback.
      requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  };

  return (
    <div className="w-full overflow-x-auto" data-testid="database-view">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            {/* Title column — min-w-[160px] balances readability and desktop fit (DEF-042):
                 with 6 properties at 120px each, 1 title at 160px, and 40px actions the
                 table minimum (920px) fits within the ~956px content area at 1280x800. */}
            <th className="min-w-[160px] border-r border-border">
              <span className="block px-3 py-2 text-left text-xs font-semibold tracking-wide text-text-muted uppercase">
                Title
              </span>
            </th>
            {/* One header per property — min-w-[120px] instead of 140px to allow all seeded
                 columns to fit at 1280x800 once the 860px prose cap is lifted (DEF-042). */}
            {properties.map((prop) => (
              <th key={prop.id} className="min-w-[120px] border-r border-border">
                <PropertyHeaderMenu
                  property={prop}
                  optionUseCounts={optionUseCountsByProperty.get(prop.id)}
                  onRename={(name) => onUpdateProperty(prop, { name })}
                  onDelete={() => setPendingDeleteProperty(prop)}
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
          {/* Empty state: distinguish a genuinely empty database from a filtered-to-empty one (DEF-085). */}
          {rowPages.length === 0 && (
            <tr>
              <td
                colSpan={properties.length + 2}
                className="py-8 text-center text-sm text-text-muted"
              >
                {totalRowCount === 0
                  ? 'This database is empty. Add a row to get started.'
                  : 'No rows match the current filters.'}
              </td>
            </tr>
          )}
          {rowPages.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border hover:bg-surface-hover/50"
              data-testid="database-row"
              data-row-id={row.id}
            >
              {/* Title cell — max-w-0 prevents a long title from expanding the column beyond
                   the TH's min-w-[160px]; overflow-hidden clips the render at the column edge. */}
              <td className="max-w-0 overflow-hidden border-r border-border p-0">
                {row.id === renamingRowId ? (
                  // Inline rename input: shown immediately after in-place row creation (ADV-044).
                  <input
                    ref={renameInputRef}
                    type="text"
                    autoFocus
                    aria-label={`Name for new row`}
                    className="flex min-h-[40px] w-full border-0 border-b-2 border-blue bg-surface/60 px-3 py-2 text-sm font-medium text-text focus:outline-none"
                    defaultValue={row.title}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault();
                        const title = (e.currentTarget as HTMLInputElement).value.trim();
                        if (title && title !== row.title) onRenameRow?.(row, title);
                        setRenamingRowId(null);
                      }
                    }}
                    onBlur={(e) => {
                      const title = e.currentTarget.value.trim();
                      if (title && title !== row.title) onRenameRow?.(row, title);
                      setRenamingRowId(null);
                    }}
                  />
                ) : (
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
                )}
              </td>
              {/* One cell per property — max-w-0 prevents any cell (e.g. a URL column with a long
                   value) from widening the column past the TH's min-w-[120px] (DEF-042). */}
              {properties.map((prop) => {
                const cellValue = valuesMap.get(row.id)?.get(prop.id) ?? null;
                return (
                  <td key={prop.id} className="max-w-0 overflow-hidden border-r border-border p-0">
                    <CellEditor
                      property={prop}
                      rowPageId={row.id}
                      value={cellValue}
                      onSave={(v) =>
                        onSetValue({ rowPageId: row.id, propertyId: prop.id, value: v })
                      }
                      onUpdateOptions={(p, options) => {
                        onUpdateProperty(p, { options });
                        // Return the last option — the caller appended the new one — so SelectCell
                        // can select it immediately.
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
                      <span aria-hidden className="text-inherit">
                        •••
                      </span>
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

      {/* Add row — creates in place without navigating (ADV-044). */}
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-2 border-b border-border px-3 text-sm text-text-muted hover:bg-surface-hover hover:text-text"
        data-testid="add-row-btn"
        onClick={() => void handleCreateRow()}
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

      {pendingDeleteProperty ? (
        <ConfirmDialog
          title={`Delete property "${pendingDeleteProperty.name}"?`}
          lines={[
            `This will permanently remove the "${pendingDeleteProperty.name}" column and all its values across every row.`,
            'Deletion is permanent — there is no trash.',
          ]}
          confirmLabel="Delete permanently"
          onConfirm={() => {
            const prop = pendingDeleteProperty;
            setPendingDeleteProperty(null);
            onDeleteProperty(prop);
          }}
          onCancel={() => setPendingDeleteProperty(null)}
        />
      ) : null}
    </div>
  );
}

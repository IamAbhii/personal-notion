import { useCallback, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { X } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { cn } from '../../lib/cn';
import { optionColorClass } from '../../lib/optionColors';
import { OPTION_COLORS } from '../../api/types';
import type { PropertyRecord, PropertyType, SelectOption } from '../../api/types';

// Cell editors: one per property type. Each receives the raw JSON-string value (or null) and
// calls onSave with the new JSON-encoded value, or null to clear.
// Future: inline validation feedback, read-only mode for archived rows.

/** Props shared by every cell editor variant. */
export interface CellEditorProps {
  property: PropertyRecord;
  rowPageId: string;
  /** The raw JSON-encoded value from the snapshot, or null for an empty cell. */
  value: string | null;
  onSave: (jsonValue: string | null) => void;
  /** Whether the cell is being rendered inside the properties panel (row page) vs. the table. */
  variant?: 'table' | 'panel';
}

// ---------- Value codec helpers ----------

/** Parses the stored JSON string safely. Returns undefined on any error. */
function parseValue<T>(raw: string | null): T | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** JSON-encodes a typed value. Returns null when the value is empty/falsy in a meaningful way. */
function encodeText(v: string): string | null {
  return v.trim() === '' ? null : JSON.stringify(v);
}
function encodeNumber(v: string): string | null {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) ? null : JSON.stringify(n);
}
function encodeSelect(id: string | null): string | null {
  return id === null ? null : JSON.stringify(id);
}
function encodeMultiSelect(ids: string[]): string | null {
  return ids.length === 0 ? null : JSON.stringify(ids);
}
function encodeDate(d: Date | undefined): string | null {
  if (!d) return null;
  // Store as YYYY-MM-DD in the local timezone, never UTC midnight, which can drift a day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return JSON.stringify(`${y}-${m}-${day}`);
}
function encodeCheckbox(v: boolean): string {
  return JSON.stringify(v);
}
function encodeUrl(v: string): string | null {
  return v.trim() === '' ? null : JSON.stringify(v);
}

/** Parses a YYYY-MM-DD string into a local-timezone Date, or returns undefined. */
function parseDateString(raw: string | null): Date | undefined {
  const s = parseValue<string>(raw);
  if (!s) return undefined;
  const parts = s.split('-');
  if (parts.length !== 3) return undefined;
  // Parse each part individually to avoid tuple-element undefined in strict mode.
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Formats a YYYY-MM-DD string for display, e.g. "1 Sep 2026". */
function formatDate(raw: string | null): string {
  const d = parseDateString(raw);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Ensures a URL has a scheme; prefixes https:// when none is present. */
function ensureScheme(url: string): string {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ---------- Base classes ----------

const inputBase =
  'w-full rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted/60 focus:border-blue focus:bg-surface focus:outline-none min-h-[40px]';

// ---------- Text cell ----------

function TextCell({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(() => parseValue<string>(value) ?? '');
  return (
    <input
      type="text"
      className={inputBase}
      value={draft}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(encodeText(draft))}
    />
  );
}

// ---------- Number cell ----------

function NumberCell({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [draft, setDraft] = useState(() => {
    const n = parseValue<number>(value);
    return n !== undefined ? String(n) : '';
  });
  return (
    <input
      type="number"
      className={inputBase}
      value={draft}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(encodeNumber(draft))}
    />
  );
}

// ---------- Select cell ----------

interface SelectCellProps {
  value: string | null;
  options: SelectOption[];
  onSave: (v: string | null) => void;
  onCreateOption: (name: string) => SelectOption | null;
}

function SelectCell({ value, options, onSave, onCreateOption }: SelectCellProps) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const selectedId = parseValue<string>(value);
  const selected = options.find((o) => o.id === selectedId);

  const pick = (id: string | null) => {
    onSave(encodeSelect(id));
    setOpen(false);
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const opt = onCreateOption(name);
    if (opt) {
      onSave(encodeSelect(opt.id));
      setOpen(false);
    }
    setNewName('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="flex min-h-[40px] w-full cursor-pointer items-center rounded-sm border border-transparent px-2 py-1.5 text-sm hover:border-blue/40 hover:bg-surface focus:border-blue focus:bg-surface focus:outline-none"
        >
          {selected ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                optionColorClass(selected.color),
              )}
            >
              {selected.name}
            </span>
          ) : (
            <span className="text-text-muted/60">Select...</span>
          )}
        </button>
      }
    >
      <div className="flex min-w-[180px] flex-col gap-0.5 p-1">
        {selected ? (
          <button
            type="button"
            className="flex min-h-10 items-center rounded-sm px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={() => pick(null)}
          >
            <X size={12} className="mr-2 flex-none" aria-hidden />
            Clear
          </button>
        ) : null}
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="flex min-h-10 items-center rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover"
            onClick={() => pick(opt.id)}
          >
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                optionColorClass(opt.color),
              )}
            >
              {opt.name}
            </span>
          </button>
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
                handleCreate();
              }
            }}
          />
          <button
            type="button"
            className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20"
            onClick={handleCreate}
          >
            Add
          </button>
        </div>
      </div>
    </Popover>
  );
}

// ---------- MultiSelect cell ----------

interface MultiSelectCellProps {
  value: string | null;
  options: SelectOption[];
  onSave: (v: string | null) => void;
  onCreateOption: (name: string) => SelectOption | null;
}

function MultiSelectCell({ value, options, onSave, onCreateOption }: MultiSelectCellProps) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const selectedIds = parseValue<string[]>(value) ?? [];

  const toggle = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    onSave(encodeMultiSelect(next));
  };

  const remove = (id: string) => {
    onSave(encodeMultiSelect(selectedIds.filter((s) => s !== id)));
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const opt = onCreateOption(name);
    if (opt) {
      onSave(encodeMultiSelect([...selectedIds, opt.id]));
    }
    setNewName('');
  };

  const selectedOptions = selectedIds
    .map((id) => options.find((o) => o.id === id))
    .filter(Boolean) as SelectOption[];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="flex min-h-[40px] w-full cursor-pointer flex-wrap items-center gap-1 rounded-sm border border-transparent px-2 py-1.5 text-sm hover:border-blue/40 hover:bg-surface focus:border-blue focus:bg-surface focus:outline-none"
        >
          {selectedOptions.length > 0 ? (
            selectedOptions.map((opt) => (
              <span
                key={opt.id}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
                  optionColorClass(opt.color),
                )}
              >
                {opt.name}
                <span
                  role="button"
                  aria-label={`Remove ${opt.name}`}
                  tabIndex={0}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-black/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(opt.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(opt.id);
                    }
                  }}
                >
                  <X size={10} aria-hidden />
                </span>
              </span>
            ))
          ) : (
            <span className="text-text-muted/60">Select...</span>
          )}
        </button>
      }
    >
      <div className="flex min-w-[200px] flex-col gap-0.5 p-1">
        {options.map((opt) => {
          const isSelected = selectedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={cn(
                'flex min-h-10 items-center rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover',
                isSelected && 'bg-surface-hover',
              )}
              onClick={() => toggle(opt.id)}
            >
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  optionColorClass(opt.color),
                )}
              >
                {opt.name}
              </span>
              {isSelected ? (
                <span className="ml-auto text-xs text-text-muted" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
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
                handleCreate();
              }
            }}
          />
          <button
            type="button"
            className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20"
            onClick={handleCreate}
          >
            Add
          </button>
        </div>
      </div>
    </Popover>
  );
}

// ---------- Date cell ----------

function DateCell({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseDateString(value);
  const display = formatDate(value);

  const handleSelect = (date: Date | undefined) => {
    onSave(encodeDate(date));
    if (date) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="flex min-h-[40px] w-full cursor-pointer items-center justify-between rounded-sm border border-transparent px-2 py-1.5 text-sm hover:border-blue/40 hover:bg-surface focus:border-blue focus:bg-surface focus:outline-none"
        >
          {display ? (
            <span className="text-text">{display}</span>
          ) : (
            <span className="text-text-muted/60">Pick a date...</span>
          )}
          {display ? (
            <button
              type="button"
              aria-label="Clear date"
              className="ml-1 cursor-pointer rounded-full p-0.5 text-text-muted hover:text-text"
              onClick={(e) => {
                e.stopPropagation();
                onSave(null);
              }}
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </button>
      }
    >
      {/* DayPicker styled with project tokens via classNames. No default CSS import needed. */}
      <div className="p-2">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          classNames={{
            root: 'text-sm',
            month_caption: 'flex items-center justify-between px-1 pb-2 font-medium text-text',
            nav: 'flex items-center gap-1',
            button_previous:
              'flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-muted hover:bg-surface-hover hover:text-text',
            button_next:
              'flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-muted hover:bg-surface-hover hover:text-text',
            month_grid: 'w-full border-collapse',
            weekdays: '',
            weekday: 'py-1 text-center text-xs font-medium text-text-muted',
            week: '',
            day: 'p-0',
            day_button:
              'flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-sm text-text hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-blue',
            today: 'text-blue font-semibold',
            selected: '[&>button]:bg-blue [&>button]:text-white [&>button]:hover:bg-blue',
            outside: 'opacity-30',
            disabled: 'opacity-30 cursor-not-allowed',
          }}
        />
      </div>
    </Popover>
  );
}

// ---------- Checkbox cell ----------

function CheckboxCell({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const checked = parseValue<boolean>(value) ?? false;
  // relative makes this label the containing block for the sr-only span (position:absolute in
  // Tailwind's sr-only), preventing it from escaping to the initial containing block and thus
  // overflowing the document when the checkbox column is scrolled off the right edge of the viewport.
  return (
    <label className="relative flex min-h-[40px] cursor-pointer items-center px-2">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-blue"
        checked={checked}
        onChange={(e) => onSave(encodeCheckbox(e.target.checked))}
      />
      <span className="sr-only">{checked ? 'Checked' : 'Unchecked'}</span>
    </label>
  );
}

// ---------- URL cell ----------

function UrlCell({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => parseValue<string>(value) ?? '');
  const raw = parseValue<string>(value) ?? '';
  const href = ensureScheme(raw);

  if (!focused && raw) {
    // min-w-0 lets the anchor shrink below its URL text width so the table column stays
    // at the TH-defined minimum rather than expanding to fit the raw URL (DEF-042).
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[40px] min-w-0 items-center overflow-hidden px-2 py-1.5 text-sm text-blue-fg underline hover:opacity-80"
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setFocused(true)}
      >
        <span className="truncate">{raw}</span>
      </a>
    );
  }

  return (
    <input
      type="url"
      className={inputBase}
      value={draft}
      placeholder="https://example.com"
      autoFocus={focused}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onSave(encodeUrl(draft));
      }}
    />
  );
}

// ---------- Option creation helper ----------

/** Chooses the next color from the palette in round-robin order for a new option. */
function nextOptionColor(existing: SelectOption[]): (typeof OPTION_COLORS)[number] {
  // The modulo always stays in-bounds, but TypeScript's indexed-access type widens to T|undefined
  // for plain arrays, so we provide a fallback that will never be reached at runtime.
  return OPTION_COLORS[existing.length % OPTION_COLORS.length] ?? 'gray';
}

// ---------- Main dispatcher ----------

/**
 * Routes to the correct cell editor based on the property type. The caller passes the raw JSON
 * value string and a save callback that receives the new JSON string (or null).
 *
 * `onUpdateOptions` is called when the user creates an option inline; the caller must persist it
 * and return the newly created option so the select cell can select it immediately.
 */
export function CellEditor({
  property,
  value,
  onSave,
  onUpdateOptions,
  // rowPageId accepted via CellEditorProps but not consumed in this layer; callers supply it for
  // future per-row draft storage and context propagation.
}: CellEditorProps & {
  /** Persists a new option and returns it so the cell can select it immediately. */
  onUpdateOptions?: (property: PropertyRecord, options: SelectOption[]) => SelectOption | null;
}) {
  const makeOption = useCallback(
    (name: string): SelectOption | null => {
      const opt: SelectOption = {
        id: crypto.randomUUID(),
        name,
        color: nextOptionColor(property.options),
      };
      return onUpdateOptions ? onUpdateOptions(property, [...property.options, opt]) : null;
    },
    [property, onUpdateOptions],
  );

  const type: PropertyType = property.type;

  if (type === 'text') return <TextCell value={value} onSave={onSave} />;
  if (type === 'number') return <NumberCell value={value} onSave={onSave} />;
  if (type === 'select') {
    return (
      <SelectCell
        value={value}
        options={property.options}
        onSave={onSave}
        onCreateOption={makeOption}
      />
    );
  }
  if (type === 'multiSelect') {
    return (
      <MultiSelectCell
        value={value}
        options={property.options}
        onSave={onSave}
        onCreateOption={makeOption}
      />
    );
  }
  if (type === 'date') return <DateCell value={value} onSave={onSave} />;
  if (type === 'checkbox') return <CheckboxCell value={value} onSave={onSave} />;
  if (type === 'url') return <UrlCell value={value} onSave={onSave} />;

  // Unknown type: render nothing, so a future type addition degrades gracefully.
  return null;
}

import { useCallback, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Pencil, X } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { cn } from '../../lib/cn';
import { optionColorClass } from '../../lib/optionColors';
import { OPTION_COLORS } from '../../api/types';
import type { PropertyRecord, PropertyType, SelectOption } from '../../api/types';
import styles from './CellEditor.module.css';

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

/**
 * Returns true only when the stored value looks like a navigable URL. Bare text with spaces or
 * no TLD is not linkified, so a non-URL value is displayed as plain text rather than a broken
 * link (ADV-033).
 */
function isLikelyUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Strings with spaces are not URLs.
  if (/\s/.test(trimmed)) return false;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    // Require at least one dot in the hostname so bare words are not treated as URLs.
    return parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Formats a stored number for display with at most 10 significant figures (ADV-052). */
function formatNumberForDisplay(raw: string | null): string {
  const n = parseValue<number>(raw);
  if (n === undefined) return '';
  // Integer values render without decimal places; floats are rounded to 10 significant figures
  // to avoid printing raw 64-bit float noise (e.g. 528.7752545877175 → 528.7752546).
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toPrecision(10)).toString();
}

// ---------- Base classes ----------

const inputBase =
  'w-full rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted/60 focus:border-blue focus:bg-surface focus:outline-none min-h-[40px]';

// ---------- Text cell ----------

function TextCell({
  value,
  onSave,
  label,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(() => parseValue<string>(value) ?? '');
  // Track the value at the time the user focused so Escape can revert correctly (ADV-034).
  const revertTo = useRef(draft);

  return (
    <input
      type="text"
      aria-label={label}
      className={inputBase}
      value={draft}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        revertTo.current = parseValue<string>(value) ?? '';
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSave(encodeText(draft));
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(revertTo.current);
        }
      }}
      onBlur={() => onSave(encodeText(draft))}
    />
  );
}

// ---------- Number cell ----------

function NumberCell({
  value,
  onSave,
  label,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  label: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  // Track the value at focus time for Escape revert (ADV-034).
  const revertTo = useRef('');

  // When not focused, show the formatted stored value; when focused, show the draft string.
  const displayValue = focused ? draft : formatNumberForDisplay(value);

  return (
    <input
      // type="text" with inputMode="decimal" lets us control displayed formatting (ADV-052).
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={inputBase}
      value={displayValue}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        const n = parseValue<number>(value);
        const raw = n !== undefined ? String(n) : '';
        revertTo.current = raw;
        setDraft(raw);
        setFocused(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setFocused(false);
          onSave(encodeNumber(draft));
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setFocused(false);
          setDraft(revertTo.current);
        }
      }}
      onBlur={() => {
        setFocused(false);
        onSave(encodeNumber(draft));
      }}
    />
  );
}

// ---------- Select cell ----------

interface SelectCellProps {
  value: string | null;
  options: SelectOption[];
  onSave: (v: string | null) => void;
  onCreateOption: (name: string) => SelectOption | null;
  label: string;
}

function SelectCell({ value, options, onSave, onCreateOption, label }: SelectCellProps) {
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

  const accessibleLabel = selected ? `${label}: ${selected.name}` : `${label}: Empty`;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          aria-label={accessibleLabel}
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
      {/* max-h caps the list so 50 options do not render a 2000px popover (ADV-040). */}
      <div className="flex min-w-[180px] flex-col gap-0.5 p-1">
        <div className="max-h-[320px] overflow-y-auto">
          {selected ? (
            <button
              type="button"
              className="flex min-h-10 w-full items-center rounded-sm px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
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
              className="flex min-h-10 w-full items-center rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover"
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
        </div>
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
          {/* Disabled when input is empty to give feedback (ADV-035/036). */}
          <button
            type="button"
            disabled={newName.trim() === ''}
            className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20 disabled:cursor-not-allowed disabled:opacity-40"
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
  label: string;
}

function MultiSelectCell({ value, options, onSave, onCreateOption, label }: MultiSelectCellProps) {
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

  const chipsLabel =
    selectedOptions.length > 0
      ? `${label}: ${selectedOptions.map((o) => o.name).join(', ')}`
      : `${label}: Empty`;

  // The cell area is a div, not a button, so chip remove buttons are siblings rather than nested
  // interactive elements (ADV-042). Radix Popover.Trigger asChild transfers its click/keydown
  // onto this div; stopPropagation on chip remove buttons prevents the popover from opening
  // when the user clicks to remove a chip.
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <div
          role="button"
          tabIndex={0}
          aria-label={chipsLabel}
          aria-expanded={open}
          className="flex min-h-[40px] w-full cursor-pointer flex-wrap items-center gap-1 rounded-sm border border-transparent px-2 py-1.5 text-sm hover:border-blue/40 hover:bg-surface focus:border-blue focus:bg-surface focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
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
                <span>{opt.name}</span>
                {/* Real button, sibling of the chip text span — not nested inside the Popover
                    trigger button — so Enter activates remove, not the picker (ADV-042). */}
                <button
                  type="button"
                  aria-label={`Remove ${opt.name}`}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-black/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(opt.id);
                  }}
                  onKeyDown={(e) => {
                    // Prevent the keydown from bubbling to the Popover trigger div.
                    e.stopPropagation();
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      remove(opt.id);
                    }
                  }}
                >
                  <X size={10} aria-hidden />
                </button>
              </span>
            ))
          ) : (
            <span className="text-text-muted/60">Select...</span>
          )}
        </div>
      }
    >
      {/* max-h caps the list so 50 options do not render a 2000px popover (ADV-040). */}
      <div className="flex min-w-[200px] flex-col gap-0.5 p-1">
        <div className="max-h-[320px] overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                className={cn(
                  'flex min-h-10 w-full items-center rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover',
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
        </div>
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
          {/* Disabled when input is empty to give feedback (ADV-035/036). */}
          <button
            type="button"
            disabled={newName.trim() === ''}
            className="min-h-9 rounded-sm bg-blue/10 px-2 py-1 text-xs font-medium text-blue-fg hover:bg-blue/20 disabled:cursor-not-allowed disabled:opacity-40"
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

function DateCell({
  value,
  onSave,
  label,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateString(value);
  const display = formatDate(value);

  const handleSelect = (date: Date | undefined) => {
    onSave(encodeDate(date));
    if (date) setOpen(false);
  };

  const accessibleLabel = display ? `${label}: ${display}` : `${label}: Empty`;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          aria-label={accessibleLabel}
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
      {/* DayPicker styled with project tokens via classNames. No default CSS import needed.
          defaultMonth opens on the stored date's month so the user sees the current value (ADV-041). */}
      <div className="p-2">
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected}
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
  label,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  label: string;
}) {
  const checked = parseValue<boolean>(value) ?? false;
  // relative makes this label the containing block for the sr-only span (position:absolute in
  // Tailwind's sr-only), preventing it from escaping to the initial containing block and thus
  // overflowing the document when the checkbox column is scrolled off the right edge of the viewport.
  return (
    <label className="relative flex min-h-[40px] cursor-pointer items-center px-2">
      {/* appearance-none + token-based classes: the native unchecked checkbox renders white in dark
          theme (ADV-053). The module provides the checked background-image (checkmark SVG) which
          cannot be expressed as a Tailwind utility. */}
      <input
        type="checkbox"
        aria-label={label}
        className={cn(
          'size-4 cursor-pointer rounded-sm border-2 border-text-muted/50 bg-surface checked:border-blue checked:bg-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue',
          styles.checkbox,
        )}
        checked={checked}
        onChange={(e) => onSave(encodeCheckbox(e.target.checked))}
      />
      <span className="sr-only">{checked ? 'Checked' : 'Unchecked'}</span>
    </label>
  );
}

// ---------- URL cell ----------

function UrlCell({
  value,
  onSave,
  label,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => parseValue<string>(value) ?? '');
  // Track value at edit-start so Escape can revert to it (ADV-034).
  const revertTo = useRef(draft);

  const raw = parseValue<string>(value) ?? '';

  // View mode with a stored value: show anchor (if URL-like) or plain text, plus an edit button.
  // The anchor is NOT given onFocus that switches to edit mode, so clicking/tabbing to it follows
  // the link as expected (ADV-032).
  if (!editing && raw) {
    const likelyUrl = isLikelyUrl(raw);
    return (
      <div className="group/url flex min-h-[40px] min-w-0 items-center gap-1 px-2 py-1.5">
        {likelyUrl ? (
          <a
            href={ensureScheme(raw)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label}: ${raw}`}
            className="min-w-0 flex-1 overflow-hidden text-sm text-blue-fg underline hover:opacity-80"
            // stopPropagation: prevent any ancestor click handler from swallowing the navigation.
            onClick={(e) => e.stopPropagation()}
          >
            <span className="block truncate">{raw}</span>
          </a>
        ) : (
          // Non-URL value: display as plain text without linking it (ADV-033).
          <span
            className="min-w-0 flex-1 overflow-hidden text-sm text-text"
            aria-label={`${label}: ${raw}`}
          >
            <span className="block truncate">{raw}</span>
          </span>
        )}
        {/* Explicit edit button so the anchor remains followable (ADV-032). Always visible at
            narrow viewports so touch users can reach it; hidden at md+ until the row is hovered
            or focused, to avoid visual clutter in the table. */}
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className="flex-none cursor-pointer rounded-sm p-1 text-text-muted opacity-100 hover:text-text focus:opacity-100 md:opacity-0 md:group-hover/url:opacity-100"
          onClick={() => {
            revertTo.current = raw;
            setDraft(raw);
            setEditing(true);
          }}
        >
          <Pencil size={12} aria-hidden />
        </button>
      </div>
    );
  }

  // Edit mode (or no stored value): show the input.
  return (
    <input
      type="url"
      aria-label={label}
      className={inputBase}
      value={draft}
      // autoFocus only when switching from view mode; without it the input would steal focus on
      // every mount (e.g. when the cell first renders empty).
      autoFocus={editing}
      placeholder="https://example.com"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        // Sync the revert target to the latest stored value each time the input is focused.
        revertTo.current = parseValue<string>(value) ?? '';
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setEditing(false);
          onSave(encodeUrl(draft));
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setDraft(revertTo.current);
        }
      }}
      onBlur={() => {
        setEditing(false);
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
  const label = property.name;

  if (type === 'text') return <TextCell value={value} onSave={onSave} label={label} />;
  if (type === 'number') return <NumberCell value={value} onSave={onSave} label={label} />;
  if (type === 'select') {
    return (
      <SelectCell
        value={value}
        options={property.options}
        onSave={onSave}
        onCreateOption={makeOption}
        label={label}
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
        label={label}
      />
    );
  }
  if (type === 'date') return <DateCell value={value} onSave={onSave} label={label} />;
  if (type === 'checkbox') return <CheckboxCell value={value} onSave={onSave} label={label} />;
  if (type === 'url') return <UrlCell value={value} onSave={onSave} label={label} />;

  // Unknown type: render nothing, so a future type addition degrades gracefully.
  return null;
}

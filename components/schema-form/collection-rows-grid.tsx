"use client";

/**
 * Generic editable collection grids for runtime plugin collection fields
 *. Manifest-agnostic: they take plain rows + an onChange, exactly like
 * the hand-written NameValueTable, so the declarative renderer (SchemaCollectionField)
 * and any other caller can compose them. Density-aware and dark-mode; no table
 * elements (grid layout, so lint:tables does not apply).
 *
 * `CollectionRowsGrid` renders N columns and backs `map`/`multimap` (2 columns:
 * key + value) and `table` (one column per declared column element).
 * `StringListEditor` renders a single-column list and backs `stringList`.
 */

import { Plus, Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { densityHeight, type ViewDensity } from "@/lib/hooks/use-compact-mode";

/** Renderer default; connector callers pass MANIFEST_CAPS.MAX_COLLECTION_ROWS / _CELL_LENGTH. */
const DEFAULT_MAX_ROWS = 128;
const DEFAULT_MAX_CELL_LENGTH = 4096;

function cellCls(density: ViewDensity | undefined): string {
  return `${densityHeight(density ?? "default")} px-2 text-xs rounded border border-border
    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
    focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;
}

const addButtonCls = `inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded
  border border-dashed border-border text-gray-500 dark:text-gray-400
  hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
  hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors mt-0.5
  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-gray-500 disabled:hover:bg-transparent`;

const headerLabelCls =
  "text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide";

/**
 * Add-row button with a cap tooltip. The button is wrapped in a stable `<span>`
 * that is always the tooltip target: this keeps the element tree shape constant
 * across the cap boundary (so the button never remounts / drops focus) and lets
 * the "maximum rows" tooltip open even though the button itself is disabled at
 * the cap (Radix tooltips don't fire on disabled controls).
 */
function AddRowButton({
  onClick,
  atCap,
  maxRows,
  addLabel,
  disabled,
}: {
  onClick: () => void;
  atCap: boolean;
  maxRows: number;
  addLabel: string;
  disabled: boolean;
}) {
  return (
    <HoverTooltip content={atCap ? `Maximum ${maxRows} rows` : undefined}>
      <span className="self-start">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || atCap}
          className={addButtonCls}
        >
          <Plus className="w-3 h-3" />
          {addLabel}
        </button>
      </span>
    </HoverTooltip>
  );
}

function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <HoverTooltip content="Remove row">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Remove row"
        className="flex items-center justify-center w-6 h-6 rounded text-gray-400
          hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
          transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </HoverTooltip>
  );
}

export interface CollectionColumn {
  /** Row-object key (map: "name"/"value"; table: the column element name). */
  key: string;
  label: string;
  placeholder?: string;
}

export interface CollectionRowsGridProps {
  columns: CollectionColumn[];
  rows: Record<string, string>[];
  onChange: (rows: Record<string, string>[]) => void;
  addLabel?: string;
  maxRows?: number;
  maxCellLength?: number;
  disabled?: boolean;
  density?: ViewDensity;
}

export function CollectionRowsGrid({
  columns,
  rows,
  onChange,
  addLabel = "Add Row",
  maxRows = DEFAULT_MAX_ROWS,
  maxCellLength = DEFAULT_MAX_CELL_LENGTH,
  disabled = false,
  density,
}: CollectionRowsGridProps) {
  const gridTemplate = `${columns.map(() => "1fr").join(" ")} 1.5rem`;
  const atCap = rows.length >= maxRows;

  function add() {
    const blank: Record<string, string> = {};
    for (const c of columns) blank[c.key] = "";
    onChange([...rows, blank]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function update(i: number, key: string, value: string) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.length > 0 && (
        <div className="grid gap-1.5 px-0.5 mb-0.5" style={{ gridTemplateColumns: gridTemplate }}>
          {columns.map((c) => (
            <span key={c.key} className={headerLabelCls}>
              {c.label}
            </span>
          ))}
          <span />
        </div>
      )}

      {rows.map((row, i) => (
        <div
          key={i}
          className="grid gap-1.5 items-center"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((c) => (
            <input
              key={c.key}
              type="text"
              value={row[c.key] ?? ""}
              onChange={(ev) => update(i, c.key, ev.target.value)}
              placeholder={c.placeholder}
              maxLength={maxCellLength}
              disabled={disabled}
              aria-label={c.label}
              className={cellCls(density)}
            />
          ))}
          <RemoveButton onClick={() => remove(i)} disabled={disabled} />
        </div>
      ))}

      <AddRowButton
        onClick={add}
        atCap={atCap}
        maxRows={maxRows}
        addLabel={addLabel}
        disabled={disabled}
      />
    </div>
  );
}

export interface StringListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  itemLabel?: string;
  addLabel?: string;
  placeholder?: string;
  maxRows?: number;
  maxCellLength?: number;
  disabled?: boolean;
  density?: ViewDensity;
}

export function StringListEditor({
  items,
  onChange,
  itemLabel,
  addLabel = "Add",
  placeholder,
  maxRows = DEFAULT_MAX_ROWS,
  maxCellLength = DEFAULT_MAX_CELL_LENGTH,
  disabled = false,
  density,
}: StringListEditorProps) {
  const atCap = items.length >= maxRows;

  function add() {
    onChange([...items, ""]);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function update(i: number, value: string) {
    onChange(items.map((v, idx) => (idx === i ? value : v)));
  }

  return (
    <div className="flex flex-col gap-1">
      {items.length > 0 && itemLabel && (
        <div className="grid grid-cols-[1fr_1.5rem] gap-1.5 px-0.5 mb-0.5">
          <span className={headerLabelCls}>{itemLabel}</span>
          <span />
        </div>
      )}

      {items.map((v, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.5rem] gap-1.5 items-center">
          <input
            type="text"
            value={v}
            onChange={(ev) => update(i, ev.target.value)}
            placeholder={placeholder}
            maxLength={maxCellLength}
            disabled={disabled}
            aria-label={itemLabel ?? "Item"}
            className={cellCls(density)}
          />
          <RemoveButton onClick={() => remove(i)} disabled={disabled} />
        </div>
      ))}

      <AddRowButton
        onClick={add}
        atCap={atCap}
        maxRows={maxRows}
        addLabel={addLabel}
        disabled={disabled}
      />
    </div>
  );
}

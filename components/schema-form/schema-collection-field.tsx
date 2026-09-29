"use client";

/**
 * One schema-declared COLLECTION field (v3,: map / multimap /
 * stringList / table, optionally wrapped in a variable-mode toggle.
 *
 * The value model is rows, not a string — so this renders OUTSIDE the scalar
 * SchemaField switch. Rows are bound to the properties XML by the kind wrapper.
 *
 * Local flat-row mirror (plan D1): the editor keeps its own row state rather than
 * re-deriving from the bound value every keystroke. This keeps row order and
 * input focus stable across the bound value's normalization — `multimap` groups
 * rows by key on write, so a fully-controlled editor would reorder rows (and jump
 * focus) the instant a user types a name that duplicates another row. The mirror
 * re-syncs from the bound value only when it changes for an EXTERNAL reason (a
 * different channel, an XML-tab edit) — detected by comparing the bound value to
 * the normalized form of the rows we last emitted. map/stringList/table normalize
 * to identity; only multimap regroups.
 *
 * The variable-toggle's two companion elements are ordinary scalar elements, so
 * they flow through the scalar value bag: the parent passes `useVariable`/
 * `variableValue` and their change handlers, which route to `onValueChange` for
 * the toggle's element keys.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FullWidthField } from "@/components/settings/settings-section";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { MANIFEST_CAPS, type FieldDescriptor } from "@/lib/runtime-plugins/manifest-types";
import type {
  CollectionMapRow,
  CollectionTableRow,
} from "@/lib/runtime-plugins/xml-collection-binding";
import { CollectionRowsGrid, StringListEditor } from "./collection-rows-grid";
import { VariableToggleFrame } from "./variable-toggle-frame";

/** Row value carried for one collection field, shaped by the field's type. */
export type CollectionFieldValue = CollectionMapRow[] | string[] | CollectionTableRow[];

export interface SchemaCollectionFieldProps {
  field: FieldDescriptor;
  value: CollectionFieldValue;
  onChange: (value: CollectionFieldValue) => void;
  /** variableToggle only: current mode + variable name (scalar element values). */
  useVariable: boolean;
  variableValue: string;
  onUseVariableChange: (useVariable: boolean) => void;
  onVariableValueChange: (value: string) => void;
  disabled?: boolean;
  density?: ViewDensity;
}

/** Regroups multimap rows by name (first-seen order), matching writeMultimapRows. */
function regroupMultimap(rows: CollectionMapRow[]): CollectionMapRow[] {
  const grouped = new Map<string, string[]>();
  for (const { name, value } of rows) {
    const existing = grouped.get(name);
    if (existing) existing.push(value);
    else grouped.set(name, [value]);
  }
  const out: CollectionMapRow[] = [];
  for (const [name, values] of grouped) for (const value of values) out.push({ name, value });
  return out;
}

/** The write→read normalization the binding applies for this field type. */
function normalizeFor(
  type: FieldDescriptor["type"]
): (rows: CollectionFieldValue) => CollectionFieldValue {
  return type === "multimap"
    ? (rows) => regroupMultimap(rows as CollectionMapRow[])
    : (rows) => rows;
}

function CollectionEditor({
  field,
  rows,
  onChange,
  disabled,
  density,
}: {
  field: FieldDescriptor;
  rows: CollectionFieldValue;
  onChange: (rows: CollectionFieldValue) => void;
  disabled?: boolean;
  density?: ViewDensity;
}) {
  const maxRows = MANIFEST_CAPS.MAX_COLLECTION_ROWS;
  const maxCellLength = MANIFEST_CAPS.MAX_COLLECTION_CELL_LENGTH;

  if (field.type === "stringList") {
    return (
      <StringListEditor
        items={rows as string[]}
        onChange={(items) => onChange(items)}
        itemLabel={field.itemLabel}
        addLabel={field.addLabel}
        maxRows={maxRows}
        maxCellLength={maxCellLength}
        disabled={disabled}
        density={density}
      />
    );
  }

  if (field.type === "table") {
    const columns = (field.columns ?? []).map((c) => ({
      key: c.element,
      label: c.label,
      placeholder: c.placeholder,
    }));
    return (
      <CollectionRowsGrid
        columns={columns}
        rows={rows as CollectionTableRow[]}
        onChange={(next) => onChange(next as CollectionTableRow[])}
        addLabel={field.addLabel}
        maxRows={maxRows}
        maxCellLength={maxCellLength}
        disabled={disabled}
        density={density}
      />
    );
  }

  // map / multimap: two columns (key + value); rows are {name, value}.
  const mapRows = (rows as CollectionMapRow[]).map((r) => ({ name: r.name, value: r.value }));
  return (
    <CollectionRowsGrid
      columns={[
        { key: "name", label: field.keyLabel ?? "Name" },
        { key: "value", label: field.valueLabel ?? "Value" },
      ]}
      rows={mapRows}
      onChange={(next) => onChange(next.map((r) => ({ name: r.name ?? "", value: r.value ?? "" })))}
      addLabel={field.addLabel}
      maxRows={maxRows}
      maxCellLength={maxCellLength}
      disabled={disabled}
      density={density}
    />
  );
}

export function SchemaCollectionField({
  field,
  value,
  onChange,
  useVariable,
  variableValue,
  onUseVariableChange,
  onVariableValueChange,
  disabled = false,
  density,
}: SchemaCollectionFieldProps) {
  const normalize = useMemo(() => normalizeFor(field.type), [field.type]);
  const [rows, setRows] = useState<CollectionFieldValue>(value);
  // Tracks the latest rows without being an effect dependency, so the resync
  // effect fires only when the bound `value` changes — never on our own edits
  // (which would otherwise race and revert a keystroke). Kept current in the two
  // places that set rows, never written during render (react-compiler rule).
  const rowsRef = useRef<CollectionFieldValue>(value);

  // Re-sync the mirror only on an EXTERNAL change: the bound value diverging from
  // the normalized form of the rows we last emitted (our own writes echo back
  // already-normalized, so they match and don't clobber local order/focus).
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(normalize(rowsRef.current))) {
      rowsRef.current = value;
      setRows(value);
    }
  }, [value, normalize]);

  const handleChange = (next: CollectionFieldValue) => {
    rowsRef.current = next;
    setRows(next);
    onChange(next);
  };

  const editor = (
    <CollectionEditor
      field={field}
      rows={rows}
      onChange={handleChange}
      disabled={disabled}
      density={density}
    />
  );

  return (
    <FullWidthField label={field.label} tooltip={field.tooltip}>
      {field.variableToggle ? (
        <VariableToggleFrame
          radioName={`rt-toggle-${field.key}`}
          useVariable={useVariable}
          onUseVariableChange={onUseVariableChange}
          variableValue={variableValue}
          onVariableValueChange={onVariableValueChange}
          tableLabel={field.variableToggle.tableLabel}
          variableLabel={field.variableToggle.variableLabel}
          variablePlaceholder={field.variableToggle.variablePlaceholder}
          variableTooltip={field.variableToggle.variableTooltip}
          disabled={disabled}
          density={density}
        >
          {editor}
        </VariableToggleFrame>
      ) : (
        editor
      )}
    </FullWidthField>
  );
}

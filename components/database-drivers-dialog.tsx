"use client";

import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useDatabaseDrivers } from "@/lib/hooks/use-database-drivers";
import type { DriverInfo } from "@/lib/types";

// ─── Column definitions ──────────────────────────────────────────────────────

type DriverCol = "name" | "className" | "template" | "selectLimit" | "altClasses";

const DRIVER_COLS: ColDef<DriverCol>[] = [
  { key: "name", label: "Name", defaultWidth: 130, minWidth: 80, defaultVisible: true },
  {
    key: "className",
    label: "Driver Class",
    defaultWidth: 210,
    minWidth: 100,
    defaultVisible: true,
  },
  {
    key: "template",
    label: "JDBC URL Template",
    defaultWidth: 210,
    minWidth: 100,
    defaultVisible: true,
  },
  {
    key: "selectLimit",
    label: "Select with Limit Query",
    defaultWidth: 170,
    minWidth: 100,
    defaultVisible: true,
  },
  {
    key: "altClasses",
    label: "Legacy Driver Classes",
    defaultWidth: 150,
    minWidth: 100,
    defaultVisible: true,
  },
];

// ─── Blank driver factory ─────────────────────────────────────────────────────

function blankDriver(): DriverInfo {
  return { name: "", className: "", template: "", selectLimit: "", alternativeClassNames: [] };
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationErrors {
  /** Set of row indices that have a blank "name" field. */
  blankName: Set<number>;
  /** Set of row indices that have a blank "className" field. */
  blankClassName: Set<number>;
  /** Set of row indices that have a blank "template" field. */
  blankTemplate: Set<number>;
  /** Set of row indices with a non-unique "name". */
  dupName: Set<number>;
  /** True when the list is empty. */
  empty: boolean;
}

function validate(rows: DriverInfo[]): ValidationErrors {
  const blankName = new Set<number>();
  const blankClassName = new Set<number>();
  const blankTemplate = new Set<number>();
  const dupName = new Set<number>();
  const nameSeen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.name.trim()) blankName.add(i);
    if (!r.className.trim()) blankClassName.add(i);
    if (!r.template.trim()) blankTemplate.add(i);

    const lower = r.name.trim().toLowerCase();
    if (lower) {
      const prev = nameSeen.get(lower);
      if (prev !== undefined) {
        dupName.add(prev);
        dupName.add(i);
      } else {
        nameSeen.set(lower, i);
      }
    }
  }

  return {
    blankName,
    blankClassName,
    blankTemplate,
    dupName,
    empty: rows.length === 0,
  };
}

function isValid(v: ValidationErrors): boolean {
  return (
    !v.empty &&
    v.blankName.size === 0 &&
    v.blankClassName.size === 0 &&
    v.blankTemplate.size === 0 &&
    v.dupName.size === 0
  );
}

function firstError(v: ValidationErrors): string | null {
  if (v.empty) return "At least one driver entry is required.";
  if (v.blankName.size > 0 || v.blankClassName.size > 0 || v.blankTemplate.size > 0)
    return "Name, Driver Class, and JDBC URL Template are required for every row.";
  if (v.dupName.size > 0) return "Driver names must be unique.";
  return null;
}

// ─── Main dialog component ────────────────────────────────────────────────────

interface DatabaseDriversDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DriverRow extends DriverInfo {
  _index: number;
}

/**
 * DatabaseDriversDialog — mirrors Java's DatabaseDriversDialog.
 * Loads the server-registered JDBC driver list, allows Add/Delete/Edit in place,
 * and saves via PUT /server/databaseDrivers (full list replace).
 */
export function DatabaseDriversDialog({ open, onOpenChange }: DatabaseDriversDialogProps) {
  const { drivers, save } = useDatabaseDrivers();
  const colConfig = useColumnConfig(DRIVER_COLS, "bl-database-drivers-cols-v1");
  const sortState = useSortable<DriverCol>("name", "asc");

  const [editing, setEditing] = useState<DriverInfo[]>([]);
  const [snapshot, setSnapshot] = useState<DriverInfo[]>([]);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  // Seed working copy when the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an
  // effect, which avoids the cascading-render warning from set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const copy = drivers.map((d) => ({
        ...d,
        alternativeClassNames: [...d.alternativeClassNames],
      }));
      setEditing(copy);
      setSnapshot(copy);
      setSelectedRow(null);
      setSaving(false);
      setSaveError(null);
      setShowValidation(false);
    }
  }

  const validation = validate(editing);
  const valid = isValid(validation);

  function updateRow(i: number, patch: Partial<DriverInfo>) {
    setEditing((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const idx = selectedRow !== null ? selectedRow + 1 : editing.length;
    setEditing((prev) => {
      const next = [...prev];
      next.splice(idx, 0, blankDriver());
      return next;
    });
    setSelectedRow(idx);
  }

  function deleteRow() {
    if (selectedRow === null) return;
    setEditing((prev) => prev.filter((_, i) => i !== selectedRow));
    setSelectedRow((prev) => {
      if (prev === null) return null;
      if (prev >= editing.length - 1) return editing.length > 1 ? editing.length - 2 : null;
      return prev;
    });
  }

  function isDirty(): boolean {
    if (editing.length !== snapshot.length) return true;
    return editing.some(
      (row, i) =>
        row.name !== snapshot[i].name ||
        row.className !== snapshot[i].className ||
        row.template !== snapshot[i].template ||
        row.selectLimit !== snapshot[i].selectLimit ||
        row.alternativeClassNames.join(",") !== snapshot[i].alternativeClassNames.join(",")
    );
  }

  function handleOpenChange(next: boolean) {
    if (saving) return;
    if (!next && isDirty()) {
      setShowCancelConfirm(true);
      return;
    }
    onOpenChange(next);
  }

  async function handleSave() {
    setShowValidation(true);
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(editing);
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const errorMsg = showValidation && !valid ? firstError(validation) : saveError;

  const inputBase = `w-full text-xs bg-transparent border rounded focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30 border-transparent hover:border-border px-1`;

  const errorBorder = `border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-900/20`;

  function cellInput(
    rowIdx: number,
    field: keyof DriverInfo,
    value: string,
    hasError: boolean,
    placeholder?: string
  ) {
    return (
      <input
        className={`${inputBase} ${hasError ? errorBorder : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          if (field === "alternativeClassNames") {
            updateRow(rowIdx, {
              alternativeClassNames: e.target.value
                ? e.target.value.split(",").map((s) => s.trim())
                : [],
            });
          } else {
            updateRow(rowIdx, { [field]: e.target.value });
          }
        }}
      />
    );
  }

  const rows: DriverRow[] = editing.map((d, i) => ({ ...d, _index: i }));

  const sortedRows = sortState.sorted(rows, (r) => {
    switch (sortState.sort.key) {
      case "name":
        return r.name;
      case "className":
        return r.className;
      case "template":
        return r.template;
      case "selectLimit":
        return r.selectLimit;
      case "altClasses":
        return r.alternativeClassNames.join(", ");
      default:
        return undefined;
    }
  });

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Manage Drivers"
        maxWidth="sm:max-w-[920px]"
        onSubmit={handleSave}
        saving={saving}
        error={errorMsg}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-1 mb-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={deleteRow}
            disabled={selectedRow === null}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={colConfig.resetToDefaults}
            title="Reset column widths to defaults"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset columns
          </Button>
        </div>

        <DataTable<DriverRow, DriverCol>
          variant="sortable"
          cols={DRIVER_COLS}
          rows={sortedRows}
          colConfig={colConfig}
          sortState={sortState}
          rowKey={(r) => r._index}
          selectedRowId={selectedRow}
          onRowClick={(r) => setSelectedRow(r._index)}
          empty="No drivers configured. Click Add to create one."
          renderCell={(row, col) => {
            const i = row._index;
            const nameErr = validation.blankName.has(i) || validation.dupName.has(i);
            const classErr = validation.blankClassName.has(i);
            const templateErr = validation.blankTemplate.has(i);
            if (col === "name") {
              return cellInput(i, "name", row.name, showValidation && nameErr, "Name");
            }
            if (col === "className") {
              return cellInput(
                i,
                "className",
                row.className,
                showValidation && classErr,
                "com.example.Driver"
              );
            }
            if (col === "template") {
              return cellInput(
                i,
                "template",
                row.template,
                showValidation && templateErr,
                "jdbc:..."
              );
            }
            if (col === "selectLimit") {
              return cellInput(i, "selectLimit", row.selectLimit, false, "SELECT * FROM ? LIMIT 1");
            }
            return cellInput(
              i,
              "alternativeClassNames",
              row.alternativeClassNames.join(", "),
              false,
              "comma-separated"
            );
          }}
        />
      </FormDialog>

      {showCancelConfirm && (
        <ConfirmDialog
          title="Discard Changes"
          description="You have unsaved driver changes. Discard them?"
          confirmLabel="Discard"
          confirmVariant="destructive"
          onConfirm={() => {
            setShowCancelConfirm(false);
            onOpenChange(false);
          }}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
    </>
  );
}

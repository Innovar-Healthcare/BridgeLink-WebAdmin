"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormDialog } from "@/components/form-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { getSavedAdvancedFilters, saveSavedAdvancedFilters } from "@/lib/api-client";
import type {
  LookupGroup,
  AdvancedJsonFilter,
  JsonCondition,
  JsonOperator,
  JsonValueType,
  SavedFilter,
} from "@/lib/api-client";

// ─── Column definitions ─────────────────────────────────────────────────────

type AdvSearchCol = "select" | "field" | "operator" | "type" | "value";

const ADV_SEARCH_COLS: ColDef<AdvSearchCol>[] = [
  { key: "select", label: "", defaultWidth: 32, minWidth: 28, defaultVisible: true },
  { key: "field", label: "Field", defaultWidth: 220, minWidth: 80, defaultVisible: true },
  { key: "operator", label: "Operator", defaultWidth: 160, minWidth: 100, defaultVisible: true },
  { key: "type", label: "Type", defaultWidth: 96, minWidth: 70, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 220, minWidth: 80, defaultVisible: true },
];

const OP_LABELS: Record<JsonOperator, string> = {
  EQUAL: "= (Equal)",
  NOT_EQUAL: "≠ (Not Equal)",
  GREATER_THAN: "> (Greater Than)",
  LESS_THAN: "< (Less Than)",
  GREATER_OR_EQUAL: "≥ (Greater or Equal)",
  LESS_OR_EQUAL: "≤ (Less or Equal)",
  CONTAINS: "Contains",
  NOT_CONTAINS: "Not Contains",
};

const OPS_BY_TYPE: Record<JsonValueType, JsonOperator[]> = {
  STRING: ["EQUAL", "NOT_EQUAL", "CONTAINS", "NOT_CONTAINS"],
  NUMBER: ["EQUAL", "NOT_EQUAL", "GREATER_THAN", "LESS_THAN", "GREATER_OR_EQUAL", "LESS_OR_EQUAL"],
  BOOLEAN: ["EQUAL", "NOT_EQUAL"],
};

// ─── Saved filter helpers ──────────────────────────────────────────────────────

// Saved filters are persisted on the server (global list, shared with the Java
// client) — see getSavedAdvancedFilters / saveSavedAdvancedFilters.

/**
 * Insert or replace a saved filter by case-insensitive name match, mirroring the
 * Java client's addOrReplaceFilter(). When overwriting a selected filter whose
 * name was changed, `replaceName` drops the original entry too.
 */
function upsertFilter(
  list: SavedFilter[],
  name: string,
  filter: AdvancedJsonFilter,
  replaceName?: string | null
): SavedFilter[] {
  const drop = new Set<string>([name.toLowerCase()]);
  if (replaceName) drop.add(replaceName.toLowerCase());
  const kept = list.filter((f) => !drop.has(f.name.toLowerCase()));
  return [...kept, { name, filter }];
}

// ─── Row type (internal, with id for keying) ──────────────────────────────────

interface ConditionRow extends JsonCondition {
  _id: string;
  selected: boolean;
}

function newRow(): ConditionRow {
  return {
    _id: crypto.randomUUID(),
    field: "",
    op: "EQUAL",
    valueType: "STRING",
    value: "",
    selected: false,
  };
}

function toConditions(rows: ConditionRow[]): JsonCondition[] {
  return rows.map(({ field, op, valueType, value }) => ({ field, op, valueType, value }));
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdvancedSearchDialogProps {
  group: LookupGroup;
  initialFilter: AdvancedJsonFilter;
  onApply: (filter: AdvancedJsonFilter) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdvancedSearchDialog({
  group,
  initialFilter,
  onApply,
  onClose,
}: AdvancedSearchDialogProps) {
  // ── State ──────────────────────────────────────────────────────────────────

  const { viewDensity } = useCompactMode();
  const colConfig = useColumnConfig(ADV_SEARCH_COLS, "bl-advanced-search-cols-v1");
  const sortState = useSortable<AdvSearchCol>("field", "asc");
  const [keyPattern, setKeyPattern] = useState(initialFilter.keyPattern ?? "");
  const [rows, setRows] = useState<ConditionRow[]>(() =>
    initialFilter.conditions.length > 0
      ? initialFilter.conditions.map((c) => ({ ...c, _id: crypto.randomUUID(), selected: false }))
      : [newRow()]
  );
  const [rowError, setRowError] = useState<string | null>(null);

  // Saved filters (server-backed, global across all groups)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);

  // Save dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveOverwrite, setSaveOverwrite] = useState(false);
  const [savingFilter, setSavingFilter] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSavedAdvancedFilters()
      .then((filters) => {
        if (!active) return;
        setSavedFilters(filters);
        setSavedError(null);
      })
      .catch((e) => {
        if (active) setSavedError(e instanceof Error ? e.message : "Failed to load saved filters.");
      })
      .finally(() => {
        if (active) setSavedLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // JSON preview (derived)
  const previewFilter: AdvancedJsonFilter = {
    ...(keyPattern.trim() ? { keyPattern: keyPattern.trim() } : {}),
    conditions: toConditions(rows.filter((r) => r.field || r.value)),
  };

  // Field path suggestions from indexed fields
  const fieldSuggestions: string[] = group.extra?.indexedJsonFields
    ? group.extra.indexedJsonFields
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const datalistId = `adv-field-suggestions-${group.id}`;

  // ── Row editing ────────────────────────────────────────────────────────────

  const updateRow = useCallback((id: string, patch: Partial<ConditionRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r;
        const updated = { ...r, ...patch };
        // When valueType changes, reset op to first valid one
        if (patch.valueType && patch.valueType !== r.valueType) {
          updated.op = OPS_BY_TYPE[patch.valueType][0];
        }
        return updated;
      })
    );
    setRowError(null);
  }, []);

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeSelected() {
    setRows((prev) => {
      const kept = prev.filter((r) => !r.selected);
      return kept.length > 0 ? kept : [newRow()];
    });
  }

  function toggleSelect(id: string) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, selected: !r.selected } : r)));
  }

  const anySelected = rows.some((r) => r.selected);

  // ── Saved filter actions ───────────────────────────────────────────────────

  function openSaveDialog() {
    const selected = selectedSavedIdx !== null ? savedFilters[selectedSavedIdx] : null;
    setSaveName(selected ? selected.name : "");
    setSaveOverwrite(selected != null);
    setSaveError(null);
    setSaveDialogOpen(true);
  }

  async function handleConfirmSave() {
    const name = saveName.trim();
    if (!name) {
      setSaveError("Please enter a name for the filter.");
      return;
    }
    const filter: AdvancedJsonFilter = {
      ...(keyPattern.trim() ? { keyPattern: keyPattern.trim() } : {}),
      // Persist only complete conditions (field + value), matching the Apply and
      // snippet paths — avoids reloading a filter with half-filled rows.
      conditions: toConditions(rows.filter((r) => r.field.trim() && r.value.trim())),
    };
    const selected = selectedSavedIdx !== null ? savedFilters[selectedSavedIdx] : null;
    const replaceName = saveOverwrite && selected ? selected.name : null;
    const updated = upsertFilter(savedFilters, name, filter, replaceName);

    setSavingFilter(true);
    setSaveError(null);
    try {
      await saveSavedAdvancedFilters(updated);
      setSavedFilters(updated);
      setSelectedSavedIdx(updated.findIndex((f) => f.name === name));
      setSaveDialogOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save filter.");
    } finally {
      setSavingFilter(false);
    }
  }

  function handleLoadFilter() {
    if (selectedSavedIdx === null || !savedFilters[selectedSavedIdx]) return;
    const { filter } = savedFilters[selectedSavedIdx];
    setKeyPattern(filter.keyPattern ?? "");
    setRows(
      filter.conditions.length > 0
        ? filter.conditions.map((c) => ({ ...c, _id: crypto.randomUUID(), selected: false }))
        : [newRow()]
    );
    setRowError(null);
  }

  async function handleDeleteFilter() {
    if (selectedSavedIdx === null) return;
    const updated = savedFilters.filter((_, i) => i !== selectedSavedIdx);
    try {
      await saveSavedAdvancedFilters(updated);
      setSavedFilters(updated);
      setSelectedSavedIdx(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete filter.");
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  function handleApply() {
    // Validate: every non-empty-field row must be fully filled
    const incomplete = rows.find(
      (r) => r.field.trim() && (!r.op || !r.valueType || !r.value.trim())
    );
    const blankField = rows.find((r) => !r.field.trim() && r.value.trim());
    if (incomplete || blankField) {
      setRowError("All conditions must have Field, Operator, Type, and Value filled in.");
      return;
    }
    const validRows = rows.filter((r) => r.field.trim());
    const filter: AdvancedJsonFilter = {
      ...(keyPattern.trim() ? { keyPattern: keyPattern.trim() } : {}),
      conditions: toConditions(validRows),
    };
    onApply(filter);
    onClose();
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const selectH = densityHeight(viewDensity);
  const selectCls = `${selectH} rounded border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900 w-full`;

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedSavedName =
    selectedSavedIdx !== null ? savedFilters[selectedSavedIdx]?.name : undefined;

  return (
    <>
      <Dialog
        open={true}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <DialogContent
          className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <DialogTitle className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Advanced Search — {group.name}
            </DialogTitle>
          </div>

          {/* Body: two-panel */}
          <div className="flex-1 overflow-hidden flex">
            {/* ── Left: Controls ────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-border p-4 gap-4">
              {/* Key Pattern */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Key Pattern
                </label>
                <Input
                  density={viewDensity}
                  className="text-sm"
                  placeholder="e.g. 2025-11-21_%  (SQL wildcards: % and _)"
                  value={keyPattern}
                  onChange={(e) => setKeyPattern(e.target.value)}
                />
              </div>

              {/* Field suggestions datalist */}
              {fieldSuggestions.length > 0 && (
                <datalist id={datalistId}>
                  {fieldSuggestions.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              )}

              {/* Conditions table */}
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Conditions (AND)
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={addRow}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={removeSelected}
                      disabled={!anySelected}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                </div>

                <DataTable<ConditionRow, AdvSearchCol>
                  variant="sortable"
                  cols={ADV_SEARCH_COLS}
                  rows={sortState.sorted(rows, (r) => {
                    switch (sortState.sort.key) {
                      case "select":
                        return r.selected ? 1 : 0;
                      case "field":
                        return r.field;
                      case "operator":
                        return r.op;
                      case "type":
                        return r.valueType;
                      case "value":
                        return r.value;
                      default:
                        return undefined;
                    }
                  })}
                  colConfig={colConfig}
                  sortState={sortState}
                  rowKey={(r) => r._id}
                  cellAlign={{ select: "center" }}
                  empty="No conditions."
                  containerClassName="flex-1 min-h-0"
                  renderCell={(row, col) => {
                    if (col === "select") {
                      return (
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleSelect(row._id)}
                          className="rounded"
                        />
                      );
                    }
                    if (col === "field") {
                      return (
                        <input
                          list={fieldSuggestions.length > 0 ? datalistId : undefined}
                          className={`w-full ${selectH} rounded border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
                          placeholder="e.g. email"
                          value={row.field}
                          onChange={(e) => updateRow(row._id, { field: e.target.value })}
                        />
                      );
                    }
                    if (col === "operator") {
                      return (
                        <select
                          className={selectCls}
                          value={row.op}
                          onChange={(e) =>
                            updateRow(row._id, { op: e.target.value as JsonOperator })
                          }
                        >
                          {OPS_BY_TYPE[row.valueType].map((op) => (
                            <option key={op} value={op}>
                              {OP_LABELS[op]}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    if (col === "type") {
                      return (
                        <select
                          className={selectCls}
                          value={row.valueType}
                          onChange={(e) =>
                            updateRow(row._id, { valueType: e.target.value as JsonValueType })
                          }
                        >
                          <option value="STRING">STRING</option>
                          <option value="NUMBER">NUMBER</option>
                          <option value="BOOLEAN">BOOLEAN</option>
                        </select>
                      );
                    }
                    if (row.valueType === "BOOLEAN") {
                      return (
                        <select
                          className={selectCls}
                          value={row.value}
                          onChange={(e) => updateRow(row._id, { value: e.target.value })}
                        >
                          <option value="">— select —</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      );
                    }
                    return (
                      <input
                        type={row.valueType === "NUMBER" ? "number" : "text"}
                        className={`w-full ${selectH} rounded border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
                        placeholder={row.valueType === "NUMBER" ? "0" : "value…"}
                        value={row.value}
                        onChange={(e) => updateRow(row._id, { value: e.target.value })}
                      />
                    );
                  }}
                />

                {rowError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{rowError}</p>
                )}
              </div>

              {/* JSON Preview */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  JSON Preview
                </label>
                <pre className="w-full rounded-md border border-border bg-gray-50 dark:bg-gray-900 p-2 text-[10px] leading-tight font-mono text-gray-700 dark:text-gray-300 overflow-auto max-h-28">
                  {JSON.stringify(previewFilter, null, 2)}
                </pre>
              </div>
            </div>

            {/* ── Right: Saved Filters ───────────────────────────────────────── */}
            <div className="w-52 shrink-0 flex flex-col p-4 gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Saved Filters
              </span>

              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2 flex-1"
                  onClick={handleLoadFilter}
                  disabled={selectedSavedIdx === null}
                >
                  Load
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2 flex-1"
                  onClick={handleDeleteFilter}
                  disabled={selectedSavedIdx === null}
                >
                  Delete
                </Button>
              </div>

              <div className="flex-1 overflow-auto border border-border rounded-md">
                {savedLoading ? (
                  <p className="flex items-center gap-1.5 p-2 text-xs text-gray-400 dark:text-gray-500 italic">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                  </p>
                ) : savedError ? (
                  <p className="p-2 text-xs text-red-600 dark:text-red-400">{savedError}</p>
                ) : savedFilters.length === 0 ? (
                  <p className="p-2 text-xs text-gray-400 dark:text-gray-500 italic">
                    No saved filters.
                  </p>
                ) : (
                  <ul>
                    {savedFilters.map((sf, i) => (
                      <li
                        key={sf.name}
                        onClick={() => setSelectedSavedIdx(i)}
                        className={`px-3 py-2 text-xs cursor-pointer border-b border-border last:border-0 truncate ${
                          selectedSavedIdx === i
                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                        }`}
                        title={sf.name}
                      >
                        {sf.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={openSaveDialog}
                // Block saving until the existing list loads cleanly — saving on top
                // of a failed load would overwrite the server list and wipe filters
                // we couldn't read.
                disabled={savedLoading || savedError !== null}
                title={
                  savedError
                    ? "Reload before saving — existing filters could not be loaded."
                    : undefined
                }
              >
                Save Filter…
              </Button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save-filter dialog: name + overwrite option (mirrors Java save flow) */}
      <FormDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title="Save Filter"
        submitLabel="Save"
        onSubmit={handleConfirmSave}
        saving={savingFilter}
        error={saveError}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Filter name
            </label>
            <Input
              density={viewDensity}
              autoFocus
              placeholder="e.g. Active providers"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </div>
          {selectedSavedName != null && (
            <FormCheckbox
              size="sm"
              label={`Overwrite selected filter "${selectedSavedName}"`}
              checked={saveOverwrite}
              onChange={(v) => {
                setSaveOverwrite(v);
                if (v) setSaveName(selectedSavedName);
              }}
            />
          )}
        </div>
      </FormDialog>
    </>
  );
}

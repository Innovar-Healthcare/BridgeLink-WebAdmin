"use client";

/**
 * Configuration Map tab — mirrors Java's SettingsPanelMap.java.
 *
 * Editable table with Key, Value, Comment columns.
 * Features: Show/hide values toggle, Add/Remove rows, Import/Export .properties.
 *
 * API: GET /server/configurationMap → load entries
 *      PUT /server/configurationMap → save entries
 */

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Map, Plus, Trash2 } from "lucide-react";

import { toast } from "sonner";
import {
  getConfigurationMap,
  setConfigurationMap,
  type ConfigurationMapEntry,
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "./settings-section";
import { SettingsTabScroll } from "./settings-tab-scroll";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { parsePropertiesText, serializeProperties } from "@/lib/configuration-map-properties";

// ─── Column definitions ──────────────────────────────────────────────────────

type ConfigMapCol = "key" | "value" | "comment";

const CONFIG_MAP_COLS: ColDef<ConfigMapCol>[] = [
  { key: "key", label: "Key", defaultWidth: 220, minWidth: 100, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 320, minWidth: 100, defaultVisible: true },
  { key: "comment", label: "Comment", defaultWidth: 320, minWidth: 100, defaultVisible: true },
];

// ─── Local preference for show-values toggle ────────────────────────────────

const SHOW_VALUES_KEY = "bl-configmap-show-values";

function getShowValues(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SHOW_VALUES_KEY) === "true";
}

function saveShowValues(v: boolean) {
  localStorage.setItem(SHOW_VALUES_KEY, String(v));
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Row {
  /** Stable id for React key (not persisted to server). */
  uid: string;
  key: string;
  value: string;
  comment: string;
}

let _uid = 0;
function nextUid(): string {
  return `row-${++_uid}-${Date.now()}`;
}

function entryToRow(e: ConfigurationMapEntry): Row {
  return { uid: nextUid(), key: e.key, value: e.value, comment: e.comment };
}

function rowToEntry(r: Row): ConfigurationMapEntry {
  return { key: r.key, value: r.value, comment: r.comment };
}

// ─── Inline editable cell ───────────────────────────────────────────────────

function EditableCell({
  value,
  onChange,
  masked,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  masked?: boolean;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Snapshot taken when editing begins so Escape can revert. Edits commit live (every
  // keystroke calls onChange), so the parent's `rows` — and the dirty flag and Save's
  // enabled state — always reflect what's typed. This mirrors Java's stopCellEditing()
  // before every action: Save/Refresh/Import/Export never read a stale, uncommitted cell,
  // and clicking Save right after typing works on the first click.
  const snapshotRef = useRef(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div
        className="px-2 py-1 min-h-[28px] cursor-text truncate text-sm"
        onDoubleClick={() => {
          snapshotRef.current = value;
          setEditing(true);
        }}
        title={masked ? undefined : value}
      >
        {masked && value ? "••••••••" : value || "\u00A0"}
      </div>
    );
  }

  // Revert to the pre-edit value and exit. (Live edits are already in the parent's rows.)
  const cancel = () => {
    onChange(snapshotRef.current);
    setEditing(false);
  };

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
        className="w-full px-1.5 py-0.5 text-sm border border-blue-400 dark:border-blue-500 dark:bg-gray-700 dark:text-gray-200 rounded resize-y min-h-[60px] outline-none"
        rows={3}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setEditing(false);
        if (e.key === "Escape") cancel();
      }}
      className="w-full px-1.5 py-0.5 text-sm border border-blue-400 dark:border-blue-500 dark:bg-gray-700 dark:text-gray-200 rounded outline-none"
    />
  );
}

// ─── Import/Export helpers ───────────────────────────────────────────────────

/** Parse a Java-style .properties text into rows (adds a React-key uid per entry). */
function parseProperties(text: string): Row[] {
  return parsePropertiesText(text).map(entryToRow);
}

// ─── Actions interface for dockable toolbar ─────────────────────────────────

export interface ConfigMapTabActions {
  save: () => void;
  refresh: () => void;
  importMap: () => void;
  exportMap: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  canExport: boolean;
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface ConfigurationMapTabProps {
  onDirty?: (isDirty: boolean) => void;
  saveRef?: { current: () => Promise<void> };
  actionsRef?: React.MutableRefObject<ConfigMapTabActions>;
  onActionsChanged?: () => void;
}

export function ConfigurationMapTab({
  onDirty,
  saveRef,
  actionsRef,
  onActionsChanged,
}: ConfigurationMapTabProps) {
  const colConfig = useColumnConfig(CONFIG_MAP_COLS, "bl-settings-configmap-cols-v1");
  const sortState = useSortable<ConfigMapCol>("key", "asc");
  const [rows, setRows] = useState<Row[]>([]);
  const [originalJson, setOriginalJson] = useState("");
  const [selectedRowUid, setSelectedRowUid] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Import is a destructive full replace; prompt before clobbering existing rows.
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  // Export offers to save first when there are unsaved edits (Java prompts YES/NO/CANCEL).
  const [exportPromptOpen, setExportPromptOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const rowsToJson = useCallback(
    (r: Row[]) =>
      JSON.stringify(r.map((row) => ({ key: row.key, value: row.value, comment: row.comment }))),
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await getConfigurationMap();
      const loaded = entries.map(entryToRow);
      setRows(loaded);
      setOriginalJson(rowsToJson(loaded));
      if (loaded.length > 0) {
        setSelectedRowUid(loaded[0].uid);
      } else {
        setSelectedRowUid(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load configuration map");
    } finally {
      setLoading(false);
    }
  }, [rowsToJson]);

  useEffect(() => {
    startTransition(() => {
      load();
      setShowValues(getShowValues());
    });
  }, [load]);

  const dirty = rowsToJson(rows) !== originalJson;

  // Notify parent of dirty state changes
  // (onDirty intentionally omitted from deps — only fire when dirty value itself changes)
  useEffect(() => {
    onDirty?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // ── Row handlers ──

  const addRow = () => {
    const newRow: Row = { uid: nextUid(), key: "", value: "", comment: "" };
    setRows((prev) => [...prev, newRow]);
    setSelectedRowUid(newRow.uid);
  };

  const removeRow = () => {
    if (!selectedRowUid) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.uid === selectedRowUid);
      const next = prev.filter((r) => r.uid !== selectedRowUid);
      if (next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1);
        setSelectedRowUid(next[newIdx].uid);
      } else {
        setSelectedRowUid(null);
      }
      return next;
    });
  };

  const updateRow = (uid: string, field: keyof Row, value: string) => {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));
  };

  // ── Show values toggle ──

  const handleToggleShowValues = () => {
    const next = !showValues;
    setShowValues(next);
    saveShowValues(next);
  };

  // ── Validation ──

  const validate = (): string | null => {
    for (const row of rows) {
      if (!row.key.trim() && (row.value.trim() || row.comment.trim())) {
        return "Blank keys are not allowed.";
      }
    }
    return null;
  };

  // ── Save ──

  // Pure save — throws on error; no UI state changes. Used by the navigation guard.
  async function doSave() {
    const err = validate();
    if (err) throw new Error(err);
    const toSave = rows.filter((r) => r.key.trim()).map(rowToEntry);
    await setConfigurationMap(toSave);
    const cleaned = rows.filter((r) => r.key.trim());
    setRows(cleaned);
    setOriginalJson(rowsToJson(cleaned));
  }

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await doSave();
      toast.success("Configuration map saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save configuration map");
    } finally {
      setSaving(false);
    }
  };

  // ── Import ──

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const imported = parseProperties(text);
      setRows(imported);
      if (imported.length > 0) {
        setSelectedRowUid(imported[0].uid);
      } else {
        setSelectedRowUid(null);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  };

  // ── Export ──

  // Intentional divergence from Java (L20,: Java's doExportMap re-fetches the
  // server's saved map (SettingsPanelMap.java:231) and always exports that, so it cannot
  // emit unsaved edits. The WebUI serializes the current in-memory rows and offers an
  // explicit "Export without saving" choice — clearer UX (you export exactly what you see),
  // kept deliberately rather than matching Java's re-fetch.
  const handleExport = () => {
    const text = serializeProperties(rows);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "configurationMap.properties";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import is a full replace; warn before discarding existing rows (mirrors Java's task
  // description "This will remove and replace any existing map values."). With no rows,
  // skip the prompt and open the file picker directly.
  const handleImportClick = () => {
    if (rows.length > 0) {
      setImportConfirmOpen(true);
    } else {
      importRef.current?.click();
    }
  };

  // Export offers to save first when there are unsaved edits (Java prompts YES/NO/CANCEL).
  // When clean, export immediately. After the XML-load fix the in-memory rows already hold
  // literal values, so exporting them reflects the saved state.
  const handleExportClick = () => {
    if (dirty) {
      setExportPromptOpen(true);
    } else {
      handleExport();
    }
  };

  const handleSaveThenExport = async () => {
    setExportPromptOpen(false);
    setSaving(true);
    setError("");
    try {
      await doSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save configuration map");
      return;
    } finally {
      setSaving(false);
    }
    handleExport();
  };

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, rows.length, onActionsChanged]);

  // Expose the imperative save/actions handles to the parent. Written in a deps-less
  // effect (not during render) to satisfy react-hooks/refs. Declared after the handlers
  // it references; the parent's re-render from onActionsChanged is deferred until the
  // full effect flush completes, so it always observes fresh handles.
  useEffect(() => {
    if (saveRef) saveRef.current = doSave;
    if (actionsRef) {
      actionsRef.current = {
        save: handleSave,
        refresh: load,
        importMap: handleImportClick,
        exportMap: handleExportClick,
        dirty,
        saving,
        loading,
        canExport: rows.length > 0,
      };
    }
  });

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SettingsTabScroll contentClassName="p-6 space-y-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        <SettingsSection title="Configuration Map" icon={Map}>
          {/* Show Values checkbox */}
          <div className="flex items-center gap-2 mb-2">
            <FormCheckbox
              label="Show values"
              checked={showValues}
              onChange={handleToggleShowValues}
              tooltip="If enabled, values in the table will be shown."
            />
          </div>

          {/* Table + buttons */}
          <div className="flex gap-3">
            {/* min-w-0 lets this flex item shrink so the table's own overflow-auto
                container scrolls internally instead of overflowing the panel. */}
            <div className="flex-1 min-w-0">
              <DataTable<Row, ConfigMapCol>
                variant="sortable"
                cols={CONFIG_MAP_COLS}
                rows={sortState.sorted(rows, (r) => {
                  switch (sortState.sort.key) {
                    case "key":
                      return r.key;
                    case "value":
                      return r.value;
                    case "comment":
                      return r.comment;
                    default:
                      return undefined;
                  }
                })}
                colConfig={colConfig}
                sortState={sortState}
                rowKey={(r) => r.uid}
                selectedRowId={selectedRowUid}
                onRowClick={(r) => setSelectedRowUid(r.uid)}
                empty="No entries. Click Add to create one, or Import a .properties file."
                renderCell={(row, col) => {
                  if (col === "key") {
                    return (
                      <EditableCell
                        value={row.key}
                        onChange={(v) => updateRow(row.uid, "key", v)}
                      />
                    );
                  }
                  if (col === "value") {
                    return (
                      <EditableCell
                        value={row.value}
                        onChange={(v) => updateRow(row.uid, "value", v)}
                        masked={!showValues}
                        multiline
                      />
                    );
                  }
                  return (
                    <EditableCell
                      value={row.comment}
                      onChange={(v) => updateRow(row.uid, "comment", v)}
                    />
                  );
                }}
              />
            </div>

            {/* Add/Remove buttons */}
            <div className="flex flex-col gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={addRow} className="w-[80px]">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
              <Button variant="outline" size="sm" onClick={removeRow} disabled={!selectedRowUid}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        </SettingsSection>
      </SettingsTabScroll>

      {/* Hidden file input for import */}
      <input
        ref={importRef}
        type="file"
        accept=".properties,.txt"
        className="hidden"
        onChange={handleImport}
      />

      {/* Import is a full replace — confirm before discarding existing entries. */}
      {importConfirmOpen && (
        <ConfirmDialog
          title="Replace configuration map?"
          description="Importing a properties file will remove and replace any existing map values."
          confirmLabel="Import"
          onConfirm={() => {
            setImportConfirmOpen(false);
            importRef.current?.click();
          }}
          onCancel={() => setImportConfirmOpen(false)}
        />
      )}

      {/* Export with unsaved edits — offer to save first (Java's YES/NO/CANCEL prompt). */}
      <Dialog open={exportPromptOpen} onOpenChange={(open) => !open && setExportPromptOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save before exporting?</DialogTitle>
            <DialogDescription asChild>
              <div>
                You have unsaved changes to the configuration map. Would you like to save them
                before exporting?
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportPromptOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExportPromptOpen(false);
                handleExport();
              }}
            >
              Export without saving
            </Button>
            <Button size="sm" onClick={handleSaveThenExport}>
              Save &amp; Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

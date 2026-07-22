"use client";

/**
 * ResourcesTab — mirrors SettingsPanelResources.java
 *
 * Business logic:
 *  - Load all resources via GET /server/resources → List<ResourceProperties>
 *  - Display table: Name (editable), Type (read-only dropdown), Global Scripts (checkbox), Load Parent-First (checkbox)
 *  - First row is always the "[Default Resource]" — cannot be removed, Name/Type are read-only
 *  - Selecting a row shows a detail panel below (Directory Settings for Directory type)
 *    - Directory: path text field, "Include All Subdirectories" checkbox, Description text area
 *    - Shows read-only "Loaded Libraries" list
 *  - Add Resource: creates a new Directory resource with auto-generated name ("Resource 1", "Resource 2", …)
 *  - Remove Resource: removes selected row (row index > 0 only — default resource cannot be removed)
 *  - Reload Resource: POST /server/resources/{id}/_reload (server re-scans directory)
 *    - Must save first if there are unsaved changes
 *  - Save: validates then PUT /server/resources with full list
 *    - Confirmation dialog before saving (warns about library reload impact, 1000 file limit)
 *  - Validation: resource name must be unique across all rows
 *  - "Invalid Resource" state: if server returns a resource with InvalidResourceProperties, show
 *    an error message in the detail panel instead of editable fields.
 */

import { startTransition, useCallback, useEffect, useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { toast } from "sonner";
import {
  DIRECTORY_PLUGIN_POINT,
  DIRECTORY_RESOURCE_FQN,
  getResources,
  getResourceLibraries,
  reloadResource,
  setResources,
} from "@/lib/api-client";
import type { ResourceProperties } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { DEFAULT_RESOURCE_ID, validateResources } from "@/lib/resource-utils";
import { SettingsSection } from "./settings-section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

type ResourceCol = "name" | "type" | "globalScripts" | "loadParentFirst";

const RESOURCE_COLS: ColDef<ResourceCol>[] = [
  { key: "name", label: "Name", defaultWidth: 320, minWidth: 100, defaultVisible: true },
  { key: "type", label: "Type", defaultWidth: 128, minWidth: 80, defaultVisible: true },
  {
    key: "globalScripts",
    label: "Global Scripts",
    defaultWidth: 112,
    minWidth: 80,
    defaultVisible: true,
  },
  {
    key: "loadParentFirst",
    label: "Load Parent-First",
    defaultWidth: 128,
    minWidth: 80,
    defaultVisible: true,
  },
];

interface ResourceRow extends ResourceProperties {
  _index: number;
}

type LibraryCol = "library";

const LIBRARY_COLS: ColDef<LibraryCol>[] = [
  { key: "library", label: "Library", defaultWidth: 400, minWidth: 100, defaultVisible: true },
];

interface LibraryRow {
  path: string;
  _index: number;
}

/**
 * Create a new Directory resource. Directory is the only resource type registered in open-source
 * BridgeLink — and none of the commercial plugins add one — so the WebUI always creates Directory
 * resources and the Type column is read-only (no type picker). If a resource plugin ever registers
 * a second type, drive the Type cell and a per-type detail panel from a resource-plugin registry
 * (mirrors SettingsPanelResources' ResourceClientPlugin combo box). fqn/pluginPointName are stamped
 * here so the row round-trips under its real discriminator on save instead of being forced to a
 * hardcoded Directory FQN.
 */
function makeNewResource(name: string): ResourceProperties {
  return {
    id: generateUUID(),
    name,
    type: "Directory",
    fqn: DIRECTORY_RESOURCE_FQN,
    pluginPointName: DIRECTORY_PLUGIN_POINT,
    description: "",
    includeWithGlobalScripts: false,
    loadParentFirst: false,
    directory: "",
    directoryRecursion: true,
  };
}

function uniqueName(existing: ResourceProperties[]): string {
  let num = 1;
  const names = new Set(existing.map((r) => r.name));
  while (names.has(`Resource ${num}`)) num++;
  return `Resource ${num}`;
}

export interface ResourcesTabActions {
  save: () => void;
  refresh: () => void;
  addResource: () => void;
  removeResource: () => void;
  reloadResource: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  canRemove: boolean;
  canReload: boolean;
  reloading: boolean;
}

interface ResourcesTabProps {
  onDirty?: (dirty: boolean) => void;
  saveRef?: { current: () => Promise<void> };
  actionsRef?: React.MutableRefObject<ResourcesTabActions>;
  onActionsChanged?: () => void;
}

export function ResourcesTab({
  onDirty,
  saveRef,
  actionsRef,
  onActionsChanged,
}: ResourcesTabProps) {
  const [resources, setResourcesList] = useState<ResourceProperties[]>([]);
  const { viewDensity } = useCompactMode();
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const resourceColConfig = useColumnConfig(RESOURCE_COLS, "bl-settings-resources-cols-v1");
  const resourceSortState = useSortable<ResourceCol>("name", "asc");
  const libraryColConfig = useColumnConfig(LIBRARY_COLS, "bl-settings-resource-libraries-cols-v1");
  const librarySortState = useSortable<LibraryCol>("library", "asc");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [libraries, setLibraries] = useState<string[]>([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [pendingReload, setPendingReload] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  // Bumped after load/reload to re-trigger library fetch. State (not a ref) so the
  // bump actually re-runs the dependent effect and we don't read a ref during render.
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  const selectedResource = selectedIdx >= 0 ? resources[selectedIdx] : null;
  const isDefault = selectedResource?.id === DEFAULT_RESOURCE_ID;
  // Remove is gated on identity — the default resource is never removable — not on row index.
  const canRemove = selectedIdx >= 0 && !isDefault;

  const markDirty = useCallback(() => {
    setDirty(true);
    onDirty?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // onDirty intentionally omitted from deps — inline arrow from parent recreates on every render

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getResources();
      // Ensure default resource is first
      const defaultIdx = list.findIndex((r) => r.id === DEFAULT_RESOURCE_ID);
      if (defaultIdx > 0) {
        const [def] = list.splice(defaultIdx, 1);
        list.unshift(def);
      }
      setResourcesList(list);
      setSelectedIdx(list.length > 0 ? 0 : -1);
      setDirty(false);
      onDirty?.(false);
      setLibraryRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // onDirty intentionally omitted from deps — inline arrow from parent recreates on every render

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  // Fetch loaded libraries whenever selection changes or after reload/save
  useEffect(() => {
    if (!selectedResource) {
      startTransition(() => {
        setLibraries([]);
      });
      return;
    }
    let cancelled = false;
    startTransition(() => {
      setLoadingLibraries(true);
    });
    getResourceLibraries(selectedResource.id)
      .then((libs) => {
        if (!cancelled) setLibraries(libs);
      })
      .catch(() => {
        // Non-fatal — libraries are informational
        if (!cancelled) setLibraries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLibraries(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResource?.id, libraryRefreshKey]);

  // ── Helpers to update resource fields ──

  function updateResource(idx: number, patch: Partial<ResourceProperties>) {
    setResourcesList((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    markDirty();
  }

  // ── Actions ──

  function handleAdd() {
    const name = uniqueName(resources);
    const newRes = makeNewResource(name);
    const next = [...resources, newRes];
    setResourcesList(next);
    setSelectedIdx(next.length - 1);
    markDirty();
  }

  function handleRemove() {
    if (!canRemove) return;
    const next = resources.filter((_, i) => i !== selectedIdx);
    setResourcesList(next);
    setSelectedIdx(Math.min(selectedIdx, next.length - 1));
    markDirty();
  }

  async function handleReload() {
    if (selectedIdx < 0 || !selectedResource) return;
    if (dirty) {
      toast.error("You must save before reloading any resources.");
      return;
    }
    setPendingReload(true);
  }

  async function executeReload() {
    if (selectedIdx < 0 || !selectedResource) return;
    setReloading(true);
    setError(null);
    try {
      await reloadResource(selectedResource.id);
      toast.success("Resource reloaded successfully");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  }

  // Pure save — throws on error; no confirm dialog. Used by the navigation guard.
  async function doSave() {
    const err = validateResources(resources);
    if (err) throw new Error(err);
    await setResources(resources);
    setDirty(false);
    onDirty?.(false);
  }
  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, canRemove, selectedIdx, reloading, onActionsChanged]);

  async function handleSave() {
    const err = validateResources(resources);
    if (err) {
      toast.error(err);
      return;
    }
    setPendingSave(true);
  }

  async function executeSave() {
    setSaving(true);
    setError(null);
    try {
      await doSave();
      toast.success("Resources saved");
      // Refresh to pick up any server-side changes
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

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
        addResource: handleAdd,
        removeResource: handleRemove,
        reloadResource: handleReload,
        dirty,
        saving,
        loading,
        canRemove,
        canReload: selectedIdx >= 0,
        reloading,
      };
    }
  });

  // ── Render ──

  return (
    <div className="flex flex-col gap-4 h-full min-w-[720px]">
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Resource list table ~20% */}
      <SettingsSection title="Resources" icon={Folder}>
        <DataTable<ResourceRow, ResourceCol>
          variant="sortable"
          cols={RESOURCE_COLS}
          rows={resourceSortState.sorted(
            resources.map((r, i) => ({ ...r, _index: i })),
            (r) => {
              switch (resourceSortState.sort.key) {
                case "name":
                  return r.name;
                case "type":
                  return r.type;
                case "globalScripts":
                  return r.includeWithGlobalScripts ? 1 : 0;
                case "loadParentFirst":
                  return r.loadParentFirst ? 1 : 0;
                default:
                  return undefined;
              }
            }
          )}
          colConfig={resourceColConfig}
          sortState={resourceSortState}
          rowKey={(r) => r.id}
          selectedRowId={selectedIdx >= 0 ? resources[selectedIdx]?.id : null}
          onRowClick={(r) => setSelectedIdx(r._index)}
          loading={loading}
          empty="No resources"
          containerClassName="max-h-52"
          cellAlign={{ globalScripts: "center", loadParentFirst: "center" }}
          renderCell={(row, col) => {
            const idx = row._index;
            const selected = idx === selectedIdx;
            const isDefaultRow = row.id === DEFAULT_RESOURCE_ID;
            if (col === "name") {
              if (isDefaultRow || !selected) {
                return <span>{row.name}</span>;
              }
              return (
                <Input
                  density={viewDensity}
                  value={row.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateResource(idx, { name: e.target.value })}
                />
              );
            }
            // Type is read-only — Directory is the only registered resource type (see makeNewResource).
            if (col === "type") return row.type;
            if (col === "globalScripts") {
              return (
                <HoverTooltip content="If checked, libraries associated with the corresponding resource will be included in global script contexts.">
                  <input
                    type="checkbox"
                    checked={!!row.includeWithGlobalScripts}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateResource(idx, {
                        includeWithGlobalScripts: e.target.checked,
                      })
                    }
                    className="accent-blue-600 w-4 h-4"
                  />
                </HoverTooltip>
              );
            }
            return (
              <HoverTooltip content="If checked, classes already included in the overall server classpath will not be able to be overwritten. Classes will attempt to be loaded from the parent ClassLoader first. Also, if this resource is included on a channel with other resources that have this option disabled, you will still not be able to overwrite classes in the parent classpath.">
                <input
                  type="checkbox"
                  checked={!!row.loadParentFirst}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    updateResource(idx, {
                      loadParentFirst: e.target.checked,
                    })
                  }
                  className="accent-blue-600 w-4 h-4"
                />
              </HoverTooltip>
            );
          }}
        />
      </SettingsSection>

      {/* Resource detail panel ~80% */}
      {selectedResource ? (
        <SettingsSection title="Directory Settings" icon={Folder} className="flex-1">
          {/* Directory path */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground w-24 text-right shrink-0">
              Directory:
            </label>
            <Input
              density={viewDensity}
              value={selectedResource.directory ?? ""}
              onChange={(e) => updateResource(selectedIdx, { directory: e.target.value })}
              placeholder="/path/to/directory"
              className="flex-1"
            />
            <FormCheckbox
              label="Include All Subdirectories"
              checked={!!selectedResource.directoryRecursion}
              onChange={(v) => updateResource(selectedIdx, { directoryRecursion: v })}
            />
          </div>

          {/* Description */}
          <div className="flex items-start gap-3 mt-3">
            <label className="text-sm text-muted-foreground w-24 text-right shrink-0 mt-1">
              Description:
            </label>
            <Textarea
              density={viewDensity}
              enableTabKey={!isDefault}
              value={selectedResource.description ?? ""}
              onChange={(e) => updateResource(selectedIdx, { description: e.target.value })}
              rows={4}
              readOnly={isDefault}
              className={[
                "flex-1 resize-none",
                isDefault ? "bg-muted text-muted-foreground" : "",
              ].join(" ")}
            />
          </div>

          {/* Loaded Libraries */}
          <div className="mt-4 flex flex-col flex-1 min-h-0">
            <div className="text-sm font-medium text-foreground mb-1">Loaded Libraries:</div>
            <DataTable<LibraryRow, LibraryCol>
              variant="sortable"
              cols={LIBRARY_COLS}
              rows={librarySortState.sorted(
                libraries.map((lib, i) => ({ path: lib, _index: i })),
                (r) => {
                  switch (librarySortState.sort.key) {
                    case "library":
                      return r.path;
                    default:
                      return undefined;
                  }
                }
              )}
              colConfig={libraryColConfig}
              sortState={librarySortState}
              rowKey={(r) => r._index}
              loading={loadingLibraries}
              empty="No libraries loaded."
              containerClassName="flex-1 min-h-0"
              cellMono={{ library: true }}
              renderCell={(row) => row.path}
            />
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection title="Resource Settings" icon={FolderOpen} className="flex-1">
          <p className="text-sm text-muted-foreground">Select a resource from the table above.</p>
        </SettingsSection>
      )}

      {pendingReload && (
        <ConfirmDialog
          title="Reload Resource"
          description="Libraries associated with this resource will be reloaded. Any channels / connectors using those libraries will be affected. A maximum of 1000 files may be loaded into a directory resource. Continue?"
          confirmLabel="Continue"
          onConfirm={() => {
            setPendingReload(false);
            void executeReload();
          }}
          onCancel={() => setPendingReload(false)}
        />
      )}

      {pendingSave && (
        <ConfirmDialog
          title="Save Resources"
          description="Libraries associated with any changed resources will be reloaded. Any channels / connectors using those libraries will be affected. A maximum of 1000 files may be loaded into a directory resource. Continue?"
          confirmLabel="Save & Reload"
          onConfirm={() => {
            setPendingSave(false);
            void executeSave();
          }}
          onCancel={() => setPendingSave(false)}
        />
      )}
    </div>
  );
}

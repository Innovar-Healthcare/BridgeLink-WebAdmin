"use client";

import { Fragment, useState, useCallback, useRef, useEffect, startTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Download, Pencil, Trash2, Loader2, AlertCircle, Database } from "lucide-react";
import {
  getLookupGroups,
  createLookupGroup,
  updateLookupGroup,
  deleteLookupGroup,
  importLookupGroup,
  importLookupValuesChunked,
  exportLookupGroup,
} from "@/lib/api-client";
import type { LookupGroup, LookupGroupRequest } from "@/lib/api-client";
import { GroupDialog } from "./_components/group-dialog";
import { ValuesTab } from "./_components/values-tab";
import { CacheStatusTab } from "./_components/cache-status-tab";
import { HistoryTab } from "./_components/history-tab";
import { LookupSettingsDialog } from "./_components/lookup-settings-dialog";
import { ImportGroupDialog } from "./_components/import-group-dialog";
import { ImportProgressDialog } from "./_components/import-progress-dialog";
import {
  LookupsActionPanel,
  EMPTY_VALUES_ACTIONS,
  EMPTY_CACHE_ACTIONS,
} from "./_components/lookups-action-panel";
import type { ValuesTabActions, CacheTabActions } from "./_components/lookups-action-panel";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { ConfirmDialog, TypeToConfirmDialog } from "@/components/confirm-dialog";
import { downloadFile } from "@/lib/download";
import { fmtDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PANEL_STORAGE_KEY = "bl-lookups-panel-width";
const DEFAULT_PANEL_WIDTH = 288;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;

// ─── Details Tab ──────────────────────────────────────────────────────────────

function DetailsTab({ group }: { group: LookupGroup }) {
  const rows: [string, React.ReactNode][] = [
    ["Name", group.name],
    ["Description", group.description || "—"],
    ["Version", group.version],
    ["Cache Size", group.cacheSize === 0 ? "Disabled" : group.cacheSize.toLocaleString()],
    ["Cache Policy", group.cachePolicy],
    ["Statistics Enabled", group.statisticsEnabled ? "Yes" : "No"],
    ["Value Type", group.valueType],
    ...(group.valueType === "JSON"
      ? [
          ["JSON Index Mode", group.extra?.jsonIndexMode ?? "NONE"] as [string, React.ReactNode],
          ...(group.extra?.jsonIndexMode === "FIELD" && group.extra.indexedJsonFields
            ? [
                [
                  "Indexed Fields",
                  <span key="indexed-fields" className="font-mono text-xs">
                    {group.extra.indexedJsonFields}
                  </span>,
                ] as [string, React.ReactNode],
              ]
            : []),
        ]
      : []),
    ["Created Date", fmtDate(group.createdDate)],
    ["Updated Date", fmtDate(group.updatedDate)],
  ];

  return (
    <div className="p-4 overflow-auto">
      <dl className="grid grid-cols-[11rem_1fr] text-sm w-full max-w-lg [&>dt:nth-last-of-type(1)]:border-0 [&>dd:nth-last-of-type(1)]:border-0">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium align-top border-b border-border">
              {label}
            </dt>
            <dd className="py-2 text-gray-900 dark:text-gray-100 break-words border-b border-border">
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = "details" | "values" | "cache" | "history";

const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "values", label: "Values" },
  { key: "cache", label: "Cache Status" },
  { key: "history", label: "History" },
];

export default function LookupsPage() {
  const { viewDensity } = useCompactMode();
  const [groups, setGroups] = useState<LookupGroup[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [groupSearch, setGroupSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("details");

  // Dialogs
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingGroup, setEditingGroup] = useState<LookupGroup | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deleteGroupDialog, setDeleteGroupDialog] = useState<LookupGroup | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    groupName: string;
    payload: unknown;
  } | null>(null);

  // Chunked value-import progress for the group JSON import.
  const [importProgress, setImportProgress] = useState<{
    imported: number;
    total: number;
  } | null>(null);
  const importCancelRef = useRef(false);

  // Toolbar
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();

  // Tab action refs (for toolbar to call into child tabs). Child tabs write their
  // imperative handle into these refs, then call onActionsChanged (bumpActions).
  const valuesActionsRef = useRef<ValuesTabActions>({ ...EMPTY_VALUES_ACTIONS });
  const cacheActionsRef = useRef<CacheTabActions>({ ...EMPTY_CACHE_ACTIONS });
  // Snapshot of the latest action handles, held in state so the toolbar can consume
  // them without reading a ref during render (satisfies react-hooks/refs). bumpActions
  // runs from the child's effect (an event-handler-like callback, not during render),
  // so reading the refs here is safe.
  const [valuesActions, setValuesActions] = useState<ValuesTabActions>({
    ...EMPTY_VALUES_ACTIONS,
  });
  const [cacheActions, setCacheActions] = useState<CacheTabActions>({ ...EMPTY_CACHE_ACTIONS });
  const bumpActions = useCallback(() => {
    setValuesActions({ ...valuesActionsRef.current });
    setCacheActions({ ...cacheActionsRef.current });
  }, []);

  // Resizable left panel
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH) {
        startTransition(() => setPanelWidth(w));
      }
    }
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const onMove = (me: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const w = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, me.clientX - rect.left));
      setPanelWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPanelWidth((w) => {
        localStorage.setItem(PANEL_STORAGE_KEY, String(Math.round(w)));
        return w;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null;

  // ── Load groups ──────────────────────────────────────────────────────────────

  const loadGroups = useCallback(async (selectId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLookupGroups();
      const list = Array.isArray(data) ? data : [];
      // Sort by name
      list.sort((a, b) => a.name.localeCompare(b.name));
      setGroups(list);
      if (selectId != null) {
        setSelectedId(list.find((g) => g.id === selectId)?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      loadGroups();
    });
  }, [loadGroups]);

  // ── Filtered list ─────────────────────────────────────────────────────────────

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase())
  );

  // ── CRUD operations ───────────────────────────────────────────────────────────

  async function handleSaveGroup(req: LookupGroupRequest) {
    if (dialogMode === "add") {
      const created = await createLookupGroup(req);
      setDialogMode(null);
      await loadGroups(created.id);
    } else if (dialogMode === "edit" && editingGroup) {
      const updated = await updateLookupGroup(editingGroup.id, req);
      setDialogMode(null);
      await loadGroups(updated.id);
    }
  }

  function handleDeleteGroup(group: LookupGroup) {
    setDeleteGroupDialog(group);
  }

  async function executeDeleteGroup(group: LookupGroup) {
    setDeleteGroupDialog(null);
    setError(null);
    try {
      await deleteLookupGroup(group.id);
      if (selectedId === group.id) setSelectedId(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExportGroup(group: LookupGroup) {
    setError(null);
    try {
      const data = await exportLookupGroup(group.id);
      downloadFile(JSON.stringify(data, null, 2), `${group.name}.json`, {
        mimeType: "application/json",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Import JSON ───────────────────────────────────────────────────────────────

  async function executeImport(payload: unknown) {
    setError(null);
    try {
      // Mirror Java Swing's 2-step import (GroupPanel.java:233-305): create/update
      // group with empty values, then bulk-load values via the dedicated endpoint.
      // The /groups/import endpoint silently skips values for JSON-type tables, so
      // sending values inline produces a group with no values.
      const file = payload as { group?: Record<string, unknown>; values?: unknown };
      const rawGroup = file.group;
      if (!rawGroup || typeof rawGroup !== "object") {
        setError("Invalid import file: missing 'group' object.");
        return;
      }

      // Strip server-managed fields so create/update doesn't carry stale IDs.
      const {
        id: _id,
        createdDate: _c,
        updatedDate: _u,
        ...groupRequest
      } = rawGroup as Record<string, unknown>;
      void _id;
      void _c;
      void _u;

      const importResp = await importLookupGroup(
        { group: groupRequest as unknown as LookupGroupRequest, values: {} },
        true
      );

      const valuesField = file.values;
      const values =
        valuesField && typeof valuesField === "object" && !Array.isArray(valuesField)
          ? (valuesField as Record<string, string>)
          : {};

      if (Object.keys(values).length > 0) {
        importCancelRef.current = false;
        setImportProgress({ imported: 0, total: Object.keys(values).length });
        const { cancelled } = await importLookupValuesChunked(
          importResp.groupId,
          values,
          /* clearExisting */ true,
          {
            onProgress: (imported, total) => setImportProgress({ imported, total }),
            isCancelled: () => importCancelRef.current,
          }
        );
        if (cancelled) {
          // Use a toast, not setError: loadGroups below clears the error banner
          // synchronously, so a persistent message would never render.
          toast.info("Import cancelled. Values imported before cancelling were kept.");
        }
      }

      await loadGroups(importResp.groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportProgress(null);
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────────

  const isHorizontal = toolbarPos === "top" || toolbarPos === "bottom";

  const toolbar = (
    <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
      <LookupsActionPanel
        position={toolbarPos}
        loading={loading}
        hasSelection={selectedGroup !== null}
        activeTab={activeTab}
        onRefresh={() => loadGroups(selectedId ?? undefined)}
        onSettings={() => setShowSettings(true)}
        onAddGroup={() => {
          setEditingGroup(undefined);
          setDialogMode("add");
        }}
        onImportGroup={() => setShowImportDialog(true)}
        onEditGroup={() => {
          if (selectedGroup) {
            setEditingGroup(selectedGroup);
            setDialogMode("edit");
          }
        }}
        onExportGroup={() => {
          if (selectedGroup) handleExportGroup(selectedGroup);
        }}
        onDeleteGroup={() => {
          if (selectedGroup) handleDeleteGroup(selectedGroup);
        }}
        valuesActions={valuesActions}
        cacheActions={cacheActions}
      />
    </DockableToolbar>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white dark:bg-gray-900">
      <PageHeader title="Lookup Manager" />

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {/* Toolbar + main content */}
      <div className={`flex flex-1 min-h-0 ${isHorizontal ? "flex-col" : "flex-row"}`}>
        {(toolbarPos === "left" || toolbarPos === "top") && toolbar}

        {/* Main content: left panel + right panel */}
        <div ref={containerRef} className="flex flex-1 overflow-hidden min-h-0">
          {/* ── Left panel: Group list ── */}
          <div
            className="shrink-0 border-r border-border flex flex-col overflow-hidden relative"
            style={{ width: panelWidth }}
          >
            {/* Search bar */}
            <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
              <Input
                type="text"
                placeholder="Search groups…"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                density={viewDensity}
                className="flex-1 min-w-0 text-sm"
              />
            </div>

            {/* Group list */}
            <div className="flex-1 overflow-y-auto">
              {loading && groups.length === 0 ? (
                <div className="flex items-center justify-center p-6 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading…
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="p-4 text-xs text-gray-400 dark:text-gray-500 italic text-center">
                  {groupSearch
                    ? "No matching groups."
                    : "No lookup groups. Click \u201cAdd Group\u201d to create one."}
                </div>
              ) : (
                filteredGroups.map((group) => {
                  const selected = group.id === selectedId;
                  return (
                    <ContextMenu key={group.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={`flex items-center justify-between px-3 py-2.5 cursor-pointer select-none border-b border-border ${
                            selected
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                              : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"
                          }`}
                          onClick={() => {
                            setSelectedId(group.id);
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{group.name}</div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {fmtDate(group.updatedDate)}
                            </div>
                          </div>
                          <div
                            className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-2 font-medium ${
                              group.valueType === "JSON"
                                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                            }`}
                          >
                            {group.valueType}
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            setSelectedId(group.id);
                            setEditingGroup(group);
                            setDialogMode("edit");
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-2" />
                          Edit
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => handleExportGroup(group)}>
                          <Download className="w-3.5 h-3.5 mr-2" />
                          Export JSON
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() => handleDeleteGroup(group)}
                          className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </div>

            {/* Footer: group count */}
            {groups.length > 0 && (
              <div className="px-3 py-2 border-t border-border text-xs text-gray-400 dark:text-gray-500">
                {filteredGroups.length === groups.length
                  ? `${groups.length} group${groups.length !== 1 ? "s" : ""}`
                  : `${filteredGroups.length} of ${groups.length} groups`}
              </div>
            )}

            {/* Resize handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-500/40 z-10"
              onMouseDown={handleResizeMouseDown}
            />
          </div>

          {/* ── Right panel: Tabs ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedGroup ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3">
                <Database className="w-10 h-10 opacity-20" />
                <p className="text-sm">No group selected. Please choose one to proceed.</p>
              </div>
            ) : (
              <>
                {/* Tab bar */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
                  <TabsList>
                    {TABS.map(({ key, label }) => (
                      <TabsTrigger key={key} value={key}>
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                {/* Tab content */}
                <div className="flex-1 overflow-hidden">
                  {activeTab === "details" && <DetailsTab group={selectedGroup} />}
                  {activeTab === "values" && (
                    <ValuesTab
                      group={selectedGroup}
                      actionsRef={valuesActionsRef}
                      onActionsChanged={bumpActions}
                    />
                  )}
                  {activeTab === "cache" && (
                    <CacheStatusTab
                      group={selectedGroup}
                      actionsRef={cacheActionsRef}
                      onActionsChanged={bumpActions}
                    />
                  )}
                  {activeTab === "history" && <HistoryTab group={selectedGroup} />}
                </div>
              </>
            )}
          </div>
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && toolbar}
      </div>

      {/* Group Dialog */}
      {dialogMode !== null && (
        <GroupDialog
          mode={dialogMode}
          initialGroup={editingGroup}
          onSave={handleSaveGroup}
          onClose={() => {
            setDialogMode(null);
            setEditingGroup(undefined);
          }}
        />
      )}

      {/* Settings Dialog */}
      {showSettings && <LookupSettingsDialog onClose={() => setShowSettings(false)} />}

      {/* Import group dialog (System defaults + File) */}
      {showImportDialog && (
        <ImportGroupDialog
          onClose={() => setShowImportDialog(false)}
          onImport={(payload, groupName) => {
            setShowImportDialog(false);
            setPendingImport({ groupName, payload });
          }}
        />
      )}

      {pendingImport && (
        <ConfirmDialog
          title="Import Lookup Group"
          description={
            <>
              Importing &ldquo;{pendingImport.groupName}&rdquo;. If a group with this name already
              exists, its information will be updated and all existing values will be permanently
              deleted and replaced. Do you want to proceed?
            </>
          }
          confirmLabel="Import"
          onConfirm={() => {
            const { payload } = pendingImport;
            setPendingImport(null);
            void executeImport(payload);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {/* Chunked value-import progress (mirrors Java "Importing CSV" dialog) */}
      <ImportProgressDialog
        open={importProgress !== null}
        imported={importProgress?.imported ?? 0}
        total={importProgress?.total ?? 0}
        onCancel={() => {
          importCancelRef.current = true;
        }}
      />

      {/* Delete group confirmation */}
      {deleteGroupDialog && (
        <TypeToConfirmDialog
          title="Delete Group"
          description={
            <>
              This will permanently delete the group{" "}
              <span className="font-semibold">{deleteGroupDialog.name}</span> and all its values.
              Type <span className="font-mono font-semibold">REMOVEGROUP</span> and click OK to
              continue.
            </>
          }
          confirmWord="REMOVEGROUP"
          onConfirm={() => void executeDeleteGroup(deleteGroupDialog)}
          onCancel={() => setDeleteGroupDialog(null)}
        />
      )}
    </div>
  );
}

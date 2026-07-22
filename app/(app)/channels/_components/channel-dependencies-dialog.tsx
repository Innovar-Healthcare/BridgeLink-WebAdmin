"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, X, ChevronRight } from "lucide-react";
import { DependencyTreeSection } from "./dependency-tree";
import { buildDependencyTree, getCycleCausingChannelIds } from "@/lib/dependency-graph";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChannels } from "@/lib/hooks/use-cache";
import {
  getChannelDependencies,
  setChannelDependencies,
  getCodeTemplateLibraries,
  getResources,
  getChannelXml,
  updateChannelFromXml,
} from "@/lib/api-client";
import { getCodeTemplates, invalidateCodeTemplateCache } from "@/lib/api/api-code-templates";
import { useCodeTemplateSave } from "@/app/(app)/code-templates/_lib/use-code-template-save";
import { getCache, updateChannels } from "@/lib/cache-store";
import type { ChannelDependency } from "@/lib/cache-store";
import type { CodeTemplate, CodeTemplateLibrary, ResourceProperties } from "@/lib/types";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import {
  parseResourceIdsByContext,
  serializeResourceIdsByContext,
  parseDestinationConnectorsFromXml,
  type ResourceIdsByContext,
} from "@/app/(app)/channels/_lib/channel-xml";
import {
  LibraryResourcesPanel,
  type Destination,
} from "@/app/(app)/channels/_components/library-resources-panel";

// ─── Code template library helpers ────────────────────────────────────────────

/** Return whether a library is currently enabled for the given channelId. */
function isLibEnabledForChannel(lib: CodeTemplateLibrary, channelId: string): boolean {
  const enabled = lib.enabledChannelIds ?? [];
  const disabled = lib.disabledChannelIds ?? [];
  if (enabled.includes(channelId)) return true;
  if (lib.includeNewChannels && !disabled.includes(channelId)) return true;
  return false;
}

/**
 * Return a new library object with enabledChannelIds / disabledChannelIds updated to reflect the
 * desired `checked` state for the given channelId.
 *
 * Mirrors Java's `CodeTemplateLibrariesPanel` tableChanged listener, finding #24), which
 * pins explicit membership **unconditionally**, independent of `includeNewChannels`:
 *  - checked   → add to enabledChannelIds, remove from disabledChannelIds
 *  - unchecked → add to disabledChannelIds, remove from enabledChannelIds
 *
 * (An earlier version skipped the enabled/disabled write in the `includeNewChannels` cases. The
 * effective state matched today, but if an admin later flipped the library's `includeNewChannels`
 * flag, those channels would silently gain/lose the library where Java-saved channels keep their
 * explicit membership.)
 */
export function applyLibraryCheck(
  lib: CodeTemplateLibrary,
  channelId: string,
  checked: boolean
): CodeTemplateLibrary {
  const enabledIds = lib.enabledChannelIds ?? [];
  const disabledIds = lib.disabledChannelIds ?? [];

  if (checked) {
    return {
      ...lib,
      enabledChannelIds: enabledIds.includes(channelId) ? enabledIds : [...enabledIds, channelId],
      disabledChannelIds: disabledIds.filter((id) => id !== channelId),
    };
  }
  return {
    ...lib,
    enabledChannelIds: enabledIds.filter((id) => id !== channelId),
    disabledChannelIds: disabledIds.includes(channelId) ? disabledIds : [...disabledIds, channelId],
  };
}

/** Whether two per-library checkbox maps differ (same keys are guaranteed — one snapshot of the
 *  other). Used to skip the authoritative library bulk-write when nothing changed. */
export function libCheckedChanged(
  current: Record<string, boolean>,
  original: Record<string, boolean>
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(original)]);
  for (const k of keys) {
    if ((current[k] ?? false) !== (original[k] ?? false)) return true;
  }
  return false;
}

/** Order-independent comparison of two dependency sets by their {dependentId,dependencyId} pairs. */
export function depsChanged(current: ChannelDependency[], original: ChannelDependency[]): boolean {
  if (current.length !== original.length) return true;
  const key = (d: ChannelDependency) => `${d.dependentId} ${d.dependencyId}`;
  const originalKeys = new Set(original.map(key));
  return current.some((d) => !originalKeys.has(key(d)));
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

type DepDialogTab = "libraries" | "resources" | "deps";

interface Props {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Current channel XML from the editor's local state. When provided, Library Resource
   * changes are applied to this XML and pushed back via `onLibraryResourcesChanged`
   * instead of being written directly to the server. This preserves any unsaved edits
   * the user has made elsewhere in the editor and marks the channel dirty so the user
   * can review the change before saving.
   */
  currentXml?: string | null;
  /**
   * Called with updated channel XML when Library Resources change. When omitted, the
   * dialog falls back to fetching the server XML and writing it back directly.
   */
  onLibraryResourcesChanged?: (newXml: string) => void;
}

export function ChannelDependenciesDialog({
  channelId,
  open,
  onOpenChange,
  currentXml,
  onLibraryResourcesChanged,
}: Props) {
  const { channels } = useChannels();
  const { viewDensity } = useCompactMode();
  // Shared code-template save flow: attempt override=false, prompt + retry on conflict.
  const { saveTemplates, conflictDialog: libraryConflictDialog } = useCodeTemplateSave();
  const contentPad =
    viewDensity === "comfortable"
      ? "px-6 py-4"
      : viewDensity === "compact"
        ? "px-4 py-2"
        : "px-5 py-3";
  const itemPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DepDialogTab>("libraries");

  // ── Async state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Code Template Libraries ────────────────────────────────────────────────
  const [libraries, setLibraries] = useState<CodeTemplateLibrary[]>([]);
  /** Per-library enabled state for this channel (local working copy). */
  const [libChecked, setLibChecked] = useState<Record<string, boolean>>({});
  /** Open-time snapshot of `libChecked` — used to skip the authoritative library bulk-write
   *  entirely when the user didn't touch any library checkbox, finding #5). */
  const [originalLibChecked, setOriginalLibChecked] = useState<Record<string, boolean>>({});
  /** All code templates fetched alongside libraries — used for the expand view. */
  const [codeTemplates, setCodeTemplates] = useState<CodeTemplate[]>([]);
  /** Filter text for the libraries list. */
  const [libFilter, setLibFilter] = useState("");
  /** Set of library IDs currently expanded to show their templates. */
  const [expandedLibIds, setExpandedLibIds] = useState<Set<string>>(new Set());

  // ── Library Resources ──────────────────────────────────────────────────────
  const [resources, setResources] = useState<ResourceProperties[]>([]);
  const [byContext, setByContext] = useState<ResourceIdsByContext>(new Map());
  const [originalByContext, setOriginalByContext] = useState<ResourceIdsByContext>(new Map());
  const [resourceDestinations, setResourceDestinations] = useState<Destination[]>([]);
  /** Raw channel XML fetched on open — used to serialize resource ID changes. */
  const [fetchedChannelXml, setFetchedChannelXml] = useState<string | null>(null);

  // ── Deploy/Start Dependencies ──────────────────────────────────────────────
  const [localDeps, setLocalDeps] = useState<ChannelDependency[]>([]);
  /** Open-time snapshot of the dependency set — used to skip the authoritative deps PUT when the
   *  set is unchanged, finding #47; mirrors Java ChannelDependenciesPanel.saveChanges). */
  const [originalDeps, setOriginalDeps] = useState<ChannelDependency[]>([]);
  const [searchOn, setSearchOn] = useState("");
  const [searchBy, setSearchBy] = useState("");

  // ── Template id → name lookup (for expand view) ────────────────────────────
  const templateMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const t of codeTemplates) m.set(t.id, t.name);
    return m;
  }, [codeTemplates]);

  // ── Filtered + sorted library list ─────────────────────────────────────────
  const displayedLibraries = useMemo(() => {
    const q = libFilter.trim().toLowerCase();
    return libraries
      .filter(
        (lib) =>
          !q ||
          lib.name.toLowerCase().includes(q) ||
          (lib.description ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [libraries, libFilter]);

  // ── Reset synchronous UI state when the dialog transitions to open ─────────
  // Done during render (the React "adjusting state when a prop changes" idiom)
  // rather than in the effect below, which avoids the cascading-render warning
  // from set-state-in-effect. The async data fetch stays in the effect — its
  // setState calls live inside .then/.catch/.finally continuations, which are
  // not flagged because they run asynchronously.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLoading(true);
      setError(null);
      setActiveTab("libraries");
      setLibFilter("");
      setExpandedLibIds(new Set());
    }
  }

  // ── Load all data when dialog opens ───────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    // Prefer the editor's local XML (may contain unsaved edits) over the server copy.
    // Only fetch from the server when the editor doesn't have it.
    const xmlPromise = currentXml ? Promise.resolve(currentXml) : getChannelXml(channelId);

    Promise.all([
      getCodeTemplateLibraries(),
      getCodeTemplates(),
      getResources(),
      xmlPromise,
      getChannelDependencies(), // fetch fresh — never rely on the Zustand cache snapshot
    ])
      .then(([libs, templates, rsrcs, xml, freshDeps]) => {
        // Code template libraries — sorted alphabetically
        setLibraries(libs);
        setCodeTemplates(templates);
        const checked: Record<string, boolean> = {};
        for (const lib of libs) checked[lib.id] = isLibEnabledForChannel(lib, channelId);
        setLibChecked(checked);
        setOriginalLibChecked(checked);

        // Library resources
        setResources(rsrcs);
        setFetchedChannelXml(xml);
        const parsedByContext = parseResourceIdsByContext(xml);
        setOriginalByContext(parsedByContext);
        setByContext(parsedByContext);
        setResourceDestinations(
          parseDestinationConnectorsFromXml(xml).map((d) => ({
            metaDataId: d.metaDataId,
            name: d.name,
            transportName: d.transportName,
          }))
        );

        // Deploy/Start dependencies — use freshly fetched data, already filtered by
        // getChannelDependencies() to exclude malformed entries like {"set": null}.
        setLocalDeps(freshDeps);
        setOriginalDeps(freshDeps);
        setSearchOn("");
        setSearchBy("");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
    // `currentXml` is intentionally captured only at open — mid-session edits from
    // elsewhere in the editor should not re-trigger this effect and reset the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channelId]);

  // ── Derived state for deps tab ─────────────────────────────────────────────

  const dependsOnIds = localDeps
    .filter((d) => d.dependentId === channelId)
    .map((d) => d.dependencyId);
  const dependedOnByIds = localDeps
    .filter((d) => d.dependencyId === channelId)
    .map((d) => d.dependentId);

  const channelNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of channels) m.set(c.id, c.name);
    return m;
  }, [channels]);

  const dependsOnTree = useMemo(
    () => buildDependencyTree(channelId, "depends-on", localDeps, channelNameMap),
    [channelId, localDeps, channelNameMap]
  );
  const dependedByTree = useMemo(
    () => buildDependencyTree(channelId, "depended-by", localDeps, channelNameMap),
    [channelId, localDeps, channelNameMap]
  );

  // Channels that would create a cycle if added — used to filter the picker so the user
  // can't pick them (matches Java client; server also rejects cycles).
  const cycleForOn = useMemo(
    () => getCycleCausingChannelIds(channelId, "depends-on", localDeps),
    [channelId, localDeps]
  );
  const cycleForBy = useMemo(
    () => getCycleCausingChannelIds(channelId, "depended-by", localDeps),
    [channelId, localDeps]
  );

  const availableForOn = channels
    .filter((c) => !cycleForOn.has(c.id) && !dependsOnIds.includes(c.id))
    .filter((c) => !searchOn || c.name.toLowerCase().includes(searchOn.toLowerCase()));

  const availableForBy = channels
    .filter((c) => !cycleForBy.has(c.id) && !dependedOnByIds.includes(c.id))
    .filter((c) => !searchBy || c.name.toLowerCase().includes(searchBy.toLowerCase()));

  // ── Mutation helpers for deps tab ──────────────────────────────────────────

  function addDependsOn(targetId: string) {
    setLocalDeps((prev) => [...prev, { dependentId: channelId, dependencyId: targetId }]);
    setSearchOn("");
  }

  function removeDependsOn(targetId: string) {
    setLocalDeps((prev) =>
      prev.filter((d) => !(d.dependentId === channelId && d.dependencyId === targetId))
    );
  }

  function addDependedOnBy(sourceId: string) {
    setLocalDeps((prev) => [...prev, { dependentId: sourceId, dependencyId: channelId }]);
    setSearchBy("");
  }

  function removeDependedOnBy(sourceId: string) {
    setLocalDeps((prev) =>
      prev.filter((d) => !(d.dependentId === sourceId && d.dependencyId === channelId))
    );
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // 1. Code template libraries — write the authoritative set only when the user actually
      //    toggled a library, finding #5). The `_bulkUpdate` libraries field is
      //    delete-if-absent, so an unconditional write would clobber/delete any library another
      //    session created or edited while this dialog was open. When changed, go through the
      //    shared conflict-aware flow (override=false → prompt → retry) instead of force-overwriting.
      if (libCheckedChanged(libChecked, originalLibChecked)) {
        try {
          const updatedLibs = libraries.map((lib) =>
            applyLibraryCheck(lib, channelId, libChecked[lib.id] ?? false)
          );
          const outcome = await saveTemplates({
            libraries: updatedLibs,
            removedLibraryIds: [],
            updatedCodeTemplates: [],
            removedCodeTemplateIds: [],
          });
          // User declined the overwrite prompt — leave the dialog open so they can retry/cancel.
          if (outcome.status === "cancelled") {
            setSaving(false);
            return;
          }
          // Invalidate cached libraries so the Reference panel picks up updated
          // enabledChannelIds on its next render (fixes regression).
          invalidateCodeTemplateCache();
          window.dispatchEvent(new Event("bl-code-template-cache-invalidated"));
        } catch (e) {
          throw new Error(`Code template libraries: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 2. Library resources — only update channel XML if the selection has actually changed.
      //    Skipping when unchanged avoids an unnecessary PUT and prevents 500s from
      //    DOMParser/XMLSerializer round-trip differences on unmodified XML.
      //
      //    When `onLibraryResourcesChanged` is provided, push the new XML into the editor's
      //    local state instead of writing directly to the server. This marks the channel
      //    dirty and lets the user review/cancel the change via the editor's Save flow.
      if (fetchedChannelXml) {
        const canonicalize = (m: ResourceIdsByContext) =>
          JSON.stringify(
            Array.from(m.entries())
              .map(([k, v]) => [k, [...v].sort()])
              .sort(([a], [b]) => String(a).localeCompare(String(b)))
          );
        if (canonicalize(byContext) !== canonicalize(originalByContext)) {
          try {
            const newXml = serializeResourceIdsByContext(fetchedChannelXml, byContext, resources);
            if (onLibraryResourcesChanged) {
              onLibraryResourcesChanged(newXml);
            } else {
              await updateChannelFromXml(channelId, newXml);
            }
          } catch (e) {
            throw new Error(`Library resources: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // 3. Deploy/Start dependencies — write only when the set changed, finding #47;
      //    mirrors Java ChannelDependenciesPanel.saveChanges). The PUT is authoritative (replaces
      //    the entire global set), so an unconditional write needlessly widens the clobber window.
      if (depsChanged(localDeps, originalDeps)) {
        try {
          await setChannelDependencies(localDeps);
          // Refresh the deps slice in cache without a full network reload
          const freshDeps = await getChannelDependencies();
          const c = getCache();
          updateChannels(c.channels, c.channelGroups, c.channelMetadata, freshDeps, c.channelTags);
        } catch (e) {
          throw new Error(
            `Deploy/start dependencies: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const TABS: { id: DepDialogTab; label: string }[] = [
    { id: "libraries", label: "Code Template Libraries" },
    { id: "resources", label: "Library Resources" },
    { id: "deps", label: "Deploy/Start Dependencies" },
  ];

  return (
    <>
      {/* Concurrent-edit overwrite prompt for code-template libraries/. */}
      {libraryConflictDialog}
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Override default grid/p-6 to support flex column with scrollable content */}
        <DialogContent className="sm:max-w-2xl flex flex-col gap-0 max-h-[85vh] overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6 pr-12 pb-0 shrink-0">
            <DialogTitle>Channel Dependencies</DialogTitle>
            <DialogDescription>
              Configure code template libraries, library resources, and deploy/start order for this
              channel.
            </DialogDescription>
          </DialogHeader>

          {/* ── Tab bar ──────────────────────────────────────────────────────── */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as DepDialogTab)}
            className="mt-4"
          >
            <TabsList>
              {TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* ── Scrollable tab content ────────────────────────────────────────── */}
          {/* Resources tab uses a two-pane split layout that manages its own scroll — no outer padding or scroll */}
          <div
            className={
              activeTab === "resources"
                ? "flex-1 min-h-0 flex flex-col overflow-hidden"
                : `flex-1 overflow-y-auto min-h-0 ${contentPad}`
            }
          >
            {loading ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-400 dark:text-gray-500">
                Loading…
              </div>
            ) : (
              <>
                {/* ── Code Template Libraries ─────────────────────────────────── */}
                {activeTab === "libraries" && (
                  <div className="space-y-2">
                    {/* Filter input */}
                    {libraries.length > 0 && (
                      <div
                        className="flex items-center gap-1.5 h-8 px-2.5 rounded border border-border
                      bg-white dark:bg-gray-800 focus-within:border-blue-500 dark:focus-within:border-blue-400
                      focus-within:ring-1 focus-within:ring-blue-500/30"
                      >
                        <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                        <input
                          type="text"
                          value={libFilter}
                          onChange={(e) => setLibFilter(e.target.value)}
                          placeholder="Filter libraries…"
                          className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100
                          placeholder:text-gray-400 dark:placeholder:text-gray-500"
                        />
                        {libFilter && (
                          <button
                            onClick={() => setLibFilter("")}
                            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Library list */}
                    <div className="space-y-0.5">
                      {libraries.length === 0 ? (
                        <p className="text-sm italic text-gray-400 dark:text-gray-500 py-2">
                          No code template libraries configured on this server.
                        </p>
                      ) : displayedLibraries.length === 0 ? (
                        <p className="text-sm italic text-gray-400 dark:text-gray-500 py-2">
                          No libraries match &ldquo;{libFilter}&rdquo;.
                        </p>
                      ) : (
                        displayedLibraries.map((lib) => {
                          const isExpanded = expandedLibIds.has(lib.id);
                          const templateNames = lib.codeTemplateIds
                            .map((id) => templateMap.get(id) ?? id)
                            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
                          return (
                            <div key={lib.id} className="rounded-md">
                              <div
                                className={`flex items-start gap-1 px-1 ${itemPy} rounded-md hover:bg-gray-50 dark:hover:bg-gray-800`}
                              >
                                {/* Expand toggle */}
                                <button
                                  onClick={() =>
                                    setExpandedLibIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(lib.id)) next.delete(lib.id);
                                      else next.add(lib.id);
                                      return next;
                                    })
                                  }
                                  disabled={lib.codeTemplateIds.length === 0}
                                  className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 hover:text-gray-600
                                  dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  title={
                                    lib.codeTemplateIds.length === 0
                                      ? "No templates"
                                      : isExpanded
                                        ? "Collapse"
                                        : "Expand"
                                  }
                                >
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  />
                                </button>

                                {/* Checkbox + label */}
                                <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={libChecked[lib.id] ?? false}
                                    onChange={(e) =>
                                      setLibChecked((prev) => ({
                                        ...prev,
                                        [lib.id]: e.target.checked,
                                      }))
                                    }
                                    className="mt-0.5 w-3.5 h-3.5 accent-blue-600 cursor-pointer shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                      {lib.name}
                                      <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-500">
                                        ({lib.codeTemplateIds.length} template
                                        {lib.codeTemplateIds.length !== 1 ? "s" : ""})
                                      </span>
                                    </div>
                                    {lib.description && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                        {lib.description}
                                      </div>
                                    )}
                                    {lib.includeNewChannels && (
                                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">
                                        Included in new channels by default
                                      </div>
                                    )}
                                  </div>
                                </label>
                              </div>

                              {/* Expanded template list */}
                              {isExpanded && templateNames.length > 0 && (
                                <div className="ml-8 mb-1 border-l-2 border-border pl-3 space-y-0.5">
                                  {templateNames.map((name) => (
                                    <div
                                      key={name}
                                      className="text-xs text-gray-600 dark:text-gray-400 py-0.5 truncate"
                                      title={name}
                                    >
                                      {name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* ── Library Resources ────────────────────────────────────────── */}
                {activeTab === "resources" && (
                  <LibraryResourcesPanel
                    resources={resources}
                    byContext={byContext}
                    destinations={resourceDestinations}
                    onChange={setByContext}
                  />
                )}

                {/* ── Deploy/Start Dependencies ────────────────────────────────── */}
                {activeTab === "deps" && (
                  <div className="space-y-6">
                    <DependencyTreeSection
                      title="This channel depends on…"
                      description="These channels will be deployed and started before this one."
                      rootChildren={dependsOnTree}
                      onRemoveDirect={removeDependsOn}
                      search={searchOn}
                      onSearchChange={setSearchOn}
                      availableChannels={availableForOn}
                      onAdd={addDependsOn}
                      storageKey={`${channelId}-depends-on`}
                    />

                    <hr className="border-border" />

                    <DependencyTreeSection
                      title="Depended on by…"
                      description="These channels will be deployed and started after this one."
                      rootChildren={dependedByTree}
                      onRemoveDirect={removeDependedOnBy}
                      search={searchBy}
                      onSearchChange={setSearchBy}
                      availableChannels={availableForBy}
                      onAdd={addDependedOnBy}
                      storageKey={`${channelId}-depended-by`}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {error && (
            <div
              className="mx-6 mb-0 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200
            dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400 shrink-0"
            >
              {error}
            </div>
          )}

          <DialogFooter className="px-6 pb-4 pt-3 border-t border-border shrink-0 mt-2">
            <button
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded border border-border
              text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white font-medium
              hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

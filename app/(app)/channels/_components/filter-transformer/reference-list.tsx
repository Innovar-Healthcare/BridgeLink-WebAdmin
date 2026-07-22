"use client";

/**
 * Reference list UI for the filter/transformer Reference panel.
 *
 * Exports:
 *   ReferenceTab  — tab content rendered by ReferencePanel
 *   RefItemRow    — individual draggable reference item (used by scripts-tab)
 *   GroupedList   — grouped item list (used internally + scripts-tab)
 *   FlatList      — flat item list (used by scripts-tab)
 */

import { useState, useMemo, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { formatJsVarRef } from "@/lib/velocity-format";
import { useVerticalSplitResize } from "@/lib/hooks/use-vertical-split-resize";
import {
  getCodeTemplatesCached,
  getCodeTemplateLibrariesCached,
} from "@/lib/api/api-code-templates";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import {
  isConnectorTemplate,
  templateToRefItem,
  filterTemplatesByChannel,
  isLibraryEnabledForChannel,
  findDuplicateSignatures,
  type SignatureConflict,
} from "@/lib/code-template-utils";
import { CATEGORIES } from "@/lib/reference-data";
import type { RefItem, RefCategory } from "@/lib/reference-data";
import { pluginRegistry } from "@/lib/plugin-registry";
import { useEnabledPluginNames } from "@/lib/installed-plugins";
import { useLicensedPluginIds } from "@/lib/plugin-license";
import { DATA_TYPE_REGISTRY } from "../../_datatypes/index";

// Re-export types so existing importers of reference-panel can switch to this file.
export type { RefItem, RefCategory };

// ─── Variable row (draggable, for Available Variables panel) ──────────────────

function VariableRow({ name }: { name: string }) {
  // Drag inserts the $('varName') getter shorthand (mirrors Java VariableListHandler with TransferMode.JAVASCRIPT)
  const dragText = formatJsVarRef(name);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", dragText);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="rounded px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab active:cursor-grabbing select-none"
    >
      <code className="text-xs font-mono text-emerald-700 dark:text-emerald-300">{name}</code>
    </div>
  );
}

// ─── Individual item row ──────────────────────────────────────────────────────

export function RefItemRow({ item }: { item: RefItem }) {
  const hasCode = !!item.code;
  const codeIsDifferent = hasCode && item.code !== item.name;

  const dragText = item.code ?? item.name;

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("text/plain", dragText);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group/tip relative rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab active:cursor-grabbing select-none"
    >
      <code className="text-xs font-mono text-blue-700 dark:text-blue-300 break-all pointer-events-none">
        {item.name}
      </code>

      {/* Floating tooltip — positioned absolute so it doesn't shift the list */}
      <div className="invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 absolute left-0 top-full z-10 w-full transition-opacity duration-200 delay-0 group-hover/tip:delay-300 pointer-events-none">
        <div className="mt-1 bg-gray-700 dark:bg-gray-600 rounded px-2 py-1.5 space-y-1 shadow-lg max-h-40 overflow-auto">
          <p className="text-xs text-gray-100 dark:text-gray-200 leading-relaxed">
            {item.description}
          </p>
          {codeIsDifferent && (
            <pre className="text-xs font-mono text-yellow-300 dark:text-yellow-200 whitespace-pre-wrap break-all leading-relaxed border-t border-border pt-1 mt-1">
              {item.code}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Flat list (single category) ─────────────────────────────────────────────

export function FlatList({ items }: { items: RefItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">
        No matches found.
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => (
        <RefItemRow key={i} item={item} />
      ))}
    </div>
  );
}

// ─── Grouped list (for "All" category) ───────────────────────────────────────

export function GroupedList({ items }: { items: Array<RefItem & { categoryLabel: string }> }) {
  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">
        No matches found.
      </div>
    );
  }

  const grouped: Map<string, RefItem[]> = new Map();
  for (const item of items) {
    const existing = grouped.get(item.categoryLabel);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(item.categoryLabel, [item]);
    }
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([label, grpItems]) => (
        <div key={label}>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide py-1">
            {label}
          </div>
          <FlatList items={grpItems} />
        </div>
      ))}
    </div>
  );
}

// ─── Reference tab ─────────────────────────────────────────────────────────────
// CONNECTOR_CONTEXT_TYPES is imported from @/lib/code-template-utils.

export function ReferenceTab({
  variables = [],
  channelId,
  inboundDataType,
  isResponseTransformer = false,
}: {
  variables?: string[];
  channelId?: string;
  inboundDataType?: string;
  /**
   * When true, the "Response Transformer" category is included (responseStatus
   * etc. are in scope here, matching Java's ReferenceListFactory). The
   * "Postprocessor" category remains hidden in this context.
   */
  isResponseTransformer?: boolean;
}) {
  const [categoryId, setCategoryId] = useState("__all__");
  const [filter, setFilter] = useState("");
  const [userTemplates, setUserTemplates] = useState<CodeTemplate[]>([]);
  const [libraries, setLibraries] = useState<CodeTemplateLibrary[]>([]);

  const hasVars = variables.length > 0;

  const { topRatio, containerRef, onDragMouseDown } = useVerticalSplitResize({
    storageKey: "bl-ft-ref-vars-split",
    defaultRatio: 0.7,
    minPx: 60,
  });

  // Fetch user-defined code templates and libraries (cached at module level).
  // Re-runs when channelId changes. Also listens for cache invalidation events
  // (e.g. after saving library changes in the dependencies dialog) so
  // the "User Defined Functions" category picks up updated enabledChannelIds.
  const [fetchSeq, setFetchSeq] = useState(0);
  useEffect(() => {
    getCodeTemplatesCached()
      .then(setUserTemplates)
      .catch(() => {}); // silently ignore — reference panel works fine without user templates
    getCodeTemplateLibrariesCached()
      .then(setLibraries)
      .catch(() => {});
  }, [channelId, fetchSeq]);

  // Listen for the custom event dispatched after code template cache invalidation
  useEffect(() => {
    function onInvalidate() {
      setFetchSeq((n) => n + 1);
    }
    window.addEventListener("bl-code-template-cache-invalidated", onInvalidate);
    return () => window.removeEventListener("bl-code-template-cache-invalidated", onInvalidate);
  }, []);

  const inputCls =
    "w-full h-6 px-2 text-xs rounded border border-border " +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  // Build dynamic "User Defined Functions" category from templates with connector context.
  // Placed first so it appears at the top of the category list (matches Java UI).
  // templateToRefItem() handles drag-drop per type: FUNCTION → call only; DRAG_AND_DROP_CODE → full code.
  const userFunctionsCategory = useMemo<RefCategory | null>(() => {
    const channelFiltered = filterTemplatesByChannel(userTemplates, libraries, channelId);
    const matching = channelFiltered.filter(isConnectorTemplate);
    if (matching.length === 0) return null;
    return {
      id: "userFunctions",
      label: "User Defined Functions",
      items: matching.map(templateToRefItem),
    };
  }, [userTemplates, libraries, channelId]);

  // Detect duplicate function signatures — scoped to templates visible in the
  // connector (filter/transformer) context. Channel-script-only templates are
  // irrelevant here and would be false positives.
  const signatureConflicts = useMemo<SignatureConflict[]>(() => {
    if (!channelId || libraries.length < 2 || userTemplates.length === 0) return [];
    const channelFiltered = filterTemplatesByChannel(userTemplates, libraries, channelId);
    const visible = channelFiltered.filter(isConnectorTemplate);
    if (visible.length === 0) return [];
    const templateMap = new Map(visible.map((t) => [t.id, t]));
    const enabledLibs = libraries.filter((lib) => isLibraryEnabledForChannel(lib, channelId));
    return findDuplicateSignatures(templateMap, enabledLibs);
  }, [userTemplates, libraries, channelId]);

  // Categories excluded by context,:
  // - "postprocessor": `message` (ImmutableMessage) is not in scope in connectors
  // - "response": `responseStatus` etc. are only available in response transformers,
  //   so we include this category only when the editor is a response transformer.
  const filteredCategories = useMemo(
    () =>
      CATEGORIES.filter(
        (cat) => cat.id !== "postprocessor" && (cat.id !== "response" || isResponseTransformer)
      ),
    [isResponseTransformer]
  );

  // Build a category for code snippets contributed by the active inbound data
  // type plugin (mirrors Java's DataTypeCodeTemplatePlugin extension point).
  // Placed before user-defined functions so plugin snippets appear near the top.
  const pluginContribsCategory = useMemo<RefCategory | null>(() => {
    if (!inboundDataType) return null;
    const plugin = DATA_TYPE_REGISTRY.get(inboundDataType);
    const contribs = plugin?.codeTemplateContributions;
    if (!contribs || contribs.length === 0) return null;
    const categoryLabel =
      contribs[0].category ?? `${plugin.displayName ?? inboundDataType} Functions`;
    return {
      id: `dt-plugin-${inboundDataType}`,
      label: categoryLabel,
      items: contribs.map((c) => ({
        name: c.name,
        description: c.description ?? "",
        code: c.code,
        scriptExclude: true as const,
      })),
    };
  }, [inboundDataType]);

  // Categories contributed by plugins via registerReferenceCategory() (mirrors
  // Java's CodeTemplatePlugin.getReferenceItems()). Gated on server-enablement
  // AND license: a category with a pluginName is hidden unless that
  // plugin is installed AND enabled, and one with a licensedPluginId is hidden
  // unless that plugin is licensed on the connected server.
  const enabledPluginNames = useEnabledPluginNames();
  const licensedPluginIds = useLicensedPluginIds();
  const pluginCategories = useMemo<RefCategory[]>(
    () =>
      pluginRegistry.referenceCategories
        .filter(
          (c) =>
            (!c.pluginName || enabledPluginNames.has(c.pluginName)) &&
            (!c.licensedPluginId || licensedPluginIds.has(c.licensedPluginId))
        )
        .map((c) => ({ id: c.id, label: c.label, items: c.items })),
    [enabledPluginNames, licensedPluginIds]
  );

  // Effective categories: plugin contributions first (if any), then user functions,
  // then static built-ins, then plugin-registered categories last (matches Java's
  // ordering of non-enum categories after the built-in Category enum).
  const effectiveCategories = useMemo<RefCategory[]>(
    () => [
      ...(pluginContribsCategory ? [pluginContribsCategory] : []),
      ...(userFunctionsCategory ? [userFunctionsCategory] : []),
      ...filteredCategories,
      ...pluginCategories,
    ],
    [pluginContribsCategory, userFunctionsCategory, filteredCategories, pluginCategories]
  );

  // All items flattened (for "All" grouped view) — recomputed when user templates change.
  const allItems = useMemo(
    () =>
      effectiveCategories.flatMap((cat) =>
        cat.items.map((item) => ({ ...item, categoryLabel: cat.label }))
      ),
    [effectiveCategories]
  );

  const lower = filter.toLowerCase();

  const displayItems: Array<RefItem & { categoryLabel?: string }> =
    categoryId === "__all__"
      ? allItems.filter((item) => !lower || item.name.toLowerCase().includes(lower))
      : (effectiveCategories.find((c) => c.id === categoryId)?.items ?? []).filter(
          (item) => !lower || item.name.toLowerCase().includes(lower)
        );

  const showGroupHeaders = categoryId === "__all__";

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header: Category + Filter */}
      <div className="px-2 pt-2 space-y-2 shrink-0">
        {/* Signature conflict warning */}
        {signatureConflicts.length > 0 && (
          <div className="px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-[10px] text-amber-800 dark:text-amber-300 space-y-0.5">
            <div className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Signature conflict
            </div>
            {signatureConflicts.map((c) => (
              <div key={`${c.functionName}/${c.paramCount}`}>
                <code className="font-mono">
                  {c.functionName}({c.paramCount} param{c.paramCount !== 1 ? "s" : ""})
                </code>{" "}
                in {c.templates.map((t) => `"${t.libraryName}"`).join(", ")}
              </div>
            ))}
          </div>
        )}
        {/* Category: dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Category:</span>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setFilter("");
            }}
            className={inputCls}
          >
            <option value="__all__">All</option>
            {effectiveCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Filter: text field */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Filter:</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className={inputCls}
          />
        </div>
      </div>

      {/* Resizable split area — ref list (top) + variables (bottom).
          containerRef is on this inner div so the ratio % excludes the header. */}
      <div className="flex flex-col flex-1 min-h-0" ref={containerRef}>
        {/* Reference list — scrollable */}
        <div
          className={"min-h-0 overflow-auto px-2 py-1 " + (hasVars ? "" : "flex-1")}
          style={hasVars ? { height: `${topRatio * 100}%` } : undefined}
        >
          {showGroupHeaders ? (
            <GroupedList items={displayItems as Array<RefItem & { categoryLabel: string }>} />
          ) : (
            <FlatList items={displayItems} />
          )}
        </div>

        {/* Available Variables — bottom section with resizable border */}
        {hasVars && (
          <>
            <div
              onMouseDown={onDragMouseDown}
              className="h-1 shrink-0 cursor-row-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
              title="Drag to resize"
            />
            <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
              <div className="px-2 py-1 border-b border-border shrink-0">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Available Variables
                </span>
              </div>
              <div className="flex-1 overflow-auto px-2 py-1">
                {variables.map((v) => (
                  <VariableRow key={v} name={v} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * Code template tree table — columned table preserving the library > template hierarchy.
 * Uses shared column infrastructure (useColumnConfig, useSortable, SortableHeaderCell, ColumnPicker).
 * Supports panel resize via drag handle, and right-click context menus.
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Code2,
  GitCommit,
  PanelBottom,
  PanelRight,
} from "lucide-react";
import type { SignatureConflict } from "@/lib/code-template-utils";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { SortableHeaderCell } from "@/components/sortable-header-cell";
import {
  Table,
  TableColGroup,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/data-table";
import { ColumnPicker } from "@/components/column-picker";
import {
  CODE_TEMPLATE_COLS,
  CODE_TEMPLATE_COLS_TOP,
  getLibraryColValue,
  getTemplateColValue,
  type CodeTemplateCol,
} from "../_lib/code-template-columns";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─── Context menu types ───────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  kind: "library" | "template";
  id: string;
  /** Parent library ID (for templates) */
  libraryId?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CodeTemplateTreeTableProps {
  libraries: CodeTemplateLibrary[];
  templates: Map<string, CodeTemplate>;
  filterText: string;
  onFilterChange: (text: string) => void;
  loading: boolean;

  // Selection
  selectedLibraryId: string | null;
  selectedTemplateId: string | null;
  onSelectLibrary: (id: string) => void;
  onSelectTemplate: (id: string) => void;

  // Expand/collapse
  expandedLibraryIds: ReadonlySet<string>;
  onToggleExpand: (id: string) => void;
  onExpandAll: (ids: string[]) => void;
  onCollapseAll: () => void;

  // Tree visibility
  treeVisible: boolean;
  onHideTree: () => void;
  onShowTree: () => void;

  // Layout (left/right vs top/bottom split)
  layout: "left" | "top";
  /** Split ratio (0–100) for the tree panel, owned by the page via useSplitResize. */
  splitPct: number;
  onToggleLayout: () => void;

  // Status badges
  isLibraryNew: (id: string) => boolean;
  isLibraryModified: (id: string) => boolean;
  isTemplateNew: (id: string) => boolean;
  isTemplateModified: (id: string) => boolean;

  // Context menu actions
  onAddLibrary: () => void;
  onAddTemplateToLibrary: (libraryId: string) => void;
  onDeleteLibrary: (libraryId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onFindUsage: (templateId: string) => void;
  onExportTemplate: (templateId: string) => void;
  onExportLibrary: (libraryId: string) => void;
  onExportAllLibraries: () => void;
  getSignatureConflict?: (templateId: string) => SignatureConflict | null;
  /** IDs of code templates with uncommitted changes in the version history repo. */
  repoChangedTemplateIds?: Set<string> | null;
  /** Opens version history for a library. Only provided when version history plugin is installed. */
  onViewHistoryLibrary?: (id: string) => void;
  /** Opens version history for a template. Only provided when version history plugin is installed. */
  onViewHistoryTemplate?: (id: string) => void;
}

export function CodeTemplateTreeTable({
  libraries,
  templates,
  filterText,
  onFilterChange,
  loading,
  selectedLibraryId,
  selectedTemplateId,
  onSelectLibrary,
  onSelectTemplate,
  expandedLibraryIds,
  onToggleExpand,
  onExpandAll,
  onCollapseAll,
  treeVisible,
  onHideTree,
  onShowTree,
  layout,
  splitPct,
  onToggleLayout,
  isLibraryNew,
  isLibraryModified,
  isTemplateNew,
  isTemplateModified,
  onAddLibrary,
  onAddTemplateToLibrary,
  onDeleteLibrary,
  onDeleteTemplate,
  onFindUsage,
  onExportTemplate,
  onExportLibrary,
  onExportAllLibraries,
  getSignatureConflict,
  repoChangedTemplateIds,
  onViewHistoryLibrary,
  onViewHistoryTemplate,
}: CodeTemplateTreeTableProps) {
  // Each layout remembers its own column widths/visibility/order. Top/bottom defaults to the
  // Java client's five columns; left/right keeps the narrower three. useColumnConfig hydrates
  // once on mount and ignores later storageKey/cols changes, so we instantiate both and select
  // the active one by layout rather than swapping a single instance's key.
  const leftCfg = useColumnConfig(CODE_TEMPLATE_COLS, "bl-code-templates-cols-v1");
  const topCfg = useColumnConfig(CODE_TEMPLATE_COLS_TOP, "bl-code-templates-cols-top-v1");
  const { colState, orderedCols, visibleCols, setWidth, setVisible, moveCol, resetToDefaults } =
    layout === "top" ? topCfg : leftCfg;

  const { sort, toggle: toggleSort, sorted } = useSortable<CodeTemplateCol>("name");

  // ── Context menu ──────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Reposition context menu after render to keep it within the viewport.
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = contextMenu;
    if (y + rect.height > window.innerHeight) y = Math.max(0, y - rect.height);
    if (x + rect.width > window.innerWidth) x = Math.max(0, x - rect.width);
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x, y } : null));
    }
  }, [contextMenu]);

  function openContextMenu(
    e: React.MouseEvent,
    kind: "library" | "template",
    id: string,
    libraryId?: string
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, kind, id, libraryId });
  }

  // ── Filter libraries ────────────────────────────────────────────────────────
  const filterLower = filterText.toLowerCase();
  const filteredLibraries = libraries.filter((lib) => {
    if (!filterLower) return true;
    if (lib.name.toLowerCase().includes(filterLower)) return true;
    return lib.codeTemplateIds.some((tid) =>
      (templates.get(tid)?.name ?? "").toLowerCase().includes(filterLower)
    );
  });

  // ── Sort libraries ──────────────────────────────────────────────────────────
  // Sort libraries by their own name/value (decoupled from the shared `sorted`
  // callback used for templates) so library rows are never ordered by template-level
  // data. React Compiler memoizes this computation automatically.
  const sortedLibraries = [...filteredLibraries].sort((a, b) => {
    const av = sort.key ? (getLibraryColValue(a, sort.key) ?? "") : a.name;
    const bv = sort.key ? (getLibraryColValue(b, sort.key) ?? "") : b.name;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: "base",
          });
    return sort.dir === "asc" ? cmp : -cmp;
  });

  // Count the templates actually shown for the current filter. A library whose name matches
  // shows all its templates; otherwise only templates whose own name matches are shown — this
  // mirrors the per-library row filter below so the header count stays consistent with the tree.
  const shownTemplateCount = filteredLibraries.reduce((sum, lib) => {
    const libMatches = !filterLower || lib.name.toLowerCase().includes(filterLower);
    return (
      sum +
      lib.codeTemplateIds.filter((tid) => {
        const t = templates.get(tid);
        if (!t) return false;
        return libMatches || t.name.toLowerCase().includes(filterLower);
      }).length
    );
  }, 0);

  // ── Collapsed state ─────────────────────────────────────────────────────────
  if (!treeVisible) {
    return (
      <div
        className={cn(
          "shrink-0 flex overflow-hidden bg-white dark:bg-gray-900",
          layout === "top"
            ? "h-8 w-full border-b border-border items-center px-2"
            : "w-8 flex-col items-center pt-2 border-r border-border"
        )}
      >
        <button
          onClick={onShowTree}
          title="Show library panel"
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          {layout === "top" ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    );
  }

  // Shared button styles for the header controls. Top/bottom layout has room for the
  // Dashboard-style icon+text Expand/Collapse buttons; left/right keeps the compact
  // chevron-only icons.
  const isTop = layout === "top";
  const iconBtn =
    "p-0.5 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300";

  const filterInput = (
    <input
      type="text"
      value={filterText}
      onChange={(e) => onFilterChange(e.target.value)}
      placeholder="Filter…"
      className={cn(
        "border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400",
        isTop ? "w-48 shrink-0" : "w-full"
      )}
    />
  );

  const countSpan = (
    <span className="truncate text-xs text-gray-400 dark:text-gray-500">
      {filteredLibraries.length} {filteredLibraries.length === 1 ? "Library" : "Libraries"}
      ,&nbsp;{shownTemplateCount} Code {shownTemplateCount === 1 ? "Template" : "Templates"}
    </span>
  );

  const headerControls = (
    <div className={cn("flex items-center shrink-0", isTop ? "gap-1 ml-auto" : "gap-0.5")}>
      <ColumnPicker
        cols={orderedCols}
        colState={colState}
        onToggle={(key) => setVisible(key, !colState[key]?.visible)}
        onReset={resetToDefaults}
        onMove={moveCol}
      />
      {isTop ? (
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => onExpandAll(filteredLibraries.map((l) => l.id))}
            title="Expand All"
            className="flex items-center gap-1.5 px-2 py-1 text-xs transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <ChevronDown className="w-3.5 h-3.5" /> Expand All
          </button>
          <button
            onClick={onCollapseAll}
            title="Collapse All"
            className="flex items-center gap-1.5 px-2 py-1 text-xs border-l border-border transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <ChevronUp className="w-3.5 h-3.5" /> Collapse All
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => onExpandAll(filteredLibraries.map((l) => l.id))}
            title="Expand All"
            className={iconBtn}
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={onCollapseAll} title="Collapse All" className={iconBtn}>
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      <button
        onClick={onToggleLayout}
        title={isTop ? "Switch to left/right layout" : "Switch to top/bottom layout"}
        className={iconBtn}
      >
        {isTop ? <PanelRight className="w-3.5 h-3.5" /> : <PanelBottom className="w-3.5 h-3.5" />}
      </button>
      <button onClick={onHideTree} title="Hide library panel" className={iconBtn}>
        {isTop ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  return (
    <>
      {/* Panel */}
      <div
        className={cn(
          "shrink-0 flex flex-col overflow-hidden bg-white dark:bg-gray-900 min-w-0 min-h-0",
          isTop ? "border-b border-border" : "border-r border-border"
        )}
        style={{ [isTop ? "height" : "width"]: `${splitPct}%` }}
      >
        {/* Filter + controls. Top/bottom layout combines them into one row to save vertical space. */}
        {isTop ? (
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0">
            {filterInput}
            {countSpan}
            {headerControls}
          </div>
        ) : (
          <>
            <div className="px-2 pt-1.5 pb-1 shrink-0">{filterInput}</div>
            <div className="px-2 py-1.5 border-b border-border shrink-0 flex items-center justify-between gap-1">
              {countSpan}
              {headerControls}
            </div>
          </>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading && libraries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 dark:text-gray-500">Loading…</div>
          ) : filteredLibraries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 dark:text-gray-500">
              {filterText ? "No matches" : "No libraries. Click + New Library to get started."}
            </div>
          ) : (
            <Table>
              <TableColGroup cols={visibleCols} colState={colState} />
              <TableHead sticky={false}>
                <TableHeadRow>
                  {visibleCols.map((colDef) => (
                    <SortableHeaderCell
                      key={colDef.key}
                      col={colDef.key}
                      colDef={colDef}
                      width={colState[colDef.key]?.width ?? colDef.defaultWidth}
                      current={sort.key}
                      dir={sort.dir}
                      onSort={toggleSort}
                      onResize={setWidth}
                      className="text-[11px] py-1"
                    />
                  ))}
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {sortedLibraries.map((lib) => {
                  const isExpanded = expandedLibraryIds.has(lib.id);
                  const libSelected = selectedLibraryId === lib.id && selectedTemplateId === null;
                  const libNew = isLibraryNew(lib.id);
                  const libMod = !libNew && isLibraryModified(lib.id);

                  // Filter + sort templates within this library
                  const libTemplates = lib.codeTemplateIds
                    .map((tid) => templates.get(tid))
                    .filter((t): t is CodeTemplate => !!t)
                    .filter(
                      (t) =>
                        !filterLower ||
                        t.name.toLowerCase().includes(filterLower) ||
                        lib.name.toLowerCase().includes(filterLower)
                    );
                  const sortedTemplates = sorted(libTemplates, (tmpl) =>
                    sort.key ? getTemplateColValue(tmpl, sort.key) : tmpl.name
                  );

                  return (
                    <LibraryRows
                      key={lib.id}
                      lib={lib}
                      isExpanded={isExpanded}
                      libSelected={libSelected}
                      libNew={libNew}
                      libMod={libMod}
                      sortedTemplates={sortedTemplates}
                      selectedTemplateId={selectedTemplateId}
                      visibleCols={visibleCols}
                      onSelectLibrary={onSelectLibrary}
                      onSelectTemplate={onSelectTemplate}
                      onToggleExpand={onToggleExpand}
                      isTemplateNew={isTemplateNew}
                      isTemplateModified={isTemplateModified}
                      onContextMenu={openContextMenu}
                      getSignatureConflict={getSignatureConflict}
                      repoChangedTemplateIds={repoChangedTemplateIds}
                    />
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Context menu (portal-like, fixed position) */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white dark:bg-gray-800 border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === "library" && (
            <>
              <ContextMenuItem
                label="New Code Template"
                onClick={() => {
                  onAddTemplateToLibrary(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              <ContextMenuItem
                label="New Library"
                onClick={() => {
                  onAddLibrary();
                  setContextMenu(null);
                }}
              />
              {onViewHistoryLibrary && (
                <>
                  <div className="border-t border-border my-1" />
                  <ContextMenuItem
                    label="View History"
                    onClick={() => {
                      onViewHistoryLibrary(contextMenu.id);
                      setContextMenu(null);
                    }}
                  />
                </>
              )}
              <div className="border-t border-border my-1" />
              <ContextMenuItem
                label="Export Library"
                onClick={() => {
                  onExportLibrary(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              <ContextMenuItem
                label="Export All Libraries"
                onClick={() => {
                  onExportAllLibraries();
                  setContextMenu(null);
                }}
              />
              <div className="border-t border-border my-1" />
              <ContextMenuItem
                label="Delete Library"
                variant="danger"
                onClick={() => {
                  onDeleteLibrary(contextMenu.id);
                  setContextMenu(null);
                }}
              />
            </>
          )}
          {contextMenu.kind === "template" && (
            <>
              <ContextMenuItem
                label="Find Usage"
                onClick={() => {
                  onFindUsage(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              {onViewHistoryTemplate && (
                <ContextMenuItem
                  label="View History"
                  onClick={() => {
                    onViewHistoryTemplate(contextMenu.id);
                    setContextMenu(null);
                  }}
                />
              )}
              <div className="border-t border-border my-1" />
              <ContextMenuItem
                label="New Code Template"
                onClick={() => {
                  if (contextMenu.libraryId) onAddTemplateToLibrary(contextMenu.libraryId);
                  setContextMenu(null);
                }}
              />
              <ContextMenuItem
                label="New Library"
                onClick={() => {
                  onAddLibrary();
                  setContextMenu(null);
                }}
              />
              <div className="border-t border-border my-1" />
              <ContextMenuItem
                label="Export Code Template"
                onClick={() => {
                  onExportTemplate(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              {contextMenu.libraryId && (
                <ContextMenuItem
                  label="Export Library"
                  onClick={() => {
                    onExportLibrary(contextMenu.libraryId!);
                    setContextMenu(null);
                  }}
                />
              )}
              <ContextMenuItem
                label="Export All Libraries"
                onClick={() => {
                  onExportAllLibraries();
                  setContextMenu(null);
                }}
              />
              <div className="border-t border-border my-1" />
              <ContextMenuItem
                label="Delete Template"
                variant="danger"
                onClick={() => {
                  onDeleteTemplate(contextMenu.id);
                  setContextMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}

// ─── Context menu item ────────────────────────────────────────────────────────

function ContextMenuItem({
  label,
  onClick,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-1.5 text-sm transition-colors",
        variant === "danger"
          ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      )}
    >
      {label}
    </button>
  );
}

// ─── Library + template rows ──────────────────────────────────────────────────

interface LibraryRowsProps {
  lib: CodeTemplateLibrary;
  isExpanded: boolean;
  libSelected: boolean;
  libNew: boolean;
  libMod: boolean;
  sortedTemplates: CodeTemplate[];
  selectedTemplateId: string | null;
  visibleCols: ReturnType<typeof useColumnConfig<CodeTemplateCol>>["visibleCols"];
  onSelectLibrary: (id: string) => void;
  onSelectTemplate: (id: string) => void;
  onToggleExpand: (id: string) => void;
  isTemplateNew: (id: string) => boolean;
  isTemplateModified: (id: string) => boolean;
  onContextMenu: (
    e: React.MouseEvent,
    kind: "library" | "template",
    id: string,
    libraryId?: string
  ) => void;
  getSignatureConflict?: (templateId: string) => SignatureConflict | null;
  repoChangedTemplateIds?: Set<string> | null;
}

function LibraryRows({
  lib,
  isExpanded,
  libSelected,
  libNew,
  libMod,
  sortedTemplates,
  selectedTemplateId,
  visibleCols,
  onSelectLibrary,
  onSelectTemplate,
  onToggleExpand,
  isTemplateNew,
  isTemplateModified,
  onContextMenu,
  getSignatureConflict,
  repoChangedTemplateIds,
}: LibraryRowsProps) {
  return (
    <>
      {/* Library row */}
      <TableRow
        variant={libSelected ? "selected" : "default"}
        className="cursor-pointer"
        onClick={() => onSelectLibrary(lib.id)}
        onContextMenu={(e) => onContextMenu(e, "library", lib.id)}
      >
        {visibleCols.map((colDef) => {
          if (colDef.key === "name") {
            return (
              <TableCell key={colDef.key} className="px-1 py-1">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(lib.id);
                    }}
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 p-0.5"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </button>
                  <Code2 className="w-3 h-3 text-blue-400 shrink-0" />
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                    {lib.name}
                  </span>
                  {libNew && (
                    <span className="ml-0.5 shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 leading-none">
                      New
                    </span>
                  )}
                  {libMod && (
                    <span
                      className="ml-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-[#e07820]"
                      title="Unsaved changes"
                    />
                  )}
                  {repoChangedTemplateIds &&
                    lib.codeTemplateIds?.some((id) => repoChangedTemplateIds.has(id)) && (
                      <span
                        className="ml-0.5 shrink-0"
                        title="Contains templates with uncommitted changes in version history"
                      >
                        <GitCommit className="w-3 h-3 text-amber-500" />
                      </span>
                    )}
                </div>
              </TableCell>
            );
          }

          const value = getLibraryColValue(lib, colDef.key);

          return (
            <TableCell
              key={colDef.key}
              align={colDef.align}
              className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400"
            >
              {colDef.key === "lastModified"
                ? formatDate(value as string | undefined)
                : (value ?? "")}
            </TableCell>
          );
        })}
      </TableRow>

      {/* Template rows */}
      {isExpanded &&
        sortedTemplates.map((tmpl) => {
          const tmplSelected = selectedTemplateId === tmpl.id;
          const tmplNew = isTemplateNew(tmpl.id);
          const tmplMod = !tmplNew && isTemplateModified(tmpl.id);
          const conflict = getSignatureConflict?.(tmpl.id) ?? null;

          return (
            <TableRow
              key={tmpl.id}
              variant={tmplSelected ? "selected" : "default"}
              className="cursor-pointer"
              onClick={() => onSelectTemplate(tmpl.id)}
              onContextMenu={(e) => onContextMenu(e, "template", tmpl.id, lib.id)}
            >
              {visibleCols.map((colDef) => {
                if (colDef.key === "name") {
                  return (
                    <TableCell key={colDef.key} className="px-1 py-0.5">
                      <div className="flex items-center gap-1 pl-6">
                        <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {tmpl.name}
                        </span>
                        {tmplNew && (
                          <span className="ml-0.5 shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 leading-none">
                            New
                          </span>
                        )}
                        {tmplMod && (
                          <span
                            className="ml-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-[#e07820]"
                            title="Unsaved changes"
                          />
                        )}
                        {conflict && (
                          <span
                            className="ml-0.5 shrink-0"
                            title={`Duplicate signature: ${conflict.functionName}(${conflict.paramCount} param${conflict.paramCount !== 1 ? "s" : ""}) also defined in ${conflict.templates
                              .filter((ct) => ct.libraryId !== lib.id)
                              .map((ct) => `"${ct.libraryName}"`)
                              .join(", ")}`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        )}
                        {repoChangedTemplateIds?.has(tmpl.id) && (
                          <span
                            className="ml-0.5 shrink-0"
                            title="Uncommitted changes in version history"
                          >
                            <GitCommit className="w-3 h-3 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                  );
                }

                const value = getTemplateColValue(tmpl, colDef.key);

                return (
                  <TableCell
                    key={colDef.key}
                    align={colDef.align}
                    className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-500"
                  >
                    {colDef.key === "lastModified"
                      ? formatDate(value as string | undefined)
                      : (value ?? "")}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
    </>
  );
}

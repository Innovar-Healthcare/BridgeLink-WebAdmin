"use client";

import { useCallback, useMemo } from "react";
import { ColumnPicker } from "@/components/column-picker";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { DataTable } from "@/components/data-table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EXT_COLS, type ExtCol, type ExtensionRow } from "../_lib/extension-types";

// ─── Extension Table ──────────────────────────────────────────────────────────

interface ExtensionTableProps {
  title: string;
  rows: ExtensionRow[];
  storageKey: string;
  selectedName: string | null;
  onSelect: (name: string | null) => void;
  onDoubleClick: (row: ExtensionRow) => void;
  onContextInfo: (row: ExtensionRow) => void;
  onContextToggleEnabled: (row: ExtensionRow) => void;
  onContextUninstall: (row: ExtensionRow) => void;
  /** When true, disable the manage context-menu items (Enable/Disable/Uninstall). */
  viewOnly?: boolean;
  loading: boolean;
}

export function ExtensionTable({
  title,
  rows,
  storageKey,
  selectedName,
  onSelect,
  onDoubleClick,
  onContextInfo,
  onContextToggleEnabled,
  onContextUninstall,
  viewOnly = false,
  loading,
}: ExtensionTableProps) {
  const colConfig = useColumnConfig(EXT_COLS, storageKey);
  const { orderedCols, colState, setVisible, moveCol, resetToDefaults } = colConfig;

  const sortState = useSortable<ExtCol>("name");
  const { sort, sorted } = sortState;

  const sortedRows = useMemo(() => {
    const key = sort.key;
    return sorted(rows, (r) => {
      switch (key) {
        case "status":
          return r.enabled ? 1 : 0;
        case "name":
          return r.name;
        case "author":
          return r.author;
        case "url":
          return r.url;
        case "version":
          return r.version;
        case "description":
          return r.description;
        default:
          return "";
      }
    });
  }, [rows, sort, sorted]);

  const onToggleVisible = useCallback(
    (key: ExtCol) => setVisible(key, !(colState[key]?.visible ?? true)),
    [colState, setVisible]
  );

  return (
    <section className="flex flex-col min-h-0 flex-1">
      {/* Section header with ColumnPicker */}
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
        <ColumnPicker
          cols={orderedCols}
          colState={colState}
          onToggle={onToggleVisible}
          onReset={resetToDefaults}
          onMove={moveCol}
        />
      </div>

      <DataTable<ExtensionRow, ExtCol>
        variant="sortable"
        cols={EXT_COLS}
        rows={sortedRows}
        colConfig={colConfig}
        sortState={sortState}
        rowKey={(r) => r.name}
        selectedRowId={selectedName}
        onRowClick={(r) => onSelect(r.name === selectedName ? null : r.name)}
        onRowDoubleClick={(r) => onDoubleClick(r)}
        loading={loading}
        empty="No extensions installed."
        containerClassName="flex-1 min-h-0"
        renderCell={(row, col) => {
          if (col === "status")
            return (
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full border shrink-0 ${
                    row.enabled ? "bg-blue-500 border-blue-600" : "bg-gray-400 border-gray-500"
                  }`}
                />
                <span
                  className={`text-xs ${row.enabled ? "text-blue-700 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}`}
                >
                  {row.enabled ? "Enabled" : "Disabled"}
                </span>
              </span>
            );
          if (col === "name") return row.name;
          if (col === "author") return row.author;
          if (col === "url")
            return row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {row.url}
              </a>
            ) : (
              "—"
            );
          if (col === "description") return row.description;
          return row.version; // version — mono handled via cellMono
        }}
        cellMono={{ version: true }}
        rowWrapper={(row, rendered) => (
          <ContextMenu key={row.name}>
            <ContextMenuTrigger asChild>{rendered}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onContextInfo(row)}>ℹ Info</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={row.enabled || viewOnly}
                onSelect={() => onContextToggleEnabled(row)}
              >
                Enable
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!row.enabled || viewOnly}
                onSelect={() => onContextToggleEnabled(row)}
              >
                Disable
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={viewOnly}
                onSelect={() => onContextUninstall(row)}
              >
                Uninstall
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      />

      {/* Row count footer */}
      {!loading && sortedRows.length > 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 pt-1 shrink-0">
          {sortedRows.length} extension{sortedRows.length !== 1 ? "s" : ""}
        </div>
      )}
    </section>
  );
}

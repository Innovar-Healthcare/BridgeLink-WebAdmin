"use client";

import React, { useCallback, useRef } from "react";
import {
  TableContainer,
  Table,
  TableColGroup,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
  TableEmpty,
  TableLoading,
  type TableRowVariant,
} from "./primitives";
import { SortableHeaderCell, HeaderCell } from "@/components/sortable-header-cell";
import type { ColDef, UseColumnConfigResult } from "@/lib/hooks/use-column-config";
import type { UseSortableResult } from "@/lib/hooks/use-sortable";

export type RowId = string | number;

export type DataTableVariant = "resizable" | "sortable";

interface DataTableProps<TRow, K extends string> {
  /** "resizable" = HeaderCell (no sort). "sortable" = SortableHeaderCell. */
  variant: DataTableVariant;
  /** Source-of-truth column definitions (also passed to your ColumnPicker if any). */
  cols: ColDef<K>[];
  /** Row data. For sortable variant, pass already-sorted rows (use sortState.sorted()). */
  rows: TRow[];
  /** External column config from useColumnConfig — owned by the page so it can also drive a ColumnPicker. */
  colConfig: UseColumnConfigResult<K>;
  /** Required when variant === "sortable". External sort state from useSortable. */
  sortState?: UseSortableResult<K>;
  /** Stable identifier per row, used for React keys and selection comparison. */
  rowKey: (row: TRow, index: number) => RowId;
  /** Render content for a single body cell. Wrapping <td> is provided by DataTable. */
  renderCell: (row: TRow, col: K) => React.ReactNode;
  /** Native tooltip text written to the <td title>. Mirrors Java's DefaultTableCellRenderer
   *  tooltip-on-cell behavior so clipped long values remain hoverable. */
  cellTitle?: (row: TRow, col: K) => string | undefined;
  /** Per-column horizontal alignment (defaults to "left"). */
  cellAlign?: Partial<Record<K, "left" | "right" | "center">>;
  /** Per-column monospace flag (defaults to false). */
  cellMono?: Partial<Record<K, boolean>>;
  /** Currently selected row id; that row renders with the "selected" variant. */
  selectedRowId?: RowId | null;
  /**
   * Multi-select: ids of rows that render with the "selected" variant. When provided, this takes
   * precedence over `selectedRowId` (the two are mutually exclusive selection modes).
   */
  selectedRowIds?: ReadonlySet<RowId> | null;
  /** Click handler on a body row. */
  onRowClick?: (row: TRow, e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Double-click handler on a body row. */
  onRowDoubleClick?: (row: TRow, e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Right-click / context-menu handler on a body row. */
  onRowContextMenu?: (row: TRow, e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Optionally render a wrapper around each row (e.g. <ContextMenuTrigger asChild>). */
  rowWrapper?: (row: TRow, rendered: React.ReactNode) => React.ReactNode;
  /** When true, body shows the loading state instead of rows. */
  loading?: boolean;
  /** Empty-state content (string → centered grey text; ReactNode → rendered as-is). */
  empty?: React.ReactNode | string;
  /** Layout className passed through to the outer TableContainer (e.g. "flex-1 min-h-0"). */
  containerClassName?: string;
  /**
   * When true, each column's resize is capped so the total table width never exceeds the
   * container width. Use for dialogs where horizontal overflow is never desirable.
   */
  constrainColumnsToContainer?: boolean;
}

export function DataTable<TRow, K extends string>({
  variant,
  rows,
  colConfig,
  sortState,
  rowKey,
  renderCell,
  cellTitle,
  cellAlign,
  cellMono,
  selectedRowId = null,
  selectedRowIds = null,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  rowWrapper,
  loading = false,
  empty = "No data.",
  containerClassName = "",
  constrainColumnsToContainer = false,
}: DataTableProps<TRow, K>) {
  const { colState, visibleCols, setWidth } = colConfig;

  if (variant === "sortable" && !sortState) {
    throw new Error('DataTable variant="sortable" requires a `sortState` prop.');
  }

  const colSpan = visibleCols.length || 1;

  // Refs to read current values inside the resize callback without stale closures
  const containerRef = useRef<HTMLDivElement>(null);
  const colStateRef = useRef(colState);
  // eslint-disable-next-line react-hooks/refs
  colStateRef.current = colState;
  const visibleColsRef = useRef(visibleCols);
  // eslint-disable-next-line react-hooks/refs
  visibleColsRef.current = visibleCols;

  const resolvedSetWidth = useCallback(
    (key: K, width: number) => {
      if (!constrainColumnsToContainer || !containerRef.current) {
        setWidth(key, width);
        return;
      }
      const containerWidth = containerRef.current.offsetWidth;
      const otherColsWidth = visibleColsRef.current
        .filter((c) => c.key !== key)
        .reduce((sum, c) => sum + colStateRef.current[c.key].width, 0);
      const colMinWidth = visibleColsRef.current.find((c) => c.key === key)?.minWidth ?? 40;
      const maxW = Math.max(colMinWidth, containerWidth - otherColsWidth);
      setWidth(key, Math.min(width, maxW));
    },
    [constrainColumnsToContainer, setWidth]
  );

  return (
    <TableContainer ref={containerRef} className={containerClassName}>
      <Table>
        <TableColGroup cols={visibleCols} colState={colState} />
        <TableHead>
          <TableHeadRow>
            {visibleCols.map((c) =>
              variant === "sortable" && sortState ? (
                <SortableHeaderCell
                  key={c.key}
                  col={c.key}
                  colDef={c}
                  width={colState[c.key].width}
                  current={sortState.sort.key}
                  dir={sortState.sort.dir}
                  onSort={sortState.toggle}
                  onResize={resolvedSetWidth}
                />
              ) : (
                <HeaderCell
                  key={c.key}
                  col={c.key}
                  colDef={c}
                  width={colState[c.key].width}
                  onResize={resolvedSetWidth}
                />
              )
            )}
          </TableHeadRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={colSpan} />
          ) : rows.length === 0 ? (
            <TableEmpty colSpan={colSpan}>{typeof empty === "string" ? empty : empty}</TableEmpty>
          ) : (
            rows.map((row, index) => {
              const id = rowKey(row, index);
              const isSelected = selectedRowIds
                ? selectedRowIds.has(id)
                : selectedRowId != null && id === selectedRowId;
              const variantForRow: TableRowVariant = isSelected ? "selected" : "default";
              const rendered = (
                <TableRow
                  key={id}
                  variant={variantForRow}
                  onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
                  onDoubleClick={onRowDoubleClick ? (e) => onRowDoubleClick(row, e) : undefined}
                  onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {visibleCols.map((c) => (
                    <TableCell
                      key={c.key}
                      align={cellAlign?.[c.key] ?? "left"}
                      mono={cellMono?.[c.key] ?? false}
                      title={cellTitle?.(row, c.key)}
                    >
                      {renderCell(row, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              );
              return rowWrapper ? (
                <React.Fragment key={id}>{rowWrapper(row, rendered)}</React.Fragment>
              ) : (
                rendered
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

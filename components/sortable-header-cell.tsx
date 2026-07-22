"use client";

import React from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useResizeHandle, type ColDef } from "@/lib/hooks/use-column-config";
import { useCompactMode, type ViewDensity } from "@/lib/hooks/use-compact-mode";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TABLE_HEADER_CLS, TABLE_TH_CLS } from "@/lib/table-styles";
export { TABLE_HEADER_CLS, TABLE_TH_CLS } from "@/lib/table-styles";

// Shared cell overflow style for table-layout: fixed
export const CELL_STYLE = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/** Returns the horizontal padding class for a table cell based on density. */
export function cellPx(density: ViewDensity): string {
  if (density === "comfortable") return "px-3";
  if (density === "compact") return "px-1";
  return "px-2";
}

/** Returns the vertical padding class for a table body row based on density. */
export function cellPy(density: ViewDensity): string {
  return density === "comfortable" ? "py-1" : "py-0";
}

/**
 * Minimum column width (px) needed to display a numeric value in a
 * `text-sm font-mono tabular-nums` cell without clipping.
 *
 * Pass the character length of the widest formatted value that will appear in
 * the column (e.g. `(208508).toLocaleString().length`).
 * 8.4 px ≈ one character width for a 14 px monospace font.
 */
export function numericCellWidth(maxChars: number, density: ViewDensity): number {
  const pad = density === "comfortable" ? 24 : density === "compact" ? 8 : 16; // px-3/px-2/px-1
  return Math.ceil(maxChars * 8.4) + pad;
}

const BASE_TH = `relative sticky top-0 z-10 ${TABLE_HEADER_CLS} ${TABLE_TH_CLS}`;

// Shared resize handle used by both SortableHeaderCell and HeaderCell
function ResizeHandleEl({ onMouseDown }: { onMouseDown: React.MouseEventHandler<HTMLDivElement> }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 h-full w-3 cursor-col-resize group z-10"
      title="Drag to resize"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-px bg-white/30 group-hover:bg-white/60 group-hover:w-0.5 transition-all" />
    </div>
  );
}

interface SortableHeaderCellProps<K extends string> {
  col: K;
  colDef: ColDef<K>;
  width: number;
  current: K | null;
  dir: "asc" | "desc";
  onSort: (col: K) => void;
  onResize: (key: K, w: number) => void;
  /** Optional extra className on the <th> */
  className?: string;
}

/** Reusable sortable + resizable table header cell. */
export function SortableHeaderCell<K extends string>({
  col,
  colDef,
  width,
  current,
  dir,
  onSort,
  onResize,
  className = "",
}: SortableHeaderCellProps<K>) {
  const { viewDensity } = useCompactMode();
  const headerPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";
  // Comfortable inherits browser default size; Default and Compact use text-xs for tighter headers
  const headerFont = viewDensity === "comfortable" ? "" : "text-xs";
  const { onMouseDown, resizing } = useResizeHandle(
    width,
    colDef.minWidth ?? 40,
    (w) => onResize(col, w),
    colDef.maxWidth
  );

  const active = current === col;
  const align = colDef.align;
  const textAlign =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <th
      className={`${BASE_TH} ${cellPx(viewDensity)} ${headerPy} ${headerFont} font-semibold cursor-pointer select-none hover:bg-[#264d8a] transition-colors ${className}`}
      style={{
        width,
        maxWidth: width,
        // For fixed (non-resizable) columns use width as minWidth so compact widths are honoured;
        // for drag-resizable columns respect the defined floor so the handle has a stop.
        minWidth: colDef.resizable === false ? width : (colDef.minWidth ?? 40),
        ...CELL_STYLE,
      }}
      onClick={() => {
        if (!resizing.current) onSort(col);
      }}
    >
      <div className={`flex items-center gap-1 min-w-0 ${textAlign}`}>
        {/* Hover the header label to show the column's help tooltip (ported from Java
            column factories). No inline help icon. */}
        {colDef.tooltip ? (
          <HoverTooltip content={colDef.tooltip}>
            <span className="truncate min-w-0">{colDef.label}</span>
          </HoverTooltip>
        ) : (
          <span className="truncate min-w-0">{colDef.label}</span>
        )}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="w-3 h-3 text-white shrink-0" />
          ) : (
            <ArrowDown className="w-3 h-3 text-white shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 text-white/40 shrink-0" />
        )}
      </div>
      {colDef.resizable !== false && <ResizeHandleEl onMouseDown={onMouseDown} />}
    </th>
  );
}

interface HeaderCellProps<K extends string> {
  col: K;
  colDef: ColDef<K>;
  width: number;
  onResize: (key: K, w: number) => void;
  /** Optional extra className on the <th> */
  className?: string;
  /** When provided, renders children instead of the colDef label (e.g. a checkbox column). */
  children?: React.ReactNode;
}

interface SimpleHeaderCellProps {
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Static (no resize, no sort) table header cell.
 * Use for dialog tables and any fixed-column table where resizing is not needed.
 * Applies the same BASE_TH as SortableHeaderCell/HeaderCell for visual consistency.
 */
export function SimpleHeaderCell({ className = "", children, style }: SimpleHeaderCellProps) {
  const { viewDensity } = useCompactMode();
  const headerPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";
  const headerFont = viewDensity === "comfortable" ? "" : "text-xs";

  return (
    <th
      className={`${BASE_TH} ${cellPx(viewDensity)} ${headerPy} ${headerFont} font-semibold select-none ${className}`}
      style={style}
    >
      {children}
    </th>
  );
}

/**
 * Non-sortable, resize-only table header cell.
 * Use for tables that don't support sorting (e.g. connection log, message browser).
 */
export function HeaderCell<K extends string>({
  col,
  colDef,
  width,
  onResize,
  className = "",
  children,
}: HeaderCellProps<K>) {
  const { viewDensity } = useCompactMode();
  const headerPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";
  const headerFont = viewDensity === "comfortable" ? "" : "text-xs";
  const { onMouseDown } = useResizeHandle(
    width,
    colDef.minWidth ?? 40,
    (w) => onResize(col, w),
    colDef.maxWidth
  );

  return (
    <th
      className={`${BASE_TH} ${cellPx(viewDensity)} ${headerPy} ${headerFont} font-semibold select-none ${className}`}
      style={{
        width,
        maxWidth: width,
        minWidth: colDef.resizable === false ? width : (colDef.minWidth ?? 40),
        ...CELL_STYLE,
      }}
    >
      {colDef.tooltip && !children ? (
        <HoverTooltip content={colDef.tooltip}>
          <span className="truncate min-w-0">{colDef.label}</span>
        </HoverTooltip>
      ) : (
        (children ?? colDef.label)
      )}
      {colDef.resizable !== false && <ResizeHandleEl onMouseDown={onMouseDown} />}
    </th>
  );
}

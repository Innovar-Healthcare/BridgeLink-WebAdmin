"use client";

import React from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useZebraRows } from "@/lib/hooks/use-zebra-rows";
import type { ColDef, ColStateMap } from "@/lib/hooks/use-column-config";
import { CELL_STYLE, cellPx, cellPy } from "@/components/sortable-header-cell";
import { cn } from "@/lib/utils";

const CONTAINER_CHROME =
  "overflow-auto rounded-lg border border-border bg-white dark:bg-gray-900 shadow-sm";

interface TableContainerProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const TableContainer = React.forwardRef<HTMLDivElement, TableContainerProps>(
  function TableContainer({ className = "", style, children }, ref) {
    return (
      <div ref={ref} className={cn(CONTAINER_CHROME, className)} style={style}>
        {children}
      </div>
    );
  }
);

interface TableProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { className = "", style, children },
  ref
) {
  return (
    <table
      ref={ref}
      className={cn("text-xs border-collapse w-full", className)}
      style={{ tableLayout: "fixed", ...style }}
    >
      {children}
    </table>
  );
});

interface TableColGroupProps<K extends string> {
  cols: ColDef<K>[];
  colState: ColStateMap<K>;
}

export function TableColGroup<K extends string>({ cols, colState }: TableColGroupProps<K>) {
  return (
    <colgroup>
      {cols.map((c) => (
        <col key={c.key} style={{ width: colState[c.key].width }} />
      ))}
    </colgroup>
  );
}

interface TableHeadProps {
  sticky?: boolean;
  children: React.ReactNode;
}

export function TableHead({ sticky = true, children }: TableHeadProps) {
  return <thead className={sticky ? "sticky top-0 z-10" : undefined}>{children}</thead>;
}

interface TableHeadRowProps {
  children: React.ReactNode;
}

export function TableHeadRow({ children }: TableHeadRowProps) {
  return <tr>{children}</tr>;
}

interface TableBodyProps {
  children: React.ReactNode;
}

export function TableBody({ children }: TableBodyProps) {
  return <tbody>{children}</tbody>;
}

export type TableRowVariant = "default" | "group" | "selected";

interface TableRowProps {
  variant?: TableRowVariant;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLTableRowElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLTableRowElement>;
  onMouseDown?: React.MouseEventHandler<HTMLTableRowElement>;
  onMouseMove?: React.MouseEventHandler<HTMLTableRowElement>;
  onMouseUp?: React.MouseEventHandler<HTMLTableRowElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLTableRowElement>;
  onContextMenu?: React.MouseEventHandler<HTMLTableRowElement>;
  title?: string;
  children: React.ReactNode;
}

function rowVariantClasses(variant: TableRowVariant): string {
  if (variant === "selected") {
    return "bg-[#D7E9F7] dark:bg-blue-900/40 ring-1 ring-inset ring-blue-300 dark:ring-blue-600 border-b border-border";
  }
  if (variant === "group") {
    return "border-b border-border hover:bg-blue-50 dark:hover:bg-blue-900/30";
  }
  return "border-b border-border hover:bg-blue-50 dark:hover:bg-blue-900/30";
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { variant = "default", className = "", style, children, ...handlers },
  ref
) {
  const { isZebraOn } = useZebraRows();
  const zebraClass = isZebraOn && variant === "default" ? "even:bg-row-stripe" : "";
  return (
    <tr
      ref={ref}
      className={cn(
        "transition-colors select-none",
        rowVariantClasses(variant),
        zebraClass,
        className
      )}
      style={style}
      {...handlers}
    >
      {children}
    </tr>
  );
});

interface TableCellProps {
  align?: "left" | "right" | "center";
  mono?: boolean;
  width?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  colSpan?: number;
  suppressHydrationWarning?: boolean;
  onClick?: React.MouseEventHandler<HTMLTableCellElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLTableCellElement>;
  children?: React.ReactNode;
}

export function TableCell({
  align = "left",
  mono = false,
  width,
  className = "",
  style,
  title,
  colSpan,
  suppressHydrationWarning,
  onClick,
  onDoubleClick,
  children,
}: TableCellProps) {
  const { viewDensity } = useCompactMode();
  const alignCls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const monoCls = mono ? "font-mono tabular-nums" : "";
  const widthStyle: React.CSSProperties =
    width != null ? { width, maxWidth: width, minWidth: width } : {};

  return (
    <td
      className={cn(cellPx(viewDensity), cellPy(viewDensity), alignCls, monoCls, className)}
      style={{ ...widthStyle, ...CELL_STYLE, ...style }}
      title={title}
      colSpan={colSpan}
      suppressHydrationWarning={suppressHydrationWarning}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </td>
  );
}

interface TableEmptyProps {
  colSpan: number;
  message?: string;
  children?: React.ReactNode;
}

export function TableEmpty({ colSpan, message = "No data.", children }: TableEmptyProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-6 text-xs text-gray-400 dark:text-gray-500 text-center"
      >
        {children ?? message}
      </td>
    </tr>
  );
}

interface TableLoadingProps {
  colSpan: number;
  message?: string;
}

export function TableLoading({ colSpan, message = "Loading…" }: TableLoadingProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-6 text-xs text-gray-400 dark:text-gray-500 text-center"
      >
        {message}
      </td>
    </tr>
  );
}

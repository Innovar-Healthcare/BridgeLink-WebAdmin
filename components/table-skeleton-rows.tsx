import { Skeleton } from "@/components/ui/skeleton";
import { cellPx, cellPy } from "@/components/sortable-header-cell";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

interface TableSkeletonRowsProps {
  /** Number of skeleton rows to render. Default: 10 */
  count?: number;
  /** Visible columns — drives cell count and optional per-cell widths */
  columns: Array<{ key: string; width?: number }>;
  /** Height class for each skeleton bar. Default: "h-4" */
  rowHeight?: string;
  /** View density for cell padding. Default: "default" */
  density?: ViewDensity;
  /** Whether rows have a bottom border. Default: false */
  bordered?: boolean;
  /** Number of empty leading cells to prepend per row (e.g. expand/collapse column) */
  leadingCols?: number;
}

export function TableSkeletonRows({
  count = 10,
  columns,
  rowHeight = "h-4",
  density = "default",
  bordered = false,
  leadingCols = 0,
}: TableSkeletonRowsProps) {
  const px = cellPx(density);
  const py = cellPy(density);
  const borderClass = bordered ? "border-b border-border" : "";

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className={borderClass}>
          {Array.from({ length: leadingCols }).map((__, j) => (
            <td key={`lead-${j}`} />
          ))}
          {columns.map((col) => (
            <td
              key={col.key}
              className={`${px} ${py}`}
              style={col.width !== undefined ? { width: col.width } : undefined}
            >
              <Skeleton className={`${rowHeight} w-full`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

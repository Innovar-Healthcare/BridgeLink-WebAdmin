"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Manages a draggable split divider between two panels.
 * Supports both horizontal (left/right) and vertical (top/bottom) orientations.
 *
 * Returns:
 *   - `splitPct`            — current split percentage (0–100) for the primary panel
 *   - `containerRef`        — attach to the outer container div
 *   - `onResizerMouseDown`  — attach to the drag handle element
 *
 * Usage:
 *   const { splitPct, containerRef, onResizerMouseDown } = useSplitResize({ orientation: "horizontal" });
 *   <div ref={containerRef} className="flex">
 *     <div style={{ width: `${splitPct}%` }}> ... </div>
 *     <div onMouseDown={onResizerMouseDown} className="w-1 cursor-col-resize" />
 *     <div className="flex-1"> ... </div>
 *   </div>
 */
export function useSplitResize(opts: {
  /** "horizontal" splits left/right; "vertical" splits top/bottom. */
  orientation: "horizontal" | "vertical";
  /** Initial split percentage for the primary panel. Default: 50. */
  defaultPct?: number;
  /** Minimum percentage for the primary panel. Default: 20. */
  minPct?: number;
  /** Maximum percentage for the primary panel. Default: 80. */
  maxPct?: number;
}): {
  splitPct: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onResizerMouseDown: (e: React.MouseEvent) => void;
} {
  const { orientation, defaultPct = 50, minPct = 20, maxPct = 80 } = opts;
  const [splitPct, setSplitPct] = useState(defaultPct);
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref so the drag handler always sees the current orientation without recreating
  const orientationRef = useRef(orientation);
  // eslint-disable-next-line react-hooks/refs
  orientationRef.current = orientation;

  const onResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const onMove = (me: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        let pct: number;
        if (orientationRef.current === "vertical") {
          pct = ((me.clientY - rect.top) / rect.height) * 100;
        } else {
          pct = ((me.clientX - rect.left) / rect.width) * 100;
        }
        setSplitPct(Math.min(maxPct, Math.max(minPct, pct)));
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor =
        orientationRef.current === "vertical" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [minPct, maxPct]
  );

  return { splitPct, containerRef, onResizerMouseDown };
}

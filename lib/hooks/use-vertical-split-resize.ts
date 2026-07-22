"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Manages a vertical split resize between two stacked panels.
 * Stores the top panel's fraction (0–1) in localStorage.
 *
 * Usage:
 *   const { topRatio, containerRef, onDragMouseDown } = useVerticalSplitResize({ ... });
 *   <div ref={containerRef} className="flex flex-col h-full">
 *     <div style={{ height: `${topRatio * 100}%` }}> ... </div>
 *     <div onMouseDown={onDragMouseDown} className="cursor-row-resize" />
 *     <div className="flex-1"> ... </div>
 *   </div>
 */
export function useVerticalSplitResize(opts: {
  storageKey: string;
  defaultRatio?: number;
  minPx?: number;
}) {
  const { storageKey, defaultRatio = 0.5, minPx = 80 } = opts;

  const [topRatio, setTopRatio] = useState(() => {
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    if (typeof window === "undefined") return defaultRatio;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const n = parseFloat(saved);
      if (Number.isFinite(n) && n > 0 && n < 1) return n;
    }
    return defaultRatio;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist to localStorage when ratio changes
  useEffect(() => {
    localStorage.setItem(storageKey, String(topRatio));
  }, [storageKey, topRatio]);

  const dragRef = useRef<{ startY: number; startRatio: number } | null>(null);

  const onDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startRatio: topRatio };

      function onMove(ev: MouseEvent) {
        if (!dragRef.current || !containerRef.current) return;
        const containerH = containerRef.current.clientHeight;
        if (containerH <= 0) return;
        const deltaY = ev.clientY - dragRef.current.startY;
        const deltaRatio = deltaY / containerH;
        const minRatio = minPx / containerH;
        const maxRatio = 1 - minRatio;
        const next = Math.max(
          minRatio,
          Math.min(maxRatio, dragRef.current.startRatio + deltaRatio)
        );
        setTopRatio(next);
      }

      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [topRatio, minPx]
  );

  return { topRatio, containerRef, onDragMouseDown };
}

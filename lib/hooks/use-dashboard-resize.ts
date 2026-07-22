"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ──────────────────────────────────────────────────────────────

const BOTTOM_HEIGHT_KEY = "bl-dashboard-bottom-height";
const BOTTOM_HEIGHT_DEFAULT = 150;
const BOTTOM_HEIGHT_MIN = 120;
const BOTTOM_HEIGHT_MAX = 600;

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages dashboard layout resize state:
 * - Bottom panel drag-resize (persisted to localStorage)
 * - Stats card collapse/expand (persisted to localStorage)
 * - Table container width measurement (via ResizeObserver)
 */
export function useDashboardResize() {
  // ── Stats panel visibility (hidden = removed from DOM entirely) ─────────
  const [statsHidden, setStatsHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bl-dashboard-stats-hidden") === "true";
  });
  useEffect(() => {
    localStorage.setItem("bl-dashboard-stats-hidden", String(statsHidden));
  }, [statsHidden]);

  // ── Stats card collapse ─────────────────────────────────────────────────
  // Key is versioned (-v2) to discard the pre-2026-04-22 writes made while the
  // default was expanded. Those users had "false" persisted on every mount, which
  // would otherwise force the panel open forever even though the default is now
  // collapsed. Bumping the key lets them fall through to the collapsed default once
  //.
  const [statsCollapsed, setStatsCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("bl-dashboard-stats-collapsed-v2") !== "false";
  });
  useEffect(() => {
    localStorage.setItem("bl-dashboard-stats-collapsed-v2", String(statsCollapsed));
  }, [statsCollapsed]);

  // ── Bottom panel collapse ──────────────────────────────────────────────
  const [bottomCollapsed, setBottomCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bl-dashboard-bottom-collapsed") === "true";
  });
  useEffect(() => {
    localStorage.setItem("bl-dashboard-bottom-collapsed", String(bottomCollapsed));
  }, [bottomCollapsed]);

  // ── Bottom panel height ─────────────────────────────────────────────────
  const [bottomHeight, setBottomHeight] = useState<number>(() => {
    if (typeof window === "undefined") return BOTTOM_HEIGHT_DEFAULT;
    const saved = localStorage.getItem(BOTTOM_HEIGHT_KEY);
    if (saved) return Math.max(BOTTOM_HEIGHT_MIN, Math.min(BOTTOM_HEIGHT_MAX, Number(saved)));
    return BOTTOM_HEIGHT_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem(BOTTOM_HEIGHT_KEY, String(bottomHeight));
  }, [bottomHeight]);

  // ── Drag handle ─────────────────────────────────────────────────────────
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startH: bottomHeight };
      function onMove(ev: MouseEvent) {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        const next = Math.max(
          BOTTOM_HEIGHT_MIN,
          Math.min(BOTTOM_HEIGHT_MAX, dragRef.current.startH + delta)
        );
        setBottomHeight(next);
      }
      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [bottomHeight]
  );

  // ── Table container width (ResizeObserver) ──────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return {
    bottomHeight,
    bottomCollapsed,
    setBottomCollapsed,
    statsHidden,
    setStatsHidden,
    statsCollapsed,
    setStatsCollapsed,
    containerWidth,
    tableContainerRef,
    onDragHandleMouseDown,
  };
}

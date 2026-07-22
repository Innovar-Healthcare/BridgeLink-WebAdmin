"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSplitResize } from "@/lib/hooks/use-split-resize";

// ─── Left panel constants ─────────────────────────────────────────────────────

const LEFT_W_KEY = "bl-ft-left-w";
const LEFT_COLLAPSED_KEY = "bl-ft-left-collapsed";
const DEFAULT_LEFT_W = 280;
const MIN_LEFT_W = 160;
const MAX_LEFT_W = 480;
export const COLLAPSED_LEFT_W = 36;

// ─── Right panel constants ────────────────────────────────────────────────────

const REF_PANEL_WIDTH_KEY = "bridgelink.filterTransformer.refPanelWidth";
const RIGHT_COLLAPSED_KEY = "bl-ft-right-collapsed";
const DEFAULT_REF_PANEL_WIDTH = 320;
export const COLLAPSED_RIGHT_W = 28;

// ─── Layout constants ─────────────────────────────────────────────────────────

const FT_LAYOUT_KEY = "bl-ft-layout";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useResizablePanels() {
  // -- Left panel (element list) --

  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_LEFT_W;
    const stored = localStorage.getItem(LEFT_W_KEY);
    const v = stored ? parseInt(stored, 10) : NaN;
    return isNaN(v) ? DEFAULT_LEFT_W : v;
  });

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LEFT_COLLAPSED_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(LEFT_W_KEY, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    localStorage.setItem(LEFT_COLLAPSED_KEY, String(leftCollapsed));
  }, [leftCollapsed]);

  const leftPanelWidthRef = useRef(leftPanelWidth);
  // eslint-disable-next-line react-hooks/refs
  leftPanelWidthRef.current = leftPanelWidth;

  const onLeftPanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = leftPanelWidthRef.current;
    const onMove = (me: MouseEvent) => {
      const newW = Math.max(MIN_LEFT_W, Math.min(MAX_LEFT_W, startW + (me.clientX - startX)));
      setLeftPanelWidth(newW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // -- Right panel (reference / message trees) --

  const [refPanelWidth, setRefPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_REF_PANEL_WIDTH;
    const stored = localStorage.getItem(REF_PANEL_WIDTH_KEY);
    const storedInt = stored ? parseInt(stored, 10) : NaN;
    return isNaN(storedInt) ? DEFAULT_REF_PANEL_WIDTH : storedInt;
  });

  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(RIGHT_COLLAPSED_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(REF_PANEL_WIDTH_KEY, String(refPanelWidth));
  }, [refPanelWidth]);

  useEffect(() => {
    localStorage.setItem(RIGHT_COLLAPSED_KEY, String(rightCollapsed));
  }, [rightCollapsed]);

  const refPanelWidthRef = useRef(refPanelWidth);
  // eslint-disable-next-line react-hooks/refs
  refPanelWidthRef.current = refPanelWidth;

  const onRefPanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = refPanelWidthRef.current;
    const onMove = (me: MouseEvent) => {
      // Drag left → negative delta → right panel grows
      const newW = Math.max(180, Math.min(1200, startW - (me.clientX - startX)));
      setRefPanelWidth(newW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // -- Layout orientation (side-by-side vs top/bottom) --

  const [ftLayout, setFtLayout] = useState<"side-by-side" | "top-bottom">(() => {
    if (typeof window === "undefined") return "top-bottom";
    const stored = localStorage.getItem(FT_LAYOUT_KEY);
    return stored === "side-by-side" ? "side-by-side" : "top-bottom";
  });

  useEffect(() => {
    localStorage.setItem(FT_LAYOUT_KEY, ftLayout);
  }, [ftLayout]);

  // -- Top/bottom split (vertical drag divider) --

  const {
    splitPct: tbSplitPct,
    containerRef: tbContainerRef,
    onResizerMouseDown: tbResizerMouseDown,
  } = useSplitResize({ orientation: "vertical", defaultPct: 40, minPct: 15, maxPct: 75 });

  return {
    leftPanelWidth,
    leftCollapsed,
    setLeftCollapsed,
    onLeftPanelResizeMouseDown,
    refPanelWidth,
    rightCollapsed,
    setRightCollapsed,
    onRefPanelResizeMouseDown,
    ftLayout,
    setFtLayout,
    tbSplitPct,
    tbContainerRef,
    tbResizerMouseDown,
  };
}

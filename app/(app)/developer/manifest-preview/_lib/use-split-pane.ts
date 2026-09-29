"use client";

/**
 * Resizable horizontal split between the editor (left) and preview (right)
 * panes on the Manifest Preview page (extracted from page.tsx,. Owns
 * the pointer-drag + keyboard resize, the clamp, and localStorage persistence
 * of the split percentage.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const SPLIT_STORAGE_KEY = "bl-manifest-preview-split";
export const MIN_SPLIT = 28;
export const MAX_SPLIT = 72;

const clampSplit = (n: number) => Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, n));

export interface SplitPane {
  containerRef: React.RefObject<HTMLDivElement | null>;
  leftPct: number;
  startDrag: (e: React.PointerEvent) => void;
  onDividerKeyDown: (e: React.KeyboardEvent) => void;
}

export function useSplitPane(): SplitPane {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState<number>(() => {
    if (typeof window === "undefined") return 50;
    const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
    const parsed = stored ? parseFloat(stored) : NaN;
    return isNaN(parsed) ? 50 : clampSplit(parsed);
  });
  useEffect(() => {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(leftPct));
  }, [leftPct]);

  // Store the active drag's teardown so an unmount mid-drag can't leak the
  // window listeners or leave the page unselectable.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (me: PointerEvent) => {
      setLeftPct(clampSplit(((me.clientX - rect.left) / rect.width) * 100));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      document.body.style.userSelect = "";
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
  }, []);

  const onDividerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setLeftPct((p) => clampSplit(p - 2));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setLeftPct((p) => clampSplit(p + 2));
    } else if (e.key === "Home") {
      e.preventDefault();
      setLeftPct(50);
    }
  }, []);

  return { containerRef, leftPct, startDrag, onDividerKeyDown };
}

import { useCallback, useEffect, useRef, useState } from "react";

interface UseHorizontalResizeOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

/**
 * Persisted, drag-resizable horizontal panel width.
 * Used by scripts-tab and the JS attachment handler dialog for their reference sidebars.
 * The panel grows from the RIGHT (dragging left = wider, right = narrower).
 */
export function useHorizontalResize({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: UseHorizontalResizeOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return isNaN(parsed) ? defaultWidth : parsed;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const widthRef = useRef(width);
  // eslint-disable-next-line react-hooks/refs
  widthRef.current = width;

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widthRef.current;
      const onMove = (me: MouseEvent) => {
        const newW = Math.max(minWidth, Math.min(maxWidth, startW - (me.clientX - startX)));
        setWidth(newW);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [minWidth, maxWidth]
  );

  return { width, onResizeMouseDown };
}

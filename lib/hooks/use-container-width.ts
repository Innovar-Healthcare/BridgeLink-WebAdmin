import { useState, useEffect, type RefObject } from "react";

/**
 * Tracks the content width of a DOM element via ResizeObserver.
 * Returns 0 until the first measurement.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return containerWidth;
}

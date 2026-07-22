"use client";

import { useEffect, useState } from "react";

export type ViewDensity = "comfortable" | "default" | "compact";

/**
 * Returns the Tailwind height class for a form control (input, select, button) based on density.
 * comfortable → h-9, default → h-8, compact → h-7
 */
export function densityHeight(density: ViewDensity): string {
  if (density === "comfortable") return "h-9";
  if (density === "compact") return "h-7";
  return "h-8";
}

/** Returns the outer page content padding class based on density. */
export function pagePadding(density: ViewDensity): string {
  if (density === "comfortable") return "px-6 py-4";
  if (density === "compact") return "px-2 py-2";
  return "px-4 py-3";
}

/**
 * Returns the next density level in the cycle:
 * comfortable → default → compact → comfortable
 */
function nextDensity(d: ViewDensity): ViewDensity {
  if (d === "comfortable") return "default";
  if (d === "default") return "compact";
  return "comfortable";
}

/**
 * Shifts density one level tighter (used for auto-compact on dashboard sub-rows).
 * comfortable → default, default → compact, compact → compact
 */
export function tightenDensity(d: ViewDensity): ViewDensity {
  if (d === "comfortable") return "default";
  if (d === "default") return "compact";
  return "compact";
}

const KEY = "bl-view-density-v2";
const DENSITY_EVENT = "bl-view-density-change";

export function useCompactMode() {
  const [density, setDensity] = useState<ViewDensity>(() => {
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    if (typeof window === "undefined") return "default";
    const saved = localStorage.getItem(KEY) as ViewDensity | null;
    if (saved === "comfortable" || saved === "default" || saved === "compact") return saved;
    return "default";
  });

  // Stay in sync when any other useCompactMode() instance changes density
  useEffect(() => {
    const handler = (e: Event) => {
      setDensity((e as CustomEvent<ViewDensity>).detail);
    };
    window.addEventListener(DENSITY_EVENT, handler);
    return () => window.removeEventListener(DENSITY_EVENT, handler);
  }, []);

  function setViewDensity(next: ViewDensity) {
    setDensity(next);
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new CustomEvent<ViewDensity>(DENSITY_EVENT, { detail: next }));
  }

  function cycleDensity() {
    setViewDensity(nextDensity(density));
  }

  return {
    viewDensity: density,
    /** True when density is "default" or "compact" — used for badge dot display. */
    isCompact: density !== "comfortable",
    setViewDensity,
    cycleDensity,
  };
}

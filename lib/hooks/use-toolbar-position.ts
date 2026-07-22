"use client";

import { useEffect, useState } from "react";

export type ToolbarPosition = "left" | "right" | "top" | "bottom";

const VALID: ToolbarPosition[] = ["left", "right", "top", "bottom"];
const DEFAULT: ToolbarPosition = "left";
const EVENT = "bl-toolbar-pos-change";

function isValid(v: unknown): v is ToolbarPosition {
  return typeof v === "string" && VALID.includes(v as ToolbarPosition);
}

export function useToolbarPosition(storageKey = "bl-toolbar-pos") {
  const [position, setPosition] = useState<ToolbarPosition>(() => {
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    if (typeof window === "undefined") return DEFAULT;
    const saved = localStorage.getItem(storageKey);
    return isValid(saved) ? saved : DEFAULT;
  });

  // Stay in sync when any other useToolbarPosition() instance changes the value
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToolbarPosition>).detail;
      if (isValid(detail)) setPosition(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  function setToolbarPosition(next: ToolbarPosition) {
    setPosition(next);
    localStorage.setItem(storageKey, next);
    window.dispatchEvent(new CustomEvent<ToolbarPosition>(EVENT, { detail: next }));
  }

  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  return { position, orientation, setToolbarPosition };
}

"use client";

import { useEffect, useState } from "react";

export type TagDisplayMode = "text" | "icon" | "hidden";

const KEY = "bl-tag-display-mode";
const MODE_EVENT = "bl-tag-display-mode-change";

export function useTagDisplayMode() {
  const [mode, setMode] = useState<TagDisplayMode>(() => {
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    if (typeof window === "undefined") return "text";
    const saved = localStorage.getItem(KEY) as TagDisplayMode | null;
    if (saved === "icon" || saved === "text" || saved === "hidden") return saved;
    return "text";
  });

  // Stay in sync when any other useTagDisplayMode() instance changes the value
  useEffect(() => {
    const handler = (e: Event) => {
      setMode((e as CustomEvent<TagDisplayMode>).detail);
    };
    window.addEventListener(MODE_EVENT, handler);
    return () => window.removeEventListener(MODE_EVENT, handler);
  }, []);

  function setTagDisplayMode(next: TagDisplayMode) {
    setMode(next);
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new CustomEvent<TagDisplayMode>(MODE_EVENT, { detail: next }));
  }

  return { tagDisplayMode: mode, setTagDisplayMode };
}

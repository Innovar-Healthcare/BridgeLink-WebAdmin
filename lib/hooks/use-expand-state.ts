"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { userScopedKey } from "@/lib/auth";

/**
 * Persists a Set<string> of expanded row/group keys to sessionStorage.
 * sessionStorage survives tab navigation but is cleared when the browser tab closes.
 *
 * @param storageKey  Unique key, e.g. "bl-dashboard-groups" or "bl-channels-groups"
 * @param defaultKeys Initial set of keys to expand when no saved state exists.
 *                    Pass a function so it's only called once (lazy initializer).
 */
export function useExpandState(
  storageKey: string,
  defaultKeys: () => string[] = () => []
): [Set<string>, (key: string) => void, (keys: string[]) => void, () => void, boolean] {
  const defaultsRef = useRef(defaultKeys);
  // Scope the key to the current user so expand/collapse state doesn't leak across logins
  const scopedKey = typeof window !== "undefined" ? userScopedKey(storageKey) : storageKey;

  const [hasSavedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = sessionStorage.getItem(scopedKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });

  // eslint-disable-next-line react-hooks/refs -- defaultsRef holds the initial-keys function; calling it in the lazy initializer is intentional and safe
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>(defaultsRef.current());
    try {
      const raw = sessionStorage.getItem(scopedKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch {
      /* ignore */
    }
    return new Set<string>(defaultsRef.current());
  });

  // Persist whenever the set changes
  useEffect(() => {
    try {
      sessionStorage.setItem(scopedKey, JSON.stringify([...expanded]));
    } catch {
      /* ignore quota errors */
    }
  }, [expanded, scopedKey]);

  /** Toggle a single key */
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  /** Replace entire set (used by Expand All / Collapse All) */
  const setAll = useCallback((keys: string[]) => {
    setExpanded(new Set(keys));
  }, []);

  /** Clear / collapse all */
  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return [expanded, toggle, setAll, collapseAll, hasSavedState];
}

"use client";

import { useState, useCallback } from "react";

export type SortDir = "asc" | "desc";

// Hoisted to module level: constructing an Intl.Collator is expensive,
// and the comparator runs O(n log n) times per sort. One shared instance with the
// same options the old String.localeCompare call used (numeric, base sensitivity).
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export interface SortState<K extends string> {
  key: K | null;
  dir: SortDir;
}

export interface UseSortableResult<K extends string> {
  sort: SortState<K>;
  toggle: (key: K) => void;
  /** Sort an array by a getter fn. Returns a new sorted array (stable). */
  sorted: <T>(items: T[], getter: (item: T) => string | number | undefined | null) => T[];
}

/**
 * Generic column-sort hook.
 * Pass the initial sort key and direction (both optional).
 * `toggle(key)` cycles: none → asc → desc → asc ...
 */
export function useSortable<K extends string>(
  initialKey: K | null = null,
  initialDir: SortDir = "asc"
): UseSortableResult<K> {
  const [sort, setSort] = useState<SortState<K>>({ key: initialKey, dir: initialDir });

  const toggle = useCallback((key: K) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, []);

  const sorted = useCallback(
    <T>(items: T[], getter: (item: T) => string | number | undefined | null): T[] => {
      if (!sort.key) return items;
      return [...items].sort((a, b) => {
        const av = getter(a) ?? "";
        const bv = getter(b) ?? "";
        let cmp = 0;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else {
          cmp = COLLATOR.compare(String(av), String(bv));
        }
        return sort.dir === "asc" ? cmp : -cmp;
      });
    },
    [sort]
  );

  return { sort, toggle, sorted };
}

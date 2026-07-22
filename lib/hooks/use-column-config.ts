"use client";

import { useState, useCallback, useEffect, useRef, startTransition } from "react";
import { logWarn } from "@/lib/dev-logger";

export interface ColDef<K extends string> {
  key: K;
  label: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the column header. */
  tooltip?: string;
  defaultWidth: number; // px
  /** Narrower width applied automatically when density is "default" or "compact". */
  compactWidth?: number; // px
  /** Even narrower width applied only in "compact" density (tightest level). Falls back to compactWidth. */
  tightWidth?: number; // px
  minWidth?: number; // px, default 40
  maxWidth?: number; // px, no limit by default
  defaultVisible: boolean;
  canHide?: boolean; // false = always visible (e.g. Name column)
  align?: "left" | "center" | "right";
  /** When true, column stretches to fill remaining table width instead of using a fixed width. */
  flexible?: boolean;
  /** When false, the column has no drag-resize handle — its width is fixed by the definition. */
  resizable?: boolean;
}

export interface ColState {
  width: number;
  visible: boolean;
  /** True once the user has explicitly dragged this column — disables auto-fill stretch. */
  userResized?: boolean;
}

export type ColStateMap<K extends string> = Record<K, ColState>;

export interface UseColumnConfigResult<K extends string> {
  colState: ColStateMap<K>;
  /** Ordered list of ALL column defs (respects user-defined order) */
  orderedCols: ColDef<K>[];
  /** Ordered list of only visible column defs */
  visibleCols: ColDef<K>[];
  setWidth: (key: K, width: number) => void;
  setVisible: (key: K, visible: boolean) => void;
  /** Move column at fromIndex to toIndex in orderedCols */
  moveCol: (fromIndex: number, toIndex: number) => void;
  resetToDefaults: () => void;
}

function buildDefault<K extends string>(cols: ColDef<K>[]): ColStateMap<K> {
  const map = {} as ColStateMap<K>;
  for (const c of cols) {
    map[c.key] = { width: c.defaultWidth, visible: c.defaultVisible };
  }
  return map;
}

function buildDefaultOrder<K extends string>(cols: ColDef<K>[]): K[] {
  return cols.map((c) => c.key);
}

const STORAGE_VERSION = 2; // bump when storage schema changes

interface StoredConfig<K extends string> {
  v: number;
  state: Partial<ColStateMap<K>>;
  order?: K[];
}

/**
 * Manages per-column visibility, width, and order, persisted to localStorage.
 * storageKey should be unique per table (e.g. "bl-dashboard-cols").
 */
export function useColumnConfig<K extends string>(
  cols: ColDef<K>[],
  storageKey: string
): UseColumnConfigResult<K> {
  // ── Column state (width + visibility) ──────────────────────────────────────
  // Always initialize with defaults so SSR and first client render match (avoids
  // hydration mismatch).  localStorage is loaded in a one-time useEffect below.
  const [colState, setColState] = useState<ColStateMap<K>>(() => buildDefault(cols));

  // ── Column order ────────────────────────────────────────────────────────────
  const [order, setOrder] = useState<K[]>(() => buildDefaultOrder(cols));

  // ── Load persisted state from localStorage after first render ──────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as StoredConfig<K>;
      const saved =
        stored.v === STORAGE_VERSION
          ? stored.state
          : (stored as unknown as Partial<ColStateMap<K>>);
      // Merge saved column state with current defaults. We overlay EVERY saved
      // entry — including keys with no current ColDef (e.g. metadata columns that
      // load asynchronously after mount, — so their persisted width /
      // visibility survive until their ColDef arrives. Retained-but-absent keys are
      // filtered out of orderedCols/visibleCols below, so keeping them is harmless.
      const merged = { ...buildDefault(cols) };
      for (const [key, s] of Object.entries(saved) as [K, ColState | undefined][]) {
        // Skip non-object values so a foreign-version envelope (whose top-level
        // keys are v/state/order, not column keys) can't fabricate junk entries.
        if (!s || typeof s !== "object") continue;
        const def = cols.find((c) => c.key === key);
        merged[key] = {
          width: s.width ?? def?.defaultWidth ?? 120,
          visible: s.visible ?? def?.defaultVisible ?? true,
          userResized: s.userResized ?? false,
        };
      }
      // Low-priority catch-up to persisted state after the SSR-safe default render.
      // Wrapped in startTransition so it isn't a synchronous setState in an effect
      // (react-hooks/set-state-in-effect); behavior is the same post-paint hydration.
      // Keep the FULL saved order (metadata-column positions intact) and append only
      // current cols the saved order didn't know about — do NOT narrow to current cols.
      const orderUpdate =
        stored.v === STORAGE_VERSION && Array.isArray(stored.order)
          ? (() => {
              const known = new Set(stored.order);
              const newKeys = cols.map((c) => c.key).filter((k) => !known.has(k));
              return [...stored.order!, ...newKeys];
            })()
          : null;
      startTransition(() => {
        setColState(merged);
        if (orderUpdate) setOrder(orderUpdate);
      });
    } catch (e) {
      logWarn("ColumnConfig", "Failed to load column state from storage", e);
    }
    // Run once on mount — storageKey and initial cols won't change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync when cols changes (e.g. metadata/plugin columns appear after mount) ─
  // The lazy initializers above only run once, so we imperatively merge whenever
  // the set of column keys changes. This is append-only and never prunes: a key
  // absent from the current `cols` (a metadata column not yet loaded, or a
  // plugin column temporarily gone) keeps its persisted state/position so it is
  // restored when its ColDef returns. Because hydration already loaded
  // the full saved order, any saved metadata key is found here as already-present
  // and left in its saved position rather than re-appended at the end.
  const prevColKeysRef = useRef<string>("");
  useEffect(() => {
    const currentKeys = cols.map((c) => c.key).join(",");
    if (prevColKeysRef.current === currentKeys) return;
    prevColKeysRef.current = currentKeys;

    // Add any current columns missing from colState with defaults; keep the rest.
    setColState((prev) => {
      let added = false;
      const next = { ...prev } as ColStateMap<K>;
      for (const c of cols) {
        if (!next[c.key]) {
          next[c.key] = { width: c.defaultWidth, visible: c.defaultVisible };
          added = true;
        }
      }
      return added ? next : prev;
    });

    // Append current column keys not already present; keep existing order intact.
    setOrder((prev) => {
      const prevSet = new Set(prev);
      const newKeys = cols.map((c) => c.key).filter((k) => !prevSet.has(k));
      return newKeys.length ? [...prev, ...newKeys] : prev;
    });
    // cols identity changes when the array reference changes (useMemo in parent)
  }, [cols]);

  // ── Persist (debounced — ───────────────────────────────────────────
  // A column-resize drag fires setWidth on every mousemove; writing localStorage
  // synchronously on each change janks the drag at large row counts. Debounce the
  // write ~250ms and flush any pending write on unmount so the final width is kept.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<{ key: string; payload: StoredConfig<K> } | null>(null);

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const pending = pendingPersistRef.current;
    if (!pending) return;
    pendingPersistRef.current = null;
    try {
      localStorage.setItem(pending.key, JSON.stringify(pending.payload));
    } catch {
      /* ignore quota */
    }
  }, []);

  useEffect(() => {
    pendingPersistRef.current = {
      key: storageKey,
      payload: { v: STORAGE_VERSION, state: colState, order },
    };
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(flushPersist, 250);
  }, [colState, order, storageKey, flushPersist]);

  // Flush the pending write on unmount so a width set in the last 250ms isn't lost.
  useEffect(() => flushPersist, [flushPersist]);

  // Unmount cleanup doesn't run on hard reload or tab close — flush on pagehide
  // so a resize in the final 250ms survives Cmd+R.
  useEffect(() => {
    window.addEventListener("pagehide", flushPersist);
    return () => window.removeEventListener("pagehide", flushPersist);
  }, [flushPersist]);

  // ── Setters ─────────────────────────────────────────────────────────────────
  const setWidth = useCallback((key: K, width: number) => {
    setColState((prev) => ({ ...prev, [key]: { ...prev[key], width, userResized: true } }));
  }, []);

  const setVisible = useCallback((key: K, visible: boolean) => {
    setColState((prev) => ({ ...prev, [key]: { ...prev[key], visible } }));
  }, []);

  const moveCol = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      setOrder((prev) => {
        // Callers pass indices into the RENDERED (filtered) column view
        // (ColumnPicker maps over orderedCols), but `prev` may also hold retained
        // keys with no current ColDef — metadata columns not yet loaded, or from
        // another channel under the shared storage key. Translate the
        // view indices to raw indices in `prev` so the drag moves the right column
        // instead of splicing an off-screen key.
        const colKeySet = new Set(cols.map((c) => c.key));
        const viewKeys = prev.filter((k) => colKeySet.has(k));
        const fromKey = viewKeys[fromIdx];
        const toKey = viewKeys[toIdx];
        if (fromKey === undefined || toKey === undefined) return prev;
        const rawFrom = prev.indexOf(fromKey);
        const rawTo = prev.indexOf(toKey);
        if (rawFrom === -1 || rawTo === -1 || rawFrom === rawTo) return prev;
        const next = [...prev];
        const [moved] = next.splice(rawFrom, 1);
        next.splice(rawTo, 0, moved);
        return next;
      });
    },
    [cols]
  );

  const resetToDefaults = useCallback(() => {
    setColState(buildDefault(cols));
    setOrder(buildDefaultOrder(cols));
  }, [cols]);

  // Reset column widths when the user cycles density.
  // Columns reset to tightWidth (compact), compactWidth (default), or defaultWidth (comfortable).
  useEffect(() => {
    const handler = (e: Event) => {
      const density = (e as CustomEvent<string>).detail;
      setColState((prev) => {
        const next = { ...prev } as ColStateMap<K>;
        for (const c of cols) {
          let width: number;
          if (density === "compact") {
            width = c.tightWidth ?? c.compactWidth ?? c.defaultWidth;
          } else if (density === "default") {
            width = c.compactWidth ?? c.defaultWidth;
          } else {
            width = c.defaultWidth;
          }
          next[c.key] = { ...next[c.key], width, userResized: false };
        }
        return next;
      });
    };
    window.addEventListener("bl-view-density-change", handler);
    return () => window.removeEventListener("bl-view-density-change", handler);
  }, [cols]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Build a key→ColDef map for O(1) lookup
  const colMap = new Map<K, ColDef<K>>(cols.map((c) => [c.key, c]));

  const orderedCols: ColDef<K>[] = order
    .map((k) => colMap.get(k))
    .filter((c): c is ColDef<K> => c != null);

  const visibleCols = orderedCols.filter((c) => colState[c.key]?.visible !== false);

  return { colState, orderedCols, visibleCols, setWidth, setVisible, moveCol, resetToDefaults };
}

// ─── Resize handle hook ───────────────────────────────────────────────────────

/**
 * Returns props to attach to a resize handle element inside a <th>.
 * Calls onResize(newWidth) while dragging.
 *
 * Uses refs for currentWidth, minWidth, and onResize so the mousemove
 * handler always sees the latest values without needing to be recreated —
 * avoiding the stale-closure bug where dragging had no effect.
 */
export function useResizeHandle(
  currentWidth: number,
  minWidth: number = 40,
  onResize: (w: number) => void,
  maxWidth: number = Infinity
) {
  // Keep live values in refs so the drag handler never closes over stale state
  const currentWidthRef = useRef(currentWidth);
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);
  const onResizeRef = useRef(onResize);

  // Sync refs on every render so drag handlers always see the latest values
  // eslint-disable-next-line react-hooks/refs
  currentWidthRef.current = currentWidth;
  // eslint-disable-next-line react-hooks/refs
  minWidthRef.current = minWidth;
  // eslint-disable-next-line react-hooks/refs
  maxWidthRef.current = maxWidth;
  // eslint-disable-next-line react-hooks/refs
  onResizeRef.current = onResize;

  const startX = useRef(0);
  const startW = useRef(0);
  // Tracks whether a resize drag is in progress — used by SortableHeaderCell to
  // prevent the post-drag click event from accidentally triggering a sort.
  const resizing = useRef(false);

  // onMouseDown is stable (no deps) — it reads live values via refs
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    startX.current = e.clientX;
    startW.current = currentWidthRef.current; // snapshot width at drag-start

    let dragActivated = false;

    const onMove = (me: MouseEvent) => {
      const delta = me.clientX - startX.current;
      // Require ≥3 px movement before treating as an intentional drag.
      // This prevents trackpad click-jitter (1–2 px) from resizing the column.
      if (!dragActivated) {
        if (Math.abs(delta) < 3) return;
        dragActivated = true;
      }
      const newW = Math.min(
        maxWidthRef.current,
        Math.max(minWidthRef.current, startW.current + delta)
      );
      onResizeRef.current(newW);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Reset after the click event fires (click follows mouseup in the same task).
      setTimeout(() => {
        resizing.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []); // stable — no deps needed

  return { onMouseDown, resizing };
}

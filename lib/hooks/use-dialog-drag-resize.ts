"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

// ─── Geometry helpers (pure — unit-tested in isolation) ─────────────────────────

/** Horizontal gap kept between the dialog and the viewport edges (1rem). Mirrors max-w calc. */
const MARGIN_X = 16;
/** Vertical gap kept between the dialog and the viewport edges (2rem). Mirrors max-h calc. */
const MARGIN_Y = 32;
/** Minimum slice of the dialog kept on-screen so a dragged dialog can always be grabbed back. */
const MIN_ON_SCREEN = 80;

export interface Position {
  top: number;
  left: number;
}

export interface Geometry extends Position {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Centered geometry for a dialog of the desired size within a viewport, with the
 * size clamped to fit inside the viewport margins.
 */
export function centeredGeom(
  desiredWidth: number,
  desiredHeight: number,
  minWidth: number,
  minHeight: number,
  viewport: Viewport
): Geometry {
  const maxW = Math.max(minWidth, viewport.width - MARGIN_X * 2);
  const maxH = Math.max(minHeight, viewport.height - MARGIN_Y * 2);
  const width = clamp(desiredWidth, minWidth, maxW);
  const height = clamp(desiredHeight, minHeight, maxH);
  return {
    width,
    height,
    left: Math.round((viewport.width - width) / 2),
    top: Math.round((viewport.height - height) / 2),
  };
}

/** Geometry that fills the viewport minus the edge margins (the "maximized" state). */
export function maximizedGeom(viewport: Viewport): Geometry {
  return {
    width: Math.max(0, viewport.width - MARGIN_X * 2),
    height: Math.max(0, viewport.height - MARGIN_Y * 2),
    top: MARGIN_Y,
    left: MARGIN_X,
  };
}

/**
 * Clamp an existing geometry so it fits the viewport and keeps a grabbable slice
 * on-screen — used when the window shrinks while the dialog is open.
 */
export function clampToViewport(
  geom: Geometry,
  minWidth: number,
  minHeight: number,
  viewport: Viewport
): Geometry {
  const maxW = Math.max(minWidth, viewport.width - MARGIN_X * 2);
  const maxH = Math.max(minHeight, viewport.height - MARGIN_Y * 2);
  const width = clamp(geom.width, minWidth, maxW);
  const height = clamp(geom.height, minHeight, maxH);
  return {
    width,
    height,
    left: clamp(geom.left, MIN_ON_SCREEN - width, viewport.width - MIN_ON_SCREEN),
    top: clamp(geom.top, 0, viewport.height - MIN_ON_SCREEN),
  };
}

// ─── Mobile / small-viewport gate (external store — no set-state-in-effect) ─────

const MOBILE_BREAKPOINT_PX = 640; // Tailwind `sm`
const MEDIA_QUERY = `(min-width: ${MOBILE_BREAKPOINT_PX}px)`;

function subscribeViewport(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MEDIA_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getViewportServerSnapshot(): boolean {
  return false;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 672; // = Tailwind max-w-2xl (42rem)
const DEFAULT_MIN_WIDTH = 380;
const DEFAULT_MIN_HEIGHT = 200;

export interface UseDialogDragResizeOptions {
  /** Whether the dialog is open. Geometry recenters on the open transition. */
  open: boolean;
  /** Initial width in px. Default 672 (max-w-2xl). */
  defaultWidth?: number;
  /** Initial height in px. Default ≈ 60% of the viewport height, clamped to fit. */
  defaultHeight?: number;
  minWidth?: number; // default 380
  minHeight?: number; // default 200
  /** Enable drag-to-move via the header handle. Default true. */
  draggable?: boolean;
  /** Enable native resize. Default true. */
  resizable?: boolean;
  /** Enable the maximize/restore toggle. Default true. */
  maximizable?: boolean;
}

export interface UseDialogDragResizeResult {
  /** Spread onto `<DialogContent>` — carries the ref and the positioning/resize style. */
  contentProps: {
    ref: (node: HTMLDivElement | null) => void;
    style: CSSProperties | undefined;
  };
  /** Spread onto the drag handle (the `<DialogHeader>`). */
  handleProps: {
    onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick?: () => void;
    style?: CSSProperties;
  };
  /** Maximize/restore controls for a `<DialogMaximizeButton>`. */
  maximize: {
    isMaximized: boolean;
    toggle: () => void;
    /** True when the maximize affordance should be shown (i.e. behaviors are active). */
    available: boolean;
  };
  /** False on small viewports — all behaviors disabled and the dialog renders centered. */
  enabled: boolean;
}

/**
 * Opt-in drag + resize + maximize for a Radix `DialogContent`. Strictly additive:
 * dialogs that never call this are unaffected.
 *
 * Geometry model: on the open transition the dialog is converted from Radix's
 * `translate(-50%,-50%)` centering to explicit `position: fixed; top/left` pixels
 * (with `transform/translate: none`), so native `resize: both` grows naturally
 * bottom-right and dragging is a simple `top/left` update. The full geometry lives
 * in React-controlled `style` (computed during render, not in an effect) so it is
 * applied the moment Radix mounts the content node — independent of ref or
 * effect timing (Radix's Presence can mount the node a commit after `open` flips).
 * A ResizeObserver mirrors the native-resized size back into state so re-renders
 * never clobber the user's drag. No persistence — geometry recenters at the
 * default size each open; the maximize toggle covers "I need room".
 *
 * Keyboard users cannot drag/resize (this is a pointer-only enhancement, consistent
 * with native CSS `resize`); the dialog is fully operable at its centered default.
 */
export function useDialogDragResize({
  open,
  defaultWidth = DEFAULT_WIDTH,
  defaultHeight,
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
  draggable = true,
  resizable = true,
  maximizable = true,
}: UseDialogDragResizeOptions): UseDialogDragResizeResult {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  /** Geometry captured before maximizing, restored on toggle-off. */
  const restoreRef = useRef<Geometry | null>(null);

  const enabled = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot
  );

  const [geom, setGeom] = useState<Geometry | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // Live mirrors so pointer handlers read the latest without being recreated.
  const geomRef = useRef<Geometry | null>(null);
  // eslint-disable-next-line react-hooks/refs
  geomRef.current = geom;
  const maximizedRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs
  maximizedRef.current = maximized;

  // Center on the open transition / reset on close. Done during render (the React
  // "adjust state when a prop changes" idiom — see SendMessageDialog) so the first
  // committed render already carries the geometry in `style`; this avoids both the
  // set-state-in-effect lint and any off-screen frame from Radix's deferred mount.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      if (enabled && typeof window !== "undefined") {
        setGeom(
          centeredGeom(
            defaultWidth,
            defaultHeight ?? Math.round(window.innerHeight * 0.6),
            minWidth,
            minHeight,
            { width: window.innerWidth, height: window.innerHeight }
          )
        );
      }
      setMaximized(false);
    } else {
      setGeom(null);
      setMaximized(false);
    }
  }

  const setRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

  // Mirror the native-resized size back into state so a later re-render re-applies
  // the size the user dragged to (rather than the last React-set value).
  useEffect(() => {
    if (!enabled || !open) return;
    const node = nodeRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const n = nodeRef.current;
      if (!n) return;
      const w = Math.round(n.offsetWidth);
      const h = Math.round(n.offsetHeight);
      setGeom((prev) =>
        prev && (Math.abs(prev.width - w) >= 1 || Math.abs(prev.height - h) >= 1)
          ? { ...prev, width: w, height: h }
          : prev
      );
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [enabled, open]);

  // Re-clamp when the viewport shrinks so the dialog never ends up off-screen.
  useEffect(() => {
    if (!enabled || !open || typeof window === "undefined") return;
    const onResize = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      if (maximizedRef.current) {
        setGeom(maximizedGeom(viewport));
        return;
      }
      setGeom((prev) => (prev ? clampToViewport(prev, minWidth, minHeight, viewport) : prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, open, minWidth, minHeight]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!draggable || !enabled || maximizedRef.current || e.button !== 0) return;
      // Don't start a drag from interactive header content (e.g. the close button).
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select, [data-no-drag]")) return;
      const node = nodeRef.current;
      const start = geomRef.current;
      if (!node || !start) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const { left: startLeft, top: startTop, width } = start;
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);

      let next: Position = { left: startLeft, top: startTop };
      // Move imperatively during the drag for smoothness; commit to state on release.
      const onMove = (me: PointerEvent) => {
        const left = clamp(
          startLeft + (me.clientX - startX),
          MIN_ON_SCREEN - width,
          window.innerWidth - MIN_ON_SCREEN
        );
        const top = clamp(startTop + (me.clientY - startY), 0, window.innerHeight - MIN_ON_SCREEN);
        next = { left, top };
        node.style.left = `${left}px`;
        node.style.top = `${top}px`;
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setGeom((prev) => (prev ? { ...prev, left: next.left, top: next.top } : prev));
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [draggable, enabled]
  );

  const toggleMaximize = useCallback(() => {
    if (typeof window === "undefined") return;
    if (maximizedRef.current) {
      if (restoreRef.current) setGeom(restoreRef.current);
      setMaximized(false);
    } else {
      if (geomRef.current) restoreRef.current = geomRef.current;
      setGeom(maximizedGeom({ width: window.innerWidth, height: window.innerHeight }));
      setMaximized(true);
    }
  }, []);

  const onDoubleClick = useCallback(() => {
    if (!maximizable || !enabled) return;
    toggleMaximize();
  }, [maximizable, enabled, toggleMaximize]);

  // Full geometry lives in React style so it is applied when Radix mounts the node.
  // Inline style wins over Radix's baked-in centering utilities (top/left/translate).
  const contentStyle: CSSProperties | undefined =
    enabled && geom
      ? {
          position: "fixed",
          top: geom.top,
          left: geom.left,
          width: geom.width,
          height: geom.height,
          transform: "none",
          translate: "none",
          margin: 0,
          minWidth,
          minHeight,
          maxWidth: "calc(100vw - 2rem)",
          maxHeight: "calc(100vh - 4rem)",
          resize: !maximized && resizable ? "both" : "none",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }
      : undefined;

  const handleStyle: CSSProperties | undefined =
    enabled && draggable && !maximized
      ? { cursor: "move", userSelect: "none", touchAction: "none" }
      : undefined;

  return {
    contentProps: { ref: setRef, style: contentStyle },
    handleProps: {
      onPointerDown: enabled && draggable ? onPointerDown : undefined,
      onDoubleClick: enabled && maximizable ? onDoubleClick : undefined,
      style: handleStyle,
    },
    maximize: {
      isMaximized: maximized,
      toggle: toggleMaximize,
      available: enabled && maximizable,
    },
    enabled,
  };
}

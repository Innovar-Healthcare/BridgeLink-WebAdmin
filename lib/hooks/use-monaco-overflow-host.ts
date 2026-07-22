"use client";

import { type CSSProperties, useCallback, useState } from "react";

/**
 * Transform-free centering for a Radix modal `DialogContent` that hosts a Monaco
 * editor rendering suggest/hover popups.
 *
 * Radix centers `DialogContent` with a Tailwind-v4 `translate`, which becomes the
 * containing block for the popup's `position:fixed` and offsets it far from the
 * cursor — often off the visible dialog entirely, reading as "no autocomplete at
 * all." Clearing translate/transform and centering with inset:0 + margin:auto
 * anchors the popup to the viewport instead,. The open/close
 * zoom animation still plays — running CSS animations outrank inline styles; only
 * the settled transform is cleared.
 *
 * Apply only to dialogs with a definite width AND height (both are needed for
 * margin:auto to center rather than stretch the box full-viewport). Pair with
 * `useMonacoOverflowHost()` — the two halves of the same fix.
 */
// Frozen: this single object is shared as a `style` prop across multiple dialogs,
// so an accidental future mutation would silently affect every call site.
export const MONACO_DIALOG_CENTER_STYLE: CSSProperties = Object.freeze({
  translate: "none",
  transform: "none",
  inset: 0,
  margin: "auto",
});

/**
 * In-dialog host node for Monaco's overflow widgets (suggest, hover, find, and
 * the context menu's shadow root).
 *
 * The app-wide default (lib/monaco-defaults.ts) keeps `fixedOverflowWidgets: true`
 * and hosts the widgets on a document.body node so they escape overflow clipping.
 * Inside a Radix *modal* dialog that body node is unusable: Radix's modal scope
 * aria-hides it, sets pointer-events: none on it, and traps focus inside the
 * dialog — so widget clicks pass through, the menu never receives focus, and the
 * editor loses focus when it tries autocomplete, context menu).
 *
 * Fix: host the widgets in a node *inside* the dialog subtree. Usage:
 *
 *   const { overflowHost, hostRef } = useMonacoOverflowHost();
 *   <Editor options={{ ...base, ...(overflowHost && { overflowWidgetsDomNode: overflowHost }) }} />
 *   <div ref={hostRef} />   // anywhere inside the DialogContent
 *
 * Positioning caveat: Monaco's suggest/hover popups are position:fixed and anchor
 * to the nearest transformed ancestor — a dialog centered with Radix's default CSS
 * translate offsets them from the cursor. Either center the dialog transform-free
 * (see attachment-handler-properties-dialog.tsx) or rely on useDialogDragResize,
 * whose geometry already sets transform/translate: none.
 *
 * Context-menu caveat: this host makes Monaco's right-click menu render, click,
 * and focus correctly in a dialog — but the menu's built-in Paste entry is broken
 * in browsers everywhere (it bottoms out in the Chrome-blocked
 * execCommand('paste')). Pair this hook with `registerClipboardPaste` from
 * lib/monaco-clipboard in the editor's onMount,.
 */
export function useMonacoOverflowHost(): {
  overflowHost: HTMLDivElement | null;
  hostRef: (container: HTMLDivElement | null) => void;
} {
  // State initializer so the node is created once per mount, client-side only.
  const [overflowHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    // Monaco widget CSS is scoped under .monaco-editor.
    el.className = "monaco-editor";
    // Zero layout footprint wherever the host container is rendered.
    el.style.position = "absolute";
    return el;
  });

  const hostRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (container && overflowHost && overflowHost.parentNode !== container) {
        container.appendChild(overflowHost);
      }
    },
    [overflowHost]
  );

  return { overflowHost, hostRef };
}

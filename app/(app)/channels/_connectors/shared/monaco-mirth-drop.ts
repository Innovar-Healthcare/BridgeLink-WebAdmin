"use client";

/**
 * registerMirthDropHandler
 *
 * Attaches DOM-level dragover/drop listeners to a Monaco editor so that items
 * dragged from the Destination Mappings panel are inserted as plain text
 * instead of being processed as Monaco snippets (which would escape `$` / `{`
 * and append a `$0` cursor marker).
 *
 * Two MIME types are supported on the drag DataTransfer:
 *   "text/x-mirth-js"  — JavaScript expression (for JS/Rhino editors)
 *   "text/plain"        — Velocity template expression (for SQL / text fields)
 *
 * The caller passes a `preferJsRef` whose `.current` is read at drop-time, so
 * the handler always sees the latest mode without needing to be re-registered
 * (e.g. when Database Writer toggles between SQL ↔ JavaScript).
 *
 * Returns a cleanup function that removes the listeners; call it on unmount.
 */

import type * as Monaco from "monaco-editor";

const MIME_JS = "text/x-mirth-js";
const MIME_TPL = "text/plain";

export function registerMirthDropHandler(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  preferJsRef: { current: boolean }
): () => void {
  const domNode = editor.getDomNode();
  if (!domNode) return () => {};

  function hasMirthData(e: DragEvent): boolean {
    return e.dataTransfer?.types.some((t) => t === MIME_JS || t === MIME_TPL) ?? false;
  }

  function onDragOver(e: DragEvent) {
    if (!hasMirthData(e)) return;
    e.preventDefault();
    // Do NOT stopPropagation — Monaco still needs to move its cursor indicator.
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: DragEvent) {
    const jsText = e.dataTransfer?.getData(MIME_JS) ?? "";
    const tplText = e.dataTransfer?.getData(MIME_TPL) ?? "";
    // Pick JS expression when in JS mode AND a JS expression exists
    const text = preferJsRef.current && jsText ? jsText : tplText || jsText;
    if (!text) return;

    // Take over: prevent Monaco's own snippet-mode drop handler from running.
    e.preventDefault();
    e.stopImmediatePropagation();

    // Resolve the text position under the mouse at drop time.
    const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
    const pos = target?.position ?? editor.getPosition();
    if (!pos) return;

    // If the editor has a non-empty selection, replace it; otherwise insert at cursor.
    const sel = editor.getSelection();
    const range =
      sel && !sel.isEmpty()
        ? sel
        : new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);

    editor.executeEdits("mirth-mapping", [{ range, text, forceMoveMarkers: true }]);
    editor.focus();
  }

  // Use capture phase so our handlers fire before Monaco's bubble-phase handlers.
  domNode.addEventListener("dragover", onDragOver, { capture: true });
  domNode.addEventListener("drop", onDrop, { capture: true });

  return () => {
    domNode.removeEventListener("dragover", onDragOver, { capture: true });
    domNode.removeEventListener("drop", onDrop, { capture: true });
  };
}

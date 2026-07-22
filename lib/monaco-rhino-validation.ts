/**
 * Real-time syntax validation for rhino-js Monaco editors.
 *
 * Extracted from the Code Templates editor so the transformer/filter JS
 * editors — and any other editable rhino-js editor — can opt into the identical
 * squiggle + hover-tooltip behavior with one call, keeping the error markers byte-for-byte
 * consistent across editors.
 *
 * Uses the shared acorn-based parser (lib/js-validation) — no eval/new Function, so it
 * satisfies the app CSP (script-src 'self';. Non-strict + allowReturnOutsideFunction
 * mirrors the Java client's non-strict Rhino wrapper; E4X scripts are deferred (Rhino accepts
 * them, acorn cannot parse them).
 */

import type * as MonacoType from "monaco-editor";
import { findJsSyntaxError } from "@/lib/js-validation";

/**
 * Marker owner string — per-model, so it never collides across editors. Doubles as the
 * language id we validate: the same "rhino-js" language every editable JS editor registers
 * (see RHINO_LANG_ID in lib/monaco-rhino). Editors that toggle between SQL and JavaScript
 * (Database Reader/Writer) keep one model and swap its language, so the guard below skips
 * validation while the model is in SQL mode.
 */
const MARKER_OWNER = "rhino-js";

/**
 * Run the acorn parser over the model's current content and set (or clear) Monaco error
 * markers accordingly. Exported so a page's Validate action can force a fresh, synchronous
 * check before reading markers (the on-change path is debounced).
 *
 * No-op (clears any existing rhino-js markers) when the model is not in the rhino-js language
 * — e.g. a Database connector editor toggled to SQL mode — so SQL is never flagged as bad JS.
 */
export function validateRhinoSyntax(
  monaco: typeof MonacoType,
  model: MonacoType.editor.ITextModel
) {
  // Only validate rhino-js models. SQL/JS-toggle editors reuse one model across languages;
  // clear our markers when it isn't JavaScript rather than parse SQL as JS.
  if (model.getLanguageId() !== MARKER_OWNER) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    return;
  }

  const markers: MonacoType.editor.IMarkerData[] = [];
  const error = findJsSyntaxError(model.getValue());
  if (error) {
    const line = Math.min(Math.max(1, error.line), model.getLineCount());
    const maxColumn = model.getLineMaxColumn(line);
    // acorn columns are 0-based; Monaco is 1-based. Clamp to the line's bounds.
    const startColumn = Math.min(Math.max(1, error.column + 1), maxColumn);
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: error.message,
      startLineNumber: line,
      endLineNumber: line,
      startColumn,
      endColumn: maxColumn,
    });
  }
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
}

/**
 * Attach real-time validation to an editor: validate the initial content immediately, then
 * re-validate on every content change with a 600ms debounce (matches typical IDE feel). The
 * change listener and pending timer are cleaned up automatically when the model is disposed
 * (editor unmounted / content swapped).
 *
 * Also re-validates when the model's language changes, so SQL/JS-toggle editors (Database
 * Reader/Writer) show squiggles immediately on switching to JavaScript and clear them
 * immediately on switching to SQL — without waiting for the next keystroke.
 *
 * Returns an {@link MonacoType.IDisposable} so callers may tear it down early; callers that
 * don't can ignore it — the model's `onWillDispose` handles cleanup.
 */
export function attachRhinoValidation(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  monaco: typeof MonacoType
): MonacoType.IDisposable {
  const model = editor.getModel();
  if (!model) return { dispose() {} };

  // Run once immediately for initial content.
  validateRhinoSyntax(monaco, model);

  let disposed = false;
  let debounce: ReturnType<typeof setTimeout>;
  const changeListener = model.onDidChangeContent(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => validateRhinoSyntax(monaco, model), 600);
  });

  // Re-validate on language switch (SQL ⇄ JavaScript). @monaco-editor/react swaps the model's
  // language in place (setModelLanguage) rather than recreating the model, so this fires and
  // the change/dispose listeners above stay valid across the toggle.
  const langListener = editor.onDidChangeModelLanguage(() => validateRhinoSyntax(monaco, model));

  // Idempotent: safe whether triggered by the returned disposable (early teardown) or by
  // the model disposing itself — and it tears down its own onWillDispose registration so
  // early callers don't leak a listener on the model.
  function dispose() {
    if (disposed) return;
    disposed = true;
    changeListener.dispose();
    langListener.dispose();
    willDispose.dispose();
    clearTimeout(debounce);
  }

  // Clean up when the model is disposed (editor unmounted / template switched).
  const willDispose = model.onWillDispose(dispose);

  return { dispose };
}

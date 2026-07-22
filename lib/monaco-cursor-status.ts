import type * as MonacoType from "monaco-editor";

/**
 * Language id of the BridgeLink Rhino/JS editors. Kept as a local literal (rather
 * than imported from the ~2900-line lib/monaco-rhino.ts) so this helper — invoked
 * from the app-wide MonacoEditor mount path — stays lightweight. Must match
 * RHINO_LANG_ID in lib/monaco-rhino.ts.
 */
const RHINO_LANG_ID = "rhino-js";

const WIDGET_ID = "bridgelink.overlay.cursorStatus";

/**
 * Editors we've already attached to. `composeEditorMount` can run more than once
 * for the same editor instance (e.g. React StrictMode double-mounts — the sibling
 * `registerClipboardPaste` guards the same way), and re-attaching would leak a
 * second cursor listener and orphan the first overlay node. A WeakSet lets the
 * editor be GC'd normally once it's disposed.
 */
const attached = new WeakSet<MonacoType.editor.IStandaloneCodeEditor>();

/** Format the 1-based line/column pair for display, e.g. "Ln 3, Col 12". */
function formatPosition(position: MonacoType.Position | null): string {
  if (!position) return "Ln 1, Col 1";
  return `Ln ${position.lineNumber}, Col ${position.column}`;
}

/**
 * Attach a small "Ln N, Col N" cursor-position indicator to the bottom-right
 * corner of a Rhino/JS editor item 5).
 *
 * Registered centrally from `composeEditorMount` so every JS editor gets it with
 * no per-call-site wiring. Self-gates on the model language: editors that are not
 * `rhino-js` (XML/SQL viewers, message content) get nothing, keeping the feature
 * scoped to the JS code editors the ticket asks about.
 *
 * The indicator is a Monaco overlay widget (escapes the editor's own
 * `overflow:hidden`) styled via the `.bl-editor-cursor-status` class in
 * globals.css so it themes with the app. Everything is torn down on editor
 * dispose, so nothing leaks when the editor unmounts.
 */
export function attachCursorPositionStatus(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  monaco: typeof MonacoType
): void {
  // Optional chaining on getModel itself: the model can be null (detached
  // editor), and lightweight test fakes may omit it entirely.
  if (editor.getModel?.()?.getLanguageId() !== RHINO_LANG_ID) return;
  if (attached.has(editor)) return;
  attached.add(editor);

  const node = document.createElement("div");
  node.className = "bl-editor-cursor-status";
  node.textContent = formatPosition(editor.getPosition());

  const widget: MonacoType.editor.IOverlayWidget = {
    getId: () => WIDGET_ID,
    getDomNode: () => node,
    getPosition: () => ({
      preference: monaco.editor.OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER,
    }),
  };
  editor.addOverlayWidget(widget);

  const cursorSub = editor.onDidChangeCursorPosition((e) => {
    node.textContent = formatPosition(e.position);
  });

  editor.onDidDispose(() => {
    cursorSub.dispose();
    editor.removeOverlayWidget(widget);
  });
}

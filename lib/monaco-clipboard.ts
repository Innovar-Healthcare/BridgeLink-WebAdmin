import type * as MonacoType from "monaco-editor";

/** Id of our working Paste action. Distinct from the built-in so both can coexist briefly. */
const PASTE_ACTION_ID = "bridgelink.action.clipboardPaste";
/** Id of Monaco's broken built-in Paste action, which we hide from the context menu. */
const BUILTIN_PASTE_ACTION_ID = "editor.action.clipboardPasteAction";

/** A single context-menu item as returned by the context-menu controller. */
interface ContextMenuItem {
  id?: string;
}

/**
 * Internal shape of Monaco's "editor.contrib.contextmenu" contribution that we patch.
 * `_getMenuActions` is private API, so every access is runtime-guarded: a Monaco upgrade
 * that renames it degrades gracefully (the broken built-in Paste reappears, nothing breaks).
 */
interface ContextMenuController {
  _getMenuActions?: (...args: unknown[]) => ContextMenuItem[];
  /** Set once we've wrapped `_getMenuActions`, so StrictMode double-mounts don't re-wrap. */
  __blPasteEntryRemoved?: boolean;
}

/**
 * Make the right-click "Paste" menu entry work in the browser.
 *
 * Monaco's built-in Paste action (`editor.action.clipboardPasteAction`) relies on
 * `document.execCommand("paste")`, which browsers block from page content for security —
 * so clicking "Paste" silently does nothing. This:
 *
 *   1. Adds a working Paste action that reads via the async Clipboard API and inserts at the
 *      current selection(s).
 *   2. Filters Monaco's broken built-in Paste out of the context menu, so only the working
 *      entry shows (otherwise the menu lists "Paste" twice).
 *
 * Keyboard Ctrl/Cmd+V is intentionally left to Monaco's native textarea paste handler
 * (which already works) — we register NO keybinding here, only the context-menu entry.
 */
export function registerClipboardPaste(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  // Kept for signature symmetry with other Monaco helpers; the run handler doesn't need it.
  _monaco: typeof MonacoType
): void {
  editor.addAction({
    id: PASTE_ACTION_ID,
    label: "Paste",
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 4, // matches the built-in Paste's slot (after Cut/Copy)
    run: async (ed) => {
      if (!navigator.clipboard?.readText) return;
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return; // permission denied or document not focused
      }
      if (!text) return;
      const selections = ed.getSelections();
      if (!selections?.length) return;
      // An empty (cursor-only) selection inserts; a non-empty one replaces. Multi-cursor
      // pastes the same text at each selection — matching Monaco's normal paste behavior.
      ed.executeEdits(
        "clipboard-paste",
        selections.map((sel) => ({ range: sel, text, forceMoveMarkers: true }))
      );
      ed.focus();
    },
  });

  // addAction appends a *second* "Paste" — the built-in one stays in the menu (it just fails
  // silently). Wrap the context-menu controller's action list to drop the built-in entry.
  const controller = editor.getContribution("editor.contrib.contextmenu") as unknown as
    | ContextMenuController
    | null
    | undefined;
  if (
    controller &&
    typeof controller._getMenuActions === "function" &&
    !controller.__blPasteEntryRemoved
  ) {
    const original = controller._getMenuActions.bind(controller);
    controller._getMenuActions = (...args: unknown[]) =>
      original(...args).filter((item) => item?.id !== BUILTIN_PASTE_ACTION_ID);
    controller.__blPasteEntryRemoved = true;
  }
}

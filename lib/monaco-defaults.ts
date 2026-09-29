import type * as MonacoType from "monaco-editor";
import { loadAdminPrefs } from "./admin-prefs";

/**
 * A single DOM node, appended to document.body, that hosts the overflow widget
 * containers for every Monaco editor in the app. Monaco's default behavior is to
 * append these containers inside the editor's own DOM — which means they get
 * clipped by any `overflow: hidden` ancestor. The find widget, hover tooltips,
 * suggest widget, and parameter hints all need to escape that clipping.
 */
let _overflowWidgetsRoot: HTMLDivElement | null = null;
function getOverflowWidgetsRoot(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  if (!_overflowWidgetsRoot || !_overflowWidgetsRoot.isConnected) {
    _overflowWidgetsRoot = document.createElement("div");
    _overflowWidgetsRoot.className = "monaco-editor monaco-overflow-widgets-root";
    document.body.appendChild(_overflowWidgetsRoot);
  }
  return _overflowWidgetsRoot;
}

const baseOptions: MonacoType.editor.IStandaloneEditorConstructionOptions = {
  renderWhitespace: "none",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  minimap: { enabled: false },
  // fontFamily / fontSize are defined below as prefs-reading getters.
  lineNumbers: "on",
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "off",
  fixedOverflowWidgets: true,
  // No gray highlight of the token under a bare cursor — the Java
  // client's RSyntaxTextArea never enables mark-occurrences. Selecting text
  // still highlights its other matches (selectionHighlight stays on).
  occurrencesHighlight: "off",
};

// `overflowWidgetsDomNode` must resolve at editor-construction time (client only).
// Use a getter so the document.body child is created lazily, on the first spread,
// rather than during module init (which would fail under SSR).
Object.defineProperty(baseOptions, "overflowWidgetsDomNode", {
  enumerable: true,
  get: getOverflowWidgetsRoot,
});

// Font family/size come from the user's Code Editor Preferences.
//
// These are getters for the same reason overflowWidgetsDomNode is: they must be
// read at spread time, not module-init time. Every editor spreads
// MONACO_BASE_OPTIONS, so a getter makes the pref apply to *all* of them —
// including the ~12 non-Rhino editors (XSLT panel, message templates, file and
// document writer, content viewer, lookups value dialog, ...) that never called
// getRhinoEditorOptions() and so silently ignored the setting entirely.
//
// Spreading copies the getter's current value, so each render picks up a changed
// pref, and a per-editor override placed *after* the spread still wins (e.g.
// web-service-sender.tsx's `fontSize: 12`). loadAdminPrefs() is fingerprint-cached
// precisely because Monaco calls it on every render, so this stays cheap; under
// SSR it returns the defaults.
Object.defineProperty(baseOptions, "fontFamily", {
  enumerable: true,
  get: () => loadAdminPrefs().editorFontFamily,
});
Object.defineProperty(baseOptions, "fontSize", {
  enumerable: true,
  get: () => loadAdminPrefs().editorFontSize,
});

/**
 * Base Monaco editor options shared across all BridgeLink editors.
 * Spread this into every <Editor options={...}> call.
 */
export const MONACO_BASE_OPTIONS: MonacoType.editor.IStandaloneEditorConstructionOptions =
  baseOptions;

/**
 * Editor options for BridgeLink Rhino JS editors.
 *
 * Extends MONACO_BASE_OPTIONS with autocomplete settings read from the admin
 * preferences so every Rhino editor honours the user's configured delay and
 * trigger behaviour — not just the code-template editor.
 *
 * Pass `overrides` to layer per-editor settings (e.g. readOnly, insertSpaces).
 */
export function getRhinoEditorOptions(
  overrides?: MonacoType.editor.IStandaloneEditorConstructionOptions
): MonacoType.editor.IStandaloneEditorConstructionOptions {
  const prefs = loadAdminPrefs();
  return {
    ...MONACO_BASE_OPTIONS,
    // Code editor appearance prefs. These override the hardcoded
    // MONACO_BASE_OPTIONS values (tabSize:2, minimap:off) for every Rhino/JS
    // editor, and set stickyScroll/guides/renderWhitespace which the base leaves
    // at Monaco's defaults. Placed before `...overrides` so per-editor options
    // (e.g. readOnly) still win. fontFamily/fontSize are not repeated here — the
    // base options now expose them as prefs-reading getters.
    tabSize: prefs.editorTabSize,
    insertSpaces: prefs.editorInsertSpaces,
    // Make the tab-size / tabs-vs-spaces prefs authoritative. Monaco's
    // detectIndentation defaults to true, which re-guesses both from the loaded
    // script's existing content and silently overrides the options above — so a
    // script that already contains tabs would keep inserting tabs even with
    // "Indent using: Spaces" selected.
    detectIndentation: false,
    minimap: { enabled: prefs.editorMinimap },
    stickyScroll: { enabled: prefs.editorStickyScroll },
    guides: { indentation: prefs.editorIndentGuides },
    renderWhitespace: prefs.editorRenderWhitespace ? "all" : "none",
    renderLineHighlight: "line",
    snippetSuggestions: "top",
    tabCompletion: "off",
    // Mirror Java's AutoCompleteProperties.activateAfterLetters globally:
    // when enabled, suggestions pop as you type word characters; when disabled they
    // only fire after a trigger character (".") or manual Ctrl+Space. Applies to every
    // Rhino editor, not just the code-template editor.
    quickSuggestions: prefs.autoCompleteIncludeLetters
      ? { other: true, comments: false, strings: false }
      : false,
    // Apply user-configured delay so suggestions don't fire at Monaco's ~10 ms default.
    quickSuggestionsDelay: prefs.autoCompleteDelay,
    wordBasedSuggestions: prefs.autoCompleteCharacters ? "currentDocument" : "off",
    ...overrides,
  };
}

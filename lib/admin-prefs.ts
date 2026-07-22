/**
 * Admin preference storage — localStorage-backed settings for the BridgeLink
 * web UI. Lives in lib/ so it can be imported by both components and lib modules
 * (e.g. monaco-defaults.ts) without creating a components → lib cycle.
 */

const PREFS_KEY = "bl-admin-prefs-v1";

/** Where the server/user theme color is painted in the UI. */
export type ThemeColorPlacement = "top-strip" | "page-header";

export interface AdminPrefs {
  dashboardRefreshInterval: number;
  messageBrowserPageSize: number;
  eventBrowserPageSize: number;
  messageBrowserFormat: boolean;
  textSearchWarning: boolean;
  filterTransformerShowIteratorDialog: boolean;
  messageBrowserShowAttachmentTypeDialog: boolean;
  showReprocessRemoveMessagesWarning: boolean;
  importChannelCodeTemplateLibraries: "yes" | "no" | "ask";
  exportChannelCodeTemplateLibraries: "yes" | "no" | "ask";
  autoCompleteIncludeLetters: boolean;
  autoCompleteCharacters: string;
  autoCompleteDelay: number;
  defaultGroupsCollapsed: boolean;
  /** Where the theme color is painted. Default "top-strip" (the legacy 1px strip). */
  themeColorPlacement: ThemeColorPlacement;
  /** Zebra-stripe alternating table rows. Default false (off). */
  zebraRows: boolean;
  /** Check the Innovar-hosted endpoint for available WebAdmin updates. Default true (opt-out). */
  checkForUpdates: boolean;
  // ── Code editor appearance — applied to Rhino/JS editors via
  //    getRhinoEditorOptions(). All are Monaco-only usability settings; the Java
  //    Swing client (RSyntaxTextArea) has no equivalent, so there is no source of
  //    truth to mirror here.
  /** Monospace font-family string applied to JS editors. */
  editorFontFamily: string;
  /** JS editor font size in px. */
  editorFontSize: number;
  /** JS editor tab size in spaces. Default 4 (was hardcoded 2 pre-. */
  editorTabSize: number;
  /** Indent with spaces (true) or hard tabs (false). */
  editorInsertSpaces: boolean;
  /** Show the Monaco minimap in JS editors. Default false. */
  editorMinimap: boolean;
  /** Show sticky scroll (pinned scope header) in JS editors. Default true. */
  editorStickyScroll: boolean;
  /** Show indentation guide lines in JS editors. Default true. */
  editorIndentGuides: boolean;
  /** Render whitespace characters in JS editors. Default false. */
  editorRenderWhitespace: boolean;
}

export const ADMIN_PREFS_DEFAULTS: AdminPrefs = {
  // Matches the Java client's StatusUpdater.DEFAULT_INTERVAL_TIME (20s). The
  // dashboard must not poll the server more often than the Java client did.
  dashboardRefreshInterval: 20,
  messageBrowserPageSize: 20,
  eventBrowserPageSize: 100,
  messageBrowserFormat: true,
  textSearchWarning: true,
  filterTransformerShowIteratorDialog: true,
  messageBrowserShowAttachmentTypeDialog: true,
  showReprocessRemoveMessagesWarning: true,
  importChannelCodeTemplateLibraries: "ask",
  exportChannelCodeTemplateLibraries: "ask",
  // Deliberate divergence from Java's AutoCompleteProperties.activateAfterLetters
  // default (false): the WebUI defaults to true so every Rhino editor auto-suggests
  // as you type, matching modern IDE behavior (Monaco/VS Code) and the behavior the
  // WebUI editors have always shipped with. The pref still disables it everywhere
  // when turned off. See (and the dashboard-interval default for precedent).
  autoCompleteIncludeLetters: true,
  // Mirrors AutoCompleteProperties.java default ("."): the dot triggers
  // auto-completion after non-letter characters. See.
  autoCompleteCharacters: ".",
  autoCompleteDelay: 300,
  defaultGroupsCollapsed: false,
  themeColorPlacement: "top-strip",
  zebraRows: false,
  checkForUpdates: true,
  // Code editor appearance. The font stack mirrors the pre-existing
  // MONACO_BASE_OPTIONS default. tabSize defaults to 4 per the ticket (the Java
  // client's RSyntaxTextArea tab size is 4); insertSpaces defaults to spaces.
  editorFontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
  editorFontSize: 13,
  editorTabSize: 4,
  editorInsertSpaces: true,
  editorMinimap: false,
  editorStickyScroll: true,
  editorIndentGuides: true,
  editorRenderWhitespace: false,
};

// Raw-string-fingerprint cache. Monaco editors call loadAdminPrefs() on every
// render (one per editor × multiple renders per keystroke), so skipping
// JSON.parse + spread when the underlying storage hasn't changed is a real win.
// We still read localStorage every call — that's a cheap in-memory map lookup —
// and only re-parse when the raw string differs from the cached fingerprint.
// This is intentionally robust against direct localStorage mutation (tests,
// other tabs via the storage event, future code paths that bypass the savers).
let _cachedRaw: string | null = null;
let _cachedPrefs: AdminPrefs | null = null;

/**
 * Returns the current admin preferences. The returned object is cached at the
 * module level and reused across calls when the underlying localStorage value
 * is unchanged; do not mutate it — use `saveAdminPref` or `saveAllAdminPrefs`
 * to update prefs.
 */
export function loadAdminPrefs(): AdminPrefs {
  if (typeof window === "undefined") return { ...ADMIN_PREFS_DEFAULTS };
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw === _cachedRaw && _cachedPrefs) return _cachedPrefs;
  let next: AdminPrefs;
  try {
    next = raw ? { ...ADMIN_PREFS_DEFAULTS, ...JSON.parse(raw) } : { ...ADMIN_PREFS_DEFAULTS };
  } catch {
    next = { ...ADMIN_PREFS_DEFAULTS };
  }
  //: the "sidebar" placement was removed; migrate any persisted value to the default.
  if ((next.themeColorPlacement as string) === "sidebar") {
    next.themeColorPlacement = "top-strip";
  }
  _cachedRaw = raw;
  _cachedPrefs = next;
  return next;
}

export function saveAllAdminPrefs(prefs: AdminPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function saveAdminPref<K extends keyof AdminPrefs>(key: K, value: AdminPrefs[K]): void {
  // Build a fresh object rather than mutating the cached one — callers may hold
  // a reference to the previous load result.
  const next = { ...loadAdminPrefs(), [key]: value };
  saveAllAdminPrefs(next);
}

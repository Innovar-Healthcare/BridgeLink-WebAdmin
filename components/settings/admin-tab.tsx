"use client";

/**
 * Administrator Settings tab — mirrors Java's SettingsPanelAdministrator.java.
 *
 * Most settings are CLIENT-SIDE preferences stored in localStorage,
 * matching Java's Preferences.userNodeForPackage(Mirth.class).
 *
 * Only one setting is server-side (per-user preference):
 *   - checkForNotifications via GET/PUT /users/{id}/preferences/checkForNotifications
 *
 * The server-wide theme color is chosen on the Server settings tab
 * (defaultAdministratorBackgroundColor); the Administrator tab only controls
 * where that color is painted (themeColorPlacement) and zebra striping.
 */

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { Code2, Monitor, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

import { getUsers, getUserPreference, setUserPreference } from "@/lib/api-client";
import { dispatchSettingsSaved } from "@/lib/hooks/use-server-info";
import { getSession } from "@/lib/auth";
import type { User } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection, FieldRow, RadioField } from "./settings-section";
import { SettingsTabScroll } from "./settings-tab-scroll";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";

// ─── localStorage-backed preferences ──────────────────────────────────────────
// Definitions live in lib/admin-prefs.ts so that lib modules (e.g. monaco-defaults)
// can import them without creating a components → lib cycle.
export type { AdminPrefs } from "@/lib/admin-prefs";
export { loadAdminPrefs, saveAdminPref } from "@/lib/admin-prefs";
import {
  ADMIN_PREFS_DEFAULTS as DEFAULTS,
  loadAdminPrefs,
  saveAllAdminPrefs,
} from "@/lib/admin-prefs";
import type { AdminPrefs } from "@/lib/admin-prefs";

const YES_NO_ASK = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "ask", label: "Ask" },
];

const THEME_COLOR_PLACEMENT_OPTIONS = [
  { value: "top-strip", label: "Top Strip" },
  { value: "page-header", label: "Page Header" },
];

const INDENT_OPTIONS = [
  { value: "spaces", label: "Spaces" },
  { value: "tabs", label: "Tabs" },
];

// Curated monospace font stacks for the code editors. The value is the
// full CSS font-family string handed to Monaco; each stack ends in a generic
// fallback so the editor stays monospaced even if the preferred face is absent.
const EDITOR_FONT_OPTIONS = [
  {
    value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
    label: "JetBrains Mono (default)",
  },
  { value: "'Fira Code', Menlo, Consolas, monospace", label: "Fira Code" },
  { value: "'Cascadia Code', Menlo, Consolas, monospace", label: "Cascadia Code" },
  { value: "Menlo, Consolas, 'Courier New', monospace", label: "System (Menlo / Consolas)" },
];

// Per-setting help text. Ported from Java SettingsPanelAdministrator.setToolTipText
// (HTML/<br/> flattened to plain strings; "Mirth"/"NextGen Healthcare" rebranded to
// BridgeLink per the no-"Mirth" rule). Web-UI-only settings have original copy.
const TIP = {
  dashboardRefresh:
    "Interval in seconds at which to refresh the Dashboard. Decrement for faster updates; increment for slower servers with more channels.",
  pageSize: "Sets the default page size for browsers (message, event, etc.).",
  formatText: "Pretty print messages in the message browser.",
  textSearch:
    "Show a confirmation dialog in the message browser when attempting a text search, warning that the query may take a long time depending on the number of messages being searched.",
  iterator:
    "Show a confirmation dialog in the filter/transformer views when dragging and dropping elements from the message tree, asking whether to use an Iterator.",
  attachmentType:
    "Show a selection dialog in the message browser when viewing attachments to choose a specific attachment viewer. If No, the viewer is chosen automatically from the MIME type.",
  reprocessRemove:
    'Show a confirmation dialog when reprocessing or removing multiple messages that requires typing "REPROCESSALL" or "REMOVEALL" first before proceeding.',
  importLibraries:
    "When importing channels that have code template libraries linked to them, select Yes to always include them, No to never include them, or Ask to prompt each time.",
  exportLibraries:
    "When exporting channels that have code template libraries linked to them, select Yes to always include them, No to never include them, or Ask to prompt each time.",
  expandGroups: "Expand channel groups by default in the channel and dashboard tree views.",
  checkForNotifications:
    "Checks for notifications (announcements, available updates, etc.) relevant to this version of BridgeLink whenever a user logs in.",
  themeColorPlacement:
    "Where the server theme color is painted in the UI: a thin top strip or the page header.",
  zebraRows: "Shade alternating table rows for easier reading.",
  checkForUpdates:
    "On login, check whether a newer Web Administrator version is available. Only the current version is sent — no PHI or server data.",
  includeLetters: "If selected, auto-completion is triggered after any letter is typed.",
  wordBased:
    "Also suggest words already present in the current editor, in addition to the built-in BridgeLink API completions.",
  activationDelay:
    "Time to wait after typing an activation character before opening the auto-complete popup.",
  editorFont: "Monospace font used in the code editors.",
  editorFontSize: "Font size, in pixels, used in the code editors.",
  editorTabSize: "Number of spaces a tab occupies in the code editors.",
  editorInsertSpaces:
    "Indent using space characters or hard tab characters when you press Tab in the code editors.",
  editorMinimap:
    "Show the minimap: a miniature overview of the whole file in the editor's right-hand margin.",
  editorStickyScroll:
    "Pin the enclosing scope (function, block) to the top of the editor as you scroll.",
  editorIndentGuides: "Show vertical guide lines that mark each indentation level.",
  editorRenderWhitespace: "Show whitespace characters (spaces and tabs) in the code editors.",
} as const;

export interface AdminTabActions {
  save: () => void;
  refresh: () => void;
  restoreDefaults: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
}

interface AdminTabProps {
  onDirty?: (isDirty: boolean) => void;
  saveRef?: { current: () => Promise<void> };
  actionsRef?: React.MutableRefObject<AdminTabActions>;
  onActionsChanged?: () => void;
}

export function AdminTab({ onDirty, saveRef, actionsRef, onActionsChanged }: AdminTabProps) {
  const { viewDensity } = useCompactMode();
  const [prefs, setPrefs] = useState<AdminPrefs>(DEFAULTS);
  const [originalPrefs, setOriginalPrefs] = useState<string>("");

  // Server-side user preferences
  const [checkForNotifications, setCheckForNotifications] = useState(true);
  const [origServerPrefs, setOrigServerPrefs] = useState("");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);

  const serverPrefsStr = useMemo(
    () => JSON.stringify({ checkForNotifications }),
    [checkForNotifications]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Load local prefs
      const p = loadAdminPrefs();
      setPrefs(p);
      setOriginalPrefs(JSON.stringify(p));

      // Find current user by session username
      const session = getSession();
      if (session) {
        const users = await getUsers();
        const user = users.find((u) => u.username === session.username);
        if (user) {
          setCurrentUser(user);

          // Load server-side prefs
          const notif = await getUserPreference(user.id, "checkForNotifications");
          const notifVal = notif === "" || notif === "true";
          setCheckForNotifications(notifVal);

          setOrigServerPrefs(JSON.stringify({ checkForNotifications: notifVal }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  const dirty = JSON.stringify(prefs) !== originalPrefs || serverPrefsStr !== origServerPrefs;

  // Notify parent of dirty state changes
  // (onDirty intentionally omitted from deps — only fire when dirty value itself changes)
  useEffect(() => {
    onDirty?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const setPref = <K extends keyof AdminPrefs>(key: K, val: AdminPrefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: val }));
  };

  // ── Validation (mirrors Java SettingsPanelAdministrator.doSave()) ──
  const validate = (): string | null => {
    if (prefs.dashboardRefreshInterval <= 0) return "Please enter a valid interval time.";
    if (prefs.messageBrowserPageSize <= 0) return "Please enter a valid message browser page size.";
    if (prefs.eventBrowserPageSize <= 0) return "Please enter a valid event browser page size.";
    if (prefs.editorFontSize <= 0) return "Please enter a valid code editor font size.";
    if (prefs.editorTabSize <= 0) return "Please enter a valid code editor tab size.";
    return null;
  };

  // Pure save — throws on error; no UI state changes. Used by the navigation guard.
  async function doSave() {
    const err = validate();
    if (err) throw new Error(err);
    // Save local prefs
    saveAllAdminPrefs(prefs);
    setOriginalPrefs(JSON.stringify(prefs));
    // Save server-side prefs
    if (currentUser) {
      await setUserPreference(
        currentUser.id,
        "checkForNotifications",
        String(checkForNotifications)
      );
      setOrigServerPrefs(serverPrefsStr);
    }
    // Notify consumers (theme color, placement, zebra rows, etc.) that
    // preferences changed so they re-read without a reload. Fired even when
    // there is no current user, since the local prefs above always persist.
    dispatchSettingsSaved();
  }

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await doSave();
      toast.success("Settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // Open the confirm dialog (mirrors Java's OK/Cancel prompt before resetting).
  const handleRestoreDefaults = () => setConfirmRestoreOpen(true);

  // Actual reset, run only after the user confirms. Values are staged into local
  // state; nothing is persisted until the user saves (Refresh discards them).
  const performRestoreDefaults = () => {
    setPrefs({ ...DEFAULTS });
    setCheckForNotifications(true);
    setConfirmRestoreOpen(false);
  };

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, onActionsChanged]);

  // Expose the imperative save/actions handles to the parent. Written in a deps-less
  // effect (not during render) to satisfy react-hooks/refs. Declared after the handlers
  // it references; the parent's re-render from onActionsChanged is deferred until the
  // full effect flush completes, so it always observes fresh handles.
  useEffect(() => {
    if (saveRef) saveRef.current = doSave;
    if (actionsRef) {
      actionsRef.current = {
        save: handleSave,
        refresh: load,
        restoreDefaults: handleRestoreDefaults,
        dirty,
        saving,
        loading,
      };
    }
  });

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SettingsTabScroll contentClassName="p-6 space-y-5">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        {/* ── System Preferences ── */}
        <SettingsSection labelWidth="w-[340px]" title="System Preferences" icon={Monitor}>
          <FieldRow label="Dashboard refresh interval (seconds):" tooltip={TIP.dashboardRefresh}>
            <Input
              type="text"
              inputMode="numeric"
              density={viewDensity}
              value={prefs.dashboardRefreshInterval || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPref("dashboardRefreshInterval", v === "" ? 0 : Number(v));
              }}
              className="w-20"
            />
          </FieldRow>
          <FieldRow label="Message browser page size:" tooltip={TIP.pageSize}>
            <Input
              type="text"
              inputMode="numeric"
              density={viewDensity}
              value={prefs.messageBrowserPageSize || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPref("messageBrowserPageSize", v === "" ? 0 : Number(v));
              }}
              className="w-20"
            />
          </FieldRow>
          <FieldRow label="Event browser page size:" tooltip={TIP.pageSize}>
            <Input
              type="text"
              inputMode="numeric"
              density={viewDensity}
              value={prefs.eventBrowserPageSize || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPref("eventBrowserPageSize", v === "" ? 0 : Number(v));
              }}
              className="w-20"
            />
          </FieldRow>
          <RadioField
            label="Format text in message browser:"
            name="messageBrowserFormat"
            value={String(prefs.messageBrowserFormat)}
            onChange={(v) => setPref("messageBrowserFormat", v === "true")}
            tooltip={TIP.formatText}
          />
          <RadioField
            label="Message browser text search confirmation:"
            name="textSearchWarning"
            value={String(prefs.textSearchWarning)}
            onChange={(v) => setPref("textSearchWarning", v === "true")}
            tooltip={TIP.textSearch}
          />
          <RadioField
            label="Filter/Transformer Iterator dialog:"
            name="filterTransformerShowIteratorDialog"
            value={String(prefs.filterTransformerShowIteratorDialog)}
            onChange={(v) => setPref("filterTransformerShowIteratorDialog", v === "true")}
            tooltip={TIP.iterator}
          />
          <RadioField
            label="Message browser attachment type dialog:"
            name="messageBrowserShowAttachmentTypeDialog"
            value={String(prefs.messageBrowserShowAttachmentTypeDialog)}
            onChange={(v) => setPref("messageBrowserShowAttachmentTypeDialog", v === "true")}
            tooltip={TIP.attachmentType}
          />
          <RadioField
            label="Reprocess/remove messages confirmation:"
            name="showReprocessRemoveMessagesWarning"
            value={String(prefs.showReprocessRemoveMessagesWarning)}
            onChange={(v) => setPref("showReprocessRemoveMessagesWarning", v === "true")}
            tooltip={TIP.reprocessRemove}
          />
          <RadioField
            label="Import code template libraries with channels:"
            name="importChannelCodeTemplateLibraries"
            value={prefs.importChannelCodeTemplateLibraries}
            onChange={(v) =>
              setPref("importChannelCodeTemplateLibraries", v as "yes" | "no" | "ask")
            }
            options={YES_NO_ASK}
            tooltip={TIP.importLibraries}
          />
          <RadioField
            label="Export code template libraries with channels:"
            name="exportChannelCodeTemplateLibraries"
            value={prefs.exportChannelCodeTemplateLibraries}
            onChange={(v) =>
              setPref("exportChannelCodeTemplateLibraries", v as "yes" | "no" | "ask")
            }
            options={YES_NO_ASK}
            tooltip={TIP.exportLibraries}
          />
          <RadioField
            label="Expand groups by default in tree views:"
            name="defaultGroupsExpanded"
            value={String(!prefs.defaultGroupsCollapsed)}
            onChange={(v) => setPref("defaultGroupsCollapsed", v !== "true")}
            tooltip={TIP.expandGroups}
          />
        </SettingsSection>

        {/* ── User Preferences ── */}
        <SettingsSection labelWidth="w-[340px]" title="User Preferences" icon={UserIcon}>
          <RadioField
            label="Check for new notifications on login:"
            name="checkForNotifications"
            value={String(checkForNotifications)}
            onChange={(v) => setCheckForNotifications(v === "true")}
            tooltip={TIP.checkForNotifications}
          />
          <RadioField
            label="Theme color placement:"
            name="themeColorPlacement"
            value={prefs.themeColorPlacement}
            onChange={(v) => setPref("themeColorPlacement", v as AdminPrefs["themeColorPlacement"])}
            options={THEME_COLOR_PLACEMENT_OPTIONS}
            tooltip={TIP.themeColorPlacement}
          />
          <RadioField
            label="Zebra-stripe table rows:"
            name="zebraRows"
            value={String(prefs.zebraRows)}
            onChange={(v) => setPref("zebraRows", v === "true")}
            tooltip={TIP.zebraRows}
          />
          <RadioField
            label="Check for WebAdmin updates:"
            name="checkForUpdates"
            value={String(prefs.checkForUpdates)}
            onChange={(v) => setPref("checkForUpdates", v === "true")}
            tooltip={TIP.checkForUpdates}
          />
        </SettingsSection>

        {/* ── Code Editor Preferences ── */}
        <SettingsSection labelWidth="w-[340px]" title="Code Editor Preferences" icon={Code2}>
          <FieldRow label="Auto-complete suggestions:">
            <div className="flex items-center gap-4">
              <FormCheckbox
                label="Include letters"
                checked={prefs.autoCompleteIncludeLetters}
                onChange={(v) => setPref("autoCompleteIncludeLetters", v)}
                tooltip={TIP.includeLetters}
              />
              {/*
               * Honest control for the legacy `autoCompleteCharacters` pref.
               * The Monaco editors don't implement Java's per-character activation
               * triggers; the value is only consumed as an on/off for word-based
               * suggestions (monaco-defaults.ts), so it's presented as a toggle.
               * Stored as "." when on / "" when off to preserve the string pref shape.
               */}
              <FormCheckbox
                label="Suggest words from the current document"
                checked={prefs.autoCompleteCharacters.trim().length > 0}
                onChange={(v) => setPref("autoCompleteCharacters", v ? "." : "")}
                tooltip={TIP.wordBased}
              />
            </div>
          </FieldRow>
          <FieldRow label="Activation Delay (ms):" tooltip={TIP.activationDelay}>
            <Input
              type="number"
              density={viewDensity}
              min={0}
              value={prefs.autoCompleteDelay}
              onChange={(e) => setPref("autoCompleteDelay", Number(e.target.value) || 0)}
              className="w-24"
            />
          </FieldRow>
          <FieldRow label="Font:" tooltip={TIP.editorFont}>
            <Select
              value={prefs.editorFontFamily}
              onValueChange={(v) => setPref("editorFontFamily", v)}
            >
              <SelectTrigger density={viewDensity} className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITOR_FONT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {/* Preview each option in its own font. The styled span also
                        carries into the trigger via Radix's SelectValue. */}
                    <span style={{ fontFamily: o.value }}>{o.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Font size (px):" tooltip={TIP.editorFontSize}>
            <Input
              type="text"
              inputMode="numeric"
              density={viewDensity}
              value={prefs.editorFontSize || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPref("editorFontSize", v === "" ? 0 : Number(v));
              }}
              className="w-20"
            />
          </FieldRow>
          <FieldRow label="Tab size:" tooltip={TIP.editorTabSize}>
            <Input
              type="text"
              inputMode="numeric"
              density={viewDensity}
              value={prefs.editorTabSize || ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPref("editorTabSize", v === "" ? 0 : Number(v));
              }}
              className="w-20"
            />
          </FieldRow>
          <RadioField
            label="Indent using:"
            name="editorInsertSpaces"
            value={prefs.editorInsertSpaces ? "spaces" : "tabs"}
            onChange={(v) => setPref("editorInsertSpaces", v === "spaces")}
            options={INDENT_OPTIONS}
            tooltip={TIP.editorInsertSpaces}
          />
          <RadioField
            label="Show minimap:"
            name="editorMinimap"
            value={String(prefs.editorMinimap)}
            onChange={(v) => setPref("editorMinimap", v === "true")}
            tooltip={TIP.editorMinimap}
          />
          <RadioField
            label="Show sticky scroll:"
            name="editorStickyScroll"
            value={String(prefs.editorStickyScroll)}
            onChange={(v) => setPref("editorStickyScroll", v === "true")}
            tooltip={TIP.editorStickyScroll}
          />
          <RadioField
            label="Show indentation guides:"
            name="editorIndentGuides"
            value={String(prefs.editorIndentGuides)}
            onChange={(v) => setPref("editorIndentGuides", v === "true")}
            tooltip={TIP.editorIndentGuides}
          />
          <RadioField
            label="Show whitespace characters:"
            name="editorRenderWhitespace"
            value={String(prefs.editorRenderWhitespace)}
            onChange={(v) => setPref("editorRenderWhitespace", v === "true")}
            tooltip={TIP.editorRenderWhitespace}
          />
        </SettingsSection>
      </SettingsTabScroll>

      {confirmRestoreOpen && (
        <ConfirmDialog
          title="Restore Defaults"
          description="Restore all administrator preferences to their default values? Changes take effect the next time editors and views are loaded, and are not saved until you save settings."
          confirmLabel="Restore Defaults"
          confirmVariant="default"
          onConfirm={performRestoreDefaults}
          onCancel={() => setConfirmRestoreOpen(false)}
        />
      )}
    </div>
  );
}

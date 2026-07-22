"use client";

/**
 * Global Scripts page — mirrors Java's GlobalScriptsPanel.java
 *
 * Business logic:
 *  - Load all four scripts via GET /server/globalScripts
 *  - Display four tabs: Deploy, Undeploy, Preprocessor, Postprocessor
 *  - Each tab has a Monaco JS editor (same "rhino-js" language as Code Templates)
 *  - Save all scripts together via PUT /server/globalScripts
 *  - Track dirty state per-script; warn indicator in tab label when unsaved changes exist
 *
 * Script semantics (from Java GlobalScriptsPanel / JavaScriptBuilder):
 *  Deploy       — runs on server startup or channel deploy; good for initialization
 *  Undeploy     — runs on server shutdown or channel undeploy; good for cleanup
 *  Preprocessor — runs before every message on every channel; return value replaces raw message
 *  Postprocessor— runs after every message on every channel; return value used for response
 */

import { Suspense, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { CodeTemplateEditor } from "@/components/code-template-editor";
import {
  getGlobalScripts,
  setGlobalScripts,
  GLOBAL_SCRIPT_KEYS,
  DEFAULT_GLOBAL_SCRIPTS,
  type GlobalScriptKey,
} from "@/lib/api-client";
import { ScriptReferencePanel } from "@/app/(app)/channels/_components/scripts-tab";
import { CATEGORIES, isRefItemVisibleInContext } from "@/lib/reference-data";
import type { RefCategory } from "@/lib/reference-data";
import { GlobalScriptsActionPanel } from "./_components/global-scripts-action-panel";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { useCodeTemplatesPrefetch } from "@/lib/hooks/use-cache";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";
import { scriptsSemanticallyEqual } from "@/lib/js-validation";
import { cn } from "@/lib/utils";
import { validateGlobalScript, validateAllGlobalScripts } from "@/lib/global-scripts-validation";
import { exportGlobalScriptsToXml, parseGlobalScriptsFromXml } from "@/lib/global-scripts-io";
import { pickXmlFileText } from "@/lib/pick-file";
import { downloadFile } from "@/lib/download";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ContextType } from "@/lib/types";

// ─── Global script context type map ──────────────────────────────────────────

const GLOBAL_SCRIPT_CONTEXT: Record<GlobalScriptKey, ContextType> = {
  Deploy: "GLOBAL_DEPLOY",
  Undeploy: "GLOBAL_UNDEPLOY",
  Preprocessor: "GLOBAL_PREPROCESSOR",
  Postprocessor: "GLOBAL_POSTPROCESSOR",
};

// ─── Tab metadata ─────────────────────────────────────────────────────────────

interface ScriptTab {
  key: GlobalScriptKey;
  label: string;
  description: string;
}

const TABS: ScriptTab[] = [
  {
    key: "Deploy",
    label: "Deploy",
    description:
      "Executes once when the server starts or channels are deployed. " +
      "Use this to initialize global resources, set globalMap variables, or run one-time setup tasks.",
  },
  {
    key: "Undeploy",
    label: "Undeploy",
    description:
      "Executes once when the server shuts down or channels are undeployed. " +
      "Use this to release resources, close connections, or flush state initialized by the Deploy script.",
  },
  {
    key: "Preprocessor",
    label: "Preprocessor",
    description:
      "Executes for every incoming message on every channel, before channel-level processing begins. " +
      "The return value replaces the raw inbound message. Return 'message' to pass through unchanged.",
  },
  {
    key: "Postprocessor",
    label: "Postprocessor",
    description:
      "Executes for every message on every channel after all destinations have processed it. " +
      "Use this for global logging or audit logic. Return value is used as the channel response.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GlobalScriptsPage() {
  return (
    <Suspense>
      <GlobalScriptsPageInner />
    </Suspense>
  );
}

function GlobalScriptsPageInner() {
  useCodeTemplatesPrefetch();
  const { viewDensity } = useCompactMode();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as GlobalScriptKey | null;
  const validKeys: GlobalScriptKey[] = ["Deploy", "Undeploy", "Preprocessor", "Postprocessor"];
  const startTab = initialTab && validKeys.includes(initialTab) ? initialTab : "Deploy";

  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const isHorizontal = toolbarPos === "top" || toolbarPos === "bottom";

  const [scripts, setScripts] = useState<Record<GlobalScriptKey, string> | null>(null);
  const [saved, setSaved] = useState<Record<GlobalScriptKey, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GlobalScriptKey>(startTab);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  // Bumped whenever script content is replaced from a NON-typing source (reload,
  // import, version-history revert). Feeds each editor's `key` so it remounts with a
  // fresh seed — the editors are uncontrolled (defaultValue). Typing must never bump
  // this, or the cursor would jump to the end.
  const [reloadKey, setReloadKey] = useState(0);

  // Track which editors have mounted so we don't flash an empty editor

  // ── Reference panel ───────────────────────────────────────────────────────

  // Context-filtered categories for the active global script.
  // Mirrors Java ReferenceListFactory: each item is shown only when the active
  // script's ContextType is in the item's context set. isRefItemVisibleInContext
  // applies the same precedence as Monaco autocomplete (contexts → scriptExclude).
  // This is what hides channel-scope maps (channelMap/sourceMap/globalChannelMap)
  // from all global scripts and shows message/responseMap only in Postprocessor.
  // The "response" category is response-transformer-only — never relevant here.
  const scriptCategories = useMemo<RefCategory[]>(() => {
    const ctx = GLOBAL_SCRIPT_CONTEXT[activeTab];
    return CATEGORIES.filter((cat) => cat.id !== "response")
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => isRefItemVisibleInContext(item, ctx)),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [activeTab]);

  // Wire up drag-drop on a Monaco editor so reference items can be dragged in.
  function setupEditorDragDrop(editor: import("monaco-editor").editor.IStandaloneCodeEditor) {
    const domNode = editor.getDomNode();
    if (!domNode) return;
    domNode.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      },
      true
    );
    domNode.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = e.dataTransfer?.getData("text/plain");
        if (!text) return;
        const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
        const pos = target?.position ?? editor.getPosition();
        if (!pos) return;
        editor.executeEdits("ref-drop", [
          {
            range: {
              startLineNumber: pos.lineNumber,
              startColumn: pos.column,
              endLineNumber: pos.lineNumber,
              endColumn: pos.column,
            },
            text,
            forceMoveMarkers: true,
          },
        ]);
        editor.focus();
      },
      true
    );
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGlobalScripts();
      setScripts(data);
      setSaved(data);
      // Content reloaded from the server — remount editors to reseed from it.
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  // ── Dirty state ───────────────────────────────────────────────────────────

  function isDirty(key: GlobalScriptKey): boolean {
    return !!scripts && !!saved && scripts[key] !== saved[key];
  }

  const anyDirty = GLOBAL_SCRIPT_KEYS.some((k) => isDirty(k));

  // ── Save ──────────────────────────────────────────────────────────────────

  // Save with validation. Returns true on a successful persist, false if
  // validation blocked the save or the PUT failed. Mirror Java
  // Frame.doSaveGlobalScripts(): validate all four scripts first and abort on
  // any syntax error, surfacing a combined error listing each failing script
  // (Java does not switch tabs).
  async function saveScripts(): Promise<boolean> {
    if (!scripts) return false;

    const failures = validateAllGlobalScripts(scripts);
    if (failures.length > 0) {
      setSaveErr(null);
      setValidateResult({
        ok: false,
        msg: failures.map((f) => `Error in global script "${f.key}": ${f.message}`).join("\n"),
      });
      return false;
    }

    setSaving(true);
    setSaveErr(null);
    setValidateResult(null);
    try {
      await setGlobalScripts(scripts);
      setSaved({ ...scripts });
      return true;
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    void saveScripts();
  }

  // ── Import / Export ─────────────────────────────────────────────────────────
  // Mirror Java Frame.doImportGlobalScripts() / doExportGlobalScripts(): import
  // reads an XStream Map<String,String> XML file (legacy namespace + Shutdown
  // remap handled in parseGlobalScriptsFromXml) into the editors WITHOUT saving;
  // export prompts to save first when there are unsaved changes.

  async function handleImport() {
    const xml = await pickXmlFileText();
    if (xml == null) return;
    try {
      const imported = parseGlobalScriptsFromXml(xml);
      // Merge over current — only keys present in the file are overwritten,
      // matching Java ScriptPanel.setScripts. Does not save; user clicks Save.
      setScripts((prev) => (prev ? { ...prev, ...imported } : prev));
      // Imported code replaced the editors' content — remount so it appears.
      setReloadKey((k) => k + 1);
      toast.success("Scripts imported — click Save to persist to the server");
    } catch (e) {
      toast.error(`Invalid scripts file. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function doExport(s: Record<GlobalScriptKey, string>) {
    downloadFile(exportGlobalScriptsToXml(s), "GlobalScripts.xml", {
      mimeType: "application/xml",
    });
  }

  function handleExport() {
    if (!scripts) return;
    if (anyDirty) {
      setExportConfirmOpen(true);
      return;
    }
    doExport(scripts);
  }

  async function handleExportConfirm() {
    setExportConfirmOpen(false);
    const ok = await saveScripts();
    if (ok && scripts) doExport(scripts);
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  const [historyOpen, setHistoryOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const HistoryDialog = pluginSlots["global-scripts.history-dialog"];
  const CommitDialog = pluginSlots["global-scripts.commit-dialog"];
  // Per-slot server-enablement gating. Both slots are owned by the
  // Version History plugin, so these layer its "Enable" setting on top of
  // extension-enablement — matching the prior single useVersionHistoryEnabled().
  const historyEnabled = useSlotEnabled("global-scripts.history-dialog");
  const commitEnabled = useSlotEnabled("global-scripts.commit-dialog");

  // Clear validation result when switching tabs. Adjusted during render (guarded
  // by previous `activeTab`) so the stale result clears in the same commit.
  const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
  if (activeTab !== prevActiveTab) {
    setPrevActiveTab(activeTab);
    setValidateResult(null);
  }

  // validateGlobalScript parses E4X XML literals and neutralizes E4X operators, so real errors
  // surface even in E4X scripts; forms it can't represent are deferred (returns null).
  function handleValidate() {
    if (!scripts) return;
    const script = scripts[activeTab];
    const err = validateGlobalScript(script);
    setValidateResult(err ? { ok: false, msg: err } : { ok: true, msg: "No syntax errors found." });
  }

  // ── Script change ─────────────────────────────────────────────────────────

  function handleChange(key: GlobalScriptKey, value: string) {
    setScripts((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const toolbar = (
    <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
      <GlobalScriptsActionPanel
        position={toolbarPos}
        loading={loading}
        saving={saving}
        anyDirty={anyDirty}
        hasScripts={scripts !== null}
        onRefresh={load}
        onImport={handleImport}
        onExport={handleExport}
        onValidate={handleValidate}
        onSave={handleSave}
        onViewHistory={HistoryDialog && historyEnabled ? () => setHistoryOpen(true) : undefined}
        onCommit={
          CommitDialog && commitEnabled
            ? () => {
                // Mirror Java's isSaveEnabled() guard — commit the saved scripts,
                // so block while there are unsaved editor changes.
                if (anyDirty) {
                  toast.warning("Save your changes before committing global scripts.");
                  return;
                }
                setCommitOpen(true);
              }
            : undefined
        }
      />
    </DockableToolbar>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Global Scripts"
        subtitle="Server-wide JavaScript hooks that run on deploy, undeploy, and for every message"
      />

      {/* Error banners */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load scripts: {error}
        </div>
      )}
      {saveErr && (
        <div className="mx-6 mt-2 flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Save failed: {saveErr}
        </div>
      )}
      {validateResult && (
        <div
          className={`mx-6 mt-2 flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
            validateResult.ok
              ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-700 dark:text-red-400"
          }`}
        >
          {validateResult.ok ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1 whitespace-pre-line">
            {validateResult.ok ? `✓ ${validateResult.msg}` : validateResult.msg}
          </span>
          <button
            onClick={() => setValidateResult(null)}
            className="text-current opacity-60 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar + Content */}
      <div className={`flex flex-1 min-h-0 ${isHorizontal ? "flex-col" : "flex-row"}`}>
        {(toolbarPos === "left" || toolbarPos === "top") && toolbar}

        {/* Tab bar + editor area */}
        <div className={`flex flex-col flex-1 min-h-0 ${pagePadding(viewDensity)} gap-3`}>
          {/* Tab bar */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GlobalScriptKey)}>
            <TabsList>
              {TABS.map(({ key, label }) => (
                <TabsTrigger key={key} value={key}>
                  <span
                    className={cn(
                      scripts &&
                        !scriptsSemanticallyEqual(scripts[key], DEFAULT_GLOBAL_SCRIPTS[key]) &&
                        "font-extrabold"
                    )}
                  >
                    {label}
                  </span>
                  {isDirty(key) && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0"
                      title="Unsaved changes"
                    />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Active tab description */}
          {TABS.map(
            ({ key, description }) =>
              activeTab === key && (
                <p key={key} className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {description}
                </p>
              )
          )}

          {/* Editors + Reference sidebar */}
          <div className="flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden">
            {/* Editors — all mounted but only the active tab is visible (preserves editor state) */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {loading || !scripts ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
                  {loading ? "Loading scripts…" : "No scripts loaded"}
                </div>
              ) : (
                GLOBAL_SCRIPT_KEYS.map((key) => (
                  <div
                    key={key}
                    style={{ display: activeTab === key ? "flex" : "none", height: "100%" }}
                    className="flex-col"
                  >
                    <CodeTemplateEditor
                      key={`${key}:${reloadKey}`}
                      defaultValue={scripts[key]}
                      onChange={(v) => handleChange(key, v ?? "")}
                      height="100%"
                      onEditorMount={setupEditorDragDrop}
                      editorContext={{ contextType: GLOBAL_SCRIPT_CONTEXT[key] }}
                      // Conditional on the active tab: all four editors stay mounted
                      // (display:none switching, see comment above), so an unconditional
                      // aiContext would mount four stacked position:fixed orbs and the
                      // topmost one's chat would read the wrong (hidden) editor's code.
                      aiContext={activeTab === key ? { location: "global-script" } : undefined}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Reference sidebar */}
            <div className="w-56 shrink-0 border-l border-border flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-800/50">
              <div className="px-3 py-1.5 border-b border-border shrink-0">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Reference
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ScriptReferencePanel categories={scriptCategories} />
              </div>
            </div>
          </div>
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && toolbar}
      </div>

      {HistoryDialog && (
        <HistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          currentScripts={scripts}
          onReverted={(restored) => {
            setScripts(restored);
            // Reverted code replaced the editors' content — remount so it appears.
            setReloadKey((k) => k + 1);
            setHistoryOpen(false);
            toast.success("Scripts restored — click Save to persist to the server");
          }}
        />
      )}

      {CommitDialog && (
        <CommitDialog open={commitOpen} onOpenChange={setCommitOpen} currentScripts={scripts} />
      )}

      {exportConfirmOpen && (
        <ConfirmDialog
          title="Save before exporting?"
          description="You must save your global scripts before exporting. Would you like to save them now?"
          confirmLabel="Save & Export"
          confirmVariant="default"
          onConfirm={handleExportConfirm}
          onCancel={() => setExportConfirmOpen(false)}
        />
      )}
    </div>
  );
}

"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHorizontalResize } from "@/lib/hooks/use-horizontal-resize";
import { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import { isNonDefaultScript, type ScriptsState } from "../_lib/channel-xml";
import { cn } from "@/lib/utils";
import { RHINO_LANG_ID, registerRhinoLanguage, setEditorContext } from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import type { ContextType } from "@/lib/types";
import type * as MonacoType from "monaco-editor";
import { type EditorContext as PluginEditorContext } from "@/lib/plugin-registry";
import { pluginSlots } from "@/lib/plugin-slots";
import { mountPluginMonacoActions } from "@/lib/monaco-plugin-actions";
import { usePluginSurfaceEnabled, useSlotEnabled } from "@/lib/plugin-gating";
import { CATEGORIES, type RefItem, type RefCategory } from "@/lib/reference-data";
import { FlatList } from "./filter-transformer/reference-list";
import {
  getCodeTemplatesCached,
  getCodeTemplateLibrariesCached,
} from "@/lib/api/api-code-templates";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import { AlertTriangle } from "lucide-react";
import {
  isChannelScriptTemplate,
  templateToRefItem,
  filterTemplatesByChannel,
  isLibraryEnabledForChannel,
  findDuplicateSignatures,
  type SignatureConflict,
} from "@/lib/code-template-utils";

// ─── Script definitions ───────────────────────────────────────────────────────

type ScriptKey = keyof ScriptsState;

const SCRIPTS: { key: ScriptKey; label: string }[] = [
  { key: "preprocessing", label: "Preprocessing" },
  { key: "postprocessing", label: "Postprocessing" },
  { key: "deploy", label: "Deploy" },
  { key: "undeploy", label: "Undeploy" },
];

const SCRIPT_CONTEXT_TYPE: Record<ScriptKey, ContextType> = {
  preprocessing: "CHANNEL_PREPROCESSOR",
  postprocessing: "CHANNEL_POSTPROCESSOR",
  deploy: "CHANNEL_DEPLOY",
  undeploy: "CHANNEL_UNDEPLOY",
};

// ─── Category exclusions for script context ───────────────────────────────────
// Mirrors Java ReferenceListFactory context-set logic:
// - "response": Response Transformer functions are CONTEXT_RESPONSE_TRANSFORMER only — excluded entirely
// - "message": Message Functions are mostly CONTEXT_CONNECTOR, BUT 2 items (Message Reprocessed,
//   Message Replaced) are CONTEXT_CHANNEL and DO appear in scripts. Those items are kept;
//   the other 20 are marked scriptExclude:true in reference-panel.tsx.

const SCRIPT_EXCLUDED_CATEGORIES = new Set(["response"]);

// ─── ScriptReferencePanel ─────────────────────────────────────────────────────
// Self-contained reference panel for script contexts.
// Reuses exported RefItem/RefCategory data + rendering components from reference-panel.tsx.
// Dynamically prepends "User Defined Functions" from code templates with channel-script context.
//, isChannelScriptTemplate, templateToRefItem are imported from
// @/lib/code-template-utils so the filtering logic is testable without mounting the component.

export function ScriptReferencePanel({
  categories,
  channelId,
}: {
  categories: RefCategory[];
  channelId?: string;
}) {
  const [categoryId, setCategoryId] = useState("__all__");
  const [filter, setFilter] = useState("");
  const [userTemplates, setUserTemplates] = useState<CodeTemplate[]>([]);
  const [libraries, setLibraries] = useState<CodeTemplateLibrary[]>([]);

  // Fetch user-defined code templates and libraries once on mount (cached at module level).
  useEffect(() => {
    getCodeTemplatesCached()
      .then(setUserTemplates)
      .catch(() => {}); // silently ignore — panel works fine without user templates
    getCodeTemplateLibrariesCached()
      .then(setLibraries)
      .catch(() => {});
  }, []);

  // Inject "User Defined Functions" category at the top only if there are templates
  // with channel-script context types. Matches Java: category is hidden when empty.
  // templateToRefItem() correctly handles FUNCTION vs DRAG_AND_DROP_CODE drag behaviour.
  // Filter templates to only those from libraries enabled for this channel.
  const effectiveCategories = useMemo<RefCategory[]>(() => {
    const channelFiltered = filterTemplatesByChannel(userTemplates, libraries, channelId);
    const matching = channelFiltered.filter(isChannelScriptTemplate);
    if (matching.length === 0) return categories;
    const userCat: RefCategory = {
      id: "userFunctions",
      label: "User Defined Functions",
      items: matching.map(templateToRefItem),
    };
    return [userCat, ...categories];
  }, [userTemplates, libraries, channelId, categories]);

  // Detect duplicate function signatures — scoped to templates that are actually
  // visible in this panel (channel-script context types only). Conflicts in
  // connector-only templates are irrelevant here and would be false positives.
  const signatureConflicts = useMemo<SignatureConflict[]>(() => {
    if (!channelId || libraries.length < 2 || userTemplates.length === 0) return [];
    const channelFiltered = filterTemplatesByChannel(userTemplates, libraries, channelId);
    const visible = channelFiltered.filter(isChannelScriptTemplate);
    if (visible.length === 0) return [];
    const templateMap = new Map(visible.map((t) => [t.id, t]));
    const enabledLibs = libraries.filter((lib) => isLibraryEnabledForChannel(lib, channelId));
    return findDuplicateSignatures(templateMap, enabledLibs);
  }, [userTemplates, libraries, channelId]);

  // If the active category is no longer in the new set (e.g. switched from Postprocessing
  // where "postprocessor" was visible to Deploy where it's not), reset to "All".
  useEffect(() => {
    if (categoryId !== "__all__" && !effectiveCategories.find((c) => c.id === categoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCategoryId("__all__");
    }
  }, [effectiveCategories, categoryId]);

  const inputCls =
    "w-full h-6 px-2 text-xs rounded border border-border " +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  const lower = filter.toLowerCase();

  // Flat list of items for the selected category (or all categories).
  // Java UI always shows a flat list — no group headers even in "All" mode.
  const sourceItems: RefItem[] =
    categoryId === "__all__"
      ? effectiveCategories.flatMap((cat) => cat.items)
      : (effectiveCategories.find((c) => c.id === categoryId)?.items ?? []);

  const displayItems: RefItem[] = !lower
    ? sourceItems
    : sourceItems.filter((item) => item.name.toLowerCase().includes(lower));

  return (
    <div className="p-2 space-y-2">
      {/* Signature conflict warning */}
      {signatureConflicts.length > 0 && (
        <div className="px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-[10px] text-amber-800 dark:text-amber-300 space-y-0.5">
          <div className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Signature conflict
          </div>
          {signatureConflicts.map((c) => (
            <div key={`${c.functionName}/${c.paramCount}`}>
              <code className="font-mono">
                {c.functionName}({c.paramCount} param{c.paramCount !== 1 ? "s" : ""})
              </code>{" "}
              in {c.templates.map((t) => `"${t.libraryName}"`).join(", ")}
            </div>
          ))}
        </div>
      )}
      {/* Category dropdown */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Category:</span>
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setFilter("");
          }}
          className={inputCls}
        >
          <option value="__all__">All</option>
          {effectiveCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filter text */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Filter:</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className={inputCls}
        />
      </div>

      {/* Item list — always flat, matching Java UI behaviour */}
      <FlatList items={displayItems} />
    </div>
  );
}

// ─── ScriptsTab ───────────────────────────────────────────────────────────────

interface ScriptsTabProps {
  scripts: ScriptsState;
  isDark: boolean;
  onChange: (updates: Partial<ScriptsState>) => void;
  initialScript?: ScriptKey;
  channelId?: string;
}

export function ScriptsTab({
  scripts,
  isDark,
  onChange,
  initialScript,
  channelId,
}: ScriptsTabProps) {
  const [activeScript, setActiveScript] = useState<ScriptKey>(initialScript ?? "preprocessing");
  const monacoRef = useRef<typeof MonacoType | null>(null);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const editorUriRef = useRef<string | null>(null);
  const surfaceEnabled = usePluginSurfaceEnabled();
  const overlayEnabled = useSlotEnabled("editor.overlay");

  // Re-run the plugin-action mount whenever the enablement snapshot changes —
  // an editor mounted while the installed-plugins cache was still loading would
  // otherwise permanently miss enabled plugins' actions (the gate read false at
  // onMount and nothing re-fires it). mountPluginMonacoActions is idempotent
  // (editor.getAction guard), so re-running is safe; already-added actions are
  // not removed on disable (they persist until the editor remounts).
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      mountPluginMonacoActions(editorRef.current, monacoRef.current, surfaceEnabled);
    }
  }, [surfaceEnabled]);

  const storeMonaco: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    registerRhinoLanguage(monaco);
  };

  // Update the registered editor context whenever the active script tab changes.
  useEffect(() => {
    const uri = editorUriRef.current;
    if (!uri) return;
    setEditorContext(uri, { contextType: SCRIPT_CONTEXT_TYPE[activeScript], channelId });
  }, [activeScript, channelId]);

  // Store editor instance and wire up drag-drop so reference items can be dragged into the editor.
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Real-time JS syntax validation (squiggles + hover tooltips) — same markers as the
    // Code Templates editor via the shared acorn parser. Self-cleans on dispose.
    attachRhinoValidation(editor, monaco);
    // Mount plugin-contributed Monaco actions, filtered by server-enablement
    // gating and guarded against double-registration.
    mountPluginMonacoActions(editor, monaco, surfaceEnabled);
    const uri = editor.getModel()?.uri.toString();
    if (uri) {
      editorUriRef.current = uri;
      setEditorContext(uri, { contextType: SCRIPT_CONTEXT_TYPE[activeScript], channelId });
      editor.getModel()!.onWillDispose(() => {
        setEditorContext(uri, null);
        editorUriRef.current = null;
      });
    }
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
        if (!text || !editorRef.current) return;
        const ed = editorRef.current;
        const target = ed.getTargetAtClientPoint(e.clientX, e.clientY);
        const pos = target?.position ?? ed.getPosition();
        if (!pos) return;
        ed.executeEdits("ref-drop", [
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
        ed.focus();
      },
      true
    );
  };

  // Context-filtered categories for the current script type.
  // Mirrors Java ReferenceListFactory context-set filtering:
  //   - Exclude entirely: "response" (response-transformer-only)
  //   - "postprocessor" category: shown only for the Postprocessing script
  //   - Per-item: scriptExclude:true items are stripped (connector/response-transformer vars)
  //   - "message" is NOT excluded: 2 of 22 items are CONTEXT_CHANNEL (scriptExclude kept false)
  const scriptCategories: RefCategory[] = useMemo(
    () =>
      CATEGORIES.filter((cat) => !SCRIPT_EXCLUDED_CATEGORIES.has(cat.id))
        .filter((cat) => cat.id !== "postprocessor" || activeScript === "postprocessing")
        .map((cat) => ({ ...cat, items: cat.items.filter((item) => !item.scriptExclude) }))
        .filter((cat) => cat.items.length > 0),
    [activeScript]
  );

  // ── Resizable reference pane ───────────────────────────────────────────────
  const { width: refPanelWidth, onResizeMouseDown: onRefPanelResizeMouseDown } =
    useHorizontalResize({
      storageKey: "bl-scripts-ref-w",
      defaultWidth: 224,
      minWidth: 160,
      maxWidth: 600,
    });

  // AI overlay context — location + channelId ONLY, per D-02 (no channelName/mode/
  // template metadata). The single Monaco instance here swaps models per
  // activeScript, so one overlay mount is always correct.
  const aiContext: PluginEditorContext = { location: "channel-script", channelId };
  const OverlayComponent = pluginSlots["editor.overlay"];

  return (
    <div className="flex flex-col h-full">
      {/* ── Script sub-tab bar ──────────────────────────────────────── */}
      <Tabs value={activeScript} onValueChange={(v) => setActiveScript(v as ScriptKey)}>
        <TabsList>
          {SCRIPTS.map(({ key, label }) => (
            <TabsTrigger key={key} value={key}>
              <span className={cn(isNonDefaultScript(scripts, key) && "font-extrabold")}>
                {label}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── Editor + Reference sidebar ────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Monaco editor */}
        <div className="flex-1 overflow-hidden border border-border">
          <MonacoEditor
            language={RHINO_LANG_ID}
            value={scripts[activeScript]}
            onChange={(v) => onChange({ [activeScript]: v ?? "" })}
            theme={isDark ? "mirth-js-dark" : "mirth-js"}
            height="100%"
            beforeMount={storeMonaco}
            onMount={handleMount}
            options={getRhinoEditorOptions({
              folding: true,
              suggestOnTriggerCharacters: true,
            })}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onRefPanelResizeMouseDown}
          className="w-1 shrink-0 cursor-col-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
          title="Drag to resize"
        />

        {/* Reference sidebar */}
        <div
          className="shrink-0 border-l border-border flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-800/50"
          style={{ width: refPanelWidth }}
        >
          <div className="px-3 py-1.5 border-b border-border shrink-0">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Reference
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ScriptReferencePanel categories={scriptCategories} channelId={channelId} />
          </div>
        </div>
      </div>

      {OverlayComponent && overlayEnabled && (
        <OverlayComponent editorRef={editorRef} monacoRef={monacoRef} context={aiContext} />
      )}
    </div>
  );
}

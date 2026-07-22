"use client";

import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { CheckCircle, XCircle } from "lucide-react";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import { useMonacoOverflowHost } from "@/lib/hooks/use-monaco-overflow-host";
import { useTheme } from "@/lib/hooks/use-theme";
import { useHorizontalResize } from "@/lib/hooks/use-horizontal-resize";
import { tryParseJs } from "@/lib/js-validation";
import { jsAttachmentSaveWarning } from "../../_lib/attachment-validation";
import { CATEGORIES } from "@/lib/reference-data";
import { ScriptReferencePanel } from "../scripts-tab";
import type { AttachmentHandlerState, AttachmentCommitResult } from "../../_lib/channel-xml";
import { useState } from "react";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { PluginEditorOverlay } from "@/components/plugin-editor-overlay";
import { useEditorAiSeam } from "@/lib/hooks/use-editor-ai-seam";
import { type EditorContext } from "@/lib/plugin-registry";

// ─── Monaco theme + language registration ─────────────────────────────────────
const handleBeforeMount: BeforeMount = (monaco) => {
  registerRhinoLanguage(monaco);
};

// ─── Attachment context categories ───────────────────────────────────────────
// Mirrors Java FunctionList for CHANNEL_ATTACHMENT:
//   - Java FunctionList only displays items that were added with a non-null category
//     (ReferenceListFactory.addReference line 250: "If a category is specified, add
//     the reference as a code template as well"). Variables declared with null
//     category (msg, tmp, connectorMessage, channelMap, contextFactory, etc.) appear
//     only in the editor autocomplete, not in the reference panel — so we drop the
//     "variables" category entirely here to match.
//   - "response" (Response Transformer) and "postprocessor" categories are not in
//     the CHANNEL_ATTACHMENT context set (those items' context sets don't contain
//     CHANNEL_ATTACHMENT), so they're excluded.
//   - scriptExclude items are connector/filter-transformer-only and not visible in
//     attachment context per Java's context-set logic.
const ATTACHMENT_EXCLUDED = new Set(["variables", "response", "postprocessor"]);
const ATTACHMENT_CATEGORIES = CATEGORIES.filter((cat) => !ATTACHMENT_EXCLUDED.has(cat.id))
  .map((cat) => ({ ...cat, items: cat.items.filter((item) => !item.scriptExclude) }))
  .filter((cat) => cat.items.length > 0);

// ─── JavaScriptBody ──────────────────────────────────────────────────────────

interface JavaScriptBodyProps {
  local: AttachmentHandlerState;
  setLocal: (s: AttachmentHandlerState) => void;
  commitRef: MutableRefObject<() => AttachmentCommitResult>;
  setFooterLeft: (node: React.ReactNode) => void;
  channelId?: string;
}

export function JavaScriptBody({
  local,
  setLocal,
  commitRef,
  setFooterLeft,
  channelId,
}: JavaScriptBodyProps) {
  const { isDark } = useTheme();
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  // AI seam — orb + Explain/Generate/Fix actions on this always-JS attachment script.
  // connectorType names the script surface so the AI grounds on "attachment
  // handler" instead of guessing "JavaScript Writer" from the default `return message;`,
  // and the chat panel header shows the surface instead of "No context available". The
  // attachment script runs on the inbound side, hence isSource.
  const seam = useEditorAiSeam();
  const aiContext = useMemo<EditorContext>(
    () => ({
      location: "connector-script",
      connectorType: "JavaScript Attachment Handler",
      isSource: true,
      channelId,
    }),
    [channelId]
  );

  //: this editor lives inside a Radix *modal* dialog, so its widgets must
  // be hosted inside the dialog subtree (see useMonacoOverflowHost). Paired
  // requirement: the dialog must not sit under a CSS transform/translate, or the
  // position:fixed suggest/hover popup anchors to the dialog box and renders offset
  // from the cursor — the attachment dialog neutralizes its translate-centering for
  // exactly this reason (see attachment-handler-properties-dialog.tsx).
  const { overflowHost, hostRef } = useMonacoOverflowHost();

  const editorOptions = useMemo(() => {
    const opts = getRhinoEditorOptions({ folding: true, suggestOnTriggerCharacters: true });
    if (overflowHost) opts.overflowWidgetsDomNode = overflowHost;
    return opts;
  }, [overflowHost]);

  // Resizable reference sidebar
  const { width: refWidth, onResizeMouseDown } = useHorizontalResize({
    storageKey: "bl-attach-js-ref-w",
    defaultWidth: 224,
    minWidth: 160,
    maxWidth: 600,
  });

  // Keep commitRef up-to-date so the shell can call it at save time. A JS parse error is
  // a soft warning ("Save anyway?"), not a hard block — Java saves the script freely and
  // its "Validate" button is informational only, so an E4X/Rhino construct acorn cannot
  // parse must not make a valid script unsaveable #45).
  useEffect(() => {
    commitRef.current = () => {
      const warning = jsAttachmentSaveWarning(local.javaScriptScript);
      return warning ? { warning, value: local } : local;
    };
  });

  // Validate helper. tryParseJs parses E4X XML literals and neutralizes E4X operators, so real
  // errors surface even in E4X scripts; forms it can't represent are deferred (returns null).
  function validateScript() {
    const err = tryParseJs(local.javaScriptScript);
    setValidateResult(
      err ? { ok: false, message: err } : { ok: true, message: "No syntax errors detected." }
    );
  }

  // Render Validate button into parent footer's left slot
  useEffect(() => {
    setFooterLeft(
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          onClick={validateScript}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border
            border-border text-gray-700 dark:text-gray-300
            hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-border
            transition-colors font-medium"
        >
          Validate JS
        </button>
        {validateResult && (
          <span
            className={`flex items-center gap-1 text-sm truncate
              ${validateResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
          >
            {validateResult.ok ? (
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">{validateResult.message}</span>
          </span>
        )}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateResult]);

  // Drag-drop from reference panel into Monaco — wired in onMount (not module scope)
  // so the handler is reattached each time the dialog opens/closes.
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Real-time JS syntax validation (squiggles + hover tooltips) — same markers as the
    // Code Templates editor via the shared acorn parser. Self-cleans on dispose.
    attachRhinoValidation(editor, monaco);
    const uri = editor.getModel()?.uri.toString();
    if (uri) {
      const ctx = { contextType: "CHANNEL_ATTACHMENT" as const, channelId };
      setEditorContext(uri, ctx);
      editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
    }
    seam.registerEditor(editor, monaco);
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

  // Memoize categories (stable reference — no per-render deps)
  const attachmentCategories = useMemo(() => ATTACHMENT_CATEGORIES, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Monaco editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          language={RHINO_LANG_ID}
          value={local.javaScriptScript}
          onChange={(v) => {
            setLocal({ ...local, javaScriptScript: v ?? "" });
            setValidateResult(null);
          }}
          theme={isDark ? "mirth-js-dark" : "mirth-js"}
          height="100%"
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={editorOptions}
        />
      </div>

      {/* Keeps Monaco's widgets host (overflowHost) inside the dialog subtree, so
          Radix's modal scope doesn't suppress the completion popup. */}
      <div ref={hostRef} />

      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="w-1 shrink-0 cursor-col-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
        title="Drag to resize"
      />

      {/* Reference sidebar */}
      <div
        className="shrink-0 border-l border-border flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-800/50"
        style={{ width: refWidth }}
      >
        <div className="px-3 py-1.5 border-b border-border shrink-0">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Reference
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ScriptReferencePanel categories={attachmentCategories} channelId={channelId} />
        </div>
      </div>

      {/* Rendered inside the dialog subtree so Radix's modal scope doesn't suppress the
          overlay's clicks/focus (same reasoning as the Monaco overflow host above). */}
      <PluginEditorOverlay
        editorRef={seam.editorRef}
        monacoRef={seam.monacoRef}
        context={aiContext}
      />
    </div>
  );
}

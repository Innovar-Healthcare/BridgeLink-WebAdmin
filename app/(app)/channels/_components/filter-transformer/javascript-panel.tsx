"use client";

import { useEffect, useRef } from "react";
import { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import type { JavaScriptRule, JavaScriptStep } from "../../_lib/filter-transformer-xml";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import type { ContextType } from "@/lib/types";
import { type EditorContext } from "@/lib/plugin-registry";
import { pluginSlots } from "@/lib/plugin-slots";
import { mountPluginMonacoActions } from "@/lib/monaco-plugin-actions";
import { usePluginSurfaceEnabled, useSlotEnabled } from "@/lib/plugin-gating";

interface Props {
  element: JavaScriptRule | JavaScriptStep;
  onChange: (element: JavaScriptRule | JavaScriptStep) => void;
  isDark: boolean;
  showErrors?: boolean;
  contextType?: ContextType;
  channelId?: string;
  /** Optional EditorContext passed from parent for AI overlay / plugin actions. */
  context?: EditorContext;
}

export function JavaScriptPanel({
  element,
  onChange,
  isDark,
  showErrors,
  contextType,
  channelId,
  context: editorContext,
}: Props) {
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
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

  const handleBeforeMount: BeforeMount = (m) => {
    registerRhinoLanguage(m);
    monacoRef.current = m;
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Real-time syntax validation (squiggles + hover tooltips) — identical markers to the
    // Code Templates editor via the shared acorn parser. Self-cleans on model dispose.
    attachRhinoValidation(editor, monaco);

    if (contextType) {
      const uri = editor.getModel()?.uri.toString();
      if (uri) {
        const ctx = { contextType, channelId };
        setEditorContext(uri, ctx);
        editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
      }
    }

    // Mount plugin-contributed Monaco actions, filtered by server-enablement
    // gating and guarded against double-registration.
    mountPluginMonacoActions(editor, monaco, surfaceEnabled);

    const domNode = editor.getDomNode();
    if (!domNode) return;

    // Use capture phase so we intercept before Monaco's own drop handler.
    // preventDefault on dragover tells the browser the target accepts drops.
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
        e.stopPropagation(); // prevent Monaco from also handling the drop
        const text = e.dataTransfer?.getData("text/plain");
        if (!text || !editorRef.current) return;

        const ed = editorRef.current;
        // Try to insert at the visual drop position; fall back to current cursor.
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

  const OverlayComponent = pluginSlots["editor.overlay"];
  const overlayContext: EditorContext = editorContext ?? {
    location: "filter-transformer",
    channelId,
  };

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400 italic">
        {/* Rules carry an `operator`; transformer steps do not. Only filters must return
            true/false — a transformer step has no boolean-return requirement. */}
        {"operator" in element ? (
          <>
            (Enter the body of your JavaScript; it must return <code>true</code> or{" "}
            <code>false</code> for a filter)
          </>
        ) : (
          "(Enter the body of your JavaScript for a transformer step)"
        )}
      </span>
      <div
        className={`relative flex-1 border rounded overflow-hidden${showErrors && !element.script?.trim() ? " !border-red-500 dark:!border-red-400" : ""}`}
        style={{ minHeight: 200 }}
      >
        <MonacoEditor
          height="100%"
          language={RHINO_LANG_ID}
          theme={isDark ? "mirth-js-dark" : "mirth-js"}
          defaultValue={element.script ?? ""}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          onChange={(v) => onChange({ ...element, script: v ?? "" })}
          options={getRhinoEditorOptions({
            suggestOnTriggerCharacters: true,
          })}
        />
      </div>
      {OverlayComponent && overlayEnabled && (
        <OverlayComponent editorRef={editorRef} monacoRef={monacoRef} context={overlayContext} />
      )}
    </div>
  );
}

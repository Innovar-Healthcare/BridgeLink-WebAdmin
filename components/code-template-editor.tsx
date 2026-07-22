"use client";

/**
 * CodeTemplateEditor — Monaco-based Rhino JavaScript editor for BridgeLink code templates.
 *
 * Uses a custom language "rhino-js" instead of Monaco's built-in "javascript" to avoid
 * the JS language service injecting completions that don't apply to Rhino (arg1, Any, etc.).
 * The Monarch tokenizer is copied from Monaco's JS/TS definition for identical highlighting.
 *
 * Coloring matches the Java UI (MirthJavaScriptTokenMaker):
 *  - Blue  (#0000FF): context variables, maps, shorthand helpers ($c, $co…), status constants
 *  - Purple (#7B2D8B): utility/factory classes, logger, router, alerts + all HL7V2 segment codes
 *  - Brown  (#7B5000): helper functions (createSegment, addAttachment…)
 *
 * Features:
 *  - Full JS syntax highlighting via custom Monarch tokenizer (identical to Monaco's JS)
 *  - BridgeLink/Rhino globals autocomplete (msg, connectorMessage, channelMap, etc.)
 *  - Dot-triggered member completions (DateUtil. → getCurrentDate, channelMap. → get/put, …)
 *  - Real-time syntax validation via the shared acorn parser + setModelMarkers
 *    (attachRhinoValidation from lib/monaco-rhino-validation, shared with the transformer/filter editors)
 */

import { MonacoEditor } from "@/components/monaco-editor";
import type * as MonacoType from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
  type EditorContext,
} from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
// NOTE: this file already imports monaco-rhino's unrelated `EditorContext` (the
// completion-provider context, above) under the bare name — alias the AI-facing
// plugin-registry EditorContext to avoid shadowing it.
import { type EditorContext as PluginEditorContext } from "@/lib/plugin-registry";
import { pluginSlots } from "@/lib/plugin-slots";
import { mountPluginMonacoActions } from "@/lib/monaco-plugin-actions";
import { usePluginSurfaceEnabled, useSlotEnabled } from "@/lib/plugin-gating";

// Real-time acorn-based syntax validation (squiggles + hover tooltips) lives in
// lib/monaco-rhino-validation so the transformer/filter editors share the identical
// markers. The page's Validate action imports validateRhinoSyntax from there
// directly to force a fresh synchronous check.

// ─── Editor component ─────────────────────────────────────────────────────────

export interface CodeTemplateEditorProps {
  /**
   * Initial editor content, read **once on mount** — this editor is uncontrolled
   * (passed to Monaco as `defaultValue`). Driving it as a controlled `value` makes
   * the @monaco-editor/react `[value]` effect call `executeEdits(forceMoveMarkers)`
   * whenever the prop lags the live model during a burst of input, snapping the
   * cursor to the end in transformers, here). To replace the
   * content from a non-typing source (template switch, JSDoc, import, revert,
   * reload), change the component's `key` so it remounts with a fresh seed.
   */
  defaultValue: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  /** Callback fired on mount with the editor instance, for access to model markers. */
  onEditorMount?: (editor: MonacoType.editor.IStandaloneCodeEditor) => void;
  /** Callback fired once Monaco is available — gives the parent access to the Monaco API
   *  (e.g. to call monaco.editor.getModelMarkers() for Validate Script). */
  onMonacoMount?: (monaco: typeof MonacoType) => void;
  /**
   * When set, registers this editor's model URI with the code-template completion
   * provider so it can filter by ContextType and channelId. Absent for the code
   * template editor itself (editing a template doesn't suggest other templates).
   */
  editorContext?: EditorContext;
  /** AI-overlay context (location + optional channelId only, per D-02). Omit to keep
   *  the AI seam (Monaco actions + editor.overlay slot) off for this call site. */
  aiContext?: PluginEditorContext;
}

export function CodeTemplateEditor({
  defaultValue,
  onChange,
  readOnly = false,
  height = "100%",
  onEditorMount,
  onMonacoMount,
  editorContext,
  aiContext,
}: CodeTemplateEditorProps) {
  // Store the monaco instance provided by beforeMount — avoids useMonaco() which
  // creates a cancelable promise that can produce an unhandled "{type:'cancelation'}"
  // rejection in React 19 Strict Mode when the component unmounts before Monaco loads.
  const monacoRef = useRef<typeof MonacoType | null>(null);
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const { isDark } = useTheme();
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

  // beforeMount fires synchronously before the Monaco editor instance is created.
  // This guarantees "mirth-js" theme and "rhino-js" tokenizer are registered
  // before theme="mirth-js" is applied — avoiding the silent fallback to "vs".
  // We also store the monaco instance here for use in handleMount.
  const handleBeforeMount = useCallback(
    (m: typeof MonacoType) => {
      monacoRef.current = m;
      registerRhinoLanguage(m);
      onMonacoMount?.(m);
    },
    [onMonacoMount]
  );

  const handleMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
      onEditorMount?.(editor);
      if (editorContext) {
        const uri = editor.getModel()?.uri.toString();
        if (uri) {
          setEditorContext(uri, editorContext);
          editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, editorContext));
        }
      }

      // Set up real-time syntax validation (squiggles + hover tooltips) using the shared
      // acorn parser. Self-cleans on model dispose.
      const monaco = monacoRef.current;
      if (monaco) {
        attachRhinoValidation(editor, monaco);
        // Mount plugin-contributed Monaco actions, filtered by server-enablement
        // gating and guarded against double-registration.
        mountPluginMonacoActions(editor, monaco, surfaceEnabled);
      }
    },
    [onEditorMount, editorContext, surfaceEnabled]
  );

  const OverlayComponent = pluginSlots["editor.overlay"];

  return (
    <>
      <MonacoEditor
        height={height}
        defaultLanguage={RHINO_LANG_ID}
        theme={isDark ? "mirth-js-dark" : "mirth-js"}
        defaultValue={defaultValue}
        beforeMount={handleBeforeMount}
        // Indentation (tabs vs spaces, tab size) follows the user's Code Editor
        // preferences via getRhinoEditorOptions — no per-editor override.
        options={getRhinoEditorOptions({ readOnly })}
        onChange={(val) => onChange?.(val ?? "")}
        onMount={handleMount}
      />
      {OverlayComponent && overlayEnabled && aiContext && (
        <OverlayComponent editorRef={editorRef} monacoRef={monacoRef} context={aiContext} />
      )}
    </>
  );
}

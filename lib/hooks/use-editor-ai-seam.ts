"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as MonacoType from "monaco-editor";
import { mountPluginMonacoActions } from "@/lib/monaco-plugin-actions";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";

/**
 * Wires the AI seam's Monaco half for a connector JavaScript editor: mounts the
 * plugin-contributed context-menu actions (Explain/Generate/Fix) and tracks the
 * last-focused editor so a single overlay orb can serve multi-editor surfaces.
 *
 * The overlay orb itself is rendered separately via `<PluginEditorOverlay>`, passing
 * the `editorRef`/`monacoRef` returned here.
 *
 * Usage:
 * ```ts
 * const seam = useEditorAiSeam(active);
 * // in the editor's onMount, after the existing setEditorContext/validation wiring:
 * seam.registerEditor(editor, monaco);
 * // in JSX, gated on `active`:
 * <PluginEditorOverlay editorRef={seam.editorRef} monacoRef={seam.monacoRef} context={ctx} />
 * ```
 *
 * @param active When false (e.g. a Database connector in SQL mode, or an HTTP auth type
 *   other than JavaScript), plugin actions are not mounted. Flipping it back to true
 *   re-mounts them on the already-registered editor without a remount.
 */
export function useEditorAiSeam(active = true) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoType | null>(null);
  // All registered editors, so the re-run effect can (re)mount actions on each when the
  // enablement snapshot or `active` gate changes.
  const editorsRef = useRef<Set<MonacoType.editor.IStandaloneCodeEditor>>(new Set());
  const surfaceEnabled = usePluginSurfaceEnabled();

  const registerEditor = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor, monaco: typeof MonacoType) => {
      monacoRef.current = monaco;
      // Default the overlay target to the first editor; update it to whichever editor the
      // user focuses so the single orb operates on the editor being worked in (db-reader
      // has two editors sharing one orb).
      if (!editorRef.current) editorRef.current = editor;
      editor.onDidFocusEditorText(() => {
        editorRef.current = editor;
      });
      editorsRef.current.add(editor);
      editor.onDidDispose(() => {
        editorsRef.current.delete(editor);
        if (editorRef.current === editor) editorRef.current = null;
      });
      if (active) mountPluginMonacoActions(editor, monaco, surfaceEnabled);
    },
    [active, surfaceEnabled]
  );

  // Re-run the plugin-action mount whenever the enablement snapshot or `active` gate
  // changes — an editor mounted while the installed-plugins cache was still loading (gate
  // read false at onMount), or while in SQL mode, would otherwise permanently miss the
  // actions. mountPluginMonacoActions is idempotent (editor.getAction guard), so re-running
  // is safe; already-added actions are not removed when the gate later goes false (they
  // persist until the editor remounts).
  useEffect(() => {
    if (!active) return;
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const editor of editorsRef.current) {
      mountPluginMonacoActions(editor, monaco, surfaceEnabled);
    }
  }, [surfaceEnabled, active]);

  // Stable object so callers can safely list the seam in a useCallback/useMemo dep array
  // without recreating their onMount every render (editorRef/monacoRef are stable refs;
  // registerEditor only changes when the enablement/active gate does).
  return useMemo(() => ({ editorRef, monacoRef, registerEditor }), [registerEditor]);
}

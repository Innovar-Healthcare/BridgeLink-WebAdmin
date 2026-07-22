"use client";

import type * as MonacoType from "monaco-editor";
import { type EditorContext } from "@/lib/plugin-registry";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";

/**
 * Renders the plugin-contributed AI editor overlay (the "orb" launcher + chat) for a
 * Monaco editor, when the `"editor.overlay"` slot is filled by an installed+enabled plugin.
 *
 * This encapsulates the guard block that call sites (scripts-tab, javascript-panel,
 * code-template-editor, and the connector JS editors) would otherwise repeat inline:
 * the overlay renders only when the slot is filled, the surface is enabled, AND the
 * caller passes a `context`. Omitting `context` (undefined) keeps the seam off.
 *
 * Pass live refs to the Monaco editor and namespace — the overlay reads selection/cursor
 * and applies edits through them. For multi-editor surfaces, point `editorRef` at the
 * last-focused editor (see `useEditorAiSeam`) so a single orb serves them all.
 */
export function PluginEditorOverlay({
  editorRef,
  monacoRef,
  context,
}: {
  editorRef: React.RefObject<MonacoType.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.RefObject<typeof MonacoType | null>;
  context: EditorContext | undefined;
}) {
  const overlayEnabled = useSlotEnabled("editor.overlay");
  const OverlayComponent = pluginSlots["editor.overlay"];

  if (!OverlayComponent || !overlayEnabled || !context) return null;

  return <OverlayComponent editorRef={editorRef} monacoRef={monacoRef} context={context} />;
}

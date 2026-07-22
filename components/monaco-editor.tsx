"use client";

import Editor, { type EditorProps, type OnMount } from "@monaco-editor/react";
import { registerClipboardPaste } from "@/lib/monaco-clipboard";
import { attachCursorPositionStatus } from "@/lib/monaco-cursor-status";

/**
 * App-standard Monaco editor. Always render this instead of
 * `@monaco-editor/react`'s Editor (enforced by ESLint no-restricted-imports).
 *
 * It exists so per-editor registrations every editor needs cannot be forgotten —
 * Monaco's built-in context-menu Paste is broken in browsers (Chrome-blocked
 * execCommand), and before this wrapper only 3 of ~16 editors had the
 * `registerClipboardPaste` fix applied in their onMount found the gap
 * in the Send Message dialog the hard way).
 *
 * Editors inside a Radix modal dialog additionally need
 * `useMonacoOverflowHost` (see that hook's docs) — that one stays opt-in
 * because it requires a DOM node rendered by the caller.
 */

/** Compose a caller's onMount with the registrations every editor needs. */
export function composeEditorMount(onMount?: OnMount): OnMount {
  return (editor, monaco) => {
    registerClipboardPaste(editor, monaco);
    // Ln/Col indicator for JS editors; self-gates on rhino-js language.
    attachCursorPositionStatus(editor, monaco);
    onMount?.(editor, monaco);
  };
}

export function MonacoEditor({ onMount, ...props }: EditorProps) {
  return <Editor {...props} onMount={composeEditorMount(onMount)} />;
}

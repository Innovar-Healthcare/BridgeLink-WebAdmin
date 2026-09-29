"use client";

import Editor, { type BeforeMount, type EditorProps, type OnMount } from "@monaco-editor/react";
import { registerClipboardPaste } from "@/lib/monaco-clipboard";
import { attachCursorPositionStatus } from "@/lib/monaco-cursor-status";
import { attachFontRemeasure } from "@/lib/monaco-font-remeasure";
import { monacoTheme, registerMonacoThemes } from "@/lib/monaco-theme";
import { useTheme } from "@/lib/hooks/use-theme";

/**
 * App-standard Monaco editor. Always render this instead of
 * `@monaco-editor/react`'s Editor (enforced by ESLint no-restricted-imports for
 * static imports, and by `npm run lint:monaco` for dynamic ones).
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
 *
 * **There is deliberately no `theme` prop.** Monaco themes are global per
 * instance: `setTheme` re-colors every editor on the page, and this library
 * calls it on each mount, so the last editor to mount would win for everyone.
 * Two callers naming different themes silently strip each other's colors — that
 * was and then. The wrapper applies the app's single merged
 * theme (`lib/monaco-theme.ts`) and follows the light/dark preference itself.
 */

/** Compose a caller's onMount with the registrations every editor needs. */
export function composeEditorMount(onMount?: OnMount): OnMount {
  return (editor, monaco) => {
    registerClipboardPaste(editor, monaco);
    // Ln/Col indicator for JS editors; self-gates on rhino-js language.
    attachCursorPositionStatus(editor, monaco);
    // Re-measure once the self-hosted editor webfonts settle.
    // Idempotent and app-wide, not per-editor — see that module's docs.
    attachFontRemeasure(monaco);
    onMount?.(editor, monaco);
  };
}

/**
 * Compose a caller's beforeMount with the app theme registration.
 *
 * Ordering matters: `beforeMount` runs before `editor.create()`, and `create` is
 * what applies the `theme` prop — so the themes must be defined here, ahead of
 * any caller hook that registers a language.
 */
export function composeEditorBeforeMount(beforeMount?: BeforeMount): BeforeMount {
  return (monaco) => {
    registerMonacoThemes(monaco);
    beforeMount?.(monaco);
  };
}

export function MonacoEditor({ onMount, beforeMount, ...props }: Omit<EditorProps, "theme">) {
  const { isDark } = useTheme();
  return (
    <Editor
      {...props}
      theme={monacoTheme(isDark)}
      beforeMount={composeEditorBeforeMount(beforeMount)}
      onMount={composeEditorMount(onMount)}
    />
  );
}

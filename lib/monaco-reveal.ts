/**
 * Shared helpers for moving a Monaco editor to a specific place in its buffer.
 *
 * Extracted from the manifest-preview page when Config Search grew the ability
 * to deep-link to the exact line a match was found on, so both use
 * the same "put the caret there and scroll it into view" behavior.
 */

import type { OnMount } from "@monaco-editor/react";

/** Editor instance type, from the Monaco onMount signature. */
export type MonacoCodeEditor = Parameters<OnMount>[0];

/** Moves the cursor to `pos`, scrolls it into view if needed, and focuses the editor. */
export function revealPosition(
  editor: MonacoCodeEditor,
  pos: { lineNumber: number; column: number }
): void {
  editor.setPosition(pos);
  // ...InCenterIfOutsideViewport, not ...InCenter: a freshly mounted editor is
  // already showing line 1, and yanking a near-the-top match into the vertical
  // middle reads as the editor jumping for no reason.
  editor.revealPositionInCenterIfOutsideViewport(pos);
  editor.focus();
}

/**
 * Clamp a 1-based line number to a line that exists in the editor's model.
 *
 * A deep link can outlive the code it points at — the search index is built
 * from a channel revision that may since have been edited down to fewer lines.
 * Landing on the last line is a mild inaccuracy; throwing, or asking Monaco to
 * reveal line 9999, is not.
 */
export function clampLine(editor: MonacoCodeEditor, line: number): number {
  const lineCount = editor.getModel()?.getLineCount() ?? 1;
  return Math.min(Math.max(1, Math.floor(line)), lineCount);
}

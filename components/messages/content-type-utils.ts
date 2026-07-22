/**
 * Pure helpers for the message content viewer's content-type selection.
 *
 * Kept in a Monaco-free module so the logic can be unit-tested without pulling
 * the heavy `@monaco-editor/react` dependency that content-viewer.tsx imports.
 */

/**
 * Resolve which content type should be active after the selected message or
 * connector changes.
 *
 * The Java MessageBrowser keeps the chosen content type "sticky": if the newly
 * selected message still has content for the previously selected type, that type
 * stays selected. Otherwise it falls back to "raw" (or the first available type
 * when "raw" itself is absent).
 *
 * @param prev - The previously selected content-type key.
 * @param availableKeys - Content-type keys that have content for the new message.
 * @returns The content-type key to select.
 */
export function resolveContentType(prev: string, availableKeys: string[]): string {
  if (availableKeys.includes(prev)) return prev;
  if (availableKeys.includes("raw")) return "raw";
  return availableKeys[0] ?? "raw";
}

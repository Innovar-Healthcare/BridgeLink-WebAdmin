/**
 * Pure helpers for the message content viewer's detail tab selection.
 *
 * Kept in a Monaco-free module so the logic can be unit-tested without pulling
 * the heavy `@monaco-editor/react` dependency that content-viewer.tsx imports.
 */

/**
 * Resolve which detail tab should be active after the selected message or
 * connector changes.
 *
 * The Java MessageBrowser keeps the chosen tab "sticky": if the newly selected
 * message still supports the previously selected tab, that tab stays active.
 * Otherwise it falls back to "messages" (the Content tab).
 *
 * @param prev - The previously selected tab key.
 * @param availableTabs - Tab keys that are available for the new message.
 * @returns The tab key to select.
 */
export function resolveTab(prev: string, availableTabs: string[]): string {
  if (availableTabs.includes(prev)) return prev;
  return "messages";
}

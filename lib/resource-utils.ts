/**
 * Pure helpers for the Settings → Resources tab (mirrors SettingsPanelResources.java).
 * Kept framework-free so the validation logic is unit-testable without the React component.
 */

import type { ResourceProperties } from "./types";

/** The built-in default resource's id — never removable; its name/type are read-only. */
export const DEFAULT_RESOURCE_ID = "Default Resource";

/**
 * Validate the resource list before save. Mirrors the Java checks:
 *  - resource names must be unique (SettingsPanelResources)
 *  - a non-default Directory resource's path must be non-blank and not "/" or "server-lib"
 *    (DirectoryResourcePropertiesPanel.checkProperties — both would shadow the server classpath root)
 *
 * Returns the first error message, or null when the list is valid.
 */
export function validateResources(resources: ResourceProperties[]): string | null {
  const seen = new Set<string>();
  for (const r of resources) {
    const name = r.name.trim();
    if (seen.has(name)) return `Duplicate resource name: "${name}".`;
    seen.add(name);
  }
  for (const r of resources) {
    if (r.id === DEFAULT_RESOURCE_ID || r.type !== "Directory") continue;
    const dir = r.directory?.trim() ?? "";
    if (!dir) return `Directory path is required for resource "${r.name}".`;
    if (dir === "/" || dir === "server-lib") return `Directory cannot be equal to "${dir}".`;
  }
  return null;
}

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
 *  - every Directory resource's path — including the Default Resource — must be non-blank
 *    and not "/" or "server-lib" (DirectoryResourcePropertiesPanel.checkProperties validates
 *    the selected row regardless of whether it is the default; both would shadow the server
 *    classpath root). The default's Directory field is editable in the Java client, so it is
 *    validated here rather than locked read-only.
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
    // Orphaned (InvalidResourceProperties) rows carry no editable Directory path and round-trip
    // verbatim — never fabricate a Directory-path error for them.
    if (r.invalid) continue;
    if (r.type !== "Directory") continue;
    const dir = r.directory?.trim() ?? "";
    if (!dir) return `Directory path is required for resource "${r.name}".`;
    if (dir === "/" || dir === "server-lib") return `Directory cannot be equal to "${dir}".`;
  }
  return null;
}

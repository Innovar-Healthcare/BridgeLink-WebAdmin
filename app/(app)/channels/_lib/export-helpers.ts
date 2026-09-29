/**
 * Shared helpers for channel/group export dialogs.
 */

import { loadAdminPrefs } from "@/components/settings/admin-tab";

/**
 * Resolves the "Export code template libraries with channels" admin pref to an
 * auto-answer: true/false to skip the confirm prompt and export immediately
 * (matching the Java UI's ChannelPanel.java), or null when the pref is "ask"/unset
 * and the confirm prompt should still be shown.
 */
export function resolveExportLibrariesAutoAnswer(): boolean | null {
  const pref = loadAdminPrefs().exportChannelCodeTemplateLibraries;
  if (pref === "yes") return true;
  if (pref === "no") return false;
  return null;
}

/**
 * Strip empty exportData sub-elements from channel XML to match Java UI export output.
 *
 * The server always includes <dependentIds/>, <dependencyIds/>, and <channelTags/> in
 * the channel XML even when the collections are empty.  The Java UI only sets these
 * fields on the exportData object when the collections are non-empty
 * (CollectionUtils.isNotEmpty check), so XStream never serializes empty ones.
 * We replicate that by removing any self-closing or open/close empty variants.
 */
export function stripEmptyExportDataFields(xml: string): string {
  const EMPTY_TAGS = ["codeTemplateLibraries", "dependentIds", "dependencyIds", "channelTags"];
  let result = xml;
  for (const tag of EMPTY_TAGS) {
    result = result
      .replace(new RegExp(`\\s*<${tag}\\s*/>\\s*`, "g"), "\n")
      .replace(new RegExp(`\\s*<${tag}\\s*><\\/${tag}>\\s*`, "g"), "\n");
  }
  return result;
}

/** Escape XML special chars for text content. */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

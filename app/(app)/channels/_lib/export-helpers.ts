/**
 * Shared helpers for channel/group export dialogs.
 */

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

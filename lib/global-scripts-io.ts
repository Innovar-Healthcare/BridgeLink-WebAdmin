/**
 * Import/export of the four global scripts as an XStream `Map<String,String>`
 * XML document — mirrors Java Frame.doImportGlobalScripts() /
 * doExportGlobalScripts() (which serialize via ObjectXMLSerializer).
 *
 * XML shape (Map<String, String>):
 *   <map>
 *     <entry>
 *       <string>Deploy</string>
 *       <string>// script body…</string>
 *     </entry>
 *     …
 *   </map>
 *
 * Import quirks reproduced from the Java client:
 *  - the legacy package namespace `com.webreach.mirth` is rewritten to
 *    `com.mirth.connect` in every script body;
 *  - a legacy `Shutdown` key is remapped to `Undeploy` (only when no `Undeploy`
 *    entry is already present).
 *
 * Values are escaped via `escXml` on export (never CDATA — a literal `]]>` in a
 * script body would otherwise break the document, the #5 lesson).
 */

import { escXml } from "@/lib/api/api-core";
import { GLOBAL_SCRIPT_KEYS, type GlobalScriptKey } from "@/lib/api/api-settings";

const LEGACY_NAMESPACE_RE = /com\.webreach\.mirth/g;

/** Serialize the four global scripts to an XStream `Map<String,String>` XML document. */
export function exportGlobalScriptsToXml(scripts: Record<GlobalScriptKey, string>): string {
  const entries = GLOBAL_SCRIPT_KEYS.map(
    (key) =>
      `  <entry>\n    <string>${escXml(key)}</string>\n    <string>${escXml(scripts[key] ?? "")}</string>\n  </entry>`
  ).join("\n");
  return `<map>\n${entries}\n</map>`;
}

/**
 * Parse an XStream `Map<String,String>` XML document into the known global
 * scripts. Applies the legacy namespace rewrite and `Shutdown`→`Undeploy`
 * remap, then returns only the recognised keys that were present (absent keys
 * are omitted so callers can merge over the current scripts, matching Java
 * `ScriptPanel.setScripts`, which only overwrites keys present in the map).
 *
 * @throws if the XML is invalid or the root element is not `<map>`.
 */
export function parseGlobalScriptsFromXml(xml: string): Partial<Record<GlobalScriptKey, string>> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== "map") {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <map>.`);
  }

  // Collect every key→value pair first so the Shutdown→Undeploy remap can run
  // before we narrow to the four known keys. Do NOT trim — script bodies are
  // user data and must round-trip byte-for-byte (textContent already unescapes).
  const raw = new Map<string, string>();
  root.querySelectorAll(":scope > entry").forEach((entry) => {
    const strings = entry.querySelectorAll(":scope > string");
    const key = strings[0]?.textContent ?? "";
    if (!key) return;
    const value = (strings[1]?.textContent ?? "").replace(LEGACY_NAMESPACE_RE, "com.mirth.connect");
    raw.set(key, value);
  });

  if (raw.has("Shutdown") && !raw.has("Undeploy")) {
    raw.set("Undeploy", raw.get("Shutdown")!);
    raw.delete("Shutdown");
  }

  const result: Partial<Record<GlobalScriptKey, string>> = {};
  for (const key of GLOBAL_SCRIPT_KEYS) {
    if (raw.has(key)) result[key] = raw.get(key)!;
  }
  return result;
}

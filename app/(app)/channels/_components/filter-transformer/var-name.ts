/**
 * Variable-name generation for transformer steps created from the message tree.
 *
 * Mirrors MirthTree.constructVariable() + removeInvalidVariableCharacters() from
 * client/src/com/mirth/connect/client/ui/components/MirthTree.java.
 */

import { splitLabel } from "@/lib/reference-data";

/**
 * Port of MirthTree.removeInvalidVariableCharacters().
 *
 * Lowercases, replaces / & @ and " - ", strips non-identifier chars,
 * trims leading/trailing dots, then camelCases at every space or dot boundary.
 */
export function sanitizeVariableName(source: string): string {
  if (!source) return "";

  let s = source.toLowerCase();
  s = s.replace(/\//g, " or ");
  s = s.replace(/ - /g, "_");
  s = s.replace(/&/g, " and ");
  s = s.replace(/@/g, "att ");
  s = s.replace(/[^a-zA-Z0-9_\s]/g, "");
  s = s.trim();

  // Trim leading/trailing dots (Java while-loop equivalent).
  while (s.length > 0 && (s[0] === "." || s[s.length - 1] === ".")) {
    s = s.replace(/^\.|\.$/g, "").trim();
  }

  if (!s) return "";

  // CamelCase: remove each space or dot, capitalise the next char.
  while (s.includes(" ") || s.includes(".")) {
    const spIdx = s.indexOf(" ");
    const dotIdx = s.indexOf(".");
    let idx: number;
    if (spIdx === -1) idx = dotIdx;
    else if (dotIdx === -1) idx = spIdx;
    else idx = Math.min(spIdx, dotIdx);

    s = s.slice(0, idx) + s.slice(idx + 1, idx + 2).toUpperCase() + s.slice(idx + 2);
  }

  return s;
}

/**
 * Derives a default Mapper step variable name from a tree-node's label chain.
 *
 * Mirrors the ancestry walk in MirthTree.constructVariable(): each label
 * contributes a sanitized chunk (preferring the parenthetical vocab description
 * over the bare field code), and chunks are joined with "_" from root to leaf.
 *
 * @param nodeLabel      Label of the right-clicked / dropped node (e.g. "MSH.7.1 (Time of Message)")
 * @param ancestorLabels Labels of non-root ancestors, root-most first
 *                       (e.g. ["MSH (Message Header)", "MSH.7 (Date/Time of Message)"])
 */
export function varNameFromTree(nodeLabel: string, ancestorLabels: string[]): string {
  const chain = [...ancestorLabels, nodeLabel];

  const parts = chain
    .map((label) => {
      const [code, desc] = splitLabel(label);
      // Prefer the parenthetical vocab description; fall back to the field code.
      const raw = desc ?? code;
      return sanitizeVariableName(raw);
    })
    .filter(Boolean);

  return parts.join("_");
}

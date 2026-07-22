/**
 * Utilities for converting BridgeLink code templates to reference-panel RefItems.
 *
 * Centralised here so both the filter/transformer reference panel and the scripts-tab
 * reference panel share identical logic, and so the pure functions can be unit-tested
 * without mounting React components.
 */

import type { CodeTemplate, CodeTemplateLibrary, ContextType } from "./types";

// ─── Context-type sets ────────────────────────────────────────────────────────

/**
 * Context types that appear in the filter/transformer reference panel, as an
 * ordered list. Mirrors Java's CodeTemplateContextSet.getConnectorContextSet().
 * Exposed as a typed array (not just the Set below) so plugin-contributed
 * reference items can populate `RefItem.contexts` from a single source of truth.
 */
export const CONNECTOR_CONTEXT_TYPE_LIST: ContextType[] = [
  "SOURCE_RECEIVER",
  "SOURCE_FILTER_TRANSFORMER",
  "DESTINATION_FILTER_TRANSFORMER",
  "DESTINATION_DISPATCHER",
  "DESTINATION_RESPONSE_TRANSFORMER",
];

/**
 * Context types that appear in the filter/transformer reference panel.
 * Mirrors Java's CodeTemplateContextSet.getConnectorContextSet().
 */
export const CONNECTOR_CONTEXT_TYPES = new Set<string>(CONNECTOR_CONTEXT_TYPE_LIST);

/**
 * Context types that appear in the scripts-tab reference panel.
 * Mirrors Java's CodeTemplateContextSet.getChannelContextSet() for the
 * four script types shown in the Scripts tab (Deploy / Undeploy /
 * Preprocessing / Postprocessing) plus Attachment and Batch.
 */
export const CHANNEL_SCRIPT_CONTEXT_TYPES = new Set<string>([
  "CHANNEL_DEPLOY",
  "CHANNEL_UNDEPLOY",
  "CHANNEL_PREPROCESSOR",
  "CHANNEL_POSTPROCESSOR",
  "CHANNEL_ATTACHMENT",
  "CHANNEL_BATCH",
]);

// ─── Function-call extraction ─────────────────────────────────────────────────

/**
 * Parses the first `function` declaration found in `code` and returns a
 * minimal call expression — i.e. just `functionName(param1, param2)`.
 *
 * Default-value initialisers are stripped so the caller sees only the
 * parameter names:
 *   `function foo(a, b = 'default')` → `"foo(a, b)"`
 *
 * Returns `null` when no function declaration is found.
 */
export function extractFunctionCall(code: string): string | null {
  // Match the first `function name(...)` declaration (including inside JSDoc blocks).
  const match = code.match(/function\s+(\w+)\s*\(([^)]*)\)/);
  if (!match) return null;

  const funcName = match[1];
  const rawParams = match[2];

  if (!rawParams.trim()) return `${funcName}()`;

  const params = rawParams
    .split(",")
    .map((p) =>
      p
        .trim()
        .split(/\s*=\s*/)[0]
        .trim()
    ) // strip default values
    .filter(Boolean)
    .join(", ");

  return `${funcName}(${params})`;
}

// ─── JSDoc description extraction ────────────────────────────────────────────

/**
 * Extracts a human-readable description from the first JSDoc comment block
 * (`/** ... *​/`) in the given code string.
 *
 * Returns `null` when:
 * - No JSDoc block is found
 * - The extracted text contains placeholder markers (e.g. "Modify the description here")
 * - The cleaned text is empty
 */
export function extractJsDocDescription(code: string): string | null {
  const match = code.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;

  const raw = match[1];

  // Strip leading whitespace + optional `*` prefix from each line, then join.
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .filter((line) => !line.startsWith("@")); // drop @param, @returns, etc.

  const text = lines.join(" ").replace(/\s+/g, " ").trim();

  if (!text) return null;

  // Reject placeholder / boilerplate descriptions
  const PLACEHOLDER_PATTERNS = [
    /modify the description here/i,
    /enter a description here/i,
    /todo:?\s*(add|write|fill)/i,
  ];
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(text))) return null;

  return text;
}

// ─── Template → RefItem conversion ───────────────────────────────────────────

/**
 * The shape returned by `templateToRefItem` — intentionally a plain object so
 * this utility file does not need to import from component files (avoids
 * circular dependencies).  It is structurally compatible with `RefItem`.
 */
export interface TemplateRefItem {
  name: string;
  description: string;
  code?: string;
}

/**
 * Converts a `CodeTemplate` to a `TemplateRefItem` for display in a
 * reference panel, matching Java's drag-and-drop behaviour:
 *
 * - `FUNCTION`          → `code` is the **function call** only, e.g. `"myFunc(a, b)"`.
 *                         The full code body appears in the tooltip description.
 * - `DRAG_AND_DROP_CODE`→ `code` is the **full code block** (same as Java UI).
 * - `COMPILED_CODE`     → `code` is `undefined` — compiled at deploy time, not draggable.
 */
export function templateToRefItem(t: CodeTemplate): TemplateRefItem {
  // Extract a clean description from JSDoc if available; fall back to the template name.
  const description = (t.code ? extractJsDocDescription(t.code) : null) ?? t.name;

  if (t.type === "FUNCTION") {
    // For functions, only the call expression is inserted on drag.
    const call = extractFunctionCall(t.code) ?? `${t.name}()`;
    return { name: t.name, description, code: call };
  }

  if (t.type === "DRAG_AND_DROP_CODE") {
    // For code blocks, the entire snippet is inserted on drag.
    return { name: t.name, description, code: t.code || undefined };
  }

  // COMPILED_CODE: runs at channel load time; not intended to be dragged.
  return { name: t.name, description, code: undefined };
}

// ─── Context-type filter helpers ──────────────────────────────────────────────

/**
 * Returns true if the template has at least one context type that belongs to
 * the connector (filter/transformer) context set.
 */
export function isConnectorTemplate(t: CodeTemplate): boolean {
  return t.contextTypes.some((ct) => CONNECTOR_CONTEXT_TYPES.has(ct));
}

/**
 * Returns true if the template has at least one context type that belongs to
 * the channel-script context set (scripts tab).
 */
export function isChannelScriptTemplate(t: CodeTemplate): boolean {
  return t.contextTypes.some((ct) => CHANNEL_SCRIPT_CONTEXT_TYPES.has(ct));
}

// ─── Library-enabled filter ───────────────────────────────────────────────────

/**
 * Returns true if a library is enabled for the given channel.
 *
 * Mirrors Java's CodeTemplateLibrary semantics:
 * - If enabledChannelIds is non-empty → channel must be explicitly listed
 * - Otherwise, fall back to includeNewChannels:
 *   - true  → library applies to all channels except those in disabledChannelIds
 *   - false → library applies to no channels (not a dependency of any channel)
 */
export function isLibraryEnabledForChannel(lib: CodeTemplateLibrary, channelId: string): boolean {
  if (lib.enabledChannelIds && lib.enabledChannelIds.length > 0) {
    return lib.enabledChannelIds.includes(channelId);
  }
  // No explicit channel list — use includeNewChannels to decide default
  if (!lib.includeNewChannels) {
    return false; // library is not a dependency of any channel
  }
  // includeNewChannels=true: applies to all channels unless explicitly disabled
  return !lib.disabledChannelIds?.includes(channelId);
}

/**
 * Filter templates to only those belonging to libraries enabled for a channel.
 * Returns the full template list unchanged if channelId or libraries are not available.
 */
export function filterTemplatesByChannel(
  templates: CodeTemplate[],
  libraries: CodeTemplateLibrary[],
  channelId: string | undefined
): CodeTemplate[] {
  if (!channelId || libraries.length === 0) return templates;

  // Build set of template IDs from enabled libraries
  const enabledTemplateIds = new Set<string>();
  for (const lib of libraries) {
    if (isLibraryEnabledForChannel(lib, channelId)) {
      for (const tid of lib.codeTemplateIds) {
        enabledTemplateIds.add(tid);
      }
    }
  }

  return templates.filter((t) => enabledTemplateIds.has(t.id));
}

// ─── Duplicate signature detection ──────────────────────────────────────────

export interface FunctionSignature {
  name: string;
  paramCount: number;
}

export interface SignatureConflict {
  functionName: string;
  paramCount: number;
  templates: Array<{
    templateId: string;
    templateName: string;
    libraryId: string;
    libraryName: string;
  }>;
}

/**
 * Extracts the function name and parameter count from a code template's code.
 * Returns `null` when no function declaration is found.
 */
export function extractFunctionSignature(code: string): FunctionSignature | null {
  const match = code.match(/function\s+(\w+)\s*\(([^)]*)\)/);
  if (!match) return null;
  const name = match[1];
  const rawParams = match[2].trim();
  const paramCount = rawParams
    ? rawParams
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean).length
    : 0;
  return { name, paramCount };
}

/**
 * Finds code templates across different libraries that share the same function
 * name and parameter count. Only FUNCTION-type templates are checked.
 *
 * Returns one `SignatureConflict` per unique conflicting signature.
 */
export function findDuplicateSignatures(
  templates: Map<string, CodeTemplate>,
  libraries: CodeTemplateLibrary[]
): SignatureConflict[] {
  // Build templateId → { libraryId, libraryName } lookup
  const templateLibrary = new Map<string, { libraryId: string; libraryName: string }>();
  for (const lib of libraries) {
    for (const tid of lib.codeTemplateIds) {
      templateLibrary.set(tid, { libraryId: lib.id, libraryName: lib.name });
    }
  }

  // Group FUNCTION templates by signature key
  const groups = new Map<
    string,
    Array<{
      templateId: string;
      templateName: string;
      libraryId: string;
      libraryName: string;
      functionName: string;
      paramCount: number;
    }>
  >();

  for (const [id, tmpl] of templates) {
    if (tmpl.type !== "FUNCTION") continue;
    const sig = extractFunctionSignature(tmpl.code);
    if (!sig) continue;
    const lib = templateLibrary.get(id);
    if (!lib) continue;

    const key = `${sig.name}/${sig.paramCount}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push({
      templateId: id,
      templateName: tmpl.name,
      libraryId: lib.libraryId,
      libraryName: lib.libraryName,
      functionName: sig.name,
      paramCount: sig.paramCount,
    });
  }

  // Keep only groups with 2+ templates from different libraries
  const conflicts: SignatureConflict[] = [];
  for (const group of groups.values()) {
    const uniqueLibs = new Set(group.map((g) => g.libraryId));
    if (uniqueLibs.size < 2) continue;
    conflicts.push({
      functionName: group[0].functionName,
      paramCount: group[0].paramCount,
      templates: group.map(({ templateId, templateName, libraryId, libraryName }) => ({
        templateId,
        templateName,
        libraryId,
        libraryName,
      })),
    });
  }

  return conflicts;
}

// ─── JSDoc-aware code template parser ────────────────────────────────────────

export interface ParsedCodeTemplateParam {
  type: string;
  name: string;
  description: string;
}

export interface ParsedCodeTemplateFunction {
  name: string;
  params: ParsedCodeTemplateParam[];
  returnType: string;
  returnDescription: string;
  description: string;
}

// Ported from Java's CodeTemplateUtil.FunctionVisitor annotation regexes.
const ANNOTATION_PARAM_RE = /@param(?:\s*\{([^}]*)\})?\s*(\w+)\s*(?:-\s*)?([\s\S]*)/i;
const ANNOTATION_RETURN_RE = /@returns?(?:\s*\{([^}]*)\})?\s*([\s\S]*)/i;

const JSDOC_PLACEHOLDER_RE = /modify the description here|modify the function name and parameters/i;

/**
 * Parses a BridgeLink code template's code string and returns a structured
 * representation of the function name, parameters (with JSDoc types and
 * descriptions), return type, return description, and overall description.
 *
 * Mirrors the logic in Java's CodeTemplateUtil.FunctionVisitor. BridgeLink's
 * updateCode() normalises stored JSDoc on save, so @param {Any} arg - desc
 * format is guaranteed for templates created in the UI.
 *
 * Returns null when no function declaration is found.
 */
export function parseCodeTemplateFunction(code: string): ParsedCodeTemplateFunction | null {
  if (!code) return null;

  const funcMatch = code.match(/function\s+(\w+)\s*\(([^)]*)\)/);
  if (!funcMatch) return null;

  const name = funcMatch[1];
  const rawParams = funcMatch[2].trim();
  const paramNames = rawParams
    ? rawParams
        .split(",")
        .map((p) =>
          p
            .trim()
            .split(/\s*=\s*/)[0]
            .trim()
        )
        .filter(Boolean)
    : [];

  const paramMap = new Map<string, ParsedCodeTemplateParam>(
    paramNames.map((pName) => [pName, { type: "Any", name: pName, description: "" }])
  );

  let description = "";
  let returnType = "Any";
  let returnDescription = "";

  const jsDocMatch = code.match(/\/\*{2,}([\s\S]*?)\*\//);
  if (jsDocMatch) {
    const normalized = jsDocMatch[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*?\s?/, ""))
      .join("\n");

    // Split on @ annotation boundaries; first segment is the description.
    const segments = normalized.split(/(?=@(?:param|returns?)\b)/i);

    const rawDesc = segments[0].replace(/\s+/g, " ").trim();
    if (rawDesc && !JSDOC_PLACEHOLDER_RE.test(rawDesc)) {
      description = rawDesc;
    }

    for (let i = 1; i < segments.length; i++) {
      const block = segments[i].trim();

      if (/^@param\b/i.test(block)) {
        const m = ANNOTATION_PARAM_RE.exec(block);
        if (m) {
          const pType = (m[1] ?? "Any").trim() || "Any";
          const pName = m[2];
          const pDesc = (m[3] ?? "").replace(/\s+/g, " ").trim();
          if (paramMap.has(pName)) {
            paramMap.set(pName, { type: pType, name: pName, description: pDesc });
          }
        }
      } else if (/^@returns?\b/i.test(block)) {
        const m = ANNOTATION_RETURN_RE.exec(block);
        if (m) {
          returnType = (m[1] ?? "Any").trim() || "Any";
          returnDescription = (m[2] ?? "").replace(/\s+/g, " ").trim();
        }
      }
    }
  }

  return {
    name,
    params: paramNames.map((n) => paramMap.get(n)!),
    returnType,
    returnDescription,
    description,
  };
}

/**
 * Formats a parsed code template function into a concise signature string,
 * e.g. `lookupPatient(String mrn, String facility) : String`.
 * Matches the label format shown in Monaco's suggestion detail column.
 */
export function formatCodeTemplateSignature(parsed: ParsedCodeTemplateFunction): string {
  const paramStr = parsed.params.map((p) => `${p.type} ${p.name}`).join(", ");
  return `${parsed.name}(${paramStr}) : ${parsed.returnType}`;
}

// ─── JSDoc generation ────────────────────────────────────────────────────────

/**
 * Default JSDoc description inserted when a template has no (non-placeholder)
 * description. Matches the text in Java's CodeTemplate.DEFAULT_CODE constant.
 */
export const DEFAULT_JSDOC_DESCRIPTION =
  "Modify the description here. Modify the function name and parameters as needed. One function per template is recommended; create a new code template for each new function.";

/**
 * Faithful port of Apache Commons Lang `WordUtils.wrap(str, wrapLength, newLineStr, wrapLongWords)`
 * with the default wrap-on token (a single space). Java's CodeTemplateUtil.updateCode() uses this
 * to wrap JSDoc at 100 columns, so we replicate it exactly for byte-identical output.
 *
 * - Breaks only on spaces. `wrapLongWords=false` leaves a token longer than `wrapLength` intact
 *   (the line overruns) instead of hard-splitting it.
 * - `newLineStr` is inserted at each break point.
 */
export function wordWrap(
  str: string,
  wrapLength: number,
  newLineStr: string,
  wrapLongWords: boolean
): string {
  if (!str) return str;
  if (wrapLength < 1) wrapLength = 1;

  const inputLineLength = str.length;
  let offset = 0;
  let wrapped = "";

  while (offset < inputLineLength) {
    let spaceToWrapAt = -1;
    // Window the matcher scans, mirroring str.substring(offset, min(offset + wrapLength + 1, len)).
    const windowEnd = Math.min(offset + wrapLength + 1, inputLineLength);

    const firstSpace = str.indexOf(" ", offset);
    if (firstSpace !== -1 && firstSpace < windowEnd) {
      if (firstSpace === offset) {
        // Leading space at the window start — skip it and restart (Java: offset += matcher.end()).
        offset = firstSpace + 1;
        continue;
      }
      spaceToWrapAt = firstSpace;
    }

    // Only the last line (short enough to pass through) is left.
    if (inputLineLength - offset <= wrapLength) break;

    // Advance to the LAST space within the window (Java's trailing `while (matcher.find())`).
    if (spaceToWrapAt >= offset) {
      let next = str.indexOf(" ", spaceToWrapAt + 1);
      while (next !== -1 && next < windowEnd) {
        spaceToWrapAt = next;
        next = str.indexOf(" ", next + 1);
      }
    }

    if (spaceToWrapAt >= offset) {
      // Normal case — break at the chosen space.
      wrapped += str.substring(offset, spaceToWrapAt) + newLineStr;
      offset = spaceToWrapAt + 1;
    } else if (wrapLongWords) {
      // Hard-split a long word at the limit.
      wrapped += str.substring(offset, offset + wrapLength) + newLineStr;
      offset += wrapLength;
    } else {
      // Don't split a long word — extend past the limit to the next space, if any.
      const next = str.indexOf(" ", offset + wrapLength);
      if (next >= 0) {
        wrapped += str.substring(offset, next) + newLineStr;
        offset = next + 1;
      } else {
        wrapped += str.substring(offset);
        offset = inputLineLength;
      }
    }
  }

  // Whatever is left is short enough to pass through unchanged.
  wrapped += str.substring(offset);
  return wrapped;
}

/**
 * Generates (or regenerates) the JSDoc block for a code template's first function,
 * mirroring Java's `CodeTemplateUtil.updateCode()`.
 *
 * Unlike a naive regenerate, this PRESERVES existing `@param`/`@return` types and
 * descriptions (via {@link parseCodeTemplateFunction}, which defaults missing types to
 * "Any") rather than resetting them to `{Any}` placeholders, and wraps every line at
 * 100 columns exactly like Java's WordUtils.wrap #12).
 *
 * Note: multi-paragraph descriptions are collapsed to a single wrapped line (the parser
 * normalises whitespace); the common single-paragraph case is byte-identical to Java.
 */
export function generateJsDoc(code: string): string {
  if (!code || !code.trim()) return code;

  const trimmed = code.trim();

  // endIndex = end of a leading JSDoc block + its trailing whitespace (Java COMMENT_PATTERN,
  // which consumes the whitespace after `*/` so regeneration stays idempotent), else 0.
  const commentMatch = trimmed.match(/^\/\*\*[\s\S]*?\*\/\s*/);
  const endIndex = commentMatch ? commentMatch[0].length : 0;

  // Parse the function + any existing JSDoc, preserving param/return types & descriptions.
  const parsed = parseCodeTemplateFunction(trimmed);

  let description = parsed?.description ?? "";
  if (!description.trim()) description = DEFAULT_JSDOC_DESCRIPTION;

  let builder = "/**";
  for (const line of description.split(/\r\n|\r|\n/)) {
    builder += "\n\t" + wordWrap(line, 100, "\n\t", false);
  }

  if (parsed) {
    builder += "\n";
    for (const p of parsed.params) {
      const paramStr = `\n\t@param {${p.type || "Any"}} ${p.name} - ${p.description.trim()}`;
      builder += wordWrap(paramStr, 100, "\n\t\t", false);
    }
    const returnStr = `\n\t@return {${parsed.returnType || "Any"}} ${parsed.returnDescription.trim()}`;
    builder += wordWrap(returnStr, 100, "\n\t\t", false);
  }

  builder += "\n*/\n";
  return builder + trimmed.substring(endIndex);
}

// ─── Duplicate signature detection ──────────────────────────────────────────

/**
 * Channel-scoped variant of `findDuplicateSignatures` — only considers
 * libraries that are enabled for the given channel.
 */
export function findDuplicateSignaturesForChannel(
  templates: Map<string, CodeTemplate>,
  libraries: CodeTemplateLibrary[],
  channelId: string
): SignatureConflict[] {
  const enabledLibs = libraries.filter((lib) => isLibraryEnabledForChannel(lib, channelId));
  if (enabledLibs.length < 2) return [];

  // Build filtered template map — only templates from enabled libraries
  const enabledTemplateIds = new Set<string>();
  for (const lib of enabledLibs) {
    for (const tid of lib.codeTemplateIds) {
      enabledTemplateIds.add(tid);
    }
  }
  const filteredTemplates = new Map<string, CodeTemplate>();
  for (const [id, tmpl] of templates) {
    if (enabledTemplateIds.has(id)) {
      filteredTemplates.set(id, tmpl);
    }
  }

  return findDuplicateSignatures(filteredTemplates, enabledLibs);
}

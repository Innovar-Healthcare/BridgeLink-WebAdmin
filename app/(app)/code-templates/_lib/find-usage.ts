/**
 * find-usage.ts
 *
 * Utility functions for finding which channels and code templates reference
 * a code template function. Searches channel XML scripts and other template
 * code for occurrences of the function name.
 */

import { registerCacheTeardown } from "@/lib/logout";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScriptLocation {
  /** Human-readable label, e.g. "Preprocessing Script", "Source — Transformer — Step 1" */
  label: string;
  /** Short snippet showing the function call in context */
  snippet: string;
  /**
   * Channel edit URL query params to navigate directly to this script location.
   * e.g. "tab=scripts&script=preprocessing" or "tab=source&sub=filter"
   */
  navParams: string;
}

export interface FindUsageResult {
  channelId: string;
  channelName: string;
  locations: ScriptLocation[];
}

export interface FindUsageProgress {
  searched: number;
  total: number;
}

// ─── Function name extraction ─────────────────────────────────────────────────

/**
 * Extract the primary function name from a code template's code.
 * Looks for `function <name>(` patterns. Returns null if none found.
 */
export function extractFunctionName(code: string): string | null {
  // Match standalone function declarations (not inside comments)
  const match = code.match(/^\s*function\s+(\w+)\s*\(/m);
  return match ? match[1] : null;
}

// ─── Channel XML script extraction ────────────────────────────────────────────

interface NamedScript {
  label: string;
  code: string;
  /** URL query params for navigating to this location in the channel editor */
  navParams: string;
}

/**
 * Extract all script locations from a channel XML string.
 * Returns an array of { label, code, navParams } for every script-bearing element.
 */
export function extractScriptsFromChannelXml(xml: string): NamedScript[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const scripts: NamedScript[] = [];

  // Channel-level scripts
  const channelScripts: Array<{ selector: string; label: string; scriptKey: string }> = [
    {
      selector: "channel > preprocessingScript",
      label: "Preprocessing Script",
      scriptKey: "preprocessing",
    },
    {
      selector: "channel > postprocessingScript",
      label: "Postprocessing Script",
      scriptKey: "postprocessing",
    },
    { selector: "channel > deployScript", label: "Deploy Script", scriptKey: "deploy" },
    { selector: "channel > undeployScript", label: "Undeploy Script", scriptKey: "undeploy" },
  ];
  for (const { selector, label, scriptKey } of channelScripts) {
    const el = doc.querySelector(selector);
    const code = el?.textContent ?? "";
    if (code.trim()) {
      scripts.push({ label, code, navParams: `tab=scripts&script=${scriptKey}` });
    }
  }

  // Source connector
  const srcConn = doc.querySelector("channel > sourceConnector");
  if (srcConn) {
    extractConnectorScripts(srcConn, "Source", "source", null, scripts);
  }

  // Destination connectors
  const destContainer = doc.querySelector("channel > destinationConnectors");
  if (destContainer) {
    const connectors = destContainer.querySelectorAll(":scope > connector");
    connectors.forEach((conn, idx) => {
      const destName = conn.querySelector("name")?.textContent ?? `Destination ${idx + 1}`;
      extractConnectorScripts(conn, destName, "destination", idx, scripts);
    });
  }

  return scripts;
}

function extractConnectorScripts(
  connEl: Element,
  connName: string,
  connType: "source" | "destination",
  destIdx: number | null,
  scripts: NamedScript[]
): void {
  const destParam = destIdx !== null ? `&dest=${destIdx}` : "";
  const tabParam = `tab=${connType}${destParam}`;

  // Connector properties script (e.g. JavaScript Reader/Writer)
  const propsScript = connEl.querySelector("properties > script");
  if (propsScript?.textContent?.trim()) {
    scripts.push({
      label: `${connName} — Properties Script`,
      code: propsScript.textContent,
      navParams: `${tabParam}&sub=properties`,
    });
  }

  // Filter elements
  extractStepScripts(connEl, "filter", connName, "Filter", `${tabParam}&sub=filter`, scripts);

  // Transformer elements
  extractStepScripts(
    connEl,
    "transformer",
    connName,
    "Transformer",
    `${tabParam}&sub=transformer`,
    scripts
  );

  // Response transformer (destination connectors only)
  if (connType === "destination") {
    extractStepScripts(
      connEl,
      "responseTransformer",
      connName,
      "Response Transformer",
      `${tabParam}&sub=responseTransformer`,
      scripts
    );
  }
}

function extractStepScripts(
  connEl: Element,
  containerTag: string,
  connName: string,
  containerLabel: string,
  navParams: string,
  scripts: NamedScript[]
): void {
  const container = connEl.querySelector(`:scope > ${containerTag}`);
  if (!container) return;

  // Elements can be under <elements> or directly as children
  const elementsContainer = container.querySelector(":scope > elements");
  const parent = elementsContainer ?? container;

  // Steps are elements like JavaScriptStep, ExternalScriptStep, etc.
  // Each has a <script> child element
  let stepIdx = 0;
  for (const child of Array.from(parent.children)) {
    const tagName = child.tagName;
    // Skip non-step elements
    if (
      tagName === "inboundTemplate" ||
      tagName === "outboundTemplate" ||
      tagName === "inboundDataType" ||
      tagName === "outboundDataType" ||
      tagName === "inboundProperties" ||
      tagName === "outboundProperties"
    ) {
      continue;
    }

    const scriptEl = child.querySelector(":scope > script");
    const code = scriptEl?.textContent ?? "";
    if (code.trim()) {
      const stepName = child.querySelector(":scope > name")?.textContent ?? `Step ${stepIdx + 1}`;
      scripts.push({
        label: `${connName} — ${containerLabel} — ${stepName}`,
        code,
        navParams,
      });
    }
    stepIdx++;
  }
}

// ─── Search for function references ───────────────────────────────────────────

/**
 * Build a snippet around the first occurrence of functionName in code.
 * Returns ~80 chars of context around the match.
 */
export function buildSnippet(code: string, functionName: string): string {
  const idx = code.indexOf(functionName);
  if (idx === -1) return "";

  // Find the line containing the match
  const lineStart = code.lastIndexOf("\n", idx) + 1;
  const lineEnd = code.indexOf("\n", idx);
  const line = code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

  // Truncate if too long
  if (line.length > 100) {
    const matchPosInLine = idx - lineStart;
    const start = Math.max(0, matchPosInLine - 30);
    const end = Math.min(line.length, matchPosInLine + functionName.length + 40);
    return (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : "");
  }
  return line;
}

/**
 * Search a single channel's scripts for references to a function name.
 * Returns locations where the function name appears.
 */
export function searchChannelForFunction(
  channelXml: string,
  functionName: string
): ScriptLocation[] {
  const scripts = extractScriptsFromChannelXml(channelXml);
  const results: ScriptLocation[] = [];

  const pattern = buildFunctionPattern(functionName);

  for (const { label, code, navParams } of scripts) {
    // Strip comments before testing to avoid matching function names in comments
    if (pattern.test(stripJsComments(code))) {
      results.push({
        label,
        snippet: buildSnippet(code, functionName),
        navParams,
      });
    }
  }

  return results;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex pattern that matches a function name as a standalone call,
 * excluding method calls (e.g. `obj.add(...)` won't match when searching for `add`).
 *
 * Uses:
 * - `(?<!\.)` — negative lookbehind: not preceded by a dot (excludes method calls)
 * - `\b` — word boundaries (excludes partial-word matches like `addHeader`)
 */
export function buildFunctionPattern(functionName: string): RegExp {
  return new RegExp(`(?<!\\.)\\b${escapeRegExp(functionName)}\\b`);
}

/**
 * Strip JavaScript comments from code before searching for function references.
 * - Block comments `/* ... *\/` are replaced with spaces (preserving line count)
 * - Line comments `// ...` are replaced with empty strings
 *
 * This prevents false positives where a function name appears only in a comment
 * (e.g. `// uses add() here` would otherwise match when searching for `add`).
 *
 * Note: does not handle `//` or `/* ` inside string literals, but this is
 * sufficient for real-world BridgeLink template code.
 */
export function stripJsComments(code: string): string {
  // Replace block comments with spaces, preserving newlines
  const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  // Replace line comments
  return noBlock.replace(/\/\/.*/g, "");
}

// ─── Bounded concurrent fetch ─────────────────────────────────────────────────

/**
 * Run async tasks with bounded concurrency.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main find usage function ─────────────────────────────────────────────────

// Module-level cache for fetched channel XML
const channelXmlCache = new Map<string, string>();

/** Clear the cached channel XML (e.g. on page refresh) */
export function clearChannelXmlCache(): void {
  channelXmlCache.clear();
}

// Holds raw channel XML with no invalidation of its own — clear it on every
// session-teardown path so it can't leak to the next user.
registerCacheTeardown(clearChannelXmlCache);

/**
 * Find all channels that reference the given function name.
 *
 * @param functionName - The function name to search for
 * @param channelIds - Channel IDs to search (narrowed by library enabledChannelIds)
 * @param channelNames - Map of channelId → channelName
 * @param fetchChannelXml - Function to fetch a channel's XML by ID
 * @param onProgress - Optional callback for progress updates
 * @param signal - Optional AbortSignal to cancel the search
 */
export async function findUsages(
  functionName: string,
  channelIds: string[],
  channelNames: Map<string, string>,
  fetchChannelXml: (channelId: string) => Promise<string>,
  onProgress?: (progress: FindUsageProgress) => void,
  signal?: AbortSignal
): Promise<FindUsageResult[]> {
  const results: FindUsageResult[] = [];
  let searched = 0;

  await mapConcurrent(channelIds, 5, async (channelId) => {
    if (signal?.aborted) return;

    // Check cache first
    let xml = channelXmlCache.get(channelId);
    if (!xml) {
      xml = await fetchChannelXml(channelId);
      channelXmlCache.set(channelId, xml);
    }

    const locations = searchChannelForFunction(xml, functionName);
    if (locations.length > 0) {
      results.push({
        channelId,
        channelName: channelNames.get(channelId) ?? channelId,
        locations,
      });
    }

    searched++;
    onProgress?.({ searched, total: channelIds.length });
  });

  // Sort results by channel name
  results.sort((a, b) => a.channelName.localeCompare(b.channelName));
  return results;
}

// ─── Template-to-template search ────────────────────────────────────────────

export interface FindUsageTemplateResult {
  templateId: string;
  templateName: string;
  libraryName: string;
  snippet: string;
}

/**
 * Search all code templates for references to a function name.
 * This is synchronous — template code is already in memory.
 *
 * @param functionName - The function name to search for
 * @param allTemplates - All loaded code templates
 * @param excludeTemplateId - Template to exclude from search (the source template)
 * @param libraries - Libraries for resolving template → library name
 */
export function searchTemplatesForFunction(
  functionName: string,
  allTemplates: Map<string, CodeTemplate>,
  excludeTemplateId: string,
  libraries: CodeTemplateLibrary[]
): FindUsageTemplateResult[] {
  const pattern = buildFunctionPattern(functionName);
  const results: FindUsageTemplateResult[] = [];

  // Build templateId → library name lookup
  const templateLibMap = new Map<string, string>();
  for (const lib of libraries) {
    for (const tid of lib.codeTemplateIds) {
      templateLibMap.set(tid, lib.name);
    }
  }

  for (const [id, tmpl] of allTemplates) {
    if (id === excludeTemplateId) continue;
    if (!tmpl.code || !pattern.test(stripJsComments(tmpl.code))) continue;

    results.push({
      templateId: id,
      templateName: tmpl.name,
      libraryName: templateLibMap.get(id) ?? "Unknown Library",
      snippet: buildSnippet(tmpl.code, functionName),
    });
  }

  results.sort((a, b) => a.templateName.localeCompare(b.templateName));
  return results;
}

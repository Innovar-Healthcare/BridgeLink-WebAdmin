/**
 * XML parser for imported code template and library files.
 *
 * Handles the 4 XML formats produced by the export functions:
 *   1. <codeTemplate>           — single template
 *   2. <list><codeTemplate>...  — multiple templates
 *   3. <codeTemplateLibrary>    — single library with embedded templates
 *   4. <list><codeTemplateLibrary>... — multiple libraries
 */

import type { CodeTemplate, CodeTemplateLibrary, CodeTemplateType, ContextType } from "../types";

/**
 * Preprocess CDATA sections by converting them to XML-escaped text.
 * happy-dom's DOMParser does not support CDATA; browsers do.
 * This normalization makes the parser work in both environments.
 */
function stripCdata(xml: string): string {
  return xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
    content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

const VALID_CONTEXT_TYPES = new Set<string>([
  "GLOBAL_DEPLOY",
  "GLOBAL_UNDEPLOY",
  "GLOBAL_PREPROCESSOR",
  "GLOBAL_POSTPROCESSOR",
  "CHANNEL_DEPLOY",
  "CHANNEL_UNDEPLOY",
  "CHANNEL_PREPROCESSOR",
  "CHANNEL_POSTPROCESSOR",
  "CHANNEL_ATTACHMENT",
  "CHANNEL_BATCH",
  "SOURCE_RECEIVER",
  "SOURCE_FILTER_TRANSFORMER",
  "DESTINATION_FILTER_TRANSFORMER",
  "DESTINATION_DISPATCHER",
  "DESTINATION_RESPONSE_TRANSFORMER",
]);

const VALID_TEMPLATE_TYPES = new Set<string>(["FUNCTION", "DRAG_AND_DROP_CODE", "COMPILED_CODE"]);

/**
 * Parse a `<codeTemplate>` element into a CodeTemplate object.
 */
function parseTemplateElement(el: Element): CodeTemplate {
  const id = el.querySelector(":scope > id")?.textContent ?? "";
  const name = el.querySelector(":scope > name")?.textContent ?? "";
  const revText = el.querySelector(":scope > revision")?.textContent;
  const revision = revText ? parseInt(revText, 10) : undefined;

  // contextSet > delegate > contextType (may also appear without delegate wrapper)
  const contextEls = el.querySelectorAll(":scope > contextSet > delegate > contextType");
  const contextFallback =
    contextEls.length > 0 ? contextEls : el.querySelectorAll(":scope > contextSet > contextType");
  const contextTypes: ContextType[] = [];
  contextFallback.forEach((ctEl) => {
    const val = ctEl.textContent?.trim();
    if (val && VALID_CONTEXT_TYPES.has(val)) {
      contextTypes.push(val as ContextType);
    }
  });

  // properties > type and properties > code
  const propsEl = el.querySelector(":scope > properties");
  const typeText = propsEl?.querySelector(":scope > type")?.textContent?.trim() ?? "FUNCTION";
  const type: CodeTemplateType = VALID_TEMPLATE_TYPES.has(typeText)
    ? (typeText as CodeTemplateType)
    : "FUNCTION";
  const code = propsEl?.querySelector(":scope > code")?.textContent ?? "";

  // lastModified > time
  const lmTime = el.querySelector(":scope > lastModified > time")?.textContent;
  const lastModified = lmTime ? new Date(Number(lmTime)).toISOString() : undefined;

  if (!id) throw new Error("Code template is missing an <id> element");
  if (!name) throw new Error("Code template is missing a <name> element");

  return { id, name, revision, lastModified, contextTypes, type, code };
}

/**
 * Parse a `<codeTemplateLibrary>` element into a library + its embedded templates.
 */
function parseLibraryElement(el: Element): {
  library: CodeTemplateLibrary;
  templates: CodeTemplate[];
} {
  const id = el.querySelector(":scope > id")?.textContent ?? "";
  const name = el.querySelector(":scope > name")?.textContent ?? "";
  const revText = el.querySelector(":scope > revision")?.textContent;
  const revision = revText ? parseInt(revText, 10) : undefined;
  const description = el.querySelector(":scope > description")?.textContent ?? "";
  const includeNewChannels =
    el.querySelector(":scope > includeNewChannels")?.textContent === "true";

  // Channel ID sets
  const enabledChannelIds: string[] = [];
  el.querySelectorAll(":scope > enabledChannelIds > string").forEach((s) => {
    const v = s.textContent?.trim();
    if (v) enabledChannelIds.push(v);
  });
  const disabledChannelIds: string[] = [];
  el.querySelectorAll(":scope > disabledChannelIds > string").forEach((s) => {
    const v = s.textContent?.trim();
    if (v) disabledChannelIds.push(v);
  });

  // lastModified > time
  const lmTime = el.querySelector(":scope > lastModified > time")?.textContent;
  const lastModified = lmTime ? new Date(Number(lmTime)).toISOString() : undefined;

  // Embedded templates
  const templates: CodeTemplate[] = [];
  const codeTemplateIds: string[] = [];
  el.querySelectorAll(":scope > codeTemplates > codeTemplate").forEach((tmplEl) => {
    const tmpl = parseTemplateElement(tmplEl);
    templates.push(tmpl);
    codeTemplateIds.push(tmpl.id);
  });

  if (!id) throw new Error("Code template library is missing an <id> element");
  if (!name) throw new Error("Code template library is missing a <name> element");

  const library: CodeTemplateLibrary = {
    id,
    name,
    revision,
    lastModified,
    description,
    includeNewChannels,
    enabledChannelIds,
    disabledChannelIds,
    codeTemplateIds,
  };

  return { library, templates };
}

/**
 * Parse XML containing code template(s).
 * Accepts single `<codeTemplate>` or `<list>` of `<codeTemplate>` elements.
 */
export function parseCodeTemplatesFromXml(xml: string): CodeTemplate[] {
  const doc = new DOMParser().parseFromString(stripCdata(xml), "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;

  if (root.tagName === "codeTemplate") {
    return [parseTemplateElement(root)];
  }

  if (root.tagName === "list") {
    const els = root.querySelectorAll(":scope > codeTemplate");
    if (els.length === 0) {
      throw new Error("XML <list> does not contain any <codeTemplate> elements");
    }
    const results: CodeTemplate[] = [];
    els.forEach((el) => results.push(parseTemplateElement(el)));
    return results;
  }

  throw new Error(`Unexpected root element <${root.tagName}>. Expected <codeTemplate> or <list>.`);
}

/**
 * Parse XML containing code template library/libraries.
 * Accepts single `<codeTemplateLibrary>` or `<list>` of `<codeTemplateLibrary>` elements.
 * Returns both the libraries and all embedded templates extracted from them.
 */
export function parseCodeTemplateLibrariesFromXml(xml: string): {
  libraries: CodeTemplateLibrary[];
  templates: CodeTemplate[];
} {
  const doc = new DOMParser().parseFromString(stripCdata(xml), "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;

  if (root.tagName === "codeTemplateLibrary") {
    const { library, templates } = parseLibraryElement(root);
    return { libraries: [library], templates };
  }

  if (root.tagName === "list") {
    const els = root.querySelectorAll(":scope > codeTemplateLibrary");
    if (els.length === 0) {
      throw new Error("XML <list> does not contain any <codeTemplateLibrary> elements");
    }
    const libraries: CodeTemplateLibrary[] = [];
    const templates: CodeTemplate[] = [];
    els.forEach((el) => {
      const parsed = parseLibraryElement(el);
      libraries.push(parsed.library);
      templates.push(...parsed.templates);
    });
    return { libraries, templates };
  }

  throw new Error(
    `Unexpected root element <${root.tagName}>. Expected <codeTemplateLibrary> or <list>.`
  );
}

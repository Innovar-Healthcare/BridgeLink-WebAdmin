/**
 * API code templates — library/template CRUD, XStream XML serializers for bulk update.
 */

import type {
  CodeTemplate,
  CodeTemplateLibrary,
  CodeTemplateLibrarySaveResult,
  CodeTemplateType,
  ContextType,
} from "../types";
import {
  PROXY_BASE,
  escXml,
  getServerUrl,
  normalizeXStream,
  request,
  throwForStatus,
} from "./api-core";

/**
 * Generic helper: XStream collapses single-item arrays to plain objects throughout
 * the BridgeLink API. This function always returns an array, handling both cases.
 * Pass the raw value of the XStream array field.
 */
function toArray<T>(val: unknown): T[] {
  if (val === null || val === undefined) return [];
  return Array.isArray(val) ? (val as T[]) : [val as T];
}

/**
 * Normalize a sorted-set string field from XStream JSON to string[].
 * XStream serializes java.util.TreeSet<String> as:
 *   { "@class": "sorted-set", "string": "single" }   (one item)
 *   { "@class": "sorted-set", "string": ["a","b"] }  (multiple items)
 *   { "@class": "sorted-set" }                        (empty)
 */
function normalizeSortedSetStrings(val: unknown): string[] {
  if (!val || typeof val !== "object") return [];
  const s = (val as Record<string, unknown>)["string"];
  if (s === null || s === undefined) return [];
  return toArray<string>(s);
}

/**
 * Normalize a contextSet from raw XStream JSON to ContextType[].
 * Server format: { "delegate": { "@class": "sorted-set", "contextType": "X" | ["X","Y"] } }
 */
function normalizeContextTypes(raw: unknown): ContextType[] {
  const rawObj = raw as Record<string, unknown> | null | undefined;
  const delegate = (rawObj?.delegate as Record<string, unknown> | undefined) ?? rawObj;
  const ct = delegate?.contextType;
  if (!ct) return [];
  return toArray<ContextType>(ct);
}

/**
 * Normalize a raw XStream library object to CodeTemplateLibrary.
 * Handles the single-item-collapses-to-object quirk for codeTemplates.
 */
function normalizeLibrary(raw: unknown): CodeTemplateLibrary {
  const r = raw as Record<string, unknown>;
  const codeTemplates = r?.codeTemplates as Record<string, unknown> | undefined;
  // codeTemplates.codeTemplate may be a single object or array of objects
  const ctRaw = codeTemplates?.codeTemplate;
  const templateStubs = toArray<{ id: string }>(ctRaw ?? []);
  const lastModified = r?.lastModified as Record<string, unknown> | undefined;

  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? "").trim(),
    revision: r.revision != null ? Number(r.revision) : undefined,
    lastModified: lastModified?.time
      ? new Date(Number(lastModified.time)).toISOString()
      : undefined,
    description: String(r.description ?? ""),
    includeNewChannels: r.includeNewChannels === true || r.includeNewChannels === "true",
    enabledChannelIds: normalizeSortedSetStrings(r.enabledChannelIds),
    disabledChannelIds: normalizeSortedSetStrings(r.disabledChannelIds),
    codeTemplateIds: templateStubs.map((s) => s.id).filter(Boolean),
  };
}

/**
 * Normalize a raw XStream code template object to CodeTemplate.
 */
function normalizeTemplate(raw: unknown): CodeTemplate {
  const r = raw as Record<string, unknown>;
  const props = (r?.properties as Record<string, unknown>) ?? {};
  const lastModified = r?.lastModified as Record<string, unknown> | undefined;
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    revision: r.revision != null ? Number(r.revision) : undefined,
    lastModified: lastModified?.time
      ? new Date(Number(lastModified.time)).toISOString()
      : undefined,
    contextTypes: normalizeContextTypes(r.contextSet),
    type: (props.type as CodeTemplateType) ?? "FUNCTION",
    code: String(props.code ?? ""),
  };
}

/**
 * GET /codeTemplateLibraries
 * Returns all libraries. Libraries contain only template ID stubs (no full template data).
 * Use getCodeTemplates() to get full template content.
 *
 * XStream quirk: single library collapses to object — toArray() handles this.
 */
export async function getCodeTemplateLibraries(): Promise<CodeTemplateLibrary[]> {
  const raw = await request<unknown>("/codeTemplateLibraries", { skipNormalize: true });
  // Response: {"list": {"codeTemplateLibrary": obj | obj[]}} or {"list": null}
  const rawObj = raw as Record<string, unknown> | null | undefined;
  const listVal = rawObj?.list as Record<string, unknown> | null | undefined;
  if (!listVal) return [];
  const items = toArray(listVal.codeTemplateLibrary);
  return items.map(normalizeLibrary);
}

/**
 * GET /codeTemplates
 * Returns all code templates with full data (code, contextTypes, etc.).
 *
 * XStream quirk: single template collapses to object — toArray() handles this.
 */
export async function getCodeTemplates(): Promise<CodeTemplate[]> {
  const raw = await request<unknown>("/codeTemplates", { skipNormalize: true });
  // Response: {"list": {"codeTemplate": obj | obj[]}} or {"list": null}
  const rawObj = raw as Record<string, unknown> | null | undefined;
  const listVal = rawObj?.list as Record<string, unknown> | null | undefined;
  if (!listVal) return [];
  const items = toArray(listVal.codeTemplate);
  return items.map(normalizeTemplate);
}

/**
 * Cached version of getCodeTemplates().
 * Module-level Promise ensures only one fetch per browser session.
 * Resets to null on error so the next caller can retry.
 */
let _codeTemplateCache: Promise<CodeTemplate[]> | null = null;
let _codeTemplateResolved: CodeTemplate[] | null = null;

export function getCodeTemplatesCached(): Promise<CodeTemplate[]> {
  if (!_codeTemplateCache) {
    _codeTemplateCache = getCodeTemplates()
      .then((data) => {
        _codeTemplateResolved = data;
        return data;
      })
      .catch((err) => {
        _codeTemplateCache = null; // allow retry on next call
        _codeTemplateResolved = null;
        throw err;
      });
  }
  return _codeTemplateCache;
}

/**
 * Synchronously return the cached templates if they've already resolved,
 * else null. Lets callers (e.g. the Monaco hover provider) skip an `await`
 * on hot paths where waiting for a network round-trip would feel slow.
 */
export function peekCodeTemplatesCached(): CodeTemplate[] | null {
  return _codeTemplateResolved;
}

/**
 * Invalidate the module-level code template cache so the next call to
 * getCodeTemplatesCached() will re-fetch from the server. Call this after
 * saving code templates so the Reference List picks up changes.
 */
export function invalidateCodeTemplateCache(): void {
  _codeTemplateCache = null;
  _codeTemplateResolved = null;
  _codeTemplateLibraryCache = null;
  _codeTemplateLibraryResolved = null;
}

/**
 * Cached version of getCodeTemplateLibraries().
 * Module-level Promise ensures only one fetch per browser session.
 * Resets to null on error so the next caller can retry.
 * Invalidated together with the template cache via invalidateCodeTemplateCache().
 */
let _codeTemplateLibraryCache: Promise<CodeTemplateLibrary[]> | null = null;
let _codeTemplateLibraryResolved: CodeTemplateLibrary[] | null = null;

export function getCodeTemplateLibrariesCached(): Promise<CodeTemplateLibrary[]> {
  if (!_codeTemplateLibraryCache) {
    _codeTemplateLibraryCache = getCodeTemplateLibraries()
      .then((data) => {
        _codeTemplateLibraryResolved = data;
        return data;
      })
      .catch((err) => {
        _codeTemplateLibraryCache = null;
        _codeTemplateLibraryResolved = null;
        throw err;
      });
  }
  return _codeTemplateLibraryCache;
}

/**
 * Synchronous companion to peekCodeTemplatesCached() — returns the cached
 * libraries if resolved, else null.
 */
export function peekCodeTemplateLibrariesCached(): CodeTemplateLibrary[] | null {
  return _codeTemplateLibraryResolved;
}

// ── XStream XML serializers ──────────────────────────────────────────────────

/**
 * Serialize an ID set to XStream XML <set> format.
 * Empty set → <set/> (self-closing).
 */
function serializeIdSetToXml(ids: string[]): string {
  if (ids.length === 0) return "<set/>";
  const items = ids.map((id) => `  <string>${escXml(id)}</string>`).join("\n");
  return `<set>\n${items}\n</set>`;
}

/**
 * Serialize a list of CodeTemplateLibrary objects to XStream XML <list> format.
 * Libraries sent to _bulkUpdate contain only template ID stubs, not full template data.
 */
function serializeLibrariesToXml(libs: CodeTemplateLibrary[]): string {
  if (libs.length === 0) return "<list/>";

  const items = libs.map((lib) => {
    const enabledIds = (lib.enabledChannelIds ?? [])
      .map((id) => `      <string>${escXml(id)}</string>`)
      .join("\n");
    const disabledIds = (lib.disabledChannelIds ?? [])
      .map((id) => `      <string>${escXml(id)}</string>`)
      .join("\n");
    const enabledBlock = enabledIds
      ? `<enabledChannelIds class="sorted-set">\n${enabledIds}\n    </enabledChannelIds>`
      : `<enabledChannelIds class="sorted-set"/>`;
    const disabledBlock = disabledIds
      ? `<disabledChannelIds class="sorted-set">\n${disabledIds}\n    </disabledChannelIds>`
      : `<disabledChannelIds class="sorted-set"/>`;

    const templateStubs = lib.codeTemplateIds
      .map((id) => `      <codeTemplate version="4.6.0"><id>${escXml(id)}</id></codeTemplate>`)
      .join("\n");
    const templatesBlock = templateStubs
      ? `<codeTemplates>\n${templateStubs}\n    </codeTemplates>`
      : `<codeTemplates/>`;

    return [
      `  <codeTemplateLibrary version="4.6.0">`,
      `    <id>${escXml(lib.id)}</id>`,
      `    <name>${escXml(lib.name)}</name>`,
      `    <revision>${lib.revision ?? 1}</revision>`,
      `    <description>${escXml(lib.description ?? "")}</description>`,
      `    <includeNewChannels>${lib.includeNewChannels ? "true" : "false"}</includeNewChannels>`,
      `    ${enabledBlock}`,
      `    ${disabledBlock}`,
      `    ${templatesBlock}`,
      `  </codeTemplateLibrary>`,
    ].join("\n");
  });

  return `<list>\n${items.join("\n")}\n</list>`;
}

/**
 * Serialize a list of CodeTemplate objects to XStream XML <list> format.
 * The code body is XML-escaped via escXml (matching Java's plain-String XStream
 * output) — never CDATA, which would break on a literal `]]>` in the body.
 */
function serializeTemplatesToXml(templates: CodeTemplate[]): string {
  if (templates.length === 0) return "<list/>";

  const items = templates.map((t) => {
    const contextItems = t.contextTypes
      .map((ct) => `      <contextType>${ct}</contextType>`)
      .join("\n");
    const contextBlock = contextItems
      ? `<contextSet>\n    <delegate class="sorted-set">\n${contextItems}\n    </delegate>\n  </contextSet>`
      : `<contextSet><delegate class="sorted-set"/></contextSet>`;

    return [
      `  <codeTemplate version="4.6.0">`,
      `    <id>${escXml(t.id)}</id>`,
      `    <name>${escXml(t.name)}</name>`,
      `    <revision>${t.revision ?? 1}</revision>`,
      `    ${contextBlock}`,
      `    <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties">`,
      `      <type>${t.type}</type>`,
      `      <code>${escXml(t.code)}</code>`,
      `    </properties>`,
      `  </codeTemplate>`,
    ].join("\n");
  });

  return `<list>\n${items.join("\n")}\n</list>`;
}

// ── Export serializers ────────────────────────────────────────────────────────

/**
 * Serialize a single CodeTemplate to standalone XStream XML (no <list> wrapper).
 * Used for exporting a single template as a downloadable XML file.
 */
function serializeSingleTemplateXml(t: CodeTemplate): string {
  const contextItems = t.contextTypes
    .map((ct) => `    <contextType>${ct}</contextType>`)
    .join("\n");
  const contextBlock = contextItems
    ? `<contextSet>\n  <delegate class="sorted-set">\n${contextItems}\n  </delegate>\n</contextSet>`
    : `<contextSet><delegate class="sorted-set"/></contextSet>`;

  return [
    `<codeTemplate version="4.6.0">`,
    `  <id>${escXml(t.id)}</id>`,
    `  <name>${escXml(t.name)}</name>`,
    `  <revision>${t.revision ?? 1}</revision>`,
    `  ${contextBlock}`,
    `  <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties">`,
    `    <type>${t.type}</type>`,
    `    <code>${escXml(t.code)}</code>`,
    `  </properties>`,
    `</codeTemplate>`,
  ].join("\n");
}

/**
 * Serialize a single library with full template bodies embedded for export.
 * Unlike serializeLibrariesToXml (which uses ID stubs for _bulkUpdate),
 * this embeds complete CodeTemplate objects inside the library — matching
 * the Java client's ObjectXMLSerializer.serialize(library) output.
 */
function serializeSingleLibraryForExportXml(
  lib: CodeTemplateLibrary,
  templates: CodeTemplate[]
): string {
  const enabledIds = (lib.enabledChannelIds ?? [])
    .map((id) => `    <string>${escXml(id)}</string>`)
    .join("\n");
  const disabledIds = (lib.disabledChannelIds ?? [])
    .map((id) => `    <string>${escXml(id)}</string>`)
    .join("\n");
  const enabledBlock = enabledIds
    ? `<enabledChannelIds class="sorted-set">\n${enabledIds}\n  </enabledChannelIds>`
    : `<enabledChannelIds class="sorted-set"/>`;
  const disabledBlock = disabledIds
    ? `<disabledChannelIds class="sorted-set">\n${disabledIds}\n  </disabledChannelIds>`
    : `<disabledChannelIds class="sorted-set"/>`;

  const templateItems = templates
    .map((t) => {
      const contextItems = t.contextTypes
        .map((ct) => `        <contextType>${ct}</contextType>`)
        .join("\n");
      const contextBlock = contextItems
        ? `<contextSet>\n      <delegate class="sorted-set">\n${contextItems}\n      </delegate>\n    </contextSet>`
        : `<contextSet><delegate class="sorted-set"/></contextSet>`;

      return [
        `    <codeTemplate version="4.6.0">`,
        `      <id>${escXml(t.id)}</id>`,
        `      <name>${escXml(t.name)}</name>`,
        `      <revision>${t.revision ?? 1}</revision>`,
        `      ${contextBlock}`,
        `      <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties">`,
        `        <type>${t.type}</type>`,
        `        <code>${escXml(t.code)}</code>`,
        `      </properties>`,
        `    </codeTemplate>`,
      ].join("\n");
    })
    .join("\n");
  const templatesBlock = templateItems
    ? `<codeTemplates>\n${templateItems}\n  </codeTemplates>`
    : `<codeTemplates/>`;

  return [
    `<codeTemplateLibrary version="4.6.0">`,
    `  <id>${escXml(lib.id)}</id>`,
    `  <name>${escXml(lib.name)}</name>`,
    `  <revision>${lib.revision ?? 1}</revision>`,
    `  <description>${escXml(lib.description ?? "")}</description>`,
    `  <includeNewChannels>${lib.includeNewChannels ? "true" : "false"}</includeNewChannels>`,
    `  ${enabledBlock}`,
    `  ${disabledBlock}`,
    `  ${templatesBlock}`,
    `</codeTemplateLibrary>`,
  ].join("\n");
}

/**
 * Parse a single code template from BridgeLink XStream XML.
 * The XML is the format stored in the version-history repo (same as server serialization).
 * Returns null if the XML cannot be parsed.
 */
export function parseCodeTemplateFromXml(xml: string): CodeTemplate | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const root = doc.documentElement;
  if (!root || root.tagName !== "codeTemplate") return null;

  const text = (tag: string) => root.getElementsByTagName(tag)[0]?.textContent ?? "";
  const id = text("id");
  const name = text("name");
  if (!id) return null;

  const revision = parseInt(text("revision")) || 1;
  const propsEl = root.getElementsByTagName("properties")[0];
  const type = (propsEl?.getElementsByTagName("type")[0]?.textContent ??
    "FUNCTION") as CodeTemplate["type"];
  const code = propsEl?.getElementsByTagName("code")[0]?.textContent ?? "";

  const ctEls = root.getElementsByTagName("contextType");
  const contextTypes = Array.from(ctEls)
    .map((el) => el.textContent as CodeTemplate["contextTypes"][number])
    .filter(Boolean);

  return { id, name, revision, contextTypes, type, code };
}

/**
 * Export a single code template as standalone XML.
 */
export function exportTemplateToXml(template: CodeTemplate): string {
  return serializeSingleTemplateXml(template);
}

/**
 * Serialize a single CodeTemplateLibrary to the XStream XML format stored in the
 * version-history git repository (one file per library, no <list> wrapper).
 * Template entries are ID stubs only — full template bodies live in codetemplates/.
 */
export function serializeLibraryForRepo(lib: CodeTemplateLibrary): string {
  const enabledIds = (lib.enabledChannelIds ?? [])
    .map((id) => `    <string>${escXml(id)}</string>`)
    .join("\n");
  const disabledIds = (lib.disabledChannelIds ?? [])
    .map((id) => `    <string>${escXml(id)}</string>`)
    .join("\n");
  const enabledBlock = enabledIds
    ? `<enabledChannelIds class="sorted-set">\n${enabledIds}\n  </enabledChannelIds>`
    : `<enabledChannelIds class="sorted-set"/>`;
  const disabledBlock = disabledIds
    ? `<disabledChannelIds class="sorted-set">\n${disabledIds}\n  </disabledChannelIds>`
    : `<disabledChannelIds class="sorted-set"/>`;

  const templateStubs = lib.codeTemplateIds
    .map((id) => `    <codeTemplate version="4.6.0"><id>${escXml(id)}</id></codeTemplate>`)
    .join("\n");
  const templatesBlock = templateStubs
    ? `<codeTemplates>\n${templateStubs}\n  </codeTemplates>`
    : `<codeTemplates/>`;

  return [
    `<codeTemplateLibrary version="4.6.0">`,
    `  <id>${escXml(lib.id)}</id>`,
    `  <name>${escXml(lib.name)}</name>`,
    `  <revision>${lib.revision ?? 1}</revision>`,
    `  <description>${escXml(lib.description ?? "")}</description>`,
    `  <includeNewChannels>${lib.includeNewChannels ? "true" : "false"}</includeNewChannels>`,
    `  ${enabledBlock}`,
    `  ${disabledBlock}`,
    `  ${templatesBlock}`,
    `</codeTemplateLibrary>`,
  ].join("\n");
}

/**
 * Export a single library with all its templates embedded as XML.
 */
export function exportLibraryToXml(
  library: CodeTemplateLibrary,
  templates: CodeTemplate[]
): string {
  return serializeSingleLibraryForExportXml(library, templates);
}

/**
 * Export all libraries (each with full templates embedded) as XML.
 * Wraps multiple libraries in a <list> element.
 */
export function exportAllLibrariesToXml(
  libraries: Array<{ library: CodeTemplateLibrary; templates: CodeTemplate[] }>
): string {
  if (libraries.length === 0) return "<list/>";
  const items = libraries
    .map(({ library, templates }) => {
      // Indent the single-library XML by 2 spaces for nesting inside <list>
      return serializeSingleLibraryForExportXml(library, templates)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
    })
    .join("\n");
  return `<list>\n${items}\n</list>`;
}

/**
 * POST /codeTemplateLibraries/_bulkUpdate?override=<override>
 * Mirrors Java's CodeTemplatePanel.updateLibrariesAndTemplates().
 *
 * Sends 4 multipart fields as XStream XML:
 *   - libraries: all current libraries (server replaces all)
 *   - removedLibraryIds: IDs of deleted libraries
 *   - updatedCodeTemplates: new or changed templates
 *   - removedCodeTemplateIds: IDs of deleted templates
 *
 * Concurrency (mirrors Java CodeTemplatePanel.attemptUpdate): with `override=false`
 * (the default) the server runs a revision-conflict pre-check — if another session
 * has modified a library/template since the last refresh, the result's
 * `overrideNeeded` is true and NOTHING is applied. Callers should prompt the user
 * and retry with `override=true` only on confirm (see useCodeTemplateSave).
 * `override=true` skips the pre-check and force-applies.
 *
 * Uses multipart/form-data — the proxy must forward body as raw bytes (arrayBuffer).
 * Returns the save result with per-template success/failure and new revisions.
 */
export async function bulkUpdateCodeTemplates(
  params: {
    libraries: CodeTemplateLibrary[];
    removedLibraryIds: string[];
    updatedCodeTemplates: CodeTemplate[];
    removedCodeTemplateIds: string[];
  },
  override = false
): Promise<CodeTemplateLibrarySaveResult> {
  const fd = new FormData();
  fd.append(
    "libraries",
    new Blob([serializeLibrariesToXml(params.libraries)], { type: "application/xml" }),
    "libraries.xml"
  );
  fd.append(
    "removedLibraryIds",
    new Blob([serializeIdSetToXml(params.removedLibraryIds)], { type: "application/xml" }),
    "removedLibraryIds.xml"
  );
  fd.append(
    "updatedCodeTemplates",
    new Blob([serializeTemplatesToXml(params.updatedCodeTemplates)], { type: "application/xml" }),
    "updatedCodeTemplates.xml"
  );
  fd.append(
    "removedCodeTemplateIds",
    new Blob([serializeIdSetToXml(params.removedCodeTemplateIds)], { type: "application/xml" }),
    "removedCodeTemplateIds.xml"
  );

  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/codeTemplateLibraries/_bulkUpdate?override=${override}`, {
    method: "POST",
    headers: {
      // Do NOT set Content-Type — browser sets it with the correct multipart boundary
      Accept: "application/json",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: fd,
  });

  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));

  if (res.status === 204) return {};
  const text = await res.text();
  if (!text) return {};
  const data = JSON.parse(text) as Record<string, unknown>;
  // Normalize XStream map/wrapper formats, then unwrap the top-level alias
  const normalized = normalizeXStream(data) as Record<string, unknown>;
  const result = normalized?.codeTemplateLibrarySaveResult ?? normalized;
  return result as CodeTemplateLibrarySaveResult;
}

/**
 * Update a single code template from raw XML (version history restore).
 * PUT /codeTemplates/{codeTemplateId}?override=true with Content-Type: application/xml.
 * Mirrors updateChannelFromXml() — same pattern, different endpoint.
 *
 * Throws CodeTemplateNotFoundError when the template doesn't exist on the server
 * (e.g. it was deleted). Caller should prompt the user to select a library before
 * using bulkUpdateCodeTemplates() to re-create it.
 */
export class CodeTemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Code template ${templateId} not found on server`);
    this.name = "CodeTemplateNotFoundError";
  }
}

export async function updateCodeTemplateFromXml(templateId: string, xml: string): Promise<void> {
  const serverUrl = getServerUrl();
  const res = await fetch(
    `${PROXY_BASE}/codeTemplates/${encodeURIComponent(templateId)}?override=true`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/xml",
        ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
      },
      credentials: "include",
      body: xml,
    }
  );
  if (res.status === 404) {
    throw new CodeTemplateNotFoundError(templateId);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throwForStatus(res.status, body, "Failed to update code template");
  }
  invalidateCodeTemplateCache();
}

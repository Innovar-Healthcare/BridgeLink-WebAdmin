import { DATA_TYPE_REGISTRY } from "../_datatypes/index";
import type { ResourceProperties } from "@/lib/types";
import { scriptsSemanticallyEqual } from "@/lib/js-validation";
import { getSession } from "@/lib/auth";
import {
  readTransmissionModeProperties,
  writeTransmissionModeProperties,
} from "../_connectors/shared/transmission-modes/xml";

/**
 * channel-xml.ts
 *
 * Parse/serialize helpers for the channel XML editor.
 *
 * The channel XML is the single source of truth. These helpers:
 *   - Parse structured state (SummaryState, ScriptsState) FROM xml strings
 *   - Serialize structured state BACK INTO xml strings via DOMParser + XMLSerializer
 *
 * XMLSerializer encodes special characters correctly (e.g. " → &quot;) and
 * DOMParser decodes them back on parse, so scripts round-trip without corruption.
 *
 * We serialise doc.documentElement (not doc) to avoid prepending an XML declaration
 * that wasn't in the original.
 */

// ─── Version stamping ───────────────────────────────────────────────────────

/**
 * Fallback stamped only when neither an explicit channel/state version nor a
 * cached session server version is available (e.g. SSR, or tests with no session).
 */
export const FALLBACK_XML_VERSION = "4.6.1";

/**
 * Normalize a version string to the 3-part form the BridgeLink server stamps on
 * every marshalled element (`MigrationUtil.normalizeVersion(currentVersion, 3)`).
 * "26.3.1.5" → "26.3.1", "4.6" → "4.6" (fewer than 3 parts pass through untouched).
 */
export function normalizeXmlVersion(v: string): string {
  const parts = v.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : v;
}

/**
 * Resolve the version attribute to stamp on WebUI-created XML elements. Java's
 * MigratableConverter.marshal always stamps the current server product version;
 * we mirror that. Priority: an explicit channel-root/state version already in
 * scope → the cached session server version → {@link FALLBACK_XML_VERSION}.
 */
export function resolveXmlVersion(preferred?: string | null): string {
  if (preferred && preferred.trim()) return normalizeXmlVersion(preferred.trim());
  return normalizeXmlVersion(getSession()?.serverVersion ?? FALLBACK_XML_VERSION);
}

/**
 * Substitute the `version="{{VERSION}}"` placeholder in a default-XML blob with a
 * resolved version. Deliberately scoped to the exact version-attribute token (not a
 * bare `{{VERSION}}`): withVersion also runs over user-content-bearing strings
 * (connector scripts/templates via state XML, and the whole channel via serialize()),
 * so a literal `{{VERSION}}` a user typed into a script or template is left untouched.
 * Every placeholder this module emits is the attribute form, so nothing is missed.
 */
export function withVersion(xml: string, version: string): string {
  return xml.replaceAll('version="{{VERSION}}"', `version="${version}"`);
}

/**
 * The channel-default queue buffer size, mirroring Java's `ChannelSetup.defaultQueueBufferSize`
 * (initialized to 1000, then overwritten with `serverSettings.getQueueBufferSize()` when the
 * server reports a positive value). Java substitutes this wherever a connector's stored buffer
 * size is <= 0 — for both source and destination connectors, and for freshly-added connectors
 * (whose model default is 0). We cache it at module scope, populated by the channel editor when
 * it loads server settings; parse fallbacks and new-connector defaults read it back. Defaults to
 * 1000 so behavior is unchanged when server settings are unavailable.
 */
const FALLBACK_QUEUE_BUFFER_SIZE = 1000;
let cachedDefaultQueueBufferSize = FALLBACK_QUEUE_BUFFER_SIZE;

/** Set the cached channel-default queue buffer size (server-configured value, if positive). */
export function setDefaultQueueBufferSize(size: number | null | undefined): void {
  cachedDefaultQueueBufferSize = size != null && size > 0 ? size : FALLBACK_QUEUE_BUFFER_SIZE;
}

/** Resolve the channel-default queue buffer size to substitute for a stored value <= 0. */
export function resolveDefaultQueueBufferSize(): number {
  return cachedDefaultQueueBufferSize;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type InitialState = "STARTED" | "PAUSED" | "STOPPED";
export type MessageStorageMode = "DEVELOPMENT" | "PRODUCTION" | "RAW" | "METADATA" | "DISABLED";

export type AttachmentHandlerType =
  | "None"
  | "Entire Message"
  | "Regex"
  | "DICOM"
  | "JavaScript"
  | "Custom";

/** Maps attachment handler display name → XStream provider class. Absent for "None". */
export const ATTACHMENT_HANDLER_CLASS_NAMES: Partial<Record<AttachmentHandlerType, string>> = {
  "Entire Message":
    "com.mirth.connect.server.attachments.identity.IdentityAttachmentHandlerProvider",
  Regex: "com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider",
  DICOM: "com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider",
  JavaScript: "com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider",
};

export interface RegexAttachmentPattern {
  pattern: string;
  mimeType: string;
}

export interface ReplacementEntry {
  key: string;
  value: string;
}

export interface CustomProperty {
  name: string;
  value: string;
}

export interface AttachmentHandlerState {
  type: AttachmentHandlerType;
  /** Used when type === "Regex". Always has at least one row when Regex is selected. */
  regexPatterns: RegexAttachmentPattern[];
  /** Used when type === "Regex". Inbound string replacements (regex.replaceKey{N}/regex.replaceValue{N}). */
  inboundReplacements: ReplacementEntry[];
  /** Used when type === "Regex". Outbound string replacements (outbound.regex.replaceKey{N}/outbound.regex.replaceValue{N}). */
  outboundReplacements: ReplacementEntry[];
  /** Used when type === "JavaScript". */
  javaScriptScript: string;
  /** Used when type === "Entire Message". Property key: "identity.mimetype". Default: "text/plain". */
  identityMimeType: string;
  /** Used when type === "Custom". Fully-qualified Java class name extending MirthAttachmentHandler. */
  customClassName: string;
  /** Used when type === "Custom". Arbitrary key/value properties in insertion order. */
  customProperties: CustomProperty[];
}

/**
 * Result of an attachment-handler dialog's commit function. A plain state object means
 * "save it"; `{ error }` is a hard block (footer error, no save); `{ warning, value }`
 * is a soft block — the shell prompts "Save anyway?" and saves `value` on confirm. The
 * warning path lets the Custom/JavaScript dialogs match Java, which saves incomplete or
 * Rhino-specific content without hard-blocking #45).
 */
export type AttachmentCommitResult =
  | AttachmentHandlerState
  | { error: string }
  | { warning: string; value: AttachmentHandlerState };

export interface PruningSettings {
  /** Days to retain message metadata; null = no per-channel override (use server default). */
  pruneMetaDataDays: number | null;
  /** Days to retain message content; null = no content pruning override. */
  pruneContentDays: number | null;
  /** Whether to archive messages before pruning. BridgeLink default: true. */
  archiveEnabled: boolean;
  /** Whether to prune messages that errored (not just completed). BridgeLink default: false. */
  pruneErroredMessages: boolean;
}

export interface SummaryState {
  name: string;
  description: string;
  enabled: boolean;
  initialState: InitialState;
  clearGlobalChannelMap: boolean;
  messageStorageMode: MessageStorageMode;
  encryptData: boolean;
  encryptAttachments: boolean;
  encryptCustomMetaData: boolean;
  removeContentOnCompletion: boolean;
  removeOnlyFilteredOnCompletion: boolean;
  removeAttachmentsOnCompletion: boolean;
  storeAttachments: boolean;
  pruningSettings: PruningSettings;
  metaDataColumns: Array<{ name: string; type: string; mappingName?: string }>;
  attachmentHandler: AttachmentHandlerState;
  /** Channel revision number (read-only, managed by server) */
  revision: number;
  /** Last modified timestamp as ISO string, or null for new channels */
  lastModified: string | null;
  /** Number of library resource IDs assigned to this channel (read-only, from XML) */
  resourceIdCount: number;
}

export interface ScriptsState {
  preprocessing: string;
  postprocessing: string;
  deploy: string;
  undeploy: string;
}

/** Default script content for each script type (matches new-channel template). */
export const DEFAULT_SCRIPTS: Readonly<ScriptsState> = {
  preprocessing: "// Modify the message variable below to pre process data\nreturn message;",
  postprocessing:
    '// This script executes once after a message has been processed\n// Responses returned from here will be stored as "Postprocessor" in the response map\nreturn;',
  deploy:
    "// This script executes once when the channel is deployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;",
  undeploy:
    "// This script executes once when the channel is undeployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;",
};

/**
 * Count scripts that differ from the default template. Uses a semantic (comment- and
 * whitespace-insensitive) comparison mirroring Java's Rhino compile→decompile→equals
 * (`ChannelSetup.compareScripts`, #43): a comment-only edit still counts as
 * default, while an emptied script counts as non-default (empty ≠ the non-empty default).
 */
export function countNonDefaultScripts(scripts: ScriptsState): number {
  const keys: (keyof ScriptsState)[] = ["preprocessing", "postprocessing", "deploy", "undeploy"];
  return keys.filter((k) => isNonDefaultScript(scripts, k)).length;
}

/**
 * True when a single channel script differs from its default template. Uses the same semantic
 * comparison as {@link countNonDefaultScripts} so the per-sub-tab "modified" cue and the aggregate
 * "Scripts (N)" count stay consistent. A comment-only edit still reads as default; an emptied
 * script reads as non-default (empty ≠ the non-empty default).
 */
export function isNonDefaultScript(scripts: ScriptsState, key: keyof ScriptsState): boolean {
  return !scriptsSemanticallyEqual(scripts[key], DEFAULT_SCRIPTS[key]);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function text(doc: Document, selector: string, fallback: string): string {
  return doc.querySelector(selector)?.textContent?.trim() ?? fallback;
}

/**
 * Like `text` but returns the content VERBATIM (no trim). Use for free-text fields
 * whose whitespace is significant and round-trips byte-exact through Java/XStream
 * (e.g. the channel description) — trimming on parse would rewrite them on save.
 * #49)
 */
function textRaw(doc: Document, selector: string, fallback: string): string {
  return doc.querySelector(selector)?.textContent ?? fallback;
}

function bool(doc: Document, selector: string, fallback: boolean): boolean {
  const t = doc.querySelector(selector)?.textContent?.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  return fallback;
}

function set(doc: Document, selector: string, value: string): void {
  const el = doc.querySelector(selector);
  if (el) el.textContent = value;
}

/**
 * Sets `parent > tag` to `value`, creating the child element if it is absent.
 *
 * Unlike `set()`, this never silently no-ops when the target element is missing.
 * XStream omits null String fields on serialize, so a channel created via raw REST
 * (or one whose optional Strings were never populated) can lack elements like
 * `<description>` or the four channel scripts entirely — a plain `set()` would then
 * discard the user's edit. Use this for any nullable String field the editor writes.
 * #25)
 */
function setOrCreate(doc: Document, parentSelector: string, tag: string, value: string): void {
  const parent = doc.querySelector(parentSelector);
  if (parent) ensureChild(parent, tag, doc).textContent = value;
}

function serialize(doc: Document): string {
  const out = new XMLSerializer().serializeToString(doc.documentElement);
  // Keystone guarantee: no {{VERSION}} placeholder ever leaves channel-xml. Any
  // default blob that reached the DOM un-substituted is stamped here with the
  // channel root's version (→ cached server version → fallback), mirroring Java's
  // MigratableConverter.marshal. Cheap no-op when no placeholder is present.
  return withVersion(out, resolveXmlVersion(doc.documentElement.getAttribute("version")));
}

/**
 * Ensures a direct child element with `tagName` exists inside `parent`,
 * creating and appending it if absent. Returns the element.
 */
function ensureChild(parent: Element, tagName: string, doc: Document): Element {
  let el = parent.querySelector(`:scope > ${tagName}`);
  if (!el) {
    el = doc.createElementNS(null, tagName);
    parent.appendChild(el);
  }
  return el;
}

/**
 * Allocates the next connector metaDataId for a channel and advances
 * `<nextMetaDataId>`, mirroring Java's `channel.getNextMetaDataId()` +
 * `setNextMetaDataId(id + 1)`.
 *
 * Robust against channels created via raw REST where `<nextMetaDataId>` is
 * absent (previously every add got a hardcoded `2` → duplicate ids) or empty
 * (previously `parseInt("")` → `NaN` written back). The allocated id is the max
 * of the stored value and one past the highest existing connector metaDataId, so
 * it can never collide with an existing connector. #50)
 */
function allocateMetaDataId(channel: Element, doc: Document): number {
  let maxId = 0;
  channel
    .querySelectorAll(
      ":scope > sourceConnector > metaDataId, :scope > destinationConnectors > connector > metaDataId"
    )
    .forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? "", 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    });
  const nextEl = ensureChild(channel, "nextMetaDataId", doc);
  const stored = parseInt(nextEl.textContent?.trim() ?? "", 10);
  const id = Math.max(isNaN(stored) ? 0 : stored, maxId + 1, 1);
  nextEl.textContent = String(id + 1);
  return id;
}

/**
 * Sets or removes an optional integer child element inside `parent`.
 * - value !== null → creates/updates the element's textContent
 * - value === null → removes the element if it exists (omitting it is how
 *   XStream represents a null Integer — an empty element would be read as 0)
 */
function setOptInt(parent: Element, tagName: string, doc: Document, value: number | null): void {
  const existing = parent.querySelector(`:scope > ${tagName}`);
  if (value === null) {
    existing?.remove();
  } else {
    const el =
      existing ??
      (() => {
        const e = doc.createElementNS(null, tagName);
        parent.appendChild(e);
        return e;
      })();
    el.textContent = String(value);
  }
}

// ─── Attachment handler helpers ───────────────────────────────────────────────

/** Append a Map<String,String> entry inside a linked-hash-map <properties> element. */
function appendLinkedHashMapEntry(
  parent: Element,
  doc: Document,
  key: string,
  value: string
): void {
  const entry = doc.createElementNS(null, "entry");
  const keyEl = doc.createElementNS(null, "string");
  keyEl.textContent = key;
  const valEl = doc.createElementNS(null, "string");
  valEl.textContent = value;
  entry.appendChild(keyEl);
  entry.appendChild(valEl);
  parent.appendChild(entry);
}

/**
 * Parse <properties class="linked-hash-map"> into a plain string→string map.
 * Values are kept verbatim (NOT trimmed): attachment-handler property values are
 * whitespace-significant (a regex pattern ending in a space, a replacement value of
 * " ", a JS script with leading/trailing blank lines). Java/XStream round-trips them
 * byte-exact, and serializeAttachmentHandler rebuilds the block on every Summary save,
 * so trimming here would silently corrupt them #23). Keys are trimmed — they
 * are structural property names (regex.pattern0, javascript.script, …) with no
 * significant whitespace.
 */
function parseLinkedHashMapStrings(propsEl: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of propsEl.querySelectorAll(":scope > entry")) {
    const ss = Array.from(entry.querySelectorAll(":scope > string"));
    if (ss.length === 2) result[ss[0].textContent?.trim() ?? ""] = ss[1].textContent ?? "";
  }
  return result;
}

const EMPTY_HANDLER_STATE = {
  regexPatterns: [] as RegexAttachmentPattern[],
  inboundReplacements: [] as ReplacementEntry[],
  outboundReplacements: [] as ReplacementEntry[],
  javaScriptScript: "",
  identityMimeType: "text/plain",
  customClassName: "",
  customProperties: [] as CustomProperty[],
};

/** Parse channel > properties > attachmentProperties into AttachmentHandlerState. */
function parseAttachmentHandler(doc: Document): AttachmentHandlerState {
  const attachEl = doc.querySelector("channel > properties > attachmentProperties");
  const type = (attachEl?.querySelector(":scope > type")?.textContent?.trim() ??
    "None") as AttachmentHandlerType;
  const propsEl = attachEl?.querySelector(":scope > properties") ?? null;

  if (type === "Regex" && propsEl && propsEl.childElementCount > 0) {
    const map = parseLinkedHashMapStrings(propsEl);
    const patterns: RegexAttachmentPattern[] = [];
    // Legacy unnumbered "regex.pattern"/"regex.mimetype" pair. The server still executes
    // it at runtime (RegexAttachmentHandlerProvider.setProperties reads it before the
    // numbered loop), and Java's RegexAttachmentDialog loads it first as row 0. Read it
    // here and prepend it so any Summary save re-emits it as regex.pattern0 (matching
    // Java's own post-dialog behavior) instead of silently dropping it #4).
    if ("regex.pattern" in map) {
      patterns.push({
        pattern: map["regex.pattern"] ?? "",
        mimeType: map["regex.mimetype"] ?? "",
      });
    }
    let i = 0;
    while (`regex.pattern${i}` in map) {
      patterns.push({
        pattern: map[`regex.pattern${i}`] ?? "",
        mimeType: map[`regex.mimetype${i}`] ?? "",
      });
      i++;
    }
    const inbound: ReplacementEntry[] = [];
    let j = 0;
    while (`regex.replaceKey${j}` in map) {
      inbound.push({
        key: map[`regex.replaceKey${j}`] ?? "",
        value: map[`regex.replaceValue${j}`] ?? "",
      });
      j++;
    }
    const outbound: ReplacementEntry[] = [];
    let k = 0;
    while (`outbound.regex.replaceKey${k}` in map) {
      outbound.push({
        key: map[`outbound.regex.replaceKey${k}`] ?? "",
        value: map[`outbound.regex.replaceValue${k}`] ?? "",
      });
      k++;
    }
    return {
      ...EMPTY_HANDLER_STATE,
      type,
      regexPatterns: patterns.length ? patterns : [{ pattern: "", mimeType: "" }],
      inboundReplacements: inbound,
      outboundReplacements: outbound,
    };
  }

  if (type === "JavaScript" && propsEl) {
    const map = parseLinkedHashMapStrings(propsEl);
    return {
      ...EMPTY_HANDLER_STATE,
      type,
      javaScriptScript: map["javascript.script"] ?? "",
    };
  }

  if (type === "Entire Message" && propsEl && propsEl.childElementCount > 0) {
    const map = parseLinkedHashMapStrings(propsEl);
    return {
      ...EMPTY_HANDLER_STATE,
      type,
      identityMimeType: map["identity.mimetype"] ?? "text/plain",
    };
  }

  if (type === "Custom") {
    const className = attachEl?.querySelector(":scope > className")?.textContent ?? "";
    const props: CustomProperty[] = [];
    if (propsEl) {
      for (const entry of propsEl.querySelectorAll(":scope > entry")) {
        const ss = Array.from(entry.querySelectorAll(":scope > string"));
        if (ss.length === 2) {
          props.push({
            name: ss[0].textContent ?? "",
            // Value kept verbatim — see parseLinkedHashMapStrings #23).
            value: ss[1].textContent ?? "",
          });
        }
      }
    }
    return { ...EMPTY_HANDLER_STATE, type, customClassName: className, customProperties: props };
  }

  return { ...EMPTY_HANDLER_STATE, type };
}

/**
 * Write attachment handler state into channel > properties > attachmentProperties.
 * Rebuilds children in XStream field order: className?, type, properties.
 */
function serializeAttachmentHandler(doc: Document, state: AttachmentHandlerState): void {
  const propertiesEl = doc.querySelector("channel > properties");
  if (!propertiesEl) return;

  // Find or create <attachmentProperties> (preserves existing version attribute).
  // A newly created element is stamped with the channel/server version (mirrors
  // Java's MigratableConverter.marshal), not a hardcoded release.
  let attachEl = propertiesEl.querySelector(":scope > attachmentProperties");
  if (!attachEl) {
    attachEl = doc.createElementNS(null, "attachmentProperties");
    attachEl.setAttribute(
      "version",
      resolveXmlVersion(doc.documentElement.getAttribute("version"))
    );
    propertiesEl.appendChild(attachEl);
  }

  // Rebuild all children from scratch in the correct XStream field order
  while (attachEl.firstChild) attachEl.removeChild(attachEl.firstChild);

  // 1. className. Custom uses the user-typed FQN and ALWAYS emits the element,
  //    even when empty — Java's AttachmentHandlerType.getDefaultClassName() returns
  //    "" for CUSTOM and serializes <className></className>. Built-in handlers emit
  //    their fixed class; "None" has no class and is omitted.
  const isCustom = state.type === "Custom";
  const className = isCustom
    ? (state.customClassName ?? "")
    : (ATTACHMENT_HANDLER_CLASS_NAMES[state.type] ?? "");
  if (isCustom || className) {
    const el = doc.createElementNS(null, "className");
    el.textContent = className;
    attachEl.appendChild(el);
  }

  // 2. type
  const typeEl = doc.createElementNS(null, "type");
  typeEl.textContent = state.type;
  attachEl.appendChild(typeEl);

  // 3. properties
  // The <properties> element under <attachmentProperties> is NOT a linked-hash-map.
  // The Java model (AttachmentHandlerProperties.java line 26) declares it as a plain
  // HashMap<String,String>, so XStream serializes it as <properties> WITHOUT a class
  // attribute. Java client exports look like:
  //     <properties>
  //       <entry><string>k</string><string>v</string></entry>
  //     </properties>
  // For byte-equivalent round-trip with Java-created channels, do NOT set
  // class="linked-hash-map" here. (This is in contrast to <resourceIds>, connector
  // <connectionProperties>, <responseHeaders>, etc. which are genuinely LinkedHashMap
  // in their Java models and do carry the class attribute.)
  const propsEl = doc.createElementNS(null, "properties");
  if (state.type === "Regex") {
    for (let i = 0; i < state.regexPatterns.length; i++) {
      appendLinkedHashMapEntry(propsEl, doc, `regex.pattern${i}`, state.regexPatterns[i].pattern);
      appendLinkedHashMapEntry(propsEl, doc, `regex.mimetype${i}`, state.regexPatterns[i].mimeType);
    }
    for (let i = 0; i < (state.inboundReplacements ?? []).length; i++) {
      appendLinkedHashMapEntry(
        propsEl,
        doc,
        `regex.replaceKey${i}`,
        state.inboundReplacements[i].key
      );
      appendLinkedHashMapEntry(
        propsEl,
        doc,
        `regex.replaceValue${i}`,
        state.inboundReplacements[i].value
      );
    }
    for (let i = 0; i < (state.outboundReplacements ?? []).length; i++) {
      appendLinkedHashMapEntry(
        propsEl,
        doc,
        `outbound.regex.replaceKey${i}`,
        state.outboundReplacements[i].key
      );
      appendLinkedHashMapEntry(
        propsEl,
        doc,
        `outbound.regex.replaceValue${i}`,
        state.outboundReplacements[i].value
      );
    }
  } else if (state.type === "JavaScript") {
    appendLinkedHashMapEntry(propsEl, doc, "javascript.script", state.javaScriptScript);
  } else if (state.type === "Entire Message") {
    appendLinkedHashMapEntry(
      propsEl,
      doc,
      "identity.mimetype",
      state.identityMimeType || "text/plain"
    );
  } else if (state.type === "Custom") {
    for (const prop of state.customProperties ?? []) {
      appendLinkedHashMapEntry(propsEl, doc, prop.name, prop.value);
    }
  }
  // None / DICOM → empty self-closing <properties/>
  attachEl.appendChild(propsEl);
}

// ─── Channel ID ───────────────────────────────────────────────────────────────

/** Extract the <id> direct child of <channel> from XML. */
export function parseChannelId(xml: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return doc.querySelector("channel > id")?.textContent?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Extract the <name> direct child of <channel> from XML. */
export function parseChannelName(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return doc.querySelector("channel > name")?.textContent?.trim() ?? "Edit Channel";
  } catch {
    return "Edit Channel";
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function parseSummaryFromXml(xml: string): SummaryState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // ── Pruning settings (channel > exportData > metadata > pruningSettings) ──
  const pruneEl = doc.querySelector("channel > exportData > metadata > pruningSettings");
  const parseOptInt = (el: Element | null, sel: string): number | null => {
    const t = el?.querySelector(sel)?.textContent?.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return isNaN(n) ? null : n;
  };

  // ── Custom metadata columns (channel > properties > metaDataColumns) ───────
  const colEls = doc.querySelectorAll("channel > properties > metaDataColumns > metaDataColumn");

  return {
    name: text(doc, "channel > name", "New Channel"),
    // Verbatim: description whitespace round-trips byte-exact in Java #49).
    // name stays trimmed — no whitespace significance and it is validation-coupled.
    description: textRaw(doc, "channel > description", ""),
    enabled: bool(doc, "channel > exportData > metadata > enabled", true),
    initialState: text(doc, "channel > properties > initialState", "STARTED") as InitialState,
    clearGlobalChannelMap: bool(doc, "channel > properties > clearGlobalChannelMap", true),
    messageStorageMode: text(
      doc,
      "channel > properties > messageStorageMode",
      "DEVELOPMENT"
    ) as MessageStorageMode,
    encryptData: bool(doc, "channel > properties > encryptData", false),
    encryptAttachments: bool(doc, "channel > properties > encryptAttachments", false),
    encryptCustomMetaData: bool(doc, "channel > properties > encryptCustomMetaData", false),
    removeContentOnCompletion: bool(doc, "channel > properties > removeContentOnCompletion", false),
    removeOnlyFilteredOnCompletion: bool(
      doc,
      "channel > properties > removeOnlyFilteredOnCompletion",
      false
    ),
    removeAttachmentsOnCompletion: bool(
      doc,
      "channel > properties > removeAttachmentsOnCompletion",
      false
    ),
    storeAttachments: bool(doc, "channel > properties > storeAttachments", true),

    pruningSettings: {
      pruneMetaDataDays: parseOptInt(pruneEl, "pruneMetaDataDays"),
      pruneContentDays: parseOptInt(pruneEl, "pruneContentDays"),
      // archiveEnabled defaults to true in BridgeLink — absence means true
      archiveEnabled: pruneEl?.querySelector("archiveEnabled")?.textContent?.trim() !== "false",
      pruneErroredMessages:
        pruneEl?.querySelector("pruneErroredMessages")?.textContent?.trim() === "true",
    },

    metaDataColumns: Array.from(colEls).map((col) => ({
      // Column names are uppercased by the server model (MetaDataColumn.setName → toUpperCase);
      // uppercase on parse so imported/lowercase names display and round-trip like Java #42).
      name: (col.querySelector("name")?.textContent?.trim() ?? "").toUpperCase(),
      type: col.querySelector("type")?.textContent?.trim() ?? "STRING",
      mappingName: col.querySelector("mappingName")?.textContent || undefined,
    })),

    attachmentHandler: parseAttachmentHandler(doc),

    revision: parseInt(text(doc, "channel > revision", "0"), 10),
    lastModified: (() => {
      const timeEl = doc.querySelector("channel > exportData > metadata > lastModified > time");
      if (!timeEl?.textContent) return null;
      const ms = parseInt(timeEl.textContent.trim(), 10);
      return isNaN(ms) ? null : new Date(ms).toISOString();
    })(),

    resourceIdCount: doc.querySelectorAll("channel > properties > resourceIds > entry").length,
  };
}

export function serializeSummaryToXml(xml: string, s: SummaryState): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // ── Existing scalar fields ─────────────────────────────────────────────────
  // name/description are nullable Strings XStream may omit — create-if-missing so
  // the edit is never silently dropped #25). `enabled` is written below,
  // after the exportData > metadata chain is ensured (ordering fix, #25).
  setOrCreate(doc, "channel", "name", s.name);
  setOrCreate(doc, "channel", "description", s.description);
  set(doc, "channel > properties > initialState", s.initialState);
  set(doc, "channel > properties > clearGlobalChannelMap", String(s.clearGlobalChannelMap));
  set(doc, "channel > properties > messageStorageMode", s.messageStorageMode);
  set(doc, "channel > properties > encryptData", String(s.encryptData));
  set(doc, "channel > properties > encryptAttachments", String(s.encryptAttachments));
  set(doc, "channel > properties > encryptCustomMetaData", String(s.encryptCustomMetaData));
  set(doc, "channel > properties > removeContentOnCompletion", String(s.removeContentOnCompletion));
  set(
    doc,
    "channel > properties > removeOnlyFilteredOnCompletion",
    String(s.removeOnlyFilteredOnCompletion)
  );
  set(
    doc,
    "channel > properties > removeAttachmentsOnCompletion",
    String(s.removeAttachmentsOnCompletion)
  );
  set(doc, "channel > properties > storeAttachments", String(s.storeAttachments));

  // ── Channel metadata (enabled) + pruning settings ──────────────────────────
  // Chain: channel > exportData > metadata > { enabled, pruningSettings }.
  // Ensure the whole chain unconditionally, then write `enabled` INTO it. This
  // fixes the ordering bug where `enabled` was written before the metadata chain
  // existed: ChannelServlet.addExportData can emit <exportData> without <metadata>,
  // and XStream instantiates ChannelMetadata WITHOUT its no-arg constructor (which
  // is the only place `enabled` defaults to true), so a <metadata> that has
  // <pruningSettings> but no <enabled> deserializes as DISABLED. #25)
  const channelEl = doc.querySelector("channel");
  if (channelEl) {
    const exportDataEl = ensureChild(channelEl, "exportData", doc);
    const metadataEl = ensureChild(exportDataEl, "metadata", doc);
    ensureChild(metadataEl, "enabled", doc).textContent = String(s.enabled);
    const pruneEl = ensureChild(metadataEl, "pruningSettings", doc);

    // Integer fields: omit element entirely when null (XStream reads absent = null)
    setOptInt(pruneEl, "pruneMetaDataDays", doc, s.pruningSettings.pruneMetaDataDays);
    setOptInt(pruneEl, "pruneContentDays", doc, s.pruningSettings.pruneContentDays);

    // Boolean fields: always present
    ensureChild(pruneEl, "archiveEnabled", doc).textContent = String(
      s.pruningSettings.archiveEnabled
    );
    ensureChild(pruneEl, "pruneErroredMessages", doc).textContent = String(
      s.pruningSettings.pruneErroredMessages
    );
  }

  // ── Custom metadata columns ────────────────────────────────────────────────
  // Rebuild the <metaDataColumns> element from scratch on every save.
  const propertiesEl = doc.querySelector("channel > properties");
  if (propertiesEl) {
    const metaColsEl = ensureChild(propertiesEl, "metaDataColumns", doc);
    // Remove all existing <metaDataColumn> children
    Array.from(metaColsEl.querySelectorAll(":scope > metaDataColumn")).forEach((el) => el.remove());
    // Append one element per column in state. Fully-empty (unnamed) rows are dropped —
    // the server can never produce a <name/> column and it breaks at deploy #6);
    // save validation already rejects them, this guards the XML-tab / import paths too.
    for (const col of s.metaDataColumns) {
      if (col.name.trim() === "") continue;
      const colEl = doc.createElementNS(null, "metaDataColumn");
      const nameEl = doc.createElementNS(null, "name");
      // Uppercase to mirror the server model (MetaDataColumn.setName → toUpperCase) #42).
      nameEl.textContent = col.name.toUpperCase();
      colEl.appendChild(nameEl);
      const typeEl = doc.createElementNS(null, "type");
      typeEl.textContent = col.type;
      colEl.appendChild(typeEl);
      if (col.mappingName) {
        const mapEl = doc.createElementNS(null, "mappingName");
        mapEl.textContent = col.mappingName;
        colEl.appendChild(mapEl);
      }
      metaColsEl.appendChild(colEl);
    }
  }

  // ── Attachment handler ─────────────────────────────────────────────────────
  serializeAttachmentHandler(doc, s.attachmentHandler);

  return serialize(doc);
}

// ─── Scripts ──────────────────────────────────────────────────────────────────

export function parseScriptsFromXml(xml: string): ScriptsState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // textContent auto-decodes HTML entities (&quot; → ", &amp; → &, etc.)
  return {
    preprocessing: doc.querySelector("channel > preprocessingScript")?.textContent ?? "",
    postprocessing: doc.querySelector("channel > postprocessingScript")?.textContent ?? "",
    deploy: doc.querySelector("channel > deployScript")?.textContent ?? "",
    undeploy: doc.querySelector("channel > undeployScript")?.textContent ?? "",
  };
}

export function serializeScriptsToXml(xml: string, s: ScriptsState): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // el.textContent = value re-encodes special chars (" → &quot;, etc.).
  // create-if-missing: XStream omits null script Strings, so a channel lacking these
  // elements would otherwise have the edit silently discarded on save #25).
  setOrCreate(doc, "channel", "preprocessingScript", s.preprocessing);
  setOrCreate(doc, "channel", "postprocessingScript", s.postprocessing);
  setOrCreate(doc, "channel", "deployScript", s.deploy);
  setOrCreate(doc, "channel", "undeployScript", s.undeploy);
  return serialize(doc);
}

// ─── Data Types ───────────────────────────────────────────────────────────────

// DATA_TYPE_OPTIONS and DataType are now derived from the plugin registry.
export { DATA_TYPE_OPTIONS } from "../_datatypes/index";
export type { DataType } from "../_datatypes/index";

export interface ConnectorDataTypeRow {
  /** "source" | "dest-0" | "dest-0-response" */
  id: string;
  /** "Source Connector" | destination name | "Response" */
  label: string;
  /** Only present for response rows; value is the parent dest id e.g. "dest-0" */
  parentId?: string;
  inboundDataType: string;
  outboundDataType: string;
  /** Outer XML of the <inboundProperties …> element, null if absent. */
  inboundPropertiesXml: string | null;
  /** Outer XML of the <outboundProperties …> element, null if absent. */
  outboundPropertiesXml: string | null;
}

export interface DataTypesState {
  /** Channel version attribute (the server product version) — stamped when inserting default property XML. */
  version: string;
  connectors: ConnectorDataTypeRow[];
}

// ─── Data type default property XML ──────────────────────────────────────────

/** Serialize an Element to its outer XML string, or null if el is null. */
function elOuterXml(el: Element | null | undefined): string | null {
  if (!el) return null;
  return new XMLSerializer().serializeToString(el);
}

/**
 * Returns default XML for an <inboundProperties> or <outboundProperties> element
 * for the given data type and channel version.
 * Delegates to the DataTypeDefinition plugin in DATA_TYPE_REGISTRY.
 */
export function defaultPropertiesXml(
  type: string,
  tagName: "inboundProperties" | "outboundProperties",
  version: string
): string {
  return DATA_TYPE_REGISTRY.get(type)?.defaultPropertiesXml(tagName, version) ?? `<${tagName}/>`;
}

// ─── Parse data types from channel XML ────────────────────────────────────────

export function parseDataTypesFromXml(xml: string): DataTypesState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const version = resolveXmlVersion(doc.documentElement.getAttribute("version"));
  const connectors: ConnectorDataTypeRow[] = [];

  // Source connector transformer
  const srcTransformer = doc.querySelector("channel > sourceConnector > transformer");
  if (srcTransformer) {
    connectors.push({
      id: "source",
      label: "Source Connector",
      inboundDataType:
        srcTransformer.querySelector(":scope > inboundDataType")?.textContent?.trim() ?? "RAW",
      outboundDataType:
        srcTransformer.querySelector(":scope > outboundDataType")?.textContent?.trim() ?? "RAW",
      inboundPropertiesXml: elOuterXml(srcTransformer.querySelector(":scope > inboundProperties")),
      outboundPropertiesXml: elOuterXml(
        srcTransformer.querySelector(":scope > outboundProperties")
      ),
    });
  }

  // Destination connectors
  doc.querySelectorAll("channel > destinationConnectors > connector").forEach((dest, i) => {
    const destName =
      dest.querySelector(":scope > name")?.textContent?.trim() ?? `Destination ${i + 1}`;
    const transformer = dest.querySelector(":scope > transformer");
    const responseTransformer = dest.querySelector(":scope > responseTransformer");

    connectors.push({
      id: `dest-${i}`,
      label: destName,
      inboundDataType:
        transformer?.querySelector(":scope > inboundDataType")?.textContent?.trim() ?? "RAW",
      outboundDataType:
        transformer?.querySelector(":scope > outboundDataType")?.textContent?.trim() ?? "RAW",
      inboundPropertiesXml: elOuterXml(transformer?.querySelector(":scope > inboundProperties")),
      outboundPropertiesXml: elOuterXml(transformer?.querySelector(":scope > outboundProperties")),
    });

    if (responseTransformer) {
      connectors.push({
        id: `dest-${i}-response`,
        label: "Response",
        parentId: `dest-${i}`,
        inboundDataType:
          responseTransformer.querySelector(":scope > inboundDataType")?.textContent?.trim() ??
          "RAW",
        outboundDataType:
          responseTransformer.querySelector(":scope > outboundDataType")?.textContent?.trim() ??
          "RAW",
        inboundPropertiesXml: elOuterXml(
          responseTransformer.querySelector(":scope > inboundProperties")
        ),
        outboundPropertiesXml: elOuterXml(
          responseTransformer.querySelector(":scope > outboundProperties")
        ),
      });
    }
  });

  return { version, connectors };
}

// ─── Serialize data types back into channel XML ───────────────────────────────

export function serializeDataTypesToXml(xml: string, state: DataTypesState): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const destEls = Array.from(doc.querySelectorAll("channel > destinationConnectors > connector"));

  function applyRow(transformer: Element, row: ConnectorDataTypeRow): void {
    // Update data type text nodes, creating elements if somehow absent
    const getOrCreate = (tag: string): Element => {
      let el = transformer.querySelector(`:scope > ${tag}`);
      if (!el) {
        el = doc.createElementNS(null, tag);
        transformer.appendChild(el);
      }
      return el;
    };
    getOrCreate("inboundDataType").textContent = row.inboundDataType;
    getOrCreate("outboundDataType").textContent = row.outboundDataType;

    // Swap <inboundProperties> element
    const swapProps = (
      tagName: "inboundProperties" | "outboundProperties",
      xmlStr: string | null
    ) => {
      const existing = transformer.querySelector(`:scope > ${tagName}`);
      if (xmlStr) {
        const parsed = new DOMParser().parseFromString(xmlStr, "application/xml");
        const imported = doc.importNode(parsed.documentElement, true);
        // Ensure the tag name matches (XMLSerializer may preserve, but be safe)
        if (existing) {
          transformer.replaceChild(imported, existing);
        } else {
          transformer.appendChild(imported);
        }
      } else {
        existing?.remove();
      }
    };

    swapProps("inboundProperties", row.inboundPropertiesXml);
    swapProps("outboundProperties", row.outboundPropertiesXml);
  }

  for (const row of state.connectors) {
    if (row.id === "source") {
      const t = doc.querySelector("channel > sourceConnector > transformer");
      if (t) applyRow(t, row);
    } else if (row.id.startsWith("dest-")) {
      const parts = row.id.split("-");
      const idx = parseInt(parts[1], 10);
      const dest = destEls[idx];
      if (!dest) continue;
      if (parts[2] === "response") {
        const rt = dest.querySelector(":scope > responseTransformer");
        if (rt) applyRow(rt, row);
      } else {
        const t = dest.querySelector(":scope > transformer");
        if (t) applyRow(t, row);
      }
    }
  }

  return serialize(doc);
}

// ─── Required inbound type enforcement ───────────────────────────────────────

/**
 * Returns a new DataTypesState with the source row's inbound type forced to
 * requiredType. Only touches connectors[0] (the source); destinations are unchanged.
 */
export function applyRequiredSourceInboundType(
  state: DataTypesState,
  requiredType: string
): DataTypesState {
  return {
    ...state,
    connectors: state.connectors.map((c, i) =>
      i === 0
        ? {
            ...c,
            inboundDataType: requiredType,
            inboundPropertiesXml: defaultPropertiesXml(
              requiredType,
              "inboundProperties",
              state.version
            ),
          }
        : c
    ),
  };
}

// ─── Source connector state ────────────────────────────────────────────────────

/** All known source connector transport names, in display order. */
/**
 * Canonical built-in source connector transport names, in dropdown order. The
 * Connector Type dropdown is registry-driven via
 * `visibleSourceConnectorTypes`, so this is the built-in half — CONNECTOR_REGISTRY
 * is kept in this same order and an order-lock unit test enforces the match.
 */
export const SOURCE_CONNECTOR_TYPES = [
  "Channel Reader",
  "Database Reader",
  "DICOM Listener",
  "File Reader",
  "HTTP Listener",
  "JavaScript Reader",
  "JMS Listener",
  "TCP Listener",
  "WebService Listener",
] as const;

export type SourceConnectorType = (typeof SOURCE_CONNECTOR_TYPES)[number];

export interface SourceConnectorState {
  /** e.g. "Channel Reader", "TCP Listener" */
  transportName: string;
  /** true = queue OFF (respond after processing); false = queue ON */
  respondAfterProcessing: boolean;
  /** queue capacity; only active when respondAfterProcessing = false */
  queueBufferSize: number;
  /** "None" or a destination connector name */
  responseVariable: string;
  processBatch: boolean;
  /** true = First, false = Last; only active when processBatch = true */
  firstResponse: boolean;
  processingThreads: number;
  /**
   * Full outer XML of the <properties> element (connector-specific).
   * Preserved verbatim during edits to common settings; replaced when the
   * connector type is changed (future work, per-connector-type implementation).
   */
  propertiesXml: string | null;
  /** Outer XML of <filter> — edited in Filter tab. */
  filterXml: string | null;
  /** Outer XML of <transformer> — edited in Transformer tab. */
  transformerXml: string | null;
}

/** The shared source-connector settings that live in `<sourceConnectorProperties>`. */
export type SharedSourceSettings = Pick<
  SourceConnectorState,
  | "respondAfterProcessing"
  | "queueBufferSize"
  | "responseVariable"
  | "processBatch"
  | "firstResponse"
  | "processingThreads"
>;

/**
 * Parse the shared source settings out of a `<sourceConnectorProperties>` element, applying the same
 * defaults/clamps used elsewhere: queue buffer size <= 0 falls back to the channel default, and
 * processingThreads <= 0 clamps to 1 (Java's SourceSettingsPanel.checkProperties blocks either).
 */
function parseSharedSourceSettingsEl(scp: Element | null | undefined): SharedSourceSettings {
  const t = (tag: string, def: string): string =>
    scp?.querySelector(tag)?.textContent?.trim() ?? def;
  const b = (tag: string, def: boolean): boolean => {
    const v = scp?.querySelector(tag)?.textContent?.trim();
    return v === undefined ? def : v === "true";
  };
  const n = (tag: string, def: number): number => {
    const v = scp?.querySelector(tag)?.textContent?.trim();
    const parsed = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(parsed) ? def : parsed;
  };
  const bufferSize = n("queueBufferSize", resolveDefaultQueueBufferSize());
  const threads = n("processingThreads", 1);
  return {
    respondAfterProcessing: b("respondAfterProcessing", true),
    queueBufferSize: bufferSize > 0 ? bufferSize : resolveDefaultQueueBufferSize(),
    responseVariable: t("responseVariable", "None"),
    processBatch: b("processBatch", false),
    firstResponse: b("firstResponse", false),
    processingThreads: threads > 0 ? threads : 1,
  };
}

/**
 * Parse the shared source settings from a source connector `<properties>` XML fragment (e.g. a
 * connector type's `defaultPropertiesXml`). Used to reset these fields when the source connector
 * type changes, mirroring Java's `ChannelSetup.changeConnectorType` →
 * `sourceConnectorPanel.getDefaults()`/`setProperties()` (e.g. TCP Listener → responseVariable
 * "Auto-generate (After source transformer)", firstResponse true).
 */
export function parseSharedSourceSettings(propertiesXml: string): SharedSourceSettings {
  const scp = new DOMParser()
    .parseFromString(propertiesXml, "application/xml")
    .querySelector("sourceConnectorProperties");
  return parseSharedSourceSettingsEl(scp);
}

export function parseSourceConnectorFromXml(xml: string): SourceConnectorState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const src = doc.querySelector("channel > sourceConnector");
  const scp = src?.querySelector("sourceConnectorProperties");

  return {
    transportName: src?.querySelector("transportName")?.textContent?.trim() ?? "Channel Reader",
    ...parseSharedSourceSettingsEl(scp),
    propertiesXml: elOuterXml(src?.querySelector(":scope > properties")),
    filterXml: elOuterXml(src?.querySelector(":scope > filter")),
    transformerXml: elOuterXml(src?.querySelector(":scope > transformer")),
  };
}

export function serializeSourceConnectorToXml(xml: string, s: SourceConnectorState): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const src = doc.querySelector("channel > sourceConnector");
  if (!src) return xml;

  // Update <transportName>
  ensureChild(src, "transportName", doc).textContent = s.transportName;

  // Common sourceConnectorProperties fields to write
  const commonFields: [string, string][] = [
    ["responseVariable", s.responseVariable],
    ["respondAfterProcessing", String(s.respondAfterProcessing)],
    ["processBatch", String(s.processBatch)],
    ["firstResponse", String(s.firstResponse)],
    ["processingThreads", String(s.processingThreads)],
    ["queueBufferSize", String(s.queueBufferSize)],
  ];

  if (s.propertiesXml) {
    // Parse propertiesXml, refresh common settings inside it, then replace the
    // entire <properties> element in the channel XML with the updated blob.
    const propsDoc = new DOMParser().parseFromString(s.propertiesXml, "application/xml");
    const propsRoot = propsDoc.documentElement;
    let scp = propsRoot.querySelector(":scope > sourceConnectorProperties");
    if (!scp) {
      scp = propsDoc.createElementNS(null, "sourceConnectorProperties");
      propsRoot.appendChild(scp);
    }
    for (const [tag, val] of commonFields) {
      ensureChild(scp, tag, propsDoc).textContent = val;
    }
    const newPropsEl = doc.importNode(propsDoc.documentElement, true);
    const oldPropsEl = src.querySelector(":scope > properties");
    if (oldPropsEl) src.replaceChild(newPropsEl, oldPropsEl);
    else src.appendChild(newPropsEl);
  } else {
    // Fallback: update sourceConnectorProperties directly in the channel XML.
    const propsEl = src.querySelector(":scope > properties");
    if (propsEl) {
      let scp = propsEl.querySelector(":scope > sourceConnectorProperties");
      if (!scp) {
        scp = doc.createElementNS(null, "sourceConnectorProperties");
        propsEl.appendChild(scp);
      }
      for (const [tag, val] of commonFields) {
        ensureChild(scp, tag, doc).textContent = val;
      }
    }
  }

  // Update <filter> if provided
  if (s.filterXml != null) {
    const parsed = new DOMParser().parseFromString(s.filterXml, "application/xml");
    const imported = doc.importNode(parsed.documentElement, true);
    const old = src.querySelector(":scope > filter");
    if (old) src.replaceChild(imported, old);
    else src.appendChild(imported);
  }

  // Update <transformer> if provided
  if (s.transformerXml != null) {
    const parsed = new DOMParser().parseFromString(s.transformerXml, "application/xml");
    const imported = doc.importNode(parsed.documentElement, true);
    const old = src.querySelector(":scope > transformer");
    if (old) src.replaceChild(imported, old);
    else src.appendChild(imported);
  }

  return serialize(doc);
}

/**
 * Returns the names of all enabled destination connectors in the channel XML,
 * in document order. Used to populate the Response variable dropdown.
 */
export function parseDestinationNamesFromXml(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const dests = doc.querySelectorAll("channel > destinationConnectors > connector");
  const names: string[] = [];
  for (const dest of dests) {
    const enabled = dest.querySelector(":scope > enabled")?.textContent?.trim();
    if (enabled === "false") continue;
    const name = dest.querySelector(":scope > name")?.textContent?.trim();
    if (name) names.push(name);
  }
  return names;
}

// ─── Poll Connector Properties ────────────────────────────────────────────────

export type PollingType = "INTERVAL" | "TIME" | "CRON";

/** A single Quartz cron job entry stored inside `<cronJobs>`. */
export interface CronJob {
  // Quartz cron expression (6-7 fields). Example: every 5 s = "*/5 * * * * ?"
  expression: string;
  // Human-readable description stored alongside the expression in the XML.
  description: string;
}

/**
 * Advanced day/time restriction settings for polling connectors.
 * Mirrors Java's `PollConnectorPropertiesAdvanced`.
 *
 * `inactiveDays` is INVERTED: `false` = active, `true` = inactive.
 *
 * This internal array is 0-based — index 0=Sun … 6=Sat (matches JS `Date.getDay()`).
 * The server's XML/Quartz form is Calendar-indexed instead (`<boolean>` position
 * 1=Sun … 7=Sat, position 0 unused), because the server feeds the array straight into
 * Quartz `WeeklyCalendar.setDaysExcluded`, which indexes by `java.util.Calendar` day
 * constants (SUNDAY=1 … SATURDAY=7). The +1 translation happens at the
 * `parsePollConnectorFromPropertiesXml` / `updatePollConnectorInPropertiesXml` boundary
 * below, so the emitted XML is byte-identical to the Java client's.
 */
export interface AdvancedPollingSettings {
  weekly: boolean;
  inactiveDays: boolean[]; // length 7+; index 0=Sun…6=Sat; true=inactive
  dayOfMonth: number; // 1–31, used only when weekly=false
  allDay: boolean;
  startingHour: number; // 0–23, used only when allDay=false
  startingMinute: number; // 0–59
  endingHour: number; // 0–23
  endingMinute: number; // 0–59
}

export const DEFAULT_ADVANCED_POLLING: AdvancedPollingSettings = {
  weekly: true,
  inactiveDays: [false, false, false, false, false, false, false],
  dayOfMonth: 1,
  allDay: true,
  startingHour: 8,
  startingMinute: 0,
  endingHour: 17,
  endingMinute: 0,
};

export interface PollConnectorState {
  pollingType: PollingType;
  pollOnStart: boolean;
  /** Polling interval in milliseconds. Used when pollingType === "INTERVAL". */
  pollingFrequency: number;
  /** Hour of day 0-23. Used when pollingType === "TIME". */
  pollingHour: number;
  /** Minute of hour 0-59. Used when pollingType === "TIME". */
  pollingMinute: number;
  /** Quartz cron schedules. Used when pollingType === "CRON". */
  cronJobs: CronJob[];
  /** Advanced day/time restrictions. Always present; defaults mean "no restrictions". */
  advanced: AdvancedPollingSettings;
}

const DEFAULT_POLL_STATE: PollConnectorState = {
  pollingType: "INTERVAL",
  pollOnStart: false,
  pollingFrequency: 5000,
  pollingHour: 0,
  pollingMinute: 0,
  cronJobs: [],
  advanced: { ...DEFAULT_ADVANCED_POLLING },
};

/**
 * Parses poll connector properties from a connector's `propertiesXml` blob
 * (the outer `<properties>` element XML stored in SourceConnectorState).
 */
export function parsePollConnectorFromPropertiesXml(
  propertiesXml: string | null
): PollConnectorState {
  if (!propertiesXml) return { ...DEFAULT_POLL_STATE };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const pcp = doc.querySelector("pollConnectorProperties");
  if (!pcp) return { ...DEFAULT_POLL_STATE };

  function t(tag: string, def: string): string {
    return pcp!.querySelector(tag)?.textContent?.trim() ?? def;
  }
  function b(tag: string, def: boolean): boolean {
    const v = pcp!.querySelector(tag)?.textContent?.trim();
    return v === undefined ? def : v === "true";
  }
  function n(tag: string, def: number): number {
    const v = pcp!.querySelector(tag)?.textContent?.trim();
    const p = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(p) ? def : p;
  }

  const pt = t("pollingType", "INTERVAL");

  // Parse <cronJobs><cronProperty>…</cronProperty></cronJobs>
  const cronJobs: CronJob[] = [];
  const cronJobsEl = pcp.querySelector(":scope > cronJobs");
  if (cronJobsEl) {
    for (const cp of Array.from(cronJobsEl.querySelectorAll(":scope > cronProperty"))) {
      cronJobs.push({
        expression: cp.querySelector("expression")?.textContent ?? "",
        description: cp.querySelector("description")?.textContent ?? "",
      });
    }
  }

  // Parse <pollConnectorPropertiesAdvanced>
  const adv = pcp.querySelector(":scope > pollConnectorPropertiesAdvanced");
  let advanced: AdvancedPollingSettings;
  if (adv) {
    function ab(tag: string, def: boolean): boolean {
      const v = adv!.querySelector(tag)?.textContent?.trim();
      return v === undefined ? def : v === "true";
    }
    function an(tag: string, def: number): number {
      const v = adv!.querySelector(tag)?.textContent?.trim();
      const p = v !== undefined ? parseInt(v, 10) : NaN;
      return isNaN(p) ? def : p;
    }
    // <inactiveDays> contains 8 Calendar-indexed <boolean> children: position 0 is the
    // unused reserved slot, positions 1–7 are Sun–Sat. Shift down by one into our 0-based
    // internal array (index 0=Sun … 6=Sat).
    const inactiveDaysEl = adv.querySelector(":scope > inactiveDays");
    const rawBools = inactiveDaysEl
      ? Array.from(inactiveDaysEl.querySelectorAll(":scope > boolean")).map(
          (el) => el.textContent?.trim() === "true"
        )
      : [];
    const inactiveDays: boolean[] = Array.from({ length: 7 }, (_, i) => rawBools[i + 1] ?? false);
    advanced = {
      weekly: ab("weekly", true),
      inactiveDays,
      dayOfMonth: an("dayOfMonth", 1),
      allDay: ab("allDay", true),
      startingHour: an("startingHour", 8),
      startingMinute: an("startingMinute", 0),
      endingHour: an("endingHour", 17),
      endingMinute: an("endingMinute", 0),
    };
  } else {
    advanced = { ...DEFAULT_ADVANCED_POLLING };
  }

  return {
    pollingType:
      pt === "INTERVAL" || pt === "TIME" || pt === "CRON" ? (pt as PollingType) : "INTERVAL",
    pollOnStart: b("pollOnStart", false),
    pollingFrequency: n("pollingFrequency", 5000),
    pollingHour: n("pollingHour", 0),
    pollingMinute: n("pollingMinute", 0),
    cronJobs,
    advanced,
  };
}

/**
 * Writes updated poll connector state back into the propertiesXml blob.
 * Returns the updated propertiesXml string.
 */
export function updatePollConnectorInPropertiesXml(
  propertiesXml: string,
  s: PollConnectorState
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const pcp = doc.querySelector("pollConnectorProperties");
  if (!pcp) return propertiesXml;

  ensureChild(pcp, "pollingType", doc).textContent = s.pollingType;
  ensureChild(pcp, "pollOnStart", doc).textContent = String(s.pollOnStart);
  ensureChild(pcp, "pollingFrequency", doc).textContent = String(s.pollingFrequency);
  ensureChild(pcp, "pollingHour", doc).textContent = String(s.pollingHour);
  ensureChild(pcp, "pollingMinute", doc).textContent = String(s.pollingMinute);

  // Rebuild <cronJobs> from scratch to reflect the current list
  let cronJobsEl = pcp.querySelector(":scope > cronJobs");
  if (!cronJobsEl) {
    cronJobsEl = doc.createElementNS(null, "cronJobs");
    const advancedEl = pcp.querySelector(":scope > pollConnectorPropertiesAdvanced");
    if (advancedEl) pcp.insertBefore(cronJobsEl, advancedEl);
    else pcp.appendChild(cronJobsEl);
  }
  while (cronJobsEl.firstChild) cronJobsEl.removeChild(cronJobsEl.firstChild);
  for (const job of s.cronJobs) {
    const cp = doc.createElementNS(null, "cronProperty");
    const desc = doc.createElementNS(null, "description");
    desc.textContent = job.description;
    const expr = doc.createElementNS(null, "expression");
    expr.textContent = job.expression;
    cp.appendChild(desc);
    cp.appendChild(expr);
    cronJobsEl.appendChild(cp);
  }

  // Rebuild <pollConnectorPropertiesAdvanced> from scratch (always write all fields)
  let advEl = pcp.querySelector(":scope > pollConnectorPropertiesAdvanced");
  if (!advEl) {
    advEl = doc.createElementNS(null, "pollConnectorPropertiesAdvanced");
    pcp.appendChild(advEl);
  }
  while (advEl.firstChild) advEl.removeChild(advEl.firstChild);

  function setChild(parent: Element, tag: string, value: string) {
    const el = doc.createElementNS(null, tag);
    el.textContent = value;
    parent.appendChild(el);
  }

  const adv = s.advanced;
  setChild(advEl, "weekly", String(adv.weekly));

  const inactiveDaysEl = doc.createElementNS(null, "inactiveDays");
  // Emit 8 Calendar-indexed <boolean> children to match the Java/Quartz form: position 0
  // is the unused reserved slot (always false), positions 1–7 carry our 0-based internal
  // days (index 0=Sun … 6=Sat). This makes the XML byte-identical to the Java client's.
  setChild(inactiveDaysEl, "boolean", "false");
  for (let i = 0; i < 7; i++) {
    setChild(inactiveDaysEl, "boolean", String(adv.inactiveDays[i] ?? false));
  }
  advEl.appendChild(inactiveDaysEl);

  setChild(advEl, "dayOfMonth", String(adv.dayOfMonth));
  setChild(advEl, "allDay", String(adv.allDay));
  setChild(advEl, "startingHour", String(adv.startingHour));
  setChild(advEl, "startingMinute", String(adv.startingMinute));
  setChild(advEl, "endingHour", String(adv.endingHour));
  setChild(advEl, "endingMinute", String(adv.endingMinute));

  return serialize(doc);
}

/** Parses the `<script>` text from a connector's propertiesXml blob. */
export function parseScriptFromPropertiesXml(propertiesXml: string | null): string {
  if (!propertiesXml) return "";
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  return doc.documentElement?.querySelector(":scope > script")?.textContent ?? "";
}

/** Replaces the `<script>` text in a connector's propertiesXml blob. */
export function updateScriptInPropertiesXml(propertiesXml: string, script: string): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  ensureChild(doc.documentElement, "script", doc).textContent = script;
  return serialize(doc);
}

// ─── Database Reader Properties ───────────────────────────────────────────────

/**
 * Parsed state for a Database Reader connector's `<properties>` XML blob.
 *
 * updateMode values (from DatabaseReceiverProperties.java):
 *   1 = UPDATE_NEVER  → "Never"
 *   2 = UPDATE_ONCE   → "Once after all messages"
 *   3 = UPDATE_EACH   → "After each message"
 *
 * encoding "DEFAULT_ENCODING" maps to the server's platform default charset.
 * When useScript = true, the select/update fields contain JavaScript instead of SQL.
 */
export interface DatabaseReaderProps {
  driver: string; // JDBC driver class name or "Please Select One"
  url: string; // JDBC connection URL
  username: string;
  password: string;
  select: string; // SELECT query (or JavaScript when useScript=true)
  update: string; // Post-process UPDATE query (or JavaScript)
  useScript: boolean; // true → Monaco language = "javascript"; false → "sql"
  aggregateResults: boolean;
  cacheResults: boolean;
  keepConnectionOpen: boolean;
  updateMode: number; // 1=never, 2=once after all, 3=after each
  retryCount: string; // stored as string in XML (default "3")
  retryInterval: string; // ms, stored as string (default "10000")
  fetchSize: string; // stored as string (default "1000")
  encoding: string; // "DEFAULT_ENCODING" or a standard charset name
}

const DEFAULT_DB_READER_PROPS: DatabaseReaderProps = {
  driver: "Please Select One",
  url: "",
  username: "",
  password: "",
  select: "",
  update: "",
  useScript: false,
  aggregateResults: false,
  cacheResults: true,
  keepConnectionOpen: true,
  updateMode: 1,
  retryCount: "3",
  retryInterval: "10000",
  fetchSize: "1000",
  encoding: "DEFAULT_ENCODING",
};

export function parseDatabaseReaderPropsFromXml(propertiesXml: string | null): DatabaseReaderProps {
  if (!propertiesXml) return { ...DEFAULT_DB_READER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  function t(tag: string, def: string): string {
    return root.querySelector(tag)?.textContent ?? def;
  }
  function b(tag: string, def: boolean): boolean {
    const v = root.querySelector(tag)?.textContent?.trim();
    return v === undefined ? def : v === "true";
  }
  function n(tag: string, def: number): number {
    const v = root.querySelector(tag)?.textContent?.trim();
    const p = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(p) ? def : p;
  }

  return {
    driver: t("driver", "Please Select One"),
    url: t("url", ""),
    username: t("username", ""),
    password: t("password", ""),
    select: t("select", ""),
    update: t("update", ""),
    useScript: b("useScript", false),
    aggregateResults: b("aggregateResults", false),
    cacheResults: b("cacheResults", true),
    keepConnectionOpen: b("keepConnectionOpen", true),
    updateMode: n("updateMode", 1),
    retryCount: t("retryCount", "3"),
    retryInterval: t("retryInterval", "10000"),
    fetchSize: t("fetchSize", "1000"),
    encoding: t("encoding", "DEFAULT_ENCODING"),
  };
}

export function updateDatabaseReaderPropsInXml(
  propertiesXml: string,
  p: DatabaseReaderProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  const fields: [string, string][] = [
    ["driver", p.driver],
    ["url", p.url],
    ["username", p.username],
    ["password", p.password],
    ["select", p.select],
    ["update", p.update],
    ["useScript", String(p.useScript)],
    ["aggregateResults", String(p.aggregateResults)],
    ["cacheResults", String(p.cacheResults)],
    ["keepConnectionOpen", String(p.keepConnectionOpen)],
    ["updateMode", String(p.updateMode)],
    ["retryCount", p.retryCount],
    ["retryInterval", p.retryInterval],
    ["fetchSize", p.fetchSize],
    ["encoding", p.encoding],
  ];

  for (const [tag, val] of fields) {
    ensureChild(root, tag, doc).textContent = val;
  }

  return serialize(doc);
}

/** Shared poll connector XML fragment reused in all polling connector defaults. */
const POLL_PROPS_XML = `<pollConnectorProperties version="{{VERSION}}"><pollingType>INTERVAL</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>5000</pollingFrequency><pollingHour>0</pollingHour><pollingMinute>0</pollingMinute><cronJobs/><pollConnectorPropertiesAdvanced version="{{VERSION}}"><weekly>true</weekly><inactiveDays><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean></inactiveDays><dayOfMonth>1</dayOfMonth><allDay>true</allDay><startingHour>8</startingHour><startingMinute>0</startingMinute><endingHour>17</endingHour><endingMinute>0</endingMinute></pollConnectorPropertiesAdvanced></pollConnectorProperties>`;

/** Shared source connector properties XML fragment reused in connector defaults. */
const SRC_PROPS_XML = `<sourceConnectorProperties version="{{VERSION}}"><responseVariable>None</responseVariable><respondAfterProcessing>true</respondAfterProcessing><processBatch>false</processBatch><firstResponse>false</firstResponse><processingThreads>1</processingThreads><resourceIds class="linked-hash-map"><entry><string>Default Resource</string><string>[Default Resource]</string></entry></resourceIds><queueBufferSize>1000</queueBufferSize></sourceConnectorProperties>`;

/**
 * TCP Listener-specific source connector properties: overrides the shared defaults to use
 * Auto-generate response (MLLP requires the source to generate an ACK after the transformer).
 * All other source connectors keep the shared `None`/`false` defaults.
 */
const TCP_LISTENER_SRC_PROPS_XML = SRC_PROPS_XML.replace(
  "<responseVariable>None</responseVariable>",
  "<responseVariable>Auto-generate (After source transformer)</responseVariable>"
).replace("<firstResponse>false</firstResponse>", "<firstResponse>true</firstResponse>");

/** Default `<properties>` XML blob for a newly-created Database Reader connector. */
export const DEFAULT_DB_READER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties" version="{{VERSION}}"><pluginProperties/>${POLL_PROPS_XML}${SRC_PROPS_XML}<driver>Please Select One</driver><url></url><username></username><password></password><select></select><update></update><useScript>false</useScript><aggregateResults>false</aggregateResults><cacheResults>true</cacheResults><keepConnectionOpen>true</keepConnectionOpen><updateMode>1</updateMode><retryCount>3</retryCount><retryInterval>10000</retryInterval><fetchSize>1000</fetchSize><encoding>DEFAULT_ENCODING</encoding></properties>`;

/** Default `<properties>` XML blob for a newly-created JavaScript Reader connector. */
export const DEFAULT_JS_READER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties" version="{{VERSION}}"><pluginProperties/>${POLL_PROPS_XML}${SRC_PROPS_XML}<script></script></properties>`;

/** Default `<properties>` XML blob for a Channel Reader (VmReceiver) connector.
 *  Required so that switching FROM another source type (e.g. HTTP Listener) replaces
 *  the stale properties blob with a clean VmReceiverProperties structure. */
export const DEFAULT_CHANNEL_READER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="{{VERSION}}"><pluginProperties/>${SRC_PROPS_XML}</properties>`;

// ─── DICOM Listener properties ────────────────────────────────────────────────

export interface DICOMListenerProps {
  // Listener binding
  host: string; // listenerConnectorProperties.host
  port: string; // listenerConnectorProperties.port
  // Application Entity
  applicationEntity: string;
  localApplicationEntity: string;
  // Outbound (used for storage commitment / response SCUs)
  localHost: string;
  localPort: string;
  // Destination directory for received files (empty = keep in memory)
  dest: string;
  // Timing
  soCloseDelay: string; // ms
  releaseTo: string; // s
  requestTo: string; // s
  idleTo: string; // s
  reaper: string; // s — association reaper period
  rspDelay: string; // ms
  // PDU / Transfer
  pdv1: boolean;
  sndpdulen: string; // KB
  rcvpdulen: string; // KB
  async: string; // max async operations (0 = synchronous)
  bufSize: string; // KB
  // Data format
  bigEndian: boolean;
  defts: boolean; // default transfer syntax only
  nativeData: boolean;
  // Network
  tcpDelay: boolean; // true = TCP_NODELAY (no Nagle)
  sorcvbuf: string; // bytes, 0 = OS default
  sosndbuf: string; // bytes, 0 = OS default
  // TLS
  tls: string; // "notls" | "without" | "3des" | "aes"
  keyStore: string;
  keyStorePW: string;
  keyPW: string;
  trustStore: string;
  trustStorePW: string;
  noClientAuth: boolean;
  nossl2: boolean;
}

const DICOM_DEFAULTS: DICOMListenerProps = {
  host: "0.0.0.0",
  port: "104",
  applicationEntity: "",
  localApplicationEntity: "",
  localHost: "",
  localPort: "",
  dest: "",
  soCloseDelay: "50",
  releaseTo: "5",
  requestTo: "5",
  idleTo: "60",
  reaper: "10",
  rspDelay: "0",
  pdv1: false,
  sndpdulen: "16",
  rcvpdulen: "16",
  async: "0",
  bufSize: "1",
  bigEndian: false,
  defts: false,
  nativeData: false,
  tcpDelay: true,
  sorcvbuf: "0",
  sosndbuf: "0",
  tls: "notls",
  keyStore: "",
  keyStorePW: "",
  keyPW: "",
  trustStore: "",
  trustStorePW: "",
  noClientAuth: true,
  nossl2: true,
};

export function parseDICOMListenerPropsFromXml(propertiesXml: string | null): DICOMListenerProps {
  if (!propertiesXml) return { ...DICOM_DEFAULTS };
  try {
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const root = doc.documentElement;
    const str = (sel: string, def: string) => root.querySelector(sel)?.textContent ?? def;
    const bool = (sel: string, def: boolean) => {
      const v = root.querySelector(sel)?.textContent?.trim();
      return v === null || v === undefined ? def : v === "true";
    };
    // Normalize the mutually-exclusive transfer-syntax flags on load, mirroring Java
    // DICOMListener.setProperties, which applies the three radio cascades in order
    // bigEndian → defts → nativeData (each re-reads the raw stored value and fires its
    // *ActionPerformed handler). The net persisted resolution is:
    //   - nativeData is applied last and wins over defts (nativeYesActionPerformed forces defts off),
    //   - defts wins over bigEndian (deftsYesActionPerformed forces bigEndian off).
    // Expressed as a closed form over the raw values (verified against all 8 combinations).
    // Without this, hand-edited or imported XML with a contradictory combination renders radio
    // rows disabled (a deadlock the UI cannot resolve) and persists the contradiction on save.
    // (bigEndian && nativeData with defts=false is a legal, non-deadlocked combination Java keeps.)
    const rawBigEndian = bool("bigEndian", DICOM_DEFAULTS.bigEndian);
    const rawDefts = bool("defts", DICOM_DEFAULTS.defts);
    const rawNativeData = bool("nativeData", DICOM_DEFAULTS.nativeData);
    const nativeData = rawNativeData;
    const defts = rawDefts && !rawNativeData;
    const bigEndian = rawBigEndian && !rawDefts;
    return {
      host: str("listenerConnectorProperties > host", DICOM_DEFAULTS.host),
      port: str("listenerConnectorProperties > port", DICOM_DEFAULTS.port),
      applicationEntity: str("applicationEntity", DICOM_DEFAULTS.applicationEntity),
      localApplicationEntity: str("localApplicationEntity", DICOM_DEFAULTS.localApplicationEntity),
      localHost: str("localHost", DICOM_DEFAULTS.localHost),
      localPort: str("localPort", DICOM_DEFAULTS.localPort),
      dest: str("dest", DICOM_DEFAULTS.dest),
      soCloseDelay: str("soCloseDelay", DICOM_DEFAULTS.soCloseDelay),
      releaseTo: str("releaseTo", DICOM_DEFAULTS.releaseTo),
      requestTo: str("requestTo", DICOM_DEFAULTS.requestTo),
      idleTo: str("idleTo", DICOM_DEFAULTS.idleTo),
      reaper: str("reaper", DICOM_DEFAULTS.reaper),
      rspDelay: str("rspDelay", DICOM_DEFAULTS.rspDelay),
      pdv1: bool("pdv1", DICOM_DEFAULTS.pdv1),
      sndpdulen: str("sndpdulen", DICOM_DEFAULTS.sndpdulen),
      rcvpdulen: str("rcvpdulen", DICOM_DEFAULTS.rcvpdulen),
      async: str("async", DICOM_DEFAULTS.async),
      bufSize: str("bufSize", DICOM_DEFAULTS.bufSize),
      bigEndian,
      defts,
      nativeData,
      tcpDelay: bool("tcpDelay", DICOM_DEFAULTS.tcpDelay),
      sorcvbuf: str("sorcvbuf", DICOM_DEFAULTS.sorcvbuf),
      sosndbuf: str("sosndbuf", DICOM_DEFAULTS.sosndbuf),
      tls: str("tls", DICOM_DEFAULTS.tls),
      keyStore: str("keyStore", DICOM_DEFAULTS.keyStore),
      keyStorePW: str("keyStorePW", DICOM_DEFAULTS.keyStorePW),
      keyPW: str("keyPW", DICOM_DEFAULTS.keyPW),
      trustStore: str("trustStore", DICOM_DEFAULTS.trustStore),
      trustStorePW: str("trustStorePW", DICOM_DEFAULTS.trustStorePW),
      noClientAuth: bool("noClientAuth", DICOM_DEFAULTS.noClientAuth),
      nossl2: bool("nossl2", DICOM_DEFAULTS.nossl2),
    };
  } catch {
    return { ...DICOM_DEFAULTS };
  }
}

export function updateDICOMListenerPropsInXml(
  propertiesXml: string,
  p: DICOMListenerProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  // Nested listenerConnectorProperties (host + port)
  const lcp = ensureChild(root, "listenerConnectorProperties", doc);
  ensureChild(lcp, "host", doc).textContent = p.host;
  ensureChild(lcp, "port", doc).textContent = p.port;

  // All flat DICOM fields
  const fields: [string, string][] = [
    ["applicationEntity", p.applicationEntity],
    ["localApplicationEntity", p.localApplicationEntity],
    ["localHost", p.localHost],
    ["localPort", p.localPort],
    ["dest", p.dest],
    ["soCloseDelay", p.soCloseDelay],
    ["releaseTo", p.releaseTo],
    ["requestTo", p.requestTo],
    ["idleTo", p.idleTo],
    ["reaper", p.reaper],
    ["rspDelay", p.rspDelay],
    ["pdv1", String(p.pdv1)],
    ["sndpdulen", p.sndpdulen],
    ["rcvpdulen", p.rcvpdulen],
    ["async", p.async],
    ["bufSize", p.bufSize],
    ["bigEndian", String(p.bigEndian)],
    ["defts", String(p.defts)],
    ["nativeData", String(p.nativeData)],
    ["tcpDelay", String(p.tcpDelay)],
    ["sorcvbuf", p.sorcvbuf],
    ["sosndbuf", p.sosndbuf],
    ["tls", p.tls],
    ["keyStore", p.keyStore],
    ["keyStorePW", p.keyStorePW],
    ["keyPW", p.keyPW],
    ["trustStore", p.trustStore],
    ["trustStorePW", p.trustStorePW],
    ["noClientAuth", String(p.noClientAuth)],
    ["nossl2", String(p.nossl2)],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  return serialize(doc);
}

/** Default `<properties>` XML for a newly-created DICOM Listener connector. */
export const DEFAULT_DICOM_LISTENER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.dimse.DICOMReceiverProperties" version="{{VERSION}}"><pluginProperties/><listenerConnectorProperties version="{{VERSION}}"><host>0.0.0.0</host><port>104</port></listenerConnectorProperties>${SRC_PROPS_XML}<applicationEntity></applicationEntity><localHost></localHost><localPort></localPort><localApplicationEntity></localApplicationEntity><soCloseDelay>50</soCloseDelay><releaseTo>5</releaseTo><requestTo>5</requestTo><idleTo>60</idleTo><reaper>10</reaper><rspDelay>0</rspDelay><pdv1>false</pdv1><sndpdulen>16</sndpdulen><rcvpdulen>16</rcvpdulen><async>0</async><bufSize>1</bufSize><bigEndian>false</bigEndian><defts>false</defts><nativeData>false</nativeData><dest></dest><sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><tcpDelay>true</tcpDelay><keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW><noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>notls</tls><trustStore></trustStore><trustStorePW></trustStorePW></properties>`;

// ─── File Reader properties ───────────────────────────────────────────────────
//
// FileReceiverProperties uses a polymorphic <schemeProperties> child element
// whose XStream class attribute selects the scheme-specific class:
//
//   FILE    — no <schemeProperties> element (null)
//   FTP     — com.mirth.connect.connectors.file.FTPSchemeProperties
//   SFTP    — com.mirth.connect.connectors.file.SftpSchemeProperties
//   S3      — com.mirth.connect.connectors.file.S3SchemeProperties
//   SMB     — com.mirth.connect.connectors.file.SmbSchemeProperties
//   WEBDAV  — no <schemeProperties> element (null)
//
// The <scheme> element stores the FileScheme enum's Java name() (what XStream serializes):
// "FILE", "FTP", "SFTP", "S3", "SMB", "WEBDAV". We serialize those names (see fileSchemeToXml)
// so channels round-trip byte-identically with the Java client and don't churn revisions on
// cross-client save; internally we keep the lowercase form ("file"/"ftp"/…, "S3" unchanged),
// and the parser normalizes either casing back to it.
//
// FileAction enum values serialize as their Java enum names:
// "NONE", "MOVE", "DELETE", "AFTER_PROCESSING".

/** Map the internal lowercase scheme token to the Java FileScheme enum name() that XStream
 *  serializes into <scheme>. "S3" is already the enum name; every other token uppercases. */
export function fileSchemeToXml(scheme: string): string {
  return scheme === "S3" ? "S3" : scheme.toUpperCase();
}

/** All configurable fields for a File Reader source connector. Flattened from
 *  FileReceiverProperties plus the four scheme-specific properties classes. */
export interface FileReaderProps {
  // ── Core ──────────────────────────────────────────────────────────────────
  scheme: string; // internal token: "file"|"ftp"|"sftp"|"S3"|"smb"|"webdav"
  host: string; // directory path (FILE) or host/path (remote)
  fileFilter: string; // filename pattern, default "*"
  regex: boolean;
  directoryRecursion: boolean;
  ignoreDot: boolean;
  // ── Authentication (not shown for FILE scheme) ────────────────────────────
  anonymous: boolean;
  username: string;
  password: string;
  // ── Connection (not shown for FILE scheme) ────────────────────────────────
  timeout: string; // ms
  secure: boolean; // FTP → FTPS, WEBDAV → HTTPS
  passive: boolean; // FTP passive mode only
  validateConnection: boolean; // FTP only
  // ── After-processing action ───────────────────────────────────────────────
  afterProcessingAction: string; // FileAction: "NONE"|"MOVE"|"DELETE"
  moveToDirectory: string;
  moveToFileName: string;
  // ── Error handling ────────────────────────────────────────────────────────
  errorReadingAction: string; // FileAction: "NONE"|"MOVE"|"DELETE"
  errorResponseAction: string; // FileAction: +AFTER_PROCESSING
  errorMoveToDirectory: string;
  errorMoveToFileName: string;
  // ── File age / size filters ───────────────────────────────────────────────
  checkFileAge: boolean;
  fileAge: string; // ms
  fileSizeMinimum: string; // bytes
  fileSizeMaximum: string; // bytes (only when !ignoreFileSizeMaximum)
  ignoreFileSizeMaximum: boolean;
  // ── Sort & encoding ───────────────────────────────────────────────────────
  sortBy: string; // "date"|"name"|"size"
  binary: boolean;
  charsetEncoding: string;
  // ── FTP scheme properties ─────────────────────────────────────────────────
  ftpInitialCommands: string; // newline-separated; maps to List<String>
  // ── SFTP scheme properties ────────────────────────────────────────────────
  sftpPasswordAuth: boolean;
  sftpKeyAuth: boolean;
  sftpKeyFile: string;
  sftpPassPhrase: string;
  sftpHostKeyChecking: string; // "yes"|"ask"|"no"
  sftpKnownHostsFile: string;
  sftpConfigurationSettings: Array<{ name: string; value: string }>;
  // ── S3 scheme properties ──────────────────────────────────────────────────
  s3UseDefaultCredentials: boolean;
  s3UseTemporaryCredentials: boolean;
  s3Duration: string; // seconds
  s3Region: string;
  s3CustomHeaders: Array<{ name: string; value: string }>;
  // ── SMB scheme properties ─────────────────────────────────────────────────
  smbMinVersion: string; // e.g. "SMB202"
  smbMaxVersion: string; // e.g. "SMB311"
}

const FILE_READER_DEFAULTS: FileReaderProps = {
  scheme: "file",
  host: "",
  fileFilter: "*",
  regex: false,
  directoryRecursion: false,
  ignoreDot: true,
  anonymous: true,
  username: "anonymous",
  password: "anonymous",
  timeout: "10000",
  secure: true,
  passive: true,
  validateConnection: true,
  afterProcessingAction: "NONE",
  moveToDirectory: "",
  moveToFileName: "",
  errorReadingAction: "NONE",
  errorResponseAction: "AFTER_PROCESSING",
  errorMoveToDirectory: "",
  errorMoveToFileName: "",
  checkFileAge: true,
  fileAge: "1000",
  fileSizeMinimum: "0",
  fileSizeMaximum: "",
  ignoreFileSizeMaximum: true,
  sortBy: "date",
  binary: false,
  charsetEncoding: "DEFAULT_ENCODING",
  ftpInitialCommands: "",
  sftpPasswordAuth: true,
  sftpKeyAuth: false,
  sftpKeyFile: "",
  sftpPassPhrase: "",
  sftpHostKeyChecking: "ask",
  sftpKnownHostsFile: "",
  sftpConfigurationSettings: [],
  s3UseDefaultCredentials: true,
  s3UseTemporaryCredentials: false,
  s3Duration: "7200",
  s3Region: "us-east-1",
  s3CustomHeaders: [],
  smbMinVersion: "SMB202",
  smbMaxVersion: "SMB311",
};

export function parseFileReaderPropsFromXml(propertiesXml: string | null): FileReaderProps {
  if (!propertiesXml) return { ...FILE_READER_DEFAULTS };
  try {
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const root = doc.documentElement;
    const str = (sel: string, def: string) => root.querySelector(sel)?.textContent ?? def;
    const bool = (sel: string, def: boolean) => {
      const v = root.querySelector(sel)?.textContent?.trim();
      return v === undefined || v === null ? def : v === "true";
    };

    // Normalize scheme: Java writes uppercase (FTP, SFTP, SMB, WEBDAV), web UI uses lowercase.
    // S3 is consistent between Java and web UI.
    const rawScheme = str("scheme", FILE_READER_DEFAULTS.scheme);
    const scheme = rawScheme === "S3" || rawScheme === "s3" ? "S3" : rawScheme.toLowerCase();
    const spEl = root.querySelector(":scope > schemeProperties");

    // ── FTP scheme properties ────────────────────────────────────────────────
    let ftpInitialCommands = "";
    if (spEl && scheme === "ftp") {
      ftpInitialCommands = Array.from(spEl.querySelectorAll("initialCommands > string"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean)
        .join("\n");
    }

    // ── SFTP scheme properties ───────────────────────────────────────────────
    let sftpPasswordAuth = FILE_READER_DEFAULTS.sftpPasswordAuth;
    let sftpKeyAuth = FILE_READER_DEFAULTS.sftpKeyAuth;
    let sftpKeyFile = FILE_READER_DEFAULTS.sftpKeyFile;
    let sftpPassPhrase = FILE_READER_DEFAULTS.sftpPassPhrase;
    let sftpHostKeyChecking = FILE_READER_DEFAULTS.sftpHostKeyChecking;
    let sftpKnownHostsFile = FILE_READER_DEFAULTS.sftpKnownHostsFile;
    const sftpConfigurationSettings: Array<{ name: string; value: string }> = [];
    if (spEl && scheme === "sftp") {
      const sp = spEl;
      const ss = (sel: string, def: string) => sp.querySelector(sel)?.textContent ?? def;
      const sb = (sel: string, def: boolean) => {
        const v = sp.querySelector(sel)?.textContent?.trim();
        return v === undefined || v === null ? def : v === "true";
      };
      sftpPasswordAuth = sb("passwordAuth", FILE_READER_DEFAULTS.sftpPasswordAuth);
      sftpKeyAuth = sb("keyAuth", FILE_READER_DEFAULTS.sftpKeyAuth);
      sftpKeyFile = ss("keyFile", FILE_READER_DEFAULTS.sftpKeyFile);
      sftpPassPhrase = ss("passPhrase", FILE_READER_DEFAULTS.sftpPassPhrase);
      sftpHostKeyChecking = ss("hostKeyChecking", FILE_READER_DEFAULTS.sftpHostKeyChecking);
      sftpKnownHostsFile = ss("knownHostsFile", FILE_READER_DEFAULTS.sftpKnownHostsFile);
      // Parse configurationSettings linked-hash-map entries
      const cfgEl = sp.querySelector("configurationSettings");
      if (cfgEl) {
        for (const entry of Array.from(cfgEl.querySelectorAll(":scope > entry"))) {
          const strings = Array.from(entry.querySelectorAll(":scope > string"));
          if (strings.length >= 2) {
            sftpConfigurationSettings.push({
              name: strings[0].textContent ?? "",
              value: strings[1].textContent ?? "",
            });
          }
        }
      }
    }

    // ── S3 scheme properties ─────────────────────────────────────────────────
    let s3UseDefaultCredentials = FILE_READER_DEFAULTS.s3UseDefaultCredentials;
    let s3UseTemporaryCredentials = FILE_READER_DEFAULTS.s3UseTemporaryCredentials;
    let s3Duration = FILE_READER_DEFAULTS.s3Duration;
    let s3Region = FILE_READER_DEFAULTS.s3Region;
    const s3CustomHeaders: Array<{ name: string; value: string }> = [];
    if (spEl && scheme === "S3") {
      const sp = spEl;
      const ss = (sel: string, def: string) => sp.querySelector(sel)?.textContent ?? def;
      const sb = (sel: string, def: boolean) => {
        const v = sp.querySelector(sel)?.textContent?.trim();
        return v === undefined || v === null ? def : v === "true";
      };
      s3UseDefaultCredentials = sb(
        "useDefaultCredentialProviderChain",
        FILE_READER_DEFAULTS.s3UseDefaultCredentials
      );
      s3UseTemporaryCredentials = sb(
        "useTemporaryCredentials",
        FILE_READER_DEFAULTS.s3UseTemporaryCredentials
      );
      s3Duration = ss("duration", FILE_READER_DEFAULTS.s3Duration);
      s3Region = ss("region", FILE_READER_DEFAULTS.s3Region);

      // Flatten Map<String, List<String>> → {name, value}[] rows
      const chEl = sp.querySelector("customHeaders");
      if (chEl) {
        for (const entry of Array.from(chEl.querySelectorAll(":scope > entry"))) {
          const strings = Array.from(entry.querySelectorAll(":scope > string"));
          if (strings.length === 0) continue;
          const name = strings[0].textContent ?? "";
          const listEl = entry.querySelector(":scope > list");
          if (listEl) {
            for (const strEl of Array.from(listEl.querySelectorAll(":scope > string"))) {
              s3CustomHeaders.push({ name, value: strEl.textContent ?? "" });
            }
          } else {
            for (let i = 1; i < strings.length; i++) {
              s3CustomHeaders.push({ name, value: strings[i].textContent ?? "" });
            }
          }
        }
      }
    }

    // ── SMB scheme properties ────────────────────────────────────────────────
    let smbMinVersion = FILE_READER_DEFAULTS.smbMinVersion;
    let smbMaxVersion = FILE_READER_DEFAULTS.smbMaxVersion;
    if (spEl && scheme === "smb") {
      smbMinVersion =
        spEl.querySelector("smbMinVersion")?.textContent?.trim() ??
        FILE_READER_DEFAULTS.smbMinVersion;
      smbMaxVersion =
        spEl.querySelector("smbMaxVersion")?.textContent?.trim() ??
        FILE_READER_DEFAULTS.smbMaxVersion;
    }

    return {
      scheme,
      host: str("host", FILE_READER_DEFAULTS.host),
      fileFilter: str("fileFilter", FILE_READER_DEFAULTS.fileFilter),
      regex: bool("regex", FILE_READER_DEFAULTS.regex),
      directoryRecursion: bool("directoryRecursion", FILE_READER_DEFAULTS.directoryRecursion),
      ignoreDot: bool("ignoreDot", FILE_READER_DEFAULTS.ignoreDot),
      anonymous: bool("anonymous", FILE_READER_DEFAULTS.anonymous),
      username: str("username", FILE_READER_DEFAULTS.username),
      password: str("password", FILE_READER_DEFAULTS.password),
      timeout: str("timeout", FILE_READER_DEFAULTS.timeout),
      secure: bool("secure", FILE_READER_DEFAULTS.secure),
      passive: bool("passive", FILE_READER_DEFAULTS.passive),
      validateConnection: bool("validateConnection", FILE_READER_DEFAULTS.validateConnection),
      afterProcessingAction: str(
        "afterProcessingAction",
        FILE_READER_DEFAULTS.afterProcessingAction
      ),
      moveToDirectory: str("moveToDirectory", FILE_READER_DEFAULTS.moveToDirectory),
      moveToFileName: str("moveToFileName", FILE_READER_DEFAULTS.moveToFileName),
      errorReadingAction: str("errorReadingAction", FILE_READER_DEFAULTS.errorReadingAction),
      errorResponseAction: str("errorResponseAction", FILE_READER_DEFAULTS.errorResponseAction),
      errorMoveToDirectory: str("errorMoveToDirectory", FILE_READER_DEFAULTS.errorMoveToDirectory),
      errorMoveToFileName: str("errorMoveToFileName", FILE_READER_DEFAULTS.errorMoveToFileName),
      checkFileAge: bool("checkFileAge", FILE_READER_DEFAULTS.checkFileAge),
      fileAge: str("fileAge", FILE_READER_DEFAULTS.fileAge),
      fileSizeMinimum: str("fileSizeMinimum", FILE_READER_DEFAULTS.fileSizeMinimum),
      fileSizeMaximum: str("fileSizeMaximum", FILE_READER_DEFAULTS.fileSizeMaximum),
      ignoreFileSizeMaximum: bool(
        "ignoreFileSizeMaximum",
        FILE_READER_DEFAULTS.ignoreFileSizeMaximum
      ),
      sortBy: str("sortBy", FILE_READER_DEFAULTS.sortBy),
      binary: bool("binary", FILE_READER_DEFAULTS.binary),
      charsetEncoding: str("charsetEncoding", FILE_READER_DEFAULTS.charsetEncoding),
      ftpInitialCommands,
      sftpPasswordAuth,
      sftpKeyAuth,
      sftpKeyFile,
      sftpPassPhrase,
      sftpHostKeyChecking,
      sftpKnownHostsFile,
      sftpConfigurationSettings,
      s3UseDefaultCredentials,
      s3UseTemporaryCredentials,
      s3Duration,
      s3Region,
      s3CustomHeaders,
      smbMinVersion,
      smbMaxVersion,
    };
  } catch {
    return { ...FILE_READER_DEFAULTS };
  }
}

export function updateFileReaderPropsInXml(propertiesXml: string, p: FileReaderProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  // Update scheme field (serialize the Java enum name so it round-trips with the Java client)
  ensureChild(root, "scheme", doc).textContent = fileSchemeToXml(p.scheme);

  // Rebuild <schemeProperties> — remove old, create new for current scheme
  const oldSp = root.querySelector(":scope > schemeProperties");
  if (oldSp) root.removeChild(oldSp);

  if (p.scheme === "ftp") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.FTPSchemeProperties");
    const cmdsEl = doc.createElementNS(null, "initialCommands");
    for (const cmd of p.ftpInitialCommands
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean)) {
      const strEl = doc.createElementNS(null, "string");
      strEl.textContent = cmd;
      cmdsEl.appendChild(strEl);
    }
    sp.appendChild(cmdsEl);
    root.appendChild(sp);
  } else if (p.scheme === "sftp") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.SftpSchemeProperties");
    const sfFields: [string, string][] = [
      ["passwordAuth", String(p.sftpPasswordAuth)],
      ["keyAuth", String(p.sftpKeyAuth)],
      ["keyFile", p.sftpKeyFile],
      ["passPhrase", p.sftpPassPhrase],
      ["hostKeyChecking", p.sftpHostKeyChecking],
      ["knownHostsFile", p.sftpKnownHostsFile],
    ];
    for (const [tag, val] of sfFields) {
      const el = doc.createElementNS(null, tag);
      el.textContent = val;
      sp.appendChild(el);
    }
    const cfg = doc.createElementNS(null, "configurationSettings");
    cfg.setAttribute("class", "linked-hash-map");
    for (const row of p.sftpConfigurationSettings) {
      const entry = doc.createElementNS(null, "entry");
      const keyEl = doc.createElementNS(null, "string");
      keyEl.textContent = row.name;
      entry.appendChild(keyEl);
      const valEl = doc.createElementNS(null, "string");
      valEl.textContent = row.value;
      entry.appendChild(valEl);
      cfg.appendChild(entry);
    }
    sp.appendChild(cfg);
    root.appendChild(sp);
  } else if (p.scheme === "S3") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.S3SchemeProperties");
    const s3Fields: [string, string][] = [
      ["useDefaultCredentialProviderChain", String(p.s3UseDefaultCredentials)],
      ["useTemporaryCredentials", String(p.s3UseTemporaryCredentials)],
      ["duration", p.s3Duration],
      ["region", p.s3Region],
    ];
    for (const [tag, val] of s3Fields) {
      const el = doc.createElementNS(null, tag);
      el.textContent = val;
      sp.appendChild(el);
    }
    // Rebuild customHeaders: group rows by name → Map<String, List<String>>
    const ch = doc.createElementNS(null, "customHeaders");
    ch.setAttribute("class", "linked-hash-map");
    const grouped = new Map<string, string[]>();
    for (const row of p.s3CustomHeaders) {
      const existing = grouped.get(row.name);
      if (existing) {
        existing.push(row.value);
      } else {
        grouped.set(row.name, [row.value]);
      }
    }
    for (const [name, values] of grouped) {
      const entry = doc.createElementNS(null, "entry");
      const keyEl = doc.createElementNS(null, "string");
      keyEl.textContent = name;
      entry.appendChild(keyEl);
      const list = doc.createElementNS(null, "list");
      for (const val of values) {
        const valEl = doc.createElementNS(null, "string");
        valEl.textContent = val;
        list.appendChild(valEl);
      }
      entry.appendChild(list);
      ch.appendChild(entry);
    }
    sp.appendChild(ch);
    root.appendChild(sp);
  } else if (p.scheme === "smb") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.SmbSchemeProperties");
    ensureChild(sp, "smbMinVersion", doc).textContent = p.smbMinVersion;
    ensureChild(sp, "smbMaxVersion", doc).textContent = p.smbMaxVersion;
    root.appendChild(sp);
  }
  // FILE and WEBDAV: no schemeProperties element

  // All flat fields.: mirror Java FileReader.java getProperties() path normalization
  // — the FILE-scheme directory (host) and the move-to directories have their backslashes
  // normalized to forward slashes so server-generated strings don't show mixed separators.
  // moveToDirectory/errorMoveToDirectory are normalized unconditionally (as Java does), since
  // they are only meaningful for local FILE reads. Network hosts are left untouched.
  const fields: [string, string][] = [
    ["host", p.scheme === "file" ? p.host.replace(/\\/g, "/") : p.host],
    ["fileFilter", p.fileFilter],
    ["regex", String(p.regex)],
    ["directoryRecursion", String(p.directoryRecursion)],
    ["ignoreDot", String(p.ignoreDot)],
    ["anonymous", String(p.anonymous)],
    ["username", p.username],
    ["password", p.password],
    ["timeout", p.timeout],
    ["secure", String(p.secure)],
    ["passive", String(p.passive)],
    ["validateConnection", String(p.validateConnection)],
    ["afterProcessingAction", p.afterProcessingAction],
    ["moveToDirectory", p.moveToDirectory.replace(/\\/g, "/")],
    ["moveToFileName", p.moveToFileName],
    ["errorReadingAction", p.errorReadingAction],
    ["errorResponseAction", p.errorResponseAction],
    ["errorMoveToDirectory", p.errorMoveToDirectory.replace(/\\/g, "/")],
    ["errorMoveToFileName", p.errorMoveToFileName],
    ["checkFileAge", String(p.checkFileAge)],
    ["fileAge", p.fileAge],
    ["fileSizeMinimum", p.fileSizeMinimum],
    ["fileSizeMaximum", p.fileSizeMaximum],
    ["ignoreFileSizeMaximum", String(p.ignoreFileSizeMaximum)],
    ["sortBy", p.sortBy],
    ["binary", String(p.binary)],
    ["charsetEncoding", p.charsetEncoding],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  return serialize(doc);
}

/** Default `<properties>` XML for a newly-created File Reader connector (FILE scheme). */
export const DEFAULT_FILE_READER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="{{VERSION}}"><pluginProperties/>${POLL_PROPS_XML}${SRC_PROPS_XML}<scheme>file</scheme><host></host><fileFilter>*</fileFilter><regex>false</regex><directoryRecursion>false</directoryRecursion><ignoreDot>true</ignoreDot><anonymous>true</anonymous><username>anonymous</username><password>anonymous</password><timeout>10000</timeout><secure>true</secure><passive>true</passive><validateConnection>true</validateConnection><afterProcessingAction>NONE</afterProcessingAction><moveToDirectory></moveToDirectory><moveToFileName></moveToFileName><errorReadingAction>NONE</errorReadingAction><errorResponseAction>AFTER_PROCESSING</errorResponseAction><errorMoveToDirectory></errorMoveToDirectory><errorMoveToFileName></errorMoveToFileName><checkFileAge>true</checkFileAge><fileAge>1000</fileAge><fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum></fileSizeMaximum><ignoreFileSizeMaximum>true</ignoreFileSizeMaximum><sortBy>date</sortBy><binary>false</binary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding></properties>`;

// ─── JMS Listener ─────────────────────────────────────────────────────────────

export interface JmsConnectionProperty {
  key: string;
  value: string;
}

export interface JmsListenerProps {
  // ── JNDI vs direct ──────────────────────────────────────────────────────────
  useJndi: boolean;
  jndiProviderUrl: string;
  jndiInitialContextFactory: string;
  jndiConnectionFactoryName: string;
  // ── Direct connection factory ────────────────────────────────────────────────
  connectionFactoryClass: string;
  connectionProperties: JmsConnectionProperty[];
  // ── Common ──────────────────────────────────────────────────────────────────
  username: string;
  password: string;
  destinationName: string;
  topic: boolean;
  clientId: string;
  // ── Source-specific ──────────────────────────────────────────────────────────
  selector: string;
  reconnectIntervalMillis: string;
  durableTopic: boolean;
}

const JMS_DEFAULTS: JmsListenerProps = {
  useJndi: false,
  jndiProviderUrl: "",
  jndiInitialContextFactory: "",
  jndiConnectionFactoryName: "",
  connectionFactoryClass: "",
  connectionProperties: [],
  username: "",
  password: "",
  destinationName: "",
  topic: false,
  clientId: "",
  selector: "",
  reconnectIntervalMillis: "10000",
  durableTopic: false,
};

/** Parse a JMS Listener `<properties>` XML blob into a typed object. */
export function parseJmsListenerPropsFromXml(xml: string | null): JmsListenerProps {
  if (!xml) return { ...JMS_DEFAULTS };
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const root = doc.documentElement;
    const str = (sel: string, def: string) => root.querySelector(sel)?.textContent ?? def;
    const bl = (sel: string, def: boolean) => {
      const v = root.querySelector(sel)?.textContent?.trim();
      return v === undefined || v === null ? def : v === "true";
    };

    // Parse connectionProperties linked-hash-map
    const cpEl = root.querySelector(":scope > connectionProperties");
    const connectionProperties: JmsConnectionProperty[] = [];
    if (cpEl) {
      const entryEls = Array.from(cpEl.querySelectorAll(":scope > entry")) as Element[];
      for (const entry of entryEls) {
        const strings = Array.from(entry.querySelectorAll(":scope > string")) as Element[];
        if (strings.length >= 2) {
          connectionProperties.push({
            key: strings[0].textContent ?? "",
            value: strings[1].textContent ?? "",
          });
        }
      }
    }

    return {
      useJndi: bl("useJndi", JMS_DEFAULTS.useJndi),
      jndiProviderUrl: str("jndiProviderUrl", JMS_DEFAULTS.jndiProviderUrl),
      jndiInitialContextFactory: str(
        "jndiInitialContextFactory",
        JMS_DEFAULTS.jndiInitialContextFactory
      ),
      jndiConnectionFactoryName: str(
        "jndiConnectionFactoryName",
        JMS_DEFAULTS.jndiConnectionFactoryName
      ),
      connectionFactoryClass: str("connectionFactoryClass", JMS_DEFAULTS.connectionFactoryClass),
      connectionProperties,
      username: str("username", JMS_DEFAULTS.username),
      password: str("password", JMS_DEFAULTS.password),
      destinationName: str("destinationName", JMS_DEFAULTS.destinationName),
      topic: bl("topic", JMS_DEFAULTS.topic),
      clientId: str("clientId", JMS_DEFAULTS.clientId),
      selector: str("selector", JMS_DEFAULTS.selector),
      reconnectIntervalMillis: str("reconnectIntervalMillis", JMS_DEFAULTS.reconnectIntervalMillis),
      durableTopic: bl("durableTopic", JMS_DEFAULTS.durableTopic),
    };
  } catch {
    return { ...JMS_DEFAULTS };
  }
}

/** Serialise a JmsListenerProps patch back into the `<properties>` XML blob. */
export function updateJmsListenerPropsInXml(xml: string, p: JmsListenerProps): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;

  // Rebuild connectionProperties (complex linked-hash-map element)
  const oldCp = root.querySelector(":scope > connectionProperties");
  if (oldCp) root.removeChild(oldCp);
  const cpEl = doc.createElementNS(null, "connectionProperties");
  cpEl.setAttribute("class", "linked-hash-map");
  for (const { key, value } of p.connectionProperties) {
    const entry = doc.createElementNS(null, "entry");
    const k = doc.createElementNS(null, "string");
    k.textContent = key;
    const v = doc.createElementNS(null, "string");
    v.textContent = value;
    entry.appendChild(k);
    entry.appendChild(v);
    cpEl.appendChild(entry);
  }
  root.appendChild(cpEl);

  // Flat fields
  const fields: [string, string][] = [
    ["useJndi", String(p.useJndi)],
    ["jndiProviderUrl", p.jndiProviderUrl],
    ["jndiInitialContextFactory", p.jndiInitialContextFactory],
    ["jndiConnectionFactoryName", p.jndiConnectionFactoryName],
    ["connectionFactoryClass", p.connectionFactoryClass],
    ["username", p.username],
    ["password", p.password],
    ["destinationName", p.destinationName],
    ["topic", String(p.topic)],
    ["clientId", p.clientId],
    ["selector", p.selector],
    ["reconnectIntervalMillis", p.reconnectIntervalMillis],
    ["durableTopic", String(p.durableTopic)],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  return serialize(doc);
}

/** Default `<properties>` XML for a newly-created JMS Listener connector. */
export const DEFAULT_JMS_LISTENER_PROPERTIES_XML = `<properties class="com.mirth.connect.connectors.jms.JmsReceiverProperties" version="{{VERSION}}"><pluginProperties/>${SRC_PROPS_XML}<useJndi>false</useJndi><jndiProviderUrl></jndiProviderUrl><jndiInitialContextFactory></jndiInitialContextFactory><jndiConnectionFactoryName></jndiConnectionFactoryName><connectionFactoryClass></connectionFactoryClass><connectionProperties class="linked-hash-map"/><username></username><password></password><destinationName></destinationName><topic>false</topic><clientId></clientId><selector></selector><reconnectIntervalMillis>10000</reconnectIntervalMillis><durableTopic>false</durableTopic></properties>`;

// ─── JMS connection templates (shared by Listener + Sender) ─────────────────────

/** Fully-qualified XStream class name for the base JMS connector properties. */
const JMS_BASE_CONNECTOR_CLASS = "com.mirth.connect.connectors.jms.JmsConnectorProperties";

/**
 * Base-class child elements, in field-declaration order. Any other child of a
 * `JmsReceiverProperties`/`JmsDispatcherProperties` blob is subclass-only
 * (sourceConnectorProperties, selector, reconnectIntervalMillis, durableTopic,
 * destinationConnectorProperties, template, …) and is dropped from a template.
 */
const JMS_BASE_TEMPLATE_FIELDS: ReadonlySet<string> = new Set([
  "pluginProperties",
  "useJndi",
  "jndiProviderUrl",
  "jndiInitialContextFactory",
  "jndiConnectionFactoryName",
  "connectionFactoryClass",
  "connectionProperties",
  "username",
  "password",
  "destinationName",
  "topic",
  "clientId",
]);

/**
 * Convert a connector's full JMS `<properties>` XML into a clean base-class
 * connection-template blob, mirroring Java `JmsConnectorPanel.storeTemplate`, which
 * sends a fresh `new JmsConnectorProperties()` populated with only the 6 connection
 * fields — never the receiver/dispatcher subclass, and never the credentials or
 * destination. We therefore:
 *
 * - rewrite the root `class` to the base `JmsConnectorProperties` (subclass-agnostic),
 * - drop every subclass-only child element,
 * - clear the common fields Java leaves at their defaults in a shared template
 *   (username/password/destinationName/clientId → empty, topic → false),
 * - preserve the 6 connection fields and the root `version` attribute.
 */
export function stripJmsXmlToBaseTemplate(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;

  root.setAttribute("class", JMS_BASE_CONNECTOR_CLASS);

  // Remove subclass-only children (anything not on the base-class allow-list).
  for (const child of Array.from(root.children)) {
    if (!JMS_BASE_TEMPLATE_FIELDS.has(child.tagName)) child.remove();
  }

  // Clear the common fields Java never stores in a shared template.
  const cleared: Record<string, string> = {
    username: "",
    password: "",
    destinationName: "",
    clientId: "",
    topic: "false",
  };
  for (const [tag, val] of Object.entries(cleared)) {
    const el = root.querySelector(`:scope > ${tag}`);
    if (el) el.textContent = val;
  }

  return serialize(doc);
}

/**
 * Next auto-generated unique connection-property name ("Property 1", "Property 2", …),
 * mirroring Java `MirthPropertiesTable.getNewPropertyName` (case-insensitive uniqueness).
 */
export function nextJmsPropertyName(existing: string[]): string {
  const taken = new Set(existing.map((k) => k.trim().toLowerCase()));
  for (let i = 1; i <= existing.length + 1; i++) {
    const candidate = `Property ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}

/**
 * Resolve an edited connection-property key on commit (blur), mirroring Java
 * `MirthPropertiesTable`: trim the value, and reject a blank or duplicate
 * (case-insensitive) key by reverting to its prior value. `otherKeys` are the keys of
 * every other row.
 */
export function resolveJmsPropertyKey(
  candidate: string,
  prior: string,
  otherKeys: string[]
): string {
  const trimmed = candidate.trim();
  if (!trimmed) return prior;
  const dup = otherKeys.some((k) => k.trim().toLowerCase() === trimmed.toLowerCase());
  return dup ? prior : trimmed;
}

// ─── TCP Listener ──────────────────────────────────────────────────────────────

/** Respond-on-new-connection numeric constants matching Java TcpReceiverProperties. */
export const TCP_RESPOND_SAME_CONNECTION = 0;
export const TCP_RESPOND_NEW_CONNECTION = 1;
export const TCP_RESPOND_ON_RECOVERY = 2;

export interface TcpListenerProps {
  // Listener address (from nested listenerConnectorProperties)
  host: string;
  port: string;
  // Transmission mode (from transmissionModeProperties)
  transmissionMode: string; // "MLLP" | "Basic" (pluginPointName)
  startOfMessageBytes: string; // hex — only meaningful for MLLP / custom frame modes
  endOfMessageBytes: string; // hex
  // MLLP v2 fields (MLLPModeProperties only — ignored for Basic)
  useMLLPv2: boolean;
  ackBytes: string; // hex ACK character (default "06")
  nackBytes: string; // hex NACK character (default "15")
  maxRetries: string; // MLLP v2 retries (default "2")
  // Mode
  serverMode: boolean; // true = server (listen), false = client (connect)
  // Client mode-only fields
  remoteAddress: string;
  remotePort: string;
  overrideLocalBinding: boolean;
  reconnectInterval: string; // ms
  // Common
  receiveTimeout: string; // ms (0 = no timeout)
  bufferSize: string; // bytes
  maxConnections: string; // server mode only
  keepConnectionOpen: boolean;
  // Data type
  dataTypeBinary: boolean; // false = text, true = binary
  charsetEncoding: string; // used when !dataTypeBinary
  // Response
  respondOnNewConnection: number; // 0 | 1 | 2
  responseAddress: string;
  responsePort: string;
}

const TCP_LISTENER_DEFAULTS: TcpListenerProps = {
  host: "0.0.0.0",
  port: "6661",
  transmissionMode: "MLLP",
  startOfMessageBytes: "0B",
  endOfMessageBytes: "1C0D",
  useMLLPv2: false,
  ackBytes: "06",
  nackBytes: "15",
  maxRetries: "2",
  serverMode: true,
  remoteAddress: "",
  remotePort: "",
  overrideLocalBinding: false,
  reconnectInterval: "5000",
  receiveTimeout: "0",
  bufferSize: "65536",
  maxConnections: "10",
  keepConnectionOpen: true,
  dataTypeBinary: false,
  charsetEncoding: "DEFAULT_ENCODING",
  respondOnNewConnection: TCP_RESPOND_SAME_CONNECTION,
  responseAddress: "",
  responsePort: "",
};

/** Parse a TCP Listener `<properties>` XML blob into a typed object. */
export function parseTcpListenerPropsFromXml(propertiesXml: string | null): TcpListenerProps {
  if (!propertiesXml) return { ...TCP_LISTENER_DEFAULTS };
  try {
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const root = doc.documentElement;
    const str = (sel: string, def: string) => root.querySelector(sel)?.textContent ?? def;
    const bl = (sel: string, def: boolean) => {
      const v = root.querySelector(sel)?.textContent?.trim();
      return v === undefined || v === null ? def : v === "true";
    };

    // Nested listenerConnectorProperties
    const host =
      root.querySelector("listenerConnectorProperties > host")?.textContent ??
      TCP_LISTENER_DEFAULTS.host;
    const port =
      root.querySelector("listenerConnectorProperties > port")?.textContent ??
      TCP_LISTENER_DEFAULTS.port;

    // Polymorphic transmissionModeProperties — registry-driven (class + extra fields per mode).
    // Absent element resolves to Basic with empty frame bytes (matches Java null → FrameModeProperties()).
    const tm = readTransmissionModeProperties(
      root.querySelector(":scope > transmissionModeProperties")
    );

    const respondRaw = parseInt(
      root.querySelector("respondOnNewConnection")?.textContent?.trim() ?? "0",
      10
    );
    const respondOnNewConnection =
      respondRaw === TCP_RESPOND_NEW_CONNECTION || respondRaw === TCP_RESPOND_ON_RECOVERY
        ? respondRaw
        : TCP_RESPOND_SAME_CONNECTION;

    return {
      host,
      port,
      ...tm,
      serverMode: bl("serverMode", TCP_LISTENER_DEFAULTS.serverMode),
      remoteAddress: str("remoteAddress", TCP_LISTENER_DEFAULTS.remoteAddress),
      remotePort: str("remotePort", TCP_LISTENER_DEFAULTS.remotePort),
      overrideLocalBinding: bl("overrideLocalBinding", TCP_LISTENER_DEFAULTS.overrideLocalBinding),
      reconnectInterval: str("reconnectInterval", TCP_LISTENER_DEFAULTS.reconnectInterval),
      receiveTimeout: str("receiveTimeout", TCP_LISTENER_DEFAULTS.receiveTimeout),
      bufferSize: str("bufferSize", TCP_LISTENER_DEFAULTS.bufferSize),
      maxConnections: str("maxConnections", TCP_LISTENER_DEFAULTS.maxConnections),
      keepConnectionOpen: bl("keepConnectionOpen", TCP_LISTENER_DEFAULTS.keepConnectionOpen),
      dataTypeBinary: bl("dataTypeBinary", TCP_LISTENER_DEFAULTS.dataTypeBinary),
      charsetEncoding: str("charsetEncoding", TCP_LISTENER_DEFAULTS.charsetEncoding),
      respondOnNewConnection,
      responseAddress: str("responseAddress", TCP_LISTENER_DEFAULTS.responseAddress),
      responsePort: str("responsePort", TCP_LISTENER_DEFAULTS.responsePort),
    };
  } catch {
    return { ...TCP_LISTENER_DEFAULTS };
  }
}

/** Serialise a TcpListenerProps patch back into the `<properties>` XML blob. */
export function updateTcpListenerPropsInXml(propertiesXml: string, p: TcpListenerProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  // Nested listenerConnectorProperties (host + port)
  const lcp = ensureChild(root, "listenerConnectorProperties", doc);
  ensureChild(lcp, "host", doc).textContent = p.host;
  ensureChild(lcp, "port", doc).textContent = p.port;

  // Rebuild transmissionModeProperties (polymorphic — registry-driven per mode). The element must be
  // present for a registered mode (the server requires pluginPointName to start the channel); an
  // unknown/plugin mode's existing element is preserved rather than rewritten to Basic.
  writeTransmissionModeProperties(root, p, doc);

  // Flat fields
  const fields: [string, string][] = [
    ["serverMode", String(p.serverMode)],
    ["remoteAddress", p.remoteAddress],
    ["remotePort", p.remotePort],
    ["overrideLocalBinding", String(p.overrideLocalBinding)],
    ["reconnectInterval", p.reconnectInterval],
    ["receiveTimeout", p.receiveTimeout],
    ["bufferSize", p.bufferSize],
    ["maxConnections", p.maxConnections],
    ["keepConnectionOpen", String(p.keepConnectionOpen)],
    ["dataTypeBinary", String(p.dataTypeBinary)],
    ["charsetEncoding", p.charsetEncoding],
    ["respondOnNewConnection", String(p.respondOnNewConnection)],
    ["responseAddress", p.responseAddress],
    ["responsePort", p.responsePort],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  return serialize(doc);
}

/** Default `<properties>` XML for a newly-created TCP Listener connector (MLLP, server mode).
 *
 * Notes:
 *   - <pluginProperties/> is empty; SSL lives in <responseConnectorPluginProperties> (added by
 *     the SslSettingsPlugin when the SSL Manager plugin is installed on the server).
 *   - MLLP mode uses com.mirth.connect.plugins.mllpmode.MLLPModeProperties (not FrameModeProperties).
 *   - Basic TCP uses com.mirth.connect.connectors.tcp.FrameModeProperties.
 */
export const DEFAULT_TCP_LISTENER_PROPERTIES_XML =
  `<properties class="com.mirth.connect.connectors.tcp.TcpReceiverProperties" version="{{VERSION}}">` +
  `<pluginProperties/>` +
  `<listenerConnectorProperties version="{{VERSION}}"><host>0.0.0.0</host><port>6661</port></listenerConnectorProperties>` +
  `${TCP_LISTENER_SRC_PROPS_XML}` +
  `<transmissionModeProperties class="com.mirth.connect.plugins.mllpmode.MLLPModeProperties">` +
  `<pluginPointName>MLLP</pluginPointName><startOfMessageBytes>0B</startOfMessageBytes>` +
  `<endOfMessageBytes>1C0D</endOfMessageBytes>` +
  `<useMLLPv2>false</useMLLPv2><ackBytes>06</ackBytes><nackBytes>15</nackBytes><maxRetries>2</maxRetries>` +
  `</transmissionModeProperties>` +
  `<serverMode>true</serverMode><remoteAddress></remoteAddress><remotePort></remotePort>` +
  `<overrideLocalBinding>false</overrideLocalBinding><reconnectInterval>5000</reconnectInterval>` +
  `<receiveTimeout>0</receiveTimeout><bufferSize>65536</bufferSize><maxConnections>10</maxConnections>` +
  `<keepConnectionOpen>true</keepConnectionOpen><dataTypeBinary>false</dataTypeBinary>` +
  `<charsetEncoding>DEFAULT_ENCODING</charsetEncoding><respondOnNewConnection>0</respondOnNewConnection>` +
  `<responseAddress></responseAddress><responsePort></responsePort>` +
  `<responseConnectorPluginProperties/></properties>`;

// ─── HTTP Listener properties ──────────────────────────────────────────────────

export interface HttpListenerProps {
  // Listener binding
  host: string;
  port: string;
  // Body parsing
  xmlBody: boolean;
  parseMultipart: boolean;
  includeMetadata: boolean;
  binaryMimeTypes: string;
  binaryMimeTypesRegex: boolean;
  // Response
  responseContentType: string;
  responseDataTypeBinary: boolean;
  responseStatusCode: string;
  /** Raw outer XML of the <responseHeaders class="linked-hash-map"> element. */
  responseHeadersXml: string;
  responseHeadersVariable: string;
  useResponseHeadersVariable: boolean;
  // Connection
  charset: string;
  contextPath: string;
  timeout: string;
  requestHeaderSize: string;
  /** Raw outer XML of the <staticResources> element. */
  staticResourcesXml: string;
}

const HTTP_LISTENER_DEFAULTS: HttpListenerProps = {
  host: "0.0.0.0",
  port: "80",
  xmlBody: false,
  parseMultipart: true,
  includeMetadata: false,
  binaryMimeTypes: "application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*",
  binaryMimeTypesRegex: true,
  responseContentType: "text/plain",
  responseDataTypeBinary: false,
  responseStatusCode: "",
  responseHeadersXml: `<responseHeaders class="linked-hash-map"/>`,
  responseHeadersVariable: "",
  useResponseHeadersVariable: false,
  charset: "UTF-8",
  contextPath: "",
  timeout: "30000",
  requestHeaderSize: "8192",
  staticResourcesXml: "<staticResources/>",
};

export function parseHttpListenerPropsFromXml(propertiesXml: string | null): HttpListenerProps {
  if (!propertiesXml) return { ...HTTP_LISTENER_DEFAULTS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const str = (tag: string, def: string) => root.querySelector(tag)?.textContent ?? def;
  const bl = (tag: string, def: boolean) => {
    const v = root.querySelector(tag)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  try {
    return {
      host: str("listenerConnectorProperties > host", HTTP_LISTENER_DEFAULTS.host),
      port: str("listenerConnectorProperties > port", HTTP_LISTENER_DEFAULTS.port),
      xmlBody: bl("xmlBody", HTTP_LISTENER_DEFAULTS.xmlBody),
      parseMultipart: bl("parseMultipart", HTTP_LISTENER_DEFAULTS.parseMultipart),
      includeMetadata: bl("includeMetadata", HTTP_LISTENER_DEFAULTS.includeMetadata),
      binaryMimeTypes: str("binaryMimeTypes", HTTP_LISTENER_DEFAULTS.binaryMimeTypes),
      binaryMimeTypesRegex: bl("binaryMimeTypesRegex", HTTP_LISTENER_DEFAULTS.binaryMimeTypesRegex),
      responseContentType: str("responseContentType", HTTP_LISTENER_DEFAULTS.responseContentType),
      responseDataTypeBinary: bl(
        "responseDataTypeBinary",
        HTTP_LISTENER_DEFAULTS.responseDataTypeBinary
      ),
      responseStatusCode: str("responseStatusCode", HTTP_LISTENER_DEFAULTS.responseStatusCode),
      responseHeadersXml:
        elOuterXml(root.querySelector(":scope > responseHeaders")) ??
        HTTP_LISTENER_DEFAULTS.responseHeadersXml,
      responseHeadersVariable: str(
        "responseHeadersVariable",
        HTTP_LISTENER_DEFAULTS.responseHeadersVariable
      ),
      useResponseHeadersVariable: bl(
        "useResponseHeadersVariable",
        HTTP_LISTENER_DEFAULTS.useResponseHeadersVariable
      ),
      charset: str("charset", HTTP_LISTENER_DEFAULTS.charset),
      contextPath: str("contextPath", HTTP_LISTENER_DEFAULTS.contextPath),
      timeout: str("timeout", HTTP_LISTENER_DEFAULTS.timeout),
      requestHeaderSize: str("requestHeaderSize", HTTP_LISTENER_DEFAULTS.requestHeaderSize),
      staticResourcesXml:
        elOuterXml(root.querySelector(":scope > staticResources")) ??
        HTTP_LISTENER_DEFAULTS.staticResourcesXml,
    };
  } catch {
    return { ...HTTP_LISTENER_DEFAULTS };
  }
}

export function updateHttpListenerPropsInXml(propertiesXml: string, p: HttpListenerProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  const lcp = ensureChild(root, "listenerConnectorProperties", doc);
  ensureChild(lcp, "host", doc).textContent = p.host;
  ensureChild(lcp, "port", doc).textContent = p.port;

  const fields: [string, string][] = [
    ["xmlBody", String(p.xmlBody)],
    ["parseMultipart", String(p.parseMultipart)],
    ["includeMetadata", String(p.includeMetadata)],
    ["binaryMimeTypes", p.binaryMimeTypes],
    ["binaryMimeTypesRegex", String(p.binaryMimeTypesRegex)],
    ["responseContentType", p.responseContentType],
    ["responseDataTypeBinary", String(p.responseDataTypeBinary)],
    ["responseStatusCode", p.responseStatusCode],
    ["responseHeadersVariable", p.responseHeadersVariable],
    ["useResponseHeadersVariable", String(p.useResponseHeadersVariable)],
    ["charset", p.charset],
    ["contextPath", p.contextPath],
    ["timeout", p.timeout],
    ["requestHeaderSize", p.requestHeaderSize],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  // Replace opaque responseHeaders blob, or append it if the source XML never had one
  // (legacy/hand-imported channels) — otherwise the edit is silently dropped on save.
  const oldRh = root.querySelector(":scope > responseHeaders");
  {
    const imported = doc.importNode(
      new DOMParser().parseFromString(p.responseHeadersXml, "application/xml").documentElement,
      true
    );
    if (oldRh) {
      root.replaceChild(imported, oldRh);
    } else {
      root.appendChild(imported);
    }
  }

  // Replace opaque staticResources blob, or append it if the source XML never had one.
  const oldSr = root.querySelector(":scope > staticResources");
  {
    const imported = doc.importNode(
      new DOMParser().parseFromString(p.staticResourcesXml, "application/xml").documentElement,
      true
    );
    if (oldSr) {
      root.replaceChild(imported, oldSr);
    } else {
      root.appendChild(imported);
    }
  }

  return serialize(doc);
}

/** Shared HTTP-auth plugin XML (NoneHttpAuthProperties) used by HTTP and WS listener defaults. */
const HTTP_NONE_AUTH_XML =
  `<pluginProperties>` +
  `<com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties version="{{VERSION}}">` +
  `<authType>NONE</authType>` +
  `</com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties>` +
  `</pluginProperties>`;

// ─── HTTP Authentication plugin types and helpers ─────────────────────────────
//
// The HTTP auth plugin injects an "HTTP Authentication" panel into HTTP Listener
// and WebService Listener connectors. Its state lives inside the connector's
// <pluginProperties> element using the fully-qualified Java class name as the tag.
//
// These helpers are also used by the http-auth.tsx plugin component so that all
// XML parsing logic lives in this file and can be tested independently.

/** XML tag constants for each auth type (fully-qualified Java class name). */
export const HTTPAUTH_NONE_TAG = "com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties";
export const HTTPAUTH_BASIC_TAG =
  "com.mirth.connect.plugins.httpauth.basic.BasicHttpAuthProperties";
export const HTTPAUTH_DIGEST_TAG =
  "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties";
export const HTTPAUTH_JS_TAG =
  "com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties";
export const HTTPAUTH_CUSTOM_TAG =
  "com.mirth.connect.plugins.httpauth.custom.CustomHttpAuthProperties";
export const HTTPAUTH_OAUTH2_TAG =
  "com.mirth.connect.plugins.httpauth.oauth2.OAuth2HttpAuthProperties";
// XStream serializes static inner enum types using _- as the $ separator
export const HTTPAUTH_DIGEST_ALGO_TAG =
  "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-Algorithm";
export const HTTPAUTH_DIGEST_QOP_TAG =
  "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-QOPMode";

export type HttpAuthType =
  | "NONE"
  | "BASIC"
  | "DIGEST"
  | "JAVASCRIPT"
  | "CUSTOM"
  | "OAUTH2_VERIFICATION";

export interface HttpAuthCredential {
  user: string;
  pass: string;
}
export interface HttpAuthKVPair {
  key: string;
  val: string;
}

export interface HttpAuthNoneState {
  authType: "NONE";
}
export interface HttpAuthBasicState {
  authType: "BASIC";
  realm: string;
  isUseCredentialsVariable: boolean;
  credentialsVariable: string;
  credentials: HttpAuthCredential[];
}
export interface HttpAuthDigestState {
  authType: "DIGEST";
  realm: string;
  opaque: string;
  isUseCredentialsVariable: boolean;
  credentialsVariable: string;
  credentials: HttpAuthCredential[];
  algoMD5: boolean;
  algoMD5sess: boolean;
  qopAuth: boolean;
  qopAuthInt: boolean;
}
export interface HttpAuthJSState {
  authType: "JAVASCRIPT";
  script: string;
}
export interface HttpAuthCustomState {
  authType: "CUSTOM";
  authenticatorClass: string;
  properties: HttpAuthKVPair[];
}
export interface HttpAuthOAuth2State {
  authType: "OAUTH2_VERIFICATION";
  tokenLocation: string;
  locationKey: string;
  verificationURL: string;
  /**
   * Opaque outer XML of the OAuth2 `<connectorPluginProperties>` subtree (the SSL
   * settings used to call the verification URL — Java's
   * `OAuth2HttpAuthProperties.connectorPluginProperties`). The WebUI does not model
   * these settings, so it preserves the subtree verbatim across saves to avoid data
   * loss — mirrors how the HTTP Listener preserves `responseHeaders`/`staticResources`.
   * Null when the channel has no such subtree.
   */
  connectorPluginPropertiesXml: string | null;
}

export type HttpAuthState =
  | HttpAuthNoneState
  | HttpAuthBasicState
  | HttpAuthDigestState
  | HttpAuthJSState
  | HttpAuthCustomState
  | HttpAuthOAuth2State;

export const HTTPAUTH_ALL_TAGS: { type: HttpAuthType; tag: string }[] = [
  { type: "NONE", tag: HTTPAUTH_NONE_TAG },
  { type: "BASIC", tag: HTTPAUTH_BASIC_TAG },
  { type: "DIGEST", tag: HTTPAUTH_DIGEST_TAG },
  { type: "JAVASCRIPT", tag: HTTPAUTH_JS_TAG },
  { type: "CUSTOM", tag: HTTPAUTH_CUSTOM_TAG },
  { type: "OAUTH2_VERIFICATION", tag: HTTPAUTH_OAUTH2_TAG },
];

export const HTTPAUTH_DEFAULT_JS_SCRIPT =
  "// Return an AuthenticationResult object to authenticate users.\n" +
  "// Boolean return values may also be used.\n" +
  "// You have access to the source map here.\n\n" +
  "return AuthenticationResult.Success();";

export function httpAuthDefaultForType(type: HttpAuthType): HttpAuthState {
  switch (type) {
    case "NONE":
      return { authType: "NONE" };
    case "BASIC":
      return {
        authType: "BASIC",
        realm: "My Realm",
        isUseCredentialsVariable: false,
        credentialsVariable: "",
        credentials: [],
      };
    case "DIGEST":
      return {
        authType: "DIGEST",
        realm: "My Realm",
        // Mirrors Java DigestHttpAuthProperties, which initializes opaque to "${UUID}".
        opaque: "${UUID}",
        isUseCredentialsVariable: false,
        credentialsVariable: "",
        credentials: [],
        // Mirrors Java DigestHttpAuthProperties, which initializes both sets from
        // Algorithm.values() / QOPMode.values() — all four flags default to true.
        algoMD5: true,
        algoMD5sess: true,
        qopAuth: true,
        qopAuthInt: true,
      };
    case "JAVASCRIPT":
      return { authType: "JAVASCRIPT", script: HTTPAUTH_DEFAULT_JS_SCRIPT };
    case "CUSTOM":
      return { authType: "CUSTOM", authenticatorClass: "", properties: [] };
    case "OAUTH2_VERIFICATION":
      return {
        authType: "OAUTH2_VERIFICATION",
        tokenLocation: "HEADER",
        locationKey: "Authorization",
        verificationURL: "",
        connectorPluginPropertiesXml: null,
      };
  }
}

/**
 * True when `state` is unchanged from its auth type's factory default. Mirrors Java's
 * `getProperties(sel).equals(getDefaultProperties(sel))` check in
 * `HttpAuthConnectorPropertiesPanel.authTypeChanged()`, used to decide whether switching
 * auth type would silently discard configured credentials/settings.
 */
export function httpAuthIsDefault(state: HttpAuthState): boolean {
  return JSON.stringify(state) === JSON.stringify(httpAuthDefaultForType(state.authType));
}

/** Escape special XML characters in a text value. */
function httpAuthEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Parse a XStream linked-hash-map of string→string entries into HttpAuthCredential[]. */
export function parseHttpAuthCredentials(el: Element | null): HttpAuthCredential[] {
  if (!el) return [];
  const result: HttpAuthCredential[] = [];
  for (const entry of Array.from(el.querySelectorAll(":scope > entry"))) {
    const strings = entry.querySelectorAll(":scope > string");
    if (strings.length >= 2) {
      result.push({
        user: strings[0].textContent ?? "",
        pass: strings[1].textContent ?? "",
      });
    }
  }
  return result;
}

/** Parse a XStream linked-hash-map of string→string entries into HttpAuthKVPair[]. */
export function parseHttpAuthKVPairs(el: Element | null): HttpAuthKVPair[] {
  if (!el) return [];
  const result: HttpAuthKVPair[] = [];
  for (const entry of Array.from(el.querySelectorAll(":scope > entry"))) {
    const strings = entry.querySelectorAll(":scope > string");
    if (strings.length >= 2) {
      result.push({
        key: strings[0].textContent ?? "",
        val: strings[1].textContent ?? "",
      });
    }
  }
  return result;
}

/** Serialize HttpAuthCredential[] to a XStream linked-hash-map XML string. */
function httpAuthCredentialsToXml(creds: HttpAuthCredential[], tag: string): string {
  const entries = creds
    .map(
      (c) =>
        `<entry><string>${httpAuthEsc(c.user)}</string><string>${httpAuthEsc(c.pass)}</string></entry>`
    )
    .join("");
  return `<${tag} class="linked-hash-map">${entries}</${tag}>`;
}

/** Serialize HttpAuthKVPair[] to a XStream linked-hash-map XML string. */
function httpAuthKVPairsToXml(pairs: HttpAuthKVPair[], tag: string): string {
  const entries = pairs
    .map(
      (p) =>
        `<entry><string>${httpAuthEsc(p.key)}</string><string>${httpAuthEsc(p.val)}</string></entry>`
    )
    .join("");
  return `<${tag} class="linked-hash-map">${entries}</${tag}>`;
}

/** Parse the HTTP auth plugin state from a connector propertiesXml string. */
export function parseHttpAuthFromXml(propertiesXml: string | null): HttpAuthState {
  if (!propertiesXml) return httpAuthDefaultForType("NONE");
  try {
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    for (const { tag, type } of HTTPAUTH_ALL_TAGS) {
      const els = doc.getElementsByTagName(tag);
      if (els.length === 0) continue;
      const el = els[0];
      const str = (t: string, def: string) => el.querySelector(t)?.textContent ?? def;
      const bl = (t: string, def: boolean) => {
        const v = el.querySelector(t)?.textContent?.trim();
        return v === undefined ? def : v === "true";
      };

      if (type === "NONE") return { authType: "NONE" };

      if (type === "BASIC") {
        return {
          authType: "BASIC",
          realm: str("realm", "My Realm"),
          isUseCredentialsVariable: bl("isUseCredentialsVariable", false),
          credentialsVariable: str("credentialsVariable", ""),
          credentials: parseHttpAuthCredentials(el.querySelector("credentials")),
        };
      }

      if (type === "DIGEST") {
        const algos = Array.from(doc.getElementsByTagName(HTTPAUTH_DIGEST_ALGO_TAG)).map(
          (a) => a.textContent?.trim() ?? ""
        );
        const qops = Array.from(doc.getElementsByTagName(HTTPAUTH_DIGEST_QOP_TAG)).map(
          (q) => q.textContent?.trim() ?? ""
        );
        return {
          authType: "DIGEST",
          realm: str("realm", "My Realm"),
          opaque: str("opaque", ""),
          isUseCredentialsVariable: bl("isUseCredentialsVariable", false),
          credentialsVariable: str("credentialsVariable", ""),
          credentials: parseHttpAuthCredentials(el.querySelector("credentials")),
          algoMD5: algos.includes("MD5") || algos.length === 0,
          algoMD5sess: algos.includes("MD5_SESS"),
          // Unlike algorithms (Java's 3-way radio can't produce empty), Java's QOP
          // checkboxes legitimately persist an empty <qopModes/> (RFC-2069 legacy
          // digest) — an empty set here means both flags are false, not "auth".
          qopAuth: qops.includes("AUTH"),
          qopAuthInt: qops.includes("AUTH_INT"),
        };
      }

      if (type === "JAVASCRIPT") {
        return { authType: "JAVASCRIPT", script: str("script", HTTPAUTH_DEFAULT_JS_SCRIPT) };
      }

      if (type === "CUSTOM") {
        return {
          authType: "CUSTOM",
          authenticatorClass: str("authenticatorClass", ""),
          properties: parseHttpAuthKVPairs(el.querySelector("properties")),
        };
      }

      if (type === "OAUTH2_VERIFICATION") {
        return {
          authType: "OAUTH2_VERIFICATION",
          tokenLocation: str("tokenLocation", "HEADER"),
          locationKey: str("locationKey", "Authorization"),
          verificationURL: str("verificationURL", ""),
          // Preserve the SSL config subtree opaquely (the WebUI does not model it).
          connectorPluginPropertiesXml: elOuterXml(
            el.querySelector(":scope > connectorPluginProperties")
          ),
        };
      }
    }
  } catch {
    /* fall through */
  }
  return httpAuthDefaultForType("NONE");
}

/** Build the auth XML blob for a given HttpAuthState. */
export function buildHttpAuthXml(state: HttpAuthState, version = resolveXmlVersion()): string {
  const tagMap = new Map<HttpAuthType, string>(HTTPAUTH_ALL_TAGS.map((a) => [a.type, a.tag]));
  const tag = tagMap.get(state.authType) ?? HTTPAUTH_NONE_TAG;

  if (state.authType === "NONE") {
    return `<${tag} version="${version}"><authType>NONE</authType></${tag}>`;
  }

  if (state.authType === "BASIC") {
    return (
      `<${tag} version="${version}">` +
      `<authType>BASIC</authType>` +
      `<realm>${httpAuthEsc(state.realm)}</realm>` +
      httpAuthCredentialsToXml(state.credentials, "credentials") +
      `<isUseCredentialsVariable>${state.isUseCredentialsVariable}</isUseCredentialsVariable>` +
      `<credentialsVariable>${httpAuthEsc(state.credentialsVariable)}</credentialsVariable>` +
      `</${tag}>`
    );
  }

  if (state.authType === "DIGEST") {
    const algoXml =
      [
        state.algoMD5 ? `<${HTTPAUTH_DIGEST_ALGO_TAG}>MD5</${HTTPAUTH_DIGEST_ALGO_TAG}>` : "",
        state.algoMD5sess
          ? `<${HTTPAUTH_DIGEST_ALGO_TAG}>MD5_SESS</${HTTPAUTH_DIGEST_ALGO_TAG}>`
          : "",
      ]
        .filter(Boolean)
        .join("") || `<${HTTPAUTH_DIGEST_ALGO_TAG}>MD5</${HTTPAUTH_DIGEST_ALGO_TAG}>`;
    // No "|| AUTH" fallback here: unlike algorithms, Java's QOP checkboxes can both
    // be unchecked, legitimately serializing an empty <qopModes/> (RFC-2069 legacy
    // digest — the server omits the qop directive entirely). Rewriting that to AUTH
    // would silently change the live digest challenge on an otherwise no-op save.
    const qopXml = [
      state.qopAuth ? `<${HTTPAUTH_DIGEST_QOP_TAG}>AUTH</${HTTPAUTH_DIGEST_QOP_TAG}>` : "",
      state.qopAuthInt ? `<${HTTPAUTH_DIGEST_QOP_TAG}>AUTH_INT</${HTTPAUTH_DIGEST_QOP_TAG}>` : "",
    ]
      .filter(Boolean)
      .join("");
    return (
      `<${tag} version="${version}">` +
      `<authType>DIGEST</authType>` +
      `<realm>${httpAuthEsc(state.realm)}</realm>` +
      `<algorithms>${algoXml}</algorithms>` +
      `<qopModes>${qopXml}</qopModes>` +
      `<opaque>${httpAuthEsc(state.opaque)}</opaque>` +
      httpAuthCredentialsToXml(state.credentials, "credentials") +
      `<isUseCredentialsVariable>${state.isUseCredentialsVariable}</isUseCredentialsVariable>` +
      `<credentialsVariable>${httpAuthEsc(state.credentialsVariable)}</credentialsVariable>` +
      `</${tag}>`
    );
  }

  if (state.authType === "JAVASCRIPT") {
    return (
      `<${tag} version="${version}">` +
      `<authType>JAVASCRIPT</authType>` +
      `<script>${httpAuthEsc(state.script)}</script>` +
      `</${tag}>`
    );
  }

  if (state.authType === "CUSTOM") {
    return (
      `<${tag} version="${version}">` +
      `<authType>CUSTOM</authType>` +
      `<authenticatorClass>${httpAuthEsc(state.authenticatorClass)}</authenticatorClass>` +
      httpAuthKVPairsToXml(state.properties, "properties") +
      `</${tag}>`
    );
  }

  if (state.authType === "OAUTH2_VERIFICATION") {
    return (
      `<${tag} version="${version}">` +
      `<authType>OAUTH2_VERIFICATION</authType>` +
      `<tokenLocation>${httpAuthEsc(state.tokenLocation)}</tokenLocation>` +
      `<locationKey>${httpAuthEsc(state.locationKey)}</locationKey>` +
      `<verificationURL>${httpAuthEsc(state.verificationURL)}</verificationURL>` +
      // Re-emit the preserved SSL config subtree verbatim (matches Java field order).
      (state.connectorPluginPropertiesXml ?? "") +
      `</${tag}>`
    );
  }

  return `<${HTTPAUTH_NONE_TAG} version="${version}"><authType>NONE</authType></${HTTPAUTH_NONE_TAG}>`;
}

/** Replace the HTTP auth plugin element inside propertiesXml with a new auth state. */
export function updateHttpAuthInXml(propertiesXml: string, state: HttpAuthState): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  // Ensure <pluginProperties> parent exists
  let pluginProps = root.querySelector(":scope > pluginProperties");
  if (!pluginProps) {
    pluginProps = doc.createElementNS(null, "pluginProperties");
    root.insertBefore(pluginProps, root.firstChild);
  }

  // Remove all existing httpauth elements (only one should be present at a time)
  for (const { tag } of HTTPAUTH_ALL_TAGS) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      el.parentNode?.removeChild(el);
    }
  }

  // Parse the new auth XML blob and import it into the document
  const authXml = buildHttpAuthXml(state);
  const temp = new DOMParser().parseFromString(`<root>${authXml}</root>`, "application/xml");
  const authEl = temp.documentElement.firstElementChild;
  if (authEl) {
    pluginProps.appendChild(doc.importNode(authEl, true));
  }

  return serialize(doc);
}

/** Default `<properties>` XML blob for a newly-created HTTP Listener connector. */
export const DEFAULT_HTTP_LISTENER_PROPERTIES_XML =
  `<properties class="com.mirth.connect.connectors.http.HttpReceiverProperties" version="{{VERSION}}">` +
  `${HTTP_NONE_AUTH_XML}` +
  `<listenerConnectorProperties version="{{VERSION}}"><host>0.0.0.0</host><port>80</port></listenerConnectorProperties>` +
  `${SRC_PROPS_XML}` +
  `<xmlBody>false</xmlBody>` +
  `<parseMultipart>true</parseMultipart>` +
  `<includeMetadata>false</includeMetadata>` +
  `<binaryMimeTypes>application/.*(?&lt;!json|xml)$|image/.*|video/.*|audio/.*</binaryMimeTypes>` +
  `<binaryMimeTypesRegex>true</binaryMimeTypesRegex>` +
  `<responseContentType>text/plain</responseContentType>` +
  `<responseDataTypeBinary>false</responseDataTypeBinary>` +
  `<responseStatusCode></responseStatusCode>` +
  `<responseHeaders class="linked-hash-map"/>` +
  `<responseHeadersVariable></responseHeadersVariable>` +
  `<useResponseHeadersVariable>false</useResponseHeadersVariable>` +
  `<charset>UTF-8</charset>` +
  `<contextPath></contextPath>` +
  `<timeout>30000</timeout>` +
  `<requestHeaderSize>8192</requestHeaderSize>` +
  `<staticResources/>` +
  `</properties>`;

// ─── Web Service Listener properties ──────────────────────────────────────────

export interface WebServiceListenerProps {
  host: string;
  port: string;
  className: string;
  serviceName: string;
  soapBinding: string;
}

const WS_LISTENER_DEFAULTS: WebServiceListenerProps = {
  host: "0.0.0.0",
  port: "8081",
  className: "com.mirth.connect.connectors.ws.DefaultAcceptMessage",
  serviceName: "Mirth",
  soapBinding: "DEFAULT",
};

export function parseWebServiceListenerPropsFromXml(
  propertiesXml: string | null
): WebServiceListenerProps {
  if (!propertiesXml) return { ...WS_LISTENER_DEFAULTS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const str = (tag: string, def: string) =>
    root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  try {
    return {
      host: str("listenerConnectorProperties > host", WS_LISTENER_DEFAULTS.host),
      port: str("listenerConnectorProperties > port", WS_LISTENER_DEFAULTS.port),
      className: str("className", WS_LISTENER_DEFAULTS.className),
      serviceName: str("serviceName", WS_LISTENER_DEFAULTS.serviceName),
      soapBinding: str("soapBinding", WS_LISTENER_DEFAULTS.soapBinding),
    };
  } catch {
    return { ...WS_LISTENER_DEFAULTS };
  }
}

export function updateWebServiceListenerPropsInXml(
  propertiesXml: string,
  p: WebServiceListenerProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  const lcp = ensureChild(root, "listenerConnectorProperties", doc);
  ensureChild(lcp, "host", doc).textContent = p.host;
  ensureChild(lcp, "port", doc).textContent = p.port;

  const fields: [string, string][] = [
    ["className", p.className],
    ["serviceName", p.serviceName],
    ["soapBinding", p.soapBinding],
  ];
  for (const [tag, val] of fields) ensureChild(root, tag, doc).textContent = val;

  return serialize(doc);
}

/** Default `<properties>` XML blob for a newly-created Web Service Listener connector. */
export const DEFAULT_WS_LISTENER_PROPERTIES_XML =
  `<properties class="com.mirth.connect.connectors.ws.WebServiceReceiverProperties" version="{{VERSION}}">` +
  `${HTTP_NONE_AUTH_XML}` +
  `<listenerConnectorProperties version="{{VERSION}}"><host>0.0.0.0</host><port>8081</port></listenerConnectorProperties>` +
  `${SRC_PROPS_XML}` +
  `<className>com.mirth.connect.connectors.ws.DefaultAcceptMessage</className>` +
  `<serviceName>Mirth</serviceName>` +
  `<soapBinding>DEFAULT</soapBinding>` +
  `</properties>`;

// ─── Destination Connectors ───────────────────────────────────────────────────

/**
 * Canonical built-in destination connector transport names, in dropdown order.
 * The Connector Type dropdown is registry-driven via
 * `visibleDestinationConnectorTypes`, so this is the built-in half —
 * DESTINATION_CONNECTOR_REGISTRY is kept in this same order and an order-lock
 * unit test enforces the match.
 */
export const DESTINATION_CONNECTOR_TYPES = [
  "Channel Writer",
  "Database Writer",
  "DICOM Sender",
  "Document Writer",
  "File Writer",
  "HTTP Sender",
  "JavaScript Writer",
  "JMS Sender",
  "SMTP Sender",
  "TCP Sender",
  "Web Service Sender",
] as const;

export type DestinationConnectorType = (typeof DESTINATION_CONNECTOR_TYPES)[number];

/** Common queue/response settings stored in <destinationConnectorProperties>. */
export interface DestinationQueueSettings {
  /** false = Never; true = On Failure (sendFirst=true) or Always (sendFirst=false) */
  queueEnabled: boolean;
  /** true = On Failure (try first, queue on fail); false = Always (queue immediately) */
  sendFirst: boolean;
  retryCount: number;
  retryIntervalMillis: number;
  rotate: boolean;
  regenerateTemplate: boolean;
  /** Only active when regenerateTemplate=true */
  includeFilterTransformer: boolean;
  threadCount: number;
  /** Only meaningful when threadCount > 1 */
  threadAssignmentVariable: string;
  queueBufferSize: number;
  validateResponse: boolean;
  reattachAttachments: boolean;
}

export const DEFAULT_DEST_QUEUE: DestinationQueueSettings = {
  queueEnabled: false,
  sendFirst: false,
  retryCount: 0,
  retryIntervalMillis: 10000,
  rotate: false,
  regenerateTemplate: false,
  includeFilterTransformer: false,
  threadCount: 1,
  threadAssignmentVariable: "",
  queueBufferSize: 1000,
  validateResponse: false,
  reattachAttachments: true,
};

export interface DestinationConnectorState {
  /** Permanent identifier (source=0, destinations=1+). Assigned by server on creation. */
  metaDataId: number;
  /** Display name shown in the destination list, e.g. "Destination 1". */
  name: string;
  /** Transport/connector type, e.g. "HTTP Sender". */
  transportName: string;
  enabled: boolean;
  /** Whether to wait for the previous destination to finish before running. */
  waitForPrevious: boolean;
  /** Common destination queue/response settings. */
  queue: DestinationQueueSettings;
  /**
   * Outer XML of the connector-specific <properties> element.
   * Contains <destinationConnectorProperties> + connector-specific fields.
   * Preserved verbatim during common-settings edits; replaced on connector-type change.
   */
  propertiesXml: string | null;
  /** Outer XML of <filter> — preserved; edited in Filter tab (future). */
  filterXml: string | null;
  /** Outer XML of <transformer> — preserved; edited in Transformer tab (future). */
  transformerXml: string | null;
  /** Outer XML of <responseTransformer> — preserved; edited in Response Transformer tab (future). */
  responseTransformerXml: string | null;
}

// ─── Default <destinationConnectorProperties> XML snippet ─────────────────────
// Embedded inside each connector's <properties> element.

const DEST_CONN_PROPS_XML =
  `<destinationConnectorProperties version="{{VERSION}}">` +
  `<queueEnabled>false</queueEnabled>` +
  `<sendFirst>false</sendFirst>` +
  `<retryIntervalMillis>10000</retryIntervalMillis>` +
  `<regenerateTemplate>false</regenerateTemplate>` +
  `<retryCount>0</retryCount>` +
  `<rotate>false</rotate>` +
  `<includeFilterTransformer>false</includeFilterTransformer>` +
  `<threadCount>1</threadCount>` +
  `<threadAssignmentVariable></threadAssignmentVariable>` +
  `<validateResponse>false</validateResponse>` +
  `<resourceIds class="linked-hash-map">` +
  `<entry><string>Default Resource</string><string>[Default Resource]</string></entry>` +
  `</resourceIds>` +
  `<queueBufferSize>1000</queueBufferSize>` +
  `<reattachAttachments>true</reattachAttachments>` +
  `</destinationConnectorProperties>`;

// ─── Default connector-specific <properties> XML blobs ────────────────────────
// One per destination connector type. Included verbatim when creating a new
// destination of that type. Phase 5 connectors will update these to richer defaults.

const DEST_CH_WRITER_XML =
  `<properties class="com.mirth.connect.connectors.vm.VmDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<channelId>none</channelId>` +
  `<channelTemplate>\${message.encodedData}</channelTemplate>` +
  `<mapVariables/>` +
  `</properties>`;

const DEST_JS_WRITER_XML =
  `<properties class="com.mirth.connect.connectors.js.JavaScriptDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<script></script>` +
  `</properties>`;

const DEST_HTTP_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.http.HttpDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<host></host>` +
  `<useProxyServer>false</useProxyServer>` +
  `<proxyAddress></proxyAddress>` +
  `<proxyPort></proxyPort>` +
  `<method>post</method>` +
  `<headers class="linked-hash-map"/>` +
  `<parameters class="linked-hash-map"/>` +
  `<useHeadersVariable>false</useHeadersVariable>` +
  `<headersVariable></headersVariable>` +
  `<useParametersVariable>false</useParametersVariable>` +
  `<parametersVariable></parametersVariable>` +
  `<responseXmlBody>false</responseXmlBody>` +
  `<responseParseMultipart>true</responseParseMultipart>` +
  `<responseIncludeMetadata>false</responseIncludeMetadata>` +
  `<responseBinaryMimeTypes>application/.*(?&lt;!json|xml)$|image/.*|video/.*|audio/.*</responseBinaryMimeTypes>` +
  `<responseBinaryMimeTypesRegex>true</responseBinaryMimeTypesRegex>` +
  `<multipart>false</multipart>` +
  `<useAuthentication>false</useAuthentication>` +
  `<authenticationType>Basic</authenticationType>` +
  `<usePreemptiveAuthentication>false</usePreemptiveAuthentication>` +
  `<username></username>` +
  `<password></password>` +
  `<content></content>` +
  `<contentType>text/plain</contentType>` +
  `<dataTypeBinary>false</dataTypeBinary>` +
  `<charset>UTF-8</charset>` +
  `<socketTimeout>30000</socketTimeout>` +
  `</properties>`;

const DEST_TCP_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.tcp.TcpDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML.replace("<validateResponse>false</validateResponse>", "<validateResponse>true</validateResponse>")}` +
  `<transmissionModeProperties class="com.mirth.connect.plugins.mllpmode.MLLPModeProperties">` +
  `<pluginPointName>MLLP</pluginPointName>` +
  `<startOfMessageBytes>0B</startOfMessageBytes><endOfMessageBytes>1C0D</endOfMessageBytes>` +
  `<useMLLPv2>false</useMLLPv2><ackBytes>06</ackBytes><nackBytes>15</nackBytes><maxRetries>2</maxRetries>` +
  `</transmissionModeProperties>` +
  `<serverMode>false</serverMode>` +
  `<remoteAddress>127.0.0.1</remoteAddress>` +
  `<remotePort>6660</remotePort>` +
  `<overrideLocalBinding>false</overrideLocalBinding>` +
  `<localAddress>0.0.0.0</localAddress>` +
  `<localPort>0</localPort>` +
  `<maxConnections>10</maxConnections>` +
  `<sendTimeout>5000</sendTimeout>` +
  `<bufferSize>65536</bufferSize>` +
  `<keepConnectionOpen>false</keepConnectionOpen>` +
  `<checkRemoteHost>false</checkRemoteHost>` +
  `<responseTimeout>5000</responseTimeout>` +
  `<ignoreResponse>false</ignoreResponse>` +
  `<queueOnResponseTimeout>true</queueOnResponseTimeout>` +
  `<dataTypeBinary>false</dataTypeBinary>` +
  `<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>` +
  `<template>\${message.encodedData}</template>` +
  `</properties>`;

const DEST_DB_WRITER_XML =
  `<properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<driver>Please Select One</driver>` +
  `<url></url>` +
  `<username></username>` +
  `<password></password>` +
  `<query></query>` +
  `<useScript>false</useScript>` +
  `</properties>`;

const DEST_FILE_WRITER_XML =
  `<properties class="com.mirth.connect.connectors.file.FileDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<scheme>file</scheme>` +
  `<host></host>` +
  `<outputPattern></outputPattern>` +
  `<anonymous>true</anonymous>` +
  `<username>anonymous</username>` +
  `<password>anonymous</password>` +
  `<timeout>10000</timeout>` +
  `<keepConnectionOpen>true</keepConnectionOpen>` +
  `<maxIdleTime>0</maxIdleTime>` +
  `<secure>true</secure>` +
  `<passive>true</passive>` +
  `<validateConnection>true</validateConnection>` +
  `<outputAppend>true</outputAppend>` +
  `<errorOnExists>false</errorOnExists>` +
  `<temporary>false</temporary>` +
  `<binary>false</binary>` +
  `<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>` +
  `<template>\${message.encodedData}</template>` +
  `</properties>`;

const DEST_SMTP_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.smtp.SmtpDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<smtpHost></smtpHost>` +
  `<smtpPort>25</smtpPort>` +
  `<overrideLocalBinding>false</overrideLocalBinding>` +
  `<localAddress>0.0.0.0</localAddress>` +
  `<localPort>0</localPort>` +
  `<timeout>5000</timeout>` +
  `<encryption>none</encryption>` +
  `<authentication>false</authentication>` +
  `<username></username>` +
  `<password></password>` +
  `<authType>NONE</authType>` +
  `<oAuthClientId></oAuthClientId>` +
  `<oAuthClientSecret></oAuthClientSecret>` +
  `<oAuthTokenEndpointUrl></oAuthTokenEndpointUrl>` +
  `<oAuthScope>https://outlook.office365.com/.default</oAuthScope>` +
  `<to></to>` +
  `<from></from>` +
  `<cc></cc>` +
  `<bcc></bcc>` +
  `<replyTo></replyTo>` +
  `<headers class="linked-hash-map"/>` +
  `<headersVariable></headersVariable>` +
  `<isUseHeadersVariable>false</isUseHeadersVariable>` +
  `<subject></subject>` +
  `<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>` +
  `<html>false</html>` +
  `<body></body>` +
  `<attachments/>` +
  `<attachmentsVariable></attachmentsVariable>` +
  `<isUseAttachmentsVariable>false</isUseAttachmentsVariable>` +
  `</properties>`;

const DEST_JMS_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.jms.JmsDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<useJndi>false</useJndi>` +
  `<jndiProviderUrl></jndiProviderUrl>` +
  `<jndiInitialContextFactory></jndiInitialContextFactory>` +
  `<jndiConnectionFactoryName></jndiConnectionFactoryName>` +
  `<connectionFactoryClass></connectionFactoryClass>` +
  `<connectionProperties class="linked-hash-map"/>` +
  `<username></username>` +
  `<password></password>` +
  `<destinationName></destinationName>` +
  `<topic>false</topic>` +
  `<clientId></clientId>` +
  `<template>\${message.encodedData}</template>` +
  `</properties>`;

const DEST_DOC_WRITER_XML =
  `<properties class="com.mirth.connect.connectors.doc.DocumentDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<host></host>` +
  `<outputPattern></outputPattern>` +
  `<documentType>pdf</documentType>` +
  `<encrypt>false</encrypt>` +
  `<output>FILE</output>` +
  `<password></password>` +
  `<pageWidth>8.5</pageWidth>` +
  `<pageHeight>11</pageHeight>` +
  `<pageUnit>INCHES</pageUnit>` +
  `<template></template>` +
  `</properties>`;

const DEST_DICOM_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.dimse.DICOMDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<host>127.0.0.1</host>` +
  `<port>104</port>` +
  `<applicationEntity></applicationEntity>` +
  `<localHost></localHost>` +
  `<localPort></localPort>` +
  `<localApplicationEntity></localApplicationEntity>` +
  `<template>\${DICOMMESSAGE}</template>` +
  `<acceptTo>5000</acceptTo><async>0</async><bufSize>1</bufSize><connectTo>0</connectTo>` +
  `<priority>med</priority><passcode></passcode><pdv1>false</pdv1>` +
  `<rcvpdulen>16</rcvpdulen><reaper>10</reaper><releaseTo>5</releaseTo><rspTo>60</rspTo>` +
  `<shutdownDelay>1000</shutdownDelay><sndpdulen>16</sndpdulen><soCloseDelay>50</soCloseDelay>` +
  `<sorcvbuf>0</sorcvbuf><sosndbuf>0</sosndbuf><stgcmt>false</stgcmt><tcpDelay>true</tcpDelay>` +
  `<ts1>false</ts1><uidnegrsp>false</uidnegrsp><username></username>` +
  `<keyPW></keyPW><keyStore></keyStore><keyStorePW></keyStorePW>` +
  `<noClientAuth>true</noClientAuth><nossl2>true</nossl2><tls>notls</tls>` +
  `<trustStore></trustStore><trustStorePW></trustStorePW>` +
  `</properties>`;

const DEST_WS_SENDER_XML =
  `<properties class="com.mirth.connect.connectors.ws.WebServiceDispatcherProperties" version="{{VERSION}}">` +
  `<pluginProperties/>${DEST_CONN_PROPS_XML}` +
  `<wsdlUrl></wsdlUrl>` +
  `<service></service>` +
  `<port></port>` +
  `<operation>Press Get Operations</operation>` +
  `<locationURI></locationURI>` +
  `<socketTimeout>30000</socketTimeout>` +
  `<useAuthentication>false</useAuthentication>` +
  `<username></username>` +
  `<password></password>` +
  `<envelope></envelope>` +
  `<oneWay>false</oneWay>` +
  `<headers class="linked-hash-map"/>` +
  `<headersVariable></headersVariable>` +
  `<isUseHeadersVariable>false</isUseHeadersVariable>` +
  `<useMtom>false</useMtom>` +
  `<attachmentNames/>` +
  `<attachmentContents/>` +
  `<attachmentTypes/>` +
  `<attachmentsVariable></attachmentsVariable>` +
  `<isUseAttachmentsVariable>false</isUseAttachmentsVariable>` +
  `<soapAction></soapAction>` +
  `<wsdlDefinitionMap><map class="linked-hash-map"/></wsdlDefinitionMap>` +
  `</properties>`;

/** Default connector-specific <properties> XML for each destination type. */
export const DEFAULT_DEST_PROPERTIES_XML: Record<string, string> = {
  "Channel Writer": DEST_CH_WRITER_XML,
  "Database Writer": DEST_DB_WRITER_XML,
  "DICOM Sender": DEST_DICOM_SENDER_XML,
  "Document Writer": DEST_DOC_WRITER_XML,
  "File Writer": DEST_FILE_WRITER_XML,
  "HTTP Sender": DEST_HTTP_SENDER_XML,
  "JavaScript Writer": DEST_JS_WRITER_XML,
  "JMS Sender": DEST_JMS_SENDER_XML,
  "SMTP Sender": DEST_SMTP_SENDER_XML,
  "TCP Sender": DEST_TCP_SENDER_XML,
  "Web Service Sender": DEST_WS_SENDER_XML,
};

// ─── Default transformer / filter XML fragments ───────────────────────────────

/** Builds default <transformer> XML for a new destination connector (HL7V2 in/out with full properties). */
function buildDefaultTransformerXml(version: string, inboundType = "HL7V2"): string {
  return (
    `<transformer version="${version}"><elements/>` +
    `<inboundDataType>${inboundType}</inboundDataType>` +
    `<outboundDataType>HL7V2</outboundDataType>` +
    defaultPropertiesXml(inboundType, "inboundProperties", version) +
    defaultPropertiesXml("HL7V2", "outboundProperties", version) +
    `</transformer>`
  );
}

/** Builds default <responseTransformer> XML for a new destination connector (HL7V2 in/out with full properties). */
function buildDefaultResponseTransformerXml(version: string): string {
  return (
    `<responseTransformer version="${version}"><elements/>` +
    `<inboundDataType>HL7V2</inboundDataType>` +
    `<outboundDataType>HL7V2</outboundDataType>` +
    defaultPropertiesXml("HL7V2", "inboundProperties", version) +
    defaultPropertiesXml("HL7V2", "outboundProperties", version) +
    `</responseTransformer>`
  );
}

// Placeholder-bearing templates: {{VERSION}} is substituted with the resolved
// server version at each consumption site (see withVersion / resolveXmlVersion).
const DEFAULT_DEST_TRANSFORMER_XML = buildDefaultTransformerXml("{{VERSION}}");

export const DEFAULT_DEST_RESPONSE_TRANSFORMER_XML =
  buildDefaultResponseTransformerXml("{{VERSION}}");

const DEFAULT_DEST_FILTER_XML = `<filter version="{{VERSION}}"><elements/></filter>`;

// ─── Internal: parse queue settings from a <destinationConnectorProperties> el ──

function parseDestQueueSettings(dcp: Element | null): DestinationQueueSettings {
  if (!dcp) return { ...DEFAULT_DEST_QUEUE };
  function b(tag: string, def: boolean): boolean {
    const v = dcp!.querySelector(tag)?.textContent?.trim();
    return v === undefined ? def : v === "true";
  }
  function n(tag: string, def: number): number {
    const v = dcp!.querySelector(tag)?.textContent?.trim();
    const p = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(p) ? def : p;
  }
  function s(tag: string, def: string): string {
    return dcp!.querySelector(tag)?.textContent ?? def;
  }
  // Java defaults a stored buffer size of <= 0 to the channel default (server-configured, else 1000).
  const bufferSize = n("queueBufferSize", resolveDefaultQueueBufferSize());
  return {
    queueEnabled: b("queueEnabled", false),
    sendFirst: b("sendFirst", false),
    retryCount: n("retryCount", 0),
    retryIntervalMillis: n("retryIntervalMillis", 10000),
    rotate: b("rotate", false),
    regenerateTemplate: b("regenerateTemplate", false),
    includeFilterTransformer: b("includeFilterTransformer", false),
    threadCount: n("threadCount", 1),
    threadAssignmentVariable: s("threadAssignmentVariable", ""),
    queueBufferSize: bufferSize > 0 ? bufferSize : resolveDefaultQueueBufferSize(),
    validateResponse: b("validateResponse", false),
    reattachAttachments: b("reattachAttachments", true),
  };
}

/**
 * Default queue settings for a given connector type. Derives from the connector's
 * own default <destinationConnectorProperties> so per-connector overrides (e.g. TCP
 * Sender's validateResponse=true) are honored, matching the Java client. Falls back
 * to DEFAULT_DEST_QUEUE for unknown types.
 *
 * `fallbackXml` covers registered (non-built-in) connectors whose default
 * properties live in the destination registry rather than the static map —
 * this module cannot read the registry itself (import cycle), so the caller
 * passes the resolved default XML.
 */
export function defaultQueueForType(
  transportName: string,
  fallbackXml?: string | null
): DestinationQueueSettings {
  // A freshly-added destination model-defaults queueBufferSize to 0 in Java, so it always picks up
  // the channel default (server-configured, else 1000) rather than the literal 1000 in the template.
  const bufferSize = resolveDefaultQueueBufferSize();
  const xml = DEFAULT_DEST_PROPERTIES_XML[transportName] ?? fallbackXml;
  if (!xml) return { ...DEFAULT_DEST_QUEUE, queueBufferSize: bufferSize };
  const dcp = new DOMParser()
    .parseFromString(xml, "application/xml")
    .querySelector("destinationConnectorProperties");
  return { ...parseDestQueueSettings(dcp), queueBufferSize: bufferSize };
}

// ─── Internal: write queue settings into a <destinationConnectorProperties> el ──

/**
 * Updates only the known scalar queue fields in-place via {@link ensureChild}.
 * This is intentionally non-destructive: unknown children of
 * <destinationConnectorProperties> (notably <pluginProperties> for commercial
 * advanced-queue plugins) are left untouched and survive the round-trip, because
 * the full <properties> blob is preserved through `state.propertiesXml` and only
 * these tags are rewritten. Do not switch to a clear-and-rebuild approach without
 * preserving those children — see the round-trip regression test.
 */
function writeDestQueueSettings(dcp: Element, q: DestinationQueueSettings, doc: Document): void {
  const fields: [string, string][] = [
    ["queueEnabled", String(q.queueEnabled)],
    ["sendFirst", String(q.sendFirst)],
    ["retryIntervalMillis", String(q.retryIntervalMillis)],
    ["regenerateTemplate", String(q.regenerateTemplate)],
    ["retryCount", String(q.retryCount)],
    ["rotate", String(q.rotate)],
    ["includeFilterTransformer", String(q.includeFilterTransformer)],
    ["threadCount", String(q.threadCount)],
    ["threadAssignmentVariable", q.threadAssignmentVariable],
    ["validateResponse", String(q.validateResponse)],
    ["queueBufferSize", String(q.queueBufferSize)],
    ["reattachAttachments", String(q.reattachAttachments)],
  ];
  for (const [tag, val] of fields) {
    ensureChild(dcp, tag, doc).textContent = val;
  }
}

// ─── Parse all destination connectors from channel XML ───────────────────────

export function parseDestinationConnectorsFromXml(xml: string): DestinationConnectorState[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const connEls = doc.querySelectorAll("channel > destinationConnectors > connector");
  const result: DestinationConnectorState[] = [];

  for (const conn of connEls) {
    const propsEl = conn.querySelector(":scope > properties");
    const dcp = propsEl?.querySelector(":scope > destinationConnectorProperties") ?? null;

    result.push({
      metaDataId: parseInt(
        conn.querySelector(":scope > metaDataId")?.textContent?.trim() ?? "1",
        10
      ),
      name: conn.querySelector(":scope > name")?.textContent ?? "Destination",
      transportName:
        conn.querySelector(":scope > transportName")?.textContent?.trim() ?? "Channel Writer",
      enabled: conn.querySelector(":scope > enabled")?.textContent?.trim() !== "false",
      waitForPrevious:
        conn.querySelector(":scope > waitForPrevious")?.textContent?.trim() !== "false",
      queue: parseDestQueueSettings(dcp),
      propertiesXml: elOuterXml(propsEl),
      filterXml: elOuterXml(conn.querySelector(":scope > filter")),
      transformerXml: elOuterXml(conn.querySelector(":scope > transformer")),
      responseTransformerXml: elOuterXml(conn.querySelector(":scope > responseTransformer")),
    });
  }

  return result;
}

// ─── Serialize one destination connector back into channel XML ────────────────

/**
 * Applies a DestinationConnectorState onto an EXISTING `<connector>` DOM node,
 * mutating only the known children (name, transportName, enabled,
 * waitForPrevious, properties, filter, transformer, responseTransformer).
 *
 * Because it mutates the existing node in place rather than rebuilding it from
 * scratch, any unrecognized connector-level children (future server fields,
 * plugin children) are left untouched and survive the round-trip.
 * `metaDataId` and `mode` are intentionally not written — they belong to the
 * existing node's identity and never change on an update.
 */
function applyConnectorStateInPlace(
  doc: Document,
  conn: Element,
  state: DestinationConnectorState
): void {
  // Version to stamp on any freshly built default XML (channel root → server → fallback).
  const version = resolveXmlVersion(doc.documentElement.getAttribute("version"));

  // Top-level scalar fields
  ensureChild(conn, "name", doc).textContent = state.name;
  ensureChild(conn, "transportName", doc).textContent = state.transportName;
  ensureChild(conn, "enabled", doc).textContent = String(state.enabled);
  ensureChild(conn, "waitForPrevious", doc).textContent = String(state.waitForPrevious);

  // Update <properties> (contains destinationConnectorProperties + connector-specific).
  // withVersion is a no-op on existing props (no placeholder) and stamps the default blobs.
  const propsXmlSrc = withVersion(
    state.propertiesXml ?? DEFAULT_DEST_PROPERTIES_XML[state.transportName] ?? DEST_CH_WRITER_XML,
    version
  );
  const propsDoc = new DOMParser().parseFromString(propsXmlSrc, "application/xml");
  const propsRoot = propsDoc.documentElement;

  let dcp = propsRoot.querySelector(":scope > destinationConnectorProperties");
  if (!dcp) {
    dcp = propsDoc.createElementNS(null, "destinationConnectorProperties");
    dcp.setAttribute("version", version);
    const pluginProps = propsRoot.querySelector(":scope > pluginProperties");
    if (pluginProps) pluginProps.after(dcp);
    else propsRoot.insertBefore(dcp, propsRoot.firstChild);
  }
  writeDestQueueSettings(dcp, state.queue, propsDoc);

  const newPropsEl = doc.importNode(propsRoot, true);
  const oldPropsEl = conn.querySelector(":scope > properties");
  if (oldPropsEl) conn.replaceChild(newPropsEl, oldPropsEl);
  else conn.insertBefore(newPropsEl, conn.firstChild);

  // Restore preserved filter / transformer elements
  for (const [stateXml, tag] of [
    [state.filterXml, "filter"],
    [state.transformerXml, "transformer"],
    [state.responseTransformerXml, "responseTransformer"],
  ] as [string | null, string][]) {
    if (!stateXml) continue;
    const elDoc = new DOMParser().parseFromString(
      withVersion(stateXml, version),
      "application/xml"
    );
    const newEl = doc.importNode(elDoc.documentElement, true);
    const oldEl = conn.querySelector(`:scope > ${tag}`);
    if (oldEl) conn.replaceChild(newEl, oldEl);
    else conn.appendChild(newEl);
  }
}

/**
 * Updates the destination connector at position `index` (0-based in destinationConnectors)
 * within the full channel XML string. All other destinations are left untouched.
 */
export function serializeDestinationConnectorToXml(
  xml: string,
  index: number,
  state: DestinationConnectorState
): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const conns = Array.from(doc.querySelectorAll("channel > destinationConnectors > connector"));
  const conn = conns[index];
  if (!conn) return xml;

  applyConnectorStateInPlace(doc, conn, state);

  return serialize(doc);
}

// ─── Rebuild all destinations (reorder / add / remove) ───────────────────────

/**
 * Rebuilds the entire <destinationConnectors> element from an array of states.
 * Use this when destinations are added, removed, or reordered.
 * <nextMetaDataId> in the channel root is NOT changed — only addDestinationToXml does that.
 */
export function serializeAllDestinationsToXml(
  xml: string,
  states: DestinationConnectorState[]
): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return xml;

  const existingDestsEl = channel.querySelector(":scope > destinationConnectors");
  const destsEl = existingDestsEl ?? doc.createElementNS(null, "destinationConnectors");

  // Index the existing <connector> nodes by metaDataId so we can REUSE them
  // instead of rebuilding from state. Rebuilding via buildConnectorElement would
  // emit only the 10 known Connector fields and silently drop any other
  // connector-level child (future server field / plugin child) —.
  // The incoming xml already reflects every committed per-connector edit (the
  // single-destination edit path writes it in place), so reusing the node and
  // re-applying state covers both reorder (no field delta) and toggle-enabled
  // (a real `enabled` delta) without loss.
  const existingByMetaId = new Map<number, Element>();
  for (const conn of Array.from(destsEl.querySelectorAll(":scope > connector"))) {
    const id = parseInt(conn.querySelector(":scope > metaDataId")?.textContent?.trim() ?? "", 10);
    if (!Number.isNaN(id)) existingByMetaId.set(id, conn);
  }

  // Detach all current connectors, then re-append in the target order.
  while (destsEl.firstChild) destsEl.removeChild(destsEl.firstChild);

  for (const state of states) {
    const existing = existingByMetaId.get(state.metaDataId);
    if (existing) {
      applyConnectorStateInPlace(doc, existing, state);
      destsEl.appendChild(existing);
    } else {
      // No matching node (should not happen for reorder/toggle) — build fresh.
      destsEl.appendChild(buildConnectorElement(doc, state));
    }
  }

  if (!existingDestsEl) channel.appendChild(destsEl);

  return serialize(doc);
}

// ─── Add a new destination connector ─────────────────────────────────────────

/**
 * Appends a new destination connector of `transportName` to the channel XML.
 * Uses the current <nextMetaDataId> as the new connector's metaDataId, then increments it.
 */
export function addDestinationToXml(xml: string, transportName: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return xml;

  // Read the channel version so new connectors carry the correct version attributes
  // (channel root → cached server version → fallback), mirroring Java's marshal.
  const version = resolveXmlVersion(channel.getAttribute("version"));

  // New destination inbound must match source outbound (the cascade rule)
  const srcOutboundType =
    channel
      .querySelector(":scope > sourceConnector > transformer > outboundDataType")
      ?.textContent?.trim() ?? "HL7V2";

  const nextId = allocateMetaDataId(channel, doc);

  // Mirror Java's getNewDestinationName(): find first "Destination N" not already used
  const existingNames = new Set(
    Array.from(doc.querySelectorAll("channel > destinationConnectors > connector > name")).map(
      (el) => (el.textContent?.trim() ?? "").toLowerCase()
    )
  );
  const destName = nextDestinationName(existingNames);

  const newState: DestinationConnectorState = {
    metaDataId: nextId,
    name: destName,
    transportName,
    enabled: true,
    waitForPrevious: true,
    queue: defaultQueueForType(transportName),
    propertiesXml: DEFAULT_DEST_PROPERTIES_XML[transportName]
      ? withVersion(DEFAULT_DEST_PROPERTIES_XML[transportName], version)
      : null,
    filterXml: withVersion(DEFAULT_DEST_FILTER_XML, version),
    transformerXml: buildDefaultTransformerXml(version, srcOutboundType),
    responseTransformerXml: buildDefaultResponseTransformerXml(version),
  };

  let destsEl = channel.querySelector(":scope > destinationConnectors");
  if (!destsEl) {
    destsEl = doc.createElementNS(null, "destinationConnectors");
    channel.appendChild(destsEl);
  }
  destsEl.appendChild(buildConnectorElement(doc, newState));

  return serialize(doc);
}

// ─── Duplicate a destination connector ───────────────────────────────────────

/**
 * Clones the destination at `index`, assigns a fresh metaDataId (from
 * <nextMetaDataId>), names it "Copy of {name}", and inserts it immediately
 * after the source.  Returns the updated XML string.
 */
export function duplicateDestinationToXml(
  xml: string,
  states: DestinationConnectorState[],
  index: number
): string {
  const source = states[index];
  if (!source) return xml;

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return xml;

  const sourceEl = channel.querySelectorAll(":scope > destinationConnectors > connector")[index];
  if (!sourceEl) return xml;

  // Allocate a fresh metaDataId (and bump nextMetaDataId) for the duplicate.
  const nextId = allocateMetaDataId(channel, doc);

  // Deep-clone the existing <connector> DOM node so ALL of its children —
  // including any unrecognized connector-level children — are copied verbatim
  //, rather than rebuilt from the 10 known Connector fields. Only the
  // identity fields (metaDataId, name) change on the clone.
  const cloneEl = sourceEl.cloneNode(true) as Element;
  ensureChild(cloneEl, "metaDataId", doc).textContent = String(nextId);
  ensureChild(cloneEl, "name", doc).textContent = `Copy of ${source.name}`;

  // Insert the clone immediately after the source; all other nodes untouched.
  sourceEl.after(cloneEl);

  return serialize(doc);
}

// ─── Remove a destination connector ──────────────────────────────────────────

/**
 * Removes the destination connector at position `index` (0-based).
 * Refuses to remove the last remaining destination.
 */
export function removeDestinationFromXml(xml: string, index: number): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const conns = Array.from(doc.querySelectorAll("channel > destinationConnectors > connector"));
  if (conns.length <= 1) return xml; // Always keep at least one destination
  const conn = conns[index];
  if (!conn) return xml;
  conn.parentNode?.removeChild(conn);
  return serialize(doc);
}

// ─── Export / Import a single connector ──────────────────────────────────────

export type ConnectorMode = "SOURCE" | "DESTINATION";

/**
 * Finds the first unused "Destination N" name, mirroring Java's
 * ChannelSetup.getNewDestinationName(). `existingNames` must be lowercased.
 */
function nextDestinationName(existingNames: Set<string>): string {
  for (let i = 1; i <= existingNames.size + 1; i++) {
    const candidate = `Destination ${i}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }
  return `Destination ${existingNames.size + 1}`;
}

/**
 * Forces a transformer's inbound data type to `dataType`, swapping in the data
 * type's default <inboundProperties> when the type actually changes. Mirrors
 * Java's behavior of resetting inbound properties to the plugin defaults when a
 * connector's inbound data type is realigned to the source outbound type.
 * No-op when the transformer already uses `dataType` (preserves user edits).
 */
function applyInboundDataType(
  doc: Document,
  transformer: Element,
  dataType: string,
  version: string
): void {
  const inboundTypeEl = ensureChild(transformer, "inboundDataType", doc);
  if (inboundTypeEl.textContent?.trim() === dataType) return;
  inboundTypeEl.textContent = dataType;

  const defXml = defaultPropertiesXml(dataType, "inboundProperties", version);
  const parsed = new DOMParser().parseFromString(defXml, "application/xml");
  const imported = doc.importNode(parsed.documentElement, true);
  const existing = transformer.querySelector(":scope > inboundProperties");
  if (existing) transformer.replaceChild(imported, existing);
  else transformer.appendChild(imported);
}

/**
 * Serializes a connector subtree to a standalone `<connector>` XML string —
 * the same root element the Java client's ObjectXMLSerializer produces for a
 * Connector, so the file is interchangeable with the legacy Administrator.
 * The source connector (stored as `<sourceConnector>`) is re-rooted to
 * `<connector>`; destination connectors are already rooted at `<connector>`.
 */
function serializeStandaloneConnector(doc: Document, connectorEl: Element): string {
  const connEl = doc.createElementNS(null, "connector");
  for (const attr of Array.from(connectorEl.attributes)) {
    connEl.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(connectorEl.childNodes)) {
    connEl.appendChild(child.cloneNode(true));
  }
  return new XMLSerializer().serializeToString(connEl);
}

/** Builds the standalone `<connector>` XML for the source connector, or null if absent. */
export function exportSourceConnectorXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const src = doc.querySelector("channel > sourceConnector");
  return src ? serializeStandaloneConnector(doc, src) : null;
}

/** Builds the standalone `<connector>` XML for the destination at `index`, or null if absent. */
export function exportDestinationConnectorXml(xml: string, index: number): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const conn = Array.from(doc.querySelectorAll("channel > destinationConnectors > connector"))[
    index
  ];
  return conn ? serializeStandaloneConnector(doc, conn) : null;
}

/**
 * Derives the export filename (without extension), mirroring Java's
 * Frame.doExportConnector(): "{ChannelName} Source" for the source connector,
 * "{ChannelName} {ConnectorName}" for a destination.
 */
export function connectorExportFilename(
  xml: string,
  target: "source" | { destIndex: number }
): string {
  const channelName = parseChannelName(xml);
  if (target === "source") return `${channelName} Source`;
  const dests = parseDestinationConnectorsFromXml(xml);
  const name = dests[target.destIndex]?.name ?? `Destination ${target.destIndex + 1}`;
  return `${channelName} ${name}`;
}

/**
 * Reads the mode of an imported connector file. Returns null when the file is
 * not a valid standalone connector (wrong root element, malformed XML, or
 * missing/unknown mode).
 */
export function parseConnectorFileMode(fileXml: string): ConnectorMode | null {
  try {
    const doc = new DOMParser().parseFromString(fileXml, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    const root = doc.documentElement;
    if (!root || root.nodeName !== "connector") return null;
    const mode = root.querySelector(":scope > mode")?.textContent?.trim();
    return mode === "SOURCE" || mode === "DESTINATION" ? mode : null;
  } catch {
    return null;
  }
}

/**
 * Replaces the channel's source connector with an imported connector file
 * (root `<connector>`, mode SOURCE). Re-roots it to `<sourceConnector>`, pins
 * metaDataId 0, and cascades the new source outbound data type onto every
 * destination's inbound data type — mirroring Java ChannelSetup.importConnector().
 * Caller must validate the file mode via parseConnectorFileMode() first.
 */
export function importSourceConnectorIntoXml(channelXml: string, fileXml: string): string {
  const doc = new DOMParser().parseFromString(channelXml, "application/xml");
  const channel = doc.querySelector("channel");
  const oldSrc = channel?.querySelector(":scope > sourceConnector");
  if (!channel || !oldSrc) return channelXml;

  const importedConn = new DOMParser().parseFromString(fileXml, "application/xml").documentElement;

  const newSrc = doc.createElementNS(null, "sourceConnector");
  for (const attr of Array.from(importedConn.attributes)) {
    newSrc.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(importedConn.childNodes)) {
    newSrc.appendChild(doc.importNode(child, true));
  }
  // Source-slot invariants (defensive — a valid source file already has these).
  ensureChild(newSrc, "metaDataId", doc).textContent = "0";
  ensureChild(newSrc, "mode", doc).textContent = "SOURCE";

  channel.replaceChild(newSrc, oldSrc);

  // Cascade: align every destination inbound data type to the new source outbound.
  const srcOutbound = newSrc
    .querySelector(":scope > transformer > outboundDataType")
    ?.textContent?.trim();
  if (srcOutbound) {
    const version = resolveXmlVersion(channel.getAttribute("version"));
    for (const conn of doc.querySelectorAll("channel > destinationConnectors > connector")) {
      const t = conn.querySelector(":scope > transformer");
      if (t) applyInboundDataType(doc, t, srcOutbound, version);
    }
  }

  return serialize(doc);
}

/**
 * Appends an imported connector file (root `<connector>`, mode DESTINATION) as a
 * new destination: assigns a fresh metaDataId from <nextMetaDataId>, resolves
 * name collisions ("Destination N"), and aligns its inbound data type to the
 * source outbound type — mirroring Java ChannelSetup.importConnector().
 * Caller must validate the file mode via parseConnectorFileMode() first.
 */
export function importDestinationConnectorIntoXml(channelXml: string, fileXml: string): string {
  const doc = new DOMParser().parseFromString(channelXml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return channelXml;

  const imported = doc.importNode(
    new DOMParser().parseFromString(fileXml, "application/xml").documentElement,
    true
  );
  const version = resolveXmlVersion(channel.getAttribute("version"));

  // Assign a fresh metaDataId (and bump nextMetaDataId).
  const nextId = allocateMetaDataId(channel, doc);
  ensureChild(imported, "metaDataId", doc).textContent = String(nextId);
  ensureChild(imported, "mode", doc).textContent = "DESTINATION";

  // Resolve name collisions against existing destinations.
  const existingNames = new Set(
    Array.from(doc.querySelectorAll("channel > destinationConnectors > connector > name")).map(
      (el) => (el.textContent?.trim() ?? "").toLowerCase()
    )
  );
  const nameEl = ensureChild(imported, "name", doc);
  const importedName = nameEl.textContent?.trim() ?? "";
  if (importedName === "" || existingNames.has(importedName.toLowerCase())) {
    nameEl.textContent = nextDestinationName(existingNames);
  }

  // Cascade: align the new destination's inbound data type to the source outbound.
  const srcOutbound = channel
    .querySelector(":scope > sourceConnector > transformer > outboundDataType")
    ?.textContent?.trim();
  const transformer = imported.querySelector(":scope > transformer");
  if (srcOutbound && transformer) applyInboundDataType(doc, transformer, srcOutbound, version);

  let destsEl = channel.querySelector(":scope > destinationConnectors");
  if (!destsEl) {
    destsEl = doc.createElementNS(null, "destinationConnectors");
    channel.appendChild(destsEl);
  }
  destsEl.appendChild(imported);

  return serialize(doc);
}

// ─── Inject save metadata (lastModified + userId) ─────────────────────────────

/**
 * Injects/updates exportData.metadata.lastModified and exportData.metadata.userId
 * into the channel XML immediately before saving.
 *
 * Mirrors Java's ChannelSetup.setLastModified() + setUserId() which are called on
 * EVERY save (lines 1251-1252 in ChannelSetup.java):
 *   setLastModified() → currentChannel.getExportData().getMetadata()
 *                           .setLastModified(Calendar.getInstance())
 *   setUserId()       → .setUserId(parent.mirthClient.getCurrentUser().getId())
 */
export function injectSaveMetadata(xml: string, userId: number): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return xml;

  // Ensure exportData > metadata chain exists
  let exportData = channel.querySelector(":scope > exportData");
  if (!exportData) {
    exportData = doc.createElementNS(null, "exportData");
    channel.appendChild(exportData);
  }
  let metadata = exportData.querySelector(":scope > metadata");
  if (!metadata) {
    metadata = doc.createElementNS(null, "metadata");
    exportData.insertBefore(metadata, exportData.firstChild);
  }

  /** Upsert a child element, then let `fn` populate its content. */
  function upsertChild(parent: Element, tag: string, fn: (el: Element) => void): void {
    let el = parent.querySelector(`:scope > ${tag}`);
    if (!el) {
      el = doc.createElementNS(null, tag);
      parent.appendChild(el);
    }
    fn(el);
  }

  // Set lastModified to current time — matches Java's Calendar.getInstance()
  upsertChild(metadata, "lastModified", (lm) => {
    // Clear existing children
    while (lm.firstChild) lm.removeChild(lm.firstChild);
    const timeEl = doc.createElementNS(null, "time");
    timeEl.textContent = String(Date.now());
    lm.appendChild(timeEl);
    const tzEl = doc.createElementNS(null, "timezone");
    // IANA timezone — matches Java's TimeZone.getDefault().getID() format (e.g. "America/Los_Angeles")
    tzEl.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
    lm.appendChild(tzEl);
  });

  // Set userId — matches Java's mirthClient.getCurrentUser().getId()
  upsertChild(metadata, "userId", (el) => {
    el.textContent = String(userId);
  });

  return serialize(doc);
}

/**
 * Sets the channel's enabled flag (exportData.metadata.enabled).
 *
 * Mirrors Java ChannelSetup.saveChanges (lines 1263/1283): when validation fails,
 * the channel is saved with `metadata.enabled = false` (work-in-progress channels
 * are persistable, just disabled). Ensures the exportData > metadata chain exists
 * so a fresh channel without it still gets the flag written inside metadata
 * (never outside it — a stray sibling deserializes as disabled, #25).
 */
export function setChannelEnabledInXml(xml: string, enabled: boolean): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const channel = doc.querySelector("channel");
  if (!channel) return xml;

  let exportData = channel.querySelector(":scope > exportData");
  if (!exportData) {
    exportData = doc.createElementNS(null, "exportData");
    channel.appendChild(exportData);
  }
  let metadata = exportData.querySelector(":scope > metadata");
  if (!metadata) {
    metadata = doc.createElementNS(null, "metadata");
    exportData.insertBefore(metadata, exportData.firstChild);
  }

  let enabledEl = metadata.querySelector(":scope > enabled");
  if (!enabledEl) {
    enabledEl = doc.createElementNS(null, "enabled");
    metadata.insertBefore(enabledEl, metadata.firstChild);
  }
  enabledEl.textContent = String(enabled);

  return serialize(doc);
}

// ─── Internal: build a <connector> DOM element from a DestinationConnectorState ──

function buildConnectorElement(doc: Document, state: DestinationConnectorState): Element {
  // Version to stamp (channel root → cached server version → fallback), mirroring
  // Java's MigratableConverter.marshal. withVersion below is a no-op on existing
  // state XML (no placeholder) and substitutes it into the default blobs.
  const version = resolveXmlVersion(doc.documentElement.getAttribute("version"));

  const connEl = doc.createElementNS(null, "connector");
  connEl.setAttribute("version", version);

  function appendText(tag: string, val: string) {
    const el = doc.createElementNS(null, tag);
    el.textContent = val;
    connEl.appendChild(el);
  }

  appendText("metaDataId", String(state.metaDataId));
  appendText("name", state.name);

  // <properties> with updated queue settings
  const propsXmlSrc = withVersion(
    state.propertiesXml ?? DEFAULT_DEST_PROPERTIES_XML[state.transportName] ?? DEST_CH_WRITER_XML,
    version
  );
  const propsDoc = new DOMParser().parseFromString(propsXmlSrc, "application/xml");
  const propsRoot = propsDoc.documentElement;
  let dcp = propsRoot.querySelector(":scope > destinationConnectorProperties");
  if (!dcp) {
    dcp = propsDoc.createElementNS(null, "destinationConnectorProperties");
    dcp.setAttribute("version", version);
    const pluginProps = propsRoot.querySelector(":scope > pluginProperties");
    if (pluginProps) pluginProps.after(dcp);
    else propsRoot.insertBefore(dcp, propsRoot.firstChild);
  }
  writeDestQueueSettings(dcp, state.queue, propsDoc);
  connEl.appendChild(doc.importNode(propsRoot, true));

  // <transformer>
  const txSrc = withVersion(state.transformerXml ?? DEFAULT_DEST_TRANSFORMER_XML, version);
  connEl.appendChild(
    doc.importNode(new DOMParser().parseFromString(txSrc, "application/xml").documentElement, true)
  );

  // <responseTransformer>
  const rtxSrc = withVersion(
    state.responseTransformerXml ?? DEFAULT_DEST_RESPONSE_TRANSFORMER_XML,
    version
  );
  connEl.appendChild(
    doc.importNode(new DOMParser().parseFromString(rtxSrc, "application/xml").documentElement, true)
  );

  // <filter>
  const filterSrc = withVersion(state.filterXml ?? DEFAULT_DEST_FILTER_XML, version);
  connEl.appendChild(
    doc.importNode(
      new DOMParser().parseFromString(filterSrc, "application/xml").documentElement,
      true
    )
  );

  appendText("transportName", state.transportName);
  appendText("mode", "DESTINATION");
  appendText("enabled", String(state.enabled));
  appendText("waitForPrevious", String(state.waitForPrevious));

  return connEl;
}

// ─── Shared: Name/Value entry (linked-hash-map) ───────────────────────────────

export interface NameValueEntry {
  name: string;
  value: string;
}

/** Parses a BridgeLink `<x class="linked-hash-map">` element into NameValueEntry[]. */
function parseLinkedHashMap(root: Element, elementName: string): NameValueEntry[] {
  const mapEl = root.querySelector(`:scope > ${elementName}`);
  if (!mapEl) return [];
  const result: NameValueEntry[] = [];
  for (const entry of mapEl.querySelectorAll(":scope > entry")) {
    const strings = entry.querySelectorAll(":scope > string");
    if (strings.length >= 2) {
      result.push({ name: strings[0].textContent ?? "", value: strings[1].textContent ?? "" });
    }
  }
  return result;
}

/** Writes NameValueEntry[] back into a `<x class="linked-hash-map">` element. */
function writeLinkedHashMap(
  root: Element,
  elementName: string,
  entries: NameValueEntry[],
  doc: Document
): void {
  let mapEl = root.querySelector(`:scope > ${elementName}`);
  if (!mapEl) {
    mapEl = doc.createElementNS(null, elementName);
    mapEl.setAttribute("class", "linked-hash-map");
    root.appendChild(mapEl);
  } else {
    mapEl.setAttribute("class", "linked-hash-map");
    while (mapEl.firstChild) mapEl.removeChild(mapEl.firstChild);
  }
  for (const { name, value } of entries) {
    const entryEl = doc.createElementNS(null, "entry");
    const k = doc.createElementNS(null, "string");
    k.textContent = name;
    const v = doc.createElementNS(null, "string");
    v.textContent = value;
    entryEl.appendChild(k);
    entryEl.appendChild(v);
    mapEl.appendChild(entryEl);
  }
}

/**
 * Parses a BridgeLink `<x class="linked-hash-map">` element that holds a
 * `Map<String, List<String>>` (HTTP/Web Service headers & parameters) into flat
 * NameValueEntry[] rows — one row per value in each key's list, mirroring the
 * Java client's setHeaders()/setParameters() table population.
 *
 * Each entry's value is wrapped in a `<list>`:
 *   `<entry><string>key</string><list><string>v1</string><string>v2</string></list></entry>`
 *
 * Falls back to reading the remaining direct `<string>` children when no `<list>`
 * wrapper is present, so channels already corrupted by the flat serializer (a
 * bare second `<string>`) still display and are repaired on the next save.
 */
export function parseLinkedHashMapList(root: Element, elementName: string): NameValueEntry[] {
  const mapEl = root.querySelector(`:scope > ${elementName}`);
  if (!mapEl) return [];
  const result: NameValueEntry[] = [];
  for (const entry of mapEl.querySelectorAll(":scope > entry")) {
    const strings = entry.querySelectorAll(":scope > string");
    if (strings.length === 0) continue;
    const name = strings[0].textContent ?? "";
    const listEl = entry.querySelector(":scope > list");
    if (listEl) {
      for (const strEl of listEl.querySelectorAll(":scope > string")) {
        result.push({ name, value: strEl.textContent ?? "" });
      }
    } else {
      // Legacy/corrupted flat form: <entry><string>k</string><string>v</string></entry>
      for (let i = 1; i < strings.length; i++) {
        result.push({ name, value: strings[i].textContent ?? "" });
      }
    }
  }
  return result;
}

/**
 * Writes NameValueEntry[] back into a `<x class="linked-hash-map">` element as a
 * `Map<String, List<String>>` — grouping rows by name (insertion order) into one
 * `<entry>` per key whose value is a `<list>` of `<string>`. Mirrors the Java
 * client's getProperties(table) grouping for HTTP/Web Service headers & parameters.
 */
export function writeLinkedHashMapList(
  root: Element,
  elementName: string,
  entries: NameValueEntry[],
  doc: Document
): void {
  let mapEl = root.querySelector(`:scope > ${elementName}`);
  if (!mapEl) {
    mapEl = doc.createElementNS(null, elementName);
    mapEl.setAttribute("class", "linked-hash-map");
    root.appendChild(mapEl);
  } else {
    mapEl.setAttribute("class", "linked-hash-map");
    while (mapEl.firstChild) mapEl.removeChild(mapEl.firstChild);
  }
  // Group rows by name, preserving first-seen order (matches Java LinkedHashMap).
  const grouped = new Map<string, string[]>();
  for (const { name, value } of entries) {
    const existing = grouped.get(name);
    if (existing) {
      existing.push(value);
    } else {
      grouped.set(name, [value]);
    }
  }
  for (const [name, values] of grouped) {
    const entryEl = doc.createElementNS(null, "entry");
    const k = doc.createElementNS(null, "string");
    k.textContent = name;
    entryEl.appendChild(k);
    const list = doc.createElementNS(null, "list");
    for (const value of values) {
      const v = doc.createElementNS(null, "string");
      v.textContent = value;
      list.appendChild(v);
    }
    entryEl.appendChild(list);
    mapEl.appendChild(entryEl);
  }
}

// ─── Channel Writer helpers ───────────────────────────────────────────────────

export interface ChannelWriterProps {
  channelId: string; // "none" = not set
  channelTemplate: string; // default: "${message.encodedData}"
  mapVariables: string[]; // list of variable names (no ${ } syntax)
}

/** Parses Channel Writer connector-specific fields from outer `<properties>` XML. */
export function parseChannelWriterPropsFromXml(propertiesXml: string | null): ChannelWriterProps {
  if (!propertiesXml)
    return { channelId: "none", channelTemplate: "${message.encodedData}", mapVariables: [] };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const channelId = root.querySelector(":scope > channelId")?.textContent?.trim() ?? "none";
  const channelTemplate =
    root.querySelector(":scope > channelTemplate")?.textContent ?? "${message.encodedData}";
  const mapVarEls = root.querySelectorAll(":scope > mapVariables > string");
  const mapVariables = Array.from(mapVarEls)
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
  return { channelId, channelTemplate, mapVariables };
}

/** Writes Channel Writer connector-specific fields back into outer `<properties>` XML. */
export function updateChannelWriterPropsInXml(
  propertiesXml: string,
  props: ChannelWriterProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;

  // Coerce a blank/whitespace-only channelId to "none" (mirrors Java ChannelWriter.getProperties,
  // which uses StringUtils.isBlank); a non-blank value is preserved verbatim.
  ensureChild(root, "channelId", doc).textContent = props.channelId.trim()
    ? props.channelId
    : "none";
  ensureChild(root, "channelTemplate", doc).textContent = props.channelTemplate;

  // Rebuild <mapVariables>. Java's getMapVariableTableValues filters blank keys and its cell
  // editor enforces case-insensitive uniqueness; we reproduce the same persisted result here by
  // dropping blank/whitespace-only entries and de-duplicating case-insensitively (keep first).
  let mvEl = root.querySelector(":scope > mapVariables");
  if (!mvEl) {
    mvEl = doc.createElementNS(null, "mapVariables");
    root.appendChild(mvEl);
  }
  while (mvEl.firstChild) mvEl.removeChild(mvEl.firstChild);
  const seen = new Set<string>();
  for (const v of props.mapVariables) {
    if (!v.trim()) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const s = doc.createElementNS(null, "string");
    s.textContent = v;
    mvEl.appendChild(s);
  }

  return serialize(doc);
}

// ─── HTTP Sender helpers ──────────────────────────────────────────────────────

export interface HttpSenderProps {
  host: string;
  useProxyServer: boolean;
  proxyAddress: string;
  proxyPort: string;
  method: string; // "post"|"get"|"put"|"delete"|"patch"
  multipart: boolean;
  useAuthentication: boolean;
  authenticationType: string; // "Basic"|"Digest"
  usePreemptiveAuthentication: boolean;
  username: string;
  password: string;
  headers: NameValueEntry[];
  useHeadersVariable: boolean;
  headersVariable: string;
  parameters: NameValueEntry[]; // query params
  useParametersVariable: boolean;
  parametersVariable: string;
  responseXmlBody: boolean;
  responseParseMultipart: boolean;
  responseIncludeMetadata: boolean;
  responseBinaryMimeTypes: string;
  responseBinaryMimeTypesRegex: boolean;
  content: string;
  contentType: string;
  dataTypeBinary: boolean;
  charset: string;
  socketTimeout: string;
}

const DEFAULT_HTTP_SENDER_PROPS: HttpSenderProps = {
  host: "",
  useProxyServer: false,
  proxyAddress: "",
  proxyPort: "",
  method: "post",
  multipart: false,
  useAuthentication: false,
  authenticationType: "Basic",
  usePreemptiveAuthentication: false,
  username: "",
  password: "",
  headers: [],
  useHeadersVariable: false,
  headersVariable: "",
  parameters: [],
  useParametersVariable: false,
  parametersVariable: "",
  responseXmlBody: false,
  responseParseMultipart: true,
  responseIncludeMetadata: false,
  responseBinaryMimeTypes: "application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*",
  responseBinaryMimeTypesRegex: true,
  content: "",
  contentType: "text/plain",
  dataTypeBinary: false,
  charset: "UTF-8",
  socketTimeout: "30000",
};

export function parseHttpSenderPropsFromXml(propertiesXml: string | null): HttpSenderProps {
  if (!propertiesXml) return { ...DEFAULT_HTTP_SENDER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    host: t("host"),
    useProxyServer: b("useProxyServer"),
    proxyAddress: t("proxyAddress"),
    proxyPort: t("proxyPort"),
    method: t("method", "post"),
    multipart: b("multipart"),
    useAuthentication: b("useAuthentication"),
    authenticationType: t("authenticationType", "Basic"),
    usePreemptiveAuthentication: b("usePreemptiveAuthentication"),
    username: t("username"),
    password: t("password"),
    headers: parseLinkedHashMapList(root, "headers"),
    useHeadersVariable: b("useHeadersVariable"),
    headersVariable: t("headersVariable"),
    parameters: parseLinkedHashMapList(root, "parameters"),
    useParametersVariable: b("useParametersVariable"),
    parametersVariable: t("parametersVariable"),
    responseXmlBody: b("responseXmlBody"),
    responseParseMultipart: b("responseParseMultipart", true),
    responseIncludeMetadata: b("responseIncludeMetadata"),
    responseBinaryMimeTypes: t(
      "responseBinaryMimeTypes",
      DEFAULT_HTTP_SENDER_PROPS.responseBinaryMimeTypes
    ),
    responseBinaryMimeTypesRegex: b("responseBinaryMimeTypesRegex", true),
    content: tRaw("content", ""),
    contentType: t("contentType", "text/plain"),
    dataTypeBinary: b("dataTypeBinary"),
    charset: t("charset", "UTF-8"),
    socketTimeout: t("socketTimeout", "30000"),
  };
}

export function updateHttpSenderPropsInXml(propertiesXml: string, props: HttpSenderProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("host", props.host);
  set("useProxyServer", String(props.useProxyServer));
  set("proxyAddress", props.proxyAddress);
  set("proxyPort", props.proxyPort);
  set("method", props.method);
  set("multipart", String(props.multipart));
  set("useAuthentication", String(props.useAuthentication));
  set("authenticationType", props.authenticationType);
  set("usePreemptiveAuthentication", String(props.usePreemptiveAuthentication));
  set("username", props.username);
  set("password", props.password);
  writeLinkedHashMapList(root, "headers", props.headers, doc);
  writeLinkedHashMapList(root, "parameters", props.parameters, doc);
  set("useHeadersVariable", String(props.useHeadersVariable));
  set("headersVariable", props.headersVariable);
  set("useParametersVariable", String(props.useParametersVariable));
  set("parametersVariable", props.parametersVariable);
  set("responseXmlBody", String(props.responseXmlBody));
  set("responseParseMultipart", String(props.responseParseMultipart));
  set("responseIncludeMetadata", String(props.responseIncludeMetadata));
  set("responseBinaryMimeTypes", props.responseBinaryMimeTypes);
  set("responseBinaryMimeTypesRegex", String(props.responseBinaryMimeTypesRegex));
  set("content", props.content);
  set("contentType", props.contentType);
  set("dataTypeBinary", String(props.dataTypeBinary));
  set("charset", props.charset);
  set("socketTimeout", props.socketTimeout);
  return serialize(doc);
}

// ─── TCP Sender helpers ───────────────────────────────────────────────────────

export interface TcpSenderProps {
  // Transmission mode (from transmissionModeProperties)
  transmissionMode: string; // "MLLP" | "Basic" (pluginPointName)
  startOfMessageBytes: string; // hex
  endOfMessageBytes: string; // hex
  // MLLP v2 fields (MLLPModeProperties only — ignored for Basic)
  useMLLPv2: boolean;
  ackBytes: string; // hex ACK character (default "06")
  nackBytes: string; // hex NACK character (default "15")
  maxRetries: string; // MLLP v2 retries (default "2")
  // Connection
  serverMode: boolean;
  remoteAddress: string;
  remotePort: string;
  overrideLocalBinding: boolean;
  localAddress: string;
  localPort: string;
  maxConnections: string;
  sendTimeout: string;
  bufferSize: string;
  keepConnectionOpen: boolean;
  checkRemoteHost: boolean;
  responseTimeout: string;
  ignoreResponse: boolean;
  queueOnResponseTimeout: boolean;
  dataTypeBinary: boolean;
  charsetEncoding: string;
  template: string;
}

const DEFAULT_TCP_SENDER_PROPS: TcpSenderProps = {
  transmissionMode: "MLLP",
  startOfMessageBytes: "0B",
  endOfMessageBytes: "1C0D",
  useMLLPv2: false,
  ackBytes: "06",
  nackBytes: "15",
  maxRetries: "2",
  serverMode: false,
  remoteAddress: "127.0.0.1",
  remotePort: "6660",
  overrideLocalBinding: false,
  localAddress: "0.0.0.0",
  localPort: "0",
  maxConnections: "10",
  sendTimeout: "5000",
  bufferSize: "65536",
  keepConnectionOpen: false,
  checkRemoteHost: false,
  responseTimeout: "5000",
  ignoreResponse: false,
  queueOnResponseTimeout: true,
  dataTypeBinary: false,
  charsetEncoding: "DEFAULT_ENCODING",
  template: "${message.encodedData}",
};

export function parseTcpSenderPropsFromXml(propertiesXml: string | null): TcpSenderProps {
  if (!propertiesXml) return { ...DEFAULT_TCP_SENDER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };

  // Polymorphic transmissionModeProperties — registry-driven; absent element → Basic + empty bytes.
  const tm = readTransmissionModeProperties(
    root.querySelector(":scope > transmissionModeProperties")
  );

  return {
    ...tm,
    serverMode: b("serverMode"),
    remoteAddress: t("remoteAddress", "127.0.0.1"),
    remotePort: t("remotePort", "6660"),
    overrideLocalBinding: b("overrideLocalBinding"),
    localAddress: t("localAddress", "0.0.0.0"),
    localPort: t("localPort", "0"),
    maxConnections: t("maxConnections", "10"),
    sendTimeout: t("sendTimeout", "5000"),
    bufferSize: t("bufferSize", "65536"),
    keepConnectionOpen: b("keepConnectionOpen", false),
    checkRemoteHost: b("checkRemoteHost"),
    responseTimeout: t("responseTimeout", "5000"),
    ignoreResponse: b("ignoreResponse"),
    queueOnResponseTimeout: b("queueOnResponseTimeout", true),
    dataTypeBinary: b("dataTypeBinary"),
    charsetEncoding: t("charsetEncoding", "DEFAULT_ENCODING"),
    template: tRaw("template", "${message.encodedData}"),
  };
}

export function updateTcpSenderPropsInXml(propertiesXml: string, props: TcpSenderProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };

  // Rebuild transmissionModeProperties (polymorphic — registry-driven per mode). The element must be
  // present for a registered mode (Basic included — TcpDispatcher.onDeploy() NPEs on a null
  // pluginPointName); an unknown/plugin mode's existing element is preserved rather than dropped to Basic.
  writeTransmissionModeProperties(root, props, doc);

  set("serverMode", String(props.serverMode));
  set("remoteAddress", props.remoteAddress);
  set("remotePort", props.remotePort);
  set("overrideLocalBinding", String(props.overrideLocalBinding));
  set("localAddress", props.localAddress);
  set("localPort", props.localPort);
  set("maxConnections", props.maxConnections);
  set("sendTimeout", props.sendTimeout);
  set("bufferSize", props.bufferSize);
  set("keepConnectionOpen", String(props.keepConnectionOpen));
  set("checkRemoteHost", String(props.checkRemoteHost));
  set("responseTimeout", props.responseTimeout);
  set("ignoreResponse", String(props.ignoreResponse));
  set("queueOnResponseTimeout", String(props.queueOnResponseTimeout));
  set("dataTypeBinary", String(props.dataTypeBinary));
  set("charsetEncoding", props.charsetEncoding);
  set("template", props.template);
  return serialize(doc);
}

// ─── Database Writer ───────────────────────────────────────────────────────────

export interface DatabaseWriterProps {
  driver: string;
  url: string;
  username: string;
  password: string;
  query: string;
  useScript: boolean;
}

const DEFAULT_DATABASE_WRITER_PROPS: DatabaseWriterProps = {
  driver: "Please Select One",
  url: "",
  username: "",
  password: "",
  query: "",
  useScript: false,
};

export function parseDatabaseWriterPropsFromXml(propertiesXml: string | null): DatabaseWriterProps {
  if (!propertiesXml) return { ...DEFAULT_DATABASE_WRITER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    driver: t("driver", "Please Select One"),
    url: t("url"),
    username: t("username"),
    password: t("password"),
    query: tRaw("query"),
    useScript: b("useScript"),
  };
}

export function updateDatabaseWriterPropsInXml(
  propertiesXml: string,
  props: DatabaseWriterProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("driver", props.driver);
  set("url", props.url);
  set("username", props.username);
  set("password", props.password);
  set("query", props.query);
  set("useScript", String(props.useScript));
  return serialize(doc);
}

// ─── File Writer ───────────────────────────────────────────────────────────────

export interface FileWriterProps {
  scheme: string; // "file" | "ftp" | "sftp" | "smb" | "s3" | "webdav"
  host: string; // directory (file) or hostname (network)
  outputPattern: string; // file name
  anonymous: boolean;
  username: string;
  password: string;
  timeout: string;
  keepConnectionOpen: boolean;
  maxIdleTime: string;
  secure: boolean;
  passive: boolean;
  validateConnection: boolean;
  outputAppend: boolean; // File Exists = Append
  errorOnExists: boolean; // File Exists = Error (both false = Overwrite)
  temporary: boolean; // Create Temp File
  binary: boolean;
  charsetEncoding: string;
  template: string;
  // FTP scheme properties (FTPSchemeProperties)
  ftpInitialCommands: string; // newline-separated; maps to List<String>
  // SFTP scheme properties (SftpSchemeProperties)
  sftpPasswordAuth: boolean;
  sftpKeyAuth: boolean;
  sftpKeyFile: string;
  sftpPassPhrase: string;
  sftpHostKeyChecking: string; // "yes" | "ask" | "no"
  sftpKnownHostsFile: string;
  sftpConfigurationSettings: Array<{ name: string; value: string }>;
  // SMB scheme properties (SmbSchemeProperties)
  smbMinVersion: string; // e.g. "SMB202"
  smbMaxVersion: string; // e.g. "SMB311"
  // S3 scheme properties (S3SchemeProperties)
  s3UseDefaultCredentials: boolean;
  s3UseTemporaryCredentials: boolean;
  s3Duration: number; // seconds, valid range 900–129600
  s3Region: string;
  s3CustomHeaders: Array<{ name: string; value: string }>;
}

export const DEFAULT_FILE_WRITER_PROPS: FileWriterProps = {
  scheme: "file",
  host: "",
  outputPattern: "",
  anonymous: true,
  username: "anonymous",
  password: "anonymous",
  timeout: "10000",
  keepConnectionOpen: true,
  maxIdleTime: "0",
  secure: true,
  passive: true,
  validateConnection: true,
  outputAppend: true,
  errorOnExists: false,
  temporary: false,
  binary: false,
  charsetEncoding: "DEFAULT_ENCODING",
  template: "${message.encodedData}",
  ftpInitialCommands: "",
  sftpPasswordAuth: true,
  sftpKeyAuth: false,
  sftpKeyFile: "",
  sftpPassPhrase: "",
  sftpHostKeyChecking: "ask",
  sftpKnownHostsFile: "",
  sftpConfigurationSettings: [],
  smbMinVersion: "SMB202",
  smbMaxVersion: "SMB311",
  s3UseDefaultCredentials: true,
  s3UseTemporaryCredentials: false,
  s3Duration: 7200,
  s3Region: "us-east-1",
  s3CustomHeaders: [],
};

export function parseFileWriterPropsFromXml(propertiesXml: string | null): FileWriterProps {
  if (!propertiesXml) return { ...DEFAULT_FILE_WRITER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };

  // Normalize scheme: Java writes uppercase (FTP, SFTP, SMB, WEBDAV), web UI uses lowercase.
  // S3 is consistent between Java and web UI.
  const rawScheme = t("scheme", "file");
  const scheme = rawScheme === "S3" || rawScheme === "s3" ? "S3" : rawScheme.toLowerCase();

  const spEl = root.querySelector(":scope > schemeProperties");

  // ── FTP scheme properties ────────────────────────────────────────────────
  let ftpInitialCommands = "";
  if (spEl && scheme === "ftp") {
    ftpInitialCommands = Array.from(spEl.querySelectorAll("initialCommands > string"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
  }

  // ── SFTP scheme properties ───────────────────────────────────────────────
  let sftpPasswordAuth = DEFAULT_FILE_WRITER_PROPS.sftpPasswordAuth;
  let sftpKeyAuth = DEFAULT_FILE_WRITER_PROPS.sftpKeyAuth;
  let sftpKeyFile = DEFAULT_FILE_WRITER_PROPS.sftpKeyFile;
  let sftpPassPhrase = DEFAULT_FILE_WRITER_PROPS.sftpPassPhrase;
  let sftpHostKeyChecking = DEFAULT_FILE_WRITER_PROPS.sftpHostKeyChecking;
  let sftpKnownHostsFile = DEFAULT_FILE_WRITER_PROPS.sftpKnownHostsFile;
  const sftpConfigurationSettings: Array<{ name: string; value: string }> = [];
  if (spEl && scheme === "sftp") {
    const sp = spEl;
    const ss = (sel: string, def: string) => sp.querySelector(sel)?.textContent ?? def;
    const sb = (sel: string, def: boolean) => {
      const v = sp.querySelector(sel)?.textContent?.trim();
      return v !== undefined ? v === "true" : def;
    };
    sftpPasswordAuth = sb("passwordAuth", DEFAULT_FILE_WRITER_PROPS.sftpPasswordAuth);
    sftpKeyAuth = sb("keyAuth", DEFAULT_FILE_WRITER_PROPS.sftpKeyAuth);
    sftpKeyFile = ss("keyFile", DEFAULT_FILE_WRITER_PROPS.sftpKeyFile);
    sftpPassPhrase = ss("passPhrase", DEFAULT_FILE_WRITER_PROPS.sftpPassPhrase);
    sftpHostKeyChecking = ss("hostKeyChecking", DEFAULT_FILE_WRITER_PROPS.sftpHostKeyChecking);
    sftpKnownHostsFile = ss("knownHostsFile", DEFAULT_FILE_WRITER_PROPS.sftpKnownHostsFile);
    const cfgEl = sp.querySelector("configurationSettings");
    if (cfgEl) {
      for (const entry of Array.from(cfgEl.querySelectorAll(":scope > entry"))) {
        const strings = Array.from(entry.querySelectorAll(":scope > string"));
        if (strings.length >= 2) {
          sftpConfigurationSettings.push({
            name: strings[0].textContent ?? "",
            value: strings[1].textContent ?? "",
          });
        }
      }
    }
  }

  // ── SMB scheme properties ──────────────────────────────────────────────
  let smbMinVersion = DEFAULT_FILE_WRITER_PROPS.smbMinVersion;
  let smbMaxVersion = DEFAULT_FILE_WRITER_PROPS.smbMaxVersion;
  if (spEl && scheme === "smb") {
    smbMinVersion =
      spEl.querySelector("smbMinVersion")?.textContent?.trim() ??
      DEFAULT_FILE_WRITER_PROPS.smbMinVersion;
    smbMaxVersion =
      spEl.querySelector("smbMaxVersion")?.textContent?.trim() ??
      DEFAULT_FILE_WRITER_PROPS.smbMaxVersion;
  }

  // S3 scheme properties
  let s3UseDefaultCredentials = DEFAULT_FILE_WRITER_PROPS.s3UseDefaultCredentials;
  let s3UseTemporaryCredentials = DEFAULT_FILE_WRITER_PROPS.s3UseTemporaryCredentials;
  let s3Duration = DEFAULT_FILE_WRITER_PROPS.s3Duration;
  let s3Region = DEFAULT_FILE_WRITER_PROPS.s3Region;
  const s3CustomHeaders: Array<{ name: string; value: string }> = [];
  if (spEl && scheme === "S3") {
    const sp = spEl;
    const spb = (sel: string, def: boolean) => {
      const v = sp.querySelector(sel)?.textContent?.trim();
      return v !== undefined ? v === "true" : def;
    };
    const spt = (sel: string, def: string) => sp.querySelector(sel)?.textContent ?? def;
    const spn = (sel: string, def: number) => {
      const v = sp.querySelector(sel)?.textContent?.trim();
      return v ? parseInt(v, 10) : def;
    };
    s3UseDefaultCredentials = spb(
      "useDefaultCredentialProviderChain",
      DEFAULT_FILE_WRITER_PROPS.s3UseDefaultCredentials
    );
    s3UseTemporaryCredentials = spb(
      "useTemporaryCredentials",
      DEFAULT_FILE_WRITER_PROPS.s3UseTemporaryCredentials
    );
    s3Duration = spn("duration", DEFAULT_FILE_WRITER_PROPS.s3Duration);
    s3Region = spt("region", DEFAULT_FILE_WRITER_PROPS.s3Region);

    // Flatten Map<String, List<String>> → {name, value}[] rows
    const chEl = sp.querySelector("customHeaders");
    if (chEl) {
      for (const entry of Array.from(chEl.querySelectorAll(":scope > entry"))) {
        const nameEl = entry.querySelector(":scope > string");
        const name = nameEl?.textContent ?? "";
        // Java format: <list><string>val</string>...</list>
        const listEl = entry.querySelector(":scope > list");
        if (listEl) {
          for (const strEl of Array.from(listEl.querySelectorAll(":scope > string"))) {
            s3CustomHeaders.push({ name, value: strEl.textContent ?? "" });
          }
        } else {
          // Legacy flat format: multiple <string> siblings after the key
          const strings = Array.from(entry.querySelectorAll(":scope > string"));
          for (let i = 1; i < strings.length; i++) {
            s3CustomHeaders.push({ name, value: strings[i].textContent ?? "" });
          }
        }
      }
    }
  }

  return {
    scheme,
    host: t("host"),
    outputPattern: t("outputPattern"),
    anonymous: b("anonymous"),
    username: t("username", "anonymous"),
    password: t("password", "anonymous"),
    timeout: t("timeout", "10000"),
    keepConnectionOpen: b("keepConnectionOpen", true),
    maxIdleTime: t("maxIdleTime", "0"),
    secure: b("secure"),
    passive: b("passive"),
    validateConnection: b("validateConnection", true),
    outputAppend: b("outputAppend"),
    errorOnExists: b("errorOnExists"),
    temporary: b("temporary"),
    binary: b("binary"),
    charsetEncoding: t("charsetEncoding", "DEFAULT_ENCODING"),
    template: tRaw("template", "${message.encodedData}"),
    ftpInitialCommands,
    sftpPasswordAuth,
    sftpKeyAuth,
    sftpKeyFile,
    sftpPassPhrase,
    sftpHostKeyChecking,
    sftpKnownHostsFile,
    sftpConfigurationSettings,
    smbMinVersion,
    smbMaxVersion,
    s3UseDefaultCredentials,
    s3UseTemporaryCredentials,
    s3Duration,
    s3Region,
    s3CustomHeaders,
  };
}

export function updateFileWriterPropsInXml(propertiesXml: string, props: FileWriterProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };

  // Rebuild <schemeProperties> for scheme-specific settings
  const oldSp = root.querySelector(":scope > schemeProperties");
  if (oldSp) root.removeChild(oldSp);

  if (props.scheme === "ftp") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.FTPSchemeProperties");
    const cmdsEl = doc.createElementNS(null, "initialCommands");
    for (const cmd of props.ftpInitialCommands
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean)) {
      const strEl = doc.createElementNS(null, "string");
      strEl.textContent = cmd;
      cmdsEl.appendChild(strEl);
    }
    sp.appendChild(cmdsEl);
    root.appendChild(sp);
  } else if (props.scheme === "sftp") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.SftpSchemeProperties");
    const sfFields: [string, string][] = [
      ["passwordAuth", String(props.sftpPasswordAuth)],
      ["keyAuth", String(props.sftpKeyAuth)],
      ["keyFile", props.sftpKeyFile],
      ["passPhrase", props.sftpPassPhrase],
      ["hostKeyChecking", props.sftpHostKeyChecking],
      ["knownHostsFile", props.sftpKnownHostsFile],
    ];
    for (const [tag, val] of sfFields) {
      const el = doc.createElementNS(null, tag);
      el.textContent = val;
      sp.appendChild(el);
    }
    const cfg = doc.createElementNS(null, "configurationSettings");
    cfg.setAttribute("class", "linked-hash-map");
    for (const row of props.sftpConfigurationSettings) {
      const entry = doc.createElementNS(null, "entry");
      const keyEl = doc.createElementNS(null, "string");
      keyEl.textContent = row.name;
      entry.appendChild(keyEl);
      const valEl = doc.createElementNS(null, "string");
      valEl.textContent = row.value;
      entry.appendChild(valEl);
      cfg.appendChild(entry);
    }
    sp.appendChild(cfg);
    root.appendChild(sp);
  } else if (props.scheme === "smb") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.SmbSchemeProperties");
    ensureChild(sp, "smbMinVersion", doc).textContent = props.smbMinVersion;
    ensureChild(sp, "smbMaxVersion", doc).textContent = props.smbMaxVersion;
    root.appendChild(sp);
  } else if (props.scheme === "S3") {
    const sp = doc.createElementNS(null, "schemeProperties");
    sp.setAttribute("class", "com.mirth.connect.connectors.file.S3SchemeProperties");

    const s3Fields: [string, string][] = [
      ["useDefaultCredentialProviderChain", String(props.s3UseDefaultCredentials)],
      ["useTemporaryCredentials", String(props.s3UseTemporaryCredentials)],
      ["duration", String(props.s3Duration)],
      ["region", props.s3Region],
    ];
    for (const [tag, val] of s3Fields) {
      const el = doc.createElementNS(null, tag);
      el.textContent = val;
      sp.appendChild(el);
    }

    // Rebuild customHeaders: group rows by name → Map<String, List<String>>
    const ch = doc.createElementNS(null, "customHeaders");
    ch.setAttribute("class", "linked-hash-map");
    const grouped = new Map<string, string[]>();
    for (const row of props.s3CustomHeaders) {
      const existing = grouped.get(row.name);
      if (existing) {
        existing.push(row.value);
      } else {
        grouped.set(row.name, [row.value]);
      }
    }
    for (const [name, values] of grouped) {
      const entry = doc.createElementNS(null, "entry");
      const nameEl = doc.createElementNS(null, "string");
      nameEl.textContent = name;
      entry.appendChild(nameEl);
      // Java uses Map<String, List<String>> — wrap values in <list>
      const list = doc.createElementNS(null, "list");
      for (const val of values) {
        const valEl = doc.createElementNS(null, "string");
        valEl.textContent = val;
        list.appendChild(valEl);
      }
      entry.appendChild(list);
      ch.appendChild(entry);
    }
    sp.appendChild(ch);
    root.appendChild(sp);
  }

  set("scheme", fileSchemeToXml(props.scheme));
  //: mirror Java FileWriter.java getProperties() — for the local FILE scheme the
  // directory's backslashes are normalized to forward slashes on save, so server-generated
  // strings (response message, sent-URI metadata, event log) don't show mixed separators
  // (e.g. C:\out/file.txt). Network hosts (SMB \\server\share, etc.) are left untouched.
  set("host", props.scheme === "file" ? props.host.replace(/\\/g, "/") : props.host);
  set("outputPattern", props.outputPattern);
  set("anonymous", String(props.anonymous));
  set("username", props.username);
  set("password", props.password);
  set("timeout", props.timeout);
  set("keepConnectionOpen", String(props.keepConnectionOpen));
  set("maxIdleTime", props.maxIdleTime);
  set("secure", String(props.secure));
  set("passive", String(props.passive));
  set("validateConnection", String(props.validateConnection));
  set("outputAppend", String(props.outputAppend));
  set("errorOnExists", String(props.errorOnExists));
  // Never persist Append + Temp File together: the server (FileDispatcher) checks
  // isTemporary() before isOutputAppend(), so a stale temporary=true silently turns
  // Append into a move-replace overwrite. Java's UI can never produce this combo;
  // enforce the same invariant at serialization so a stale-loaded channel can't either.
  set("temporary", String(props.outputAppend ? false : props.temporary));
  set("binary", String(props.binary));
  set("charsetEncoding", props.charsetEncoding);
  set("template", props.template);
  return serialize(doc);
}

// ─── SMTP Sender ──────────────────────────────────────────────────────────────

export interface SmtpAttachment {
  name: string;
  content: string;
  mimeType: string;
}

export interface SmtpSenderProps {
  smtpHost: string;
  smtpPort: string;
  overrideLocalBinding: boolean;
  localAddress: string;
  localPort: string;
  timeout: string;
  encryption: string; // "none" | "TLS" | "SSL" (canonical; matched case-insensitively on parse)
  authentication: boolean; // legacy — derived from authType; kept for round-trip
  username: string;
  password: string;
  authType: "NONE" | "BASIC" | "OAUTH";
  oAuthClientId: string;
  oAuthClientSecret: string;
  oAuthTokenEndpointUrl: string;
  oAuthScope: string;
  to: string;
  from: string;
  cc: string;
  bcc: string;
  replyTo: string;
  headers: NameValueEntry[];
  headersVariable: string;
  useHeadersVariable: boolean;
  subject: string;
  charsetEncoding: string;
  html: boolean;
  body: string;
  attachments: SmtpAttachment[];
  attachmentsVariable: string;
  useAttachmentsVariable: boolean;
}

const DEFAULT_SMTP_PROPS: SmtpSenderProps = {
  smtpHost: "",
  smtpPort: "25",
  overrideLocalBinding: false,
  localAddress: "0.0.0.0",
  localPort: "0",
  timeout: "5000",
  encryption: "none",
  authentication: false,
  username: "",
  password: "",
  authType: "NONE",
  oAuthClientId: "",
  oAuthClientSecret: "",
  oAuthTokenEndpointUrl: "",
  oAuthScope: "https://outlook.office365.com/.default",
  to: "",
  from: "",
  cc: "",
  bcc: "",
  replyTo: "",
  headers: [],
  headersVariable: "",
  useHeadersVariable: false,
  subject: "",
  charsetEncoding: "DEFAULT_ENCODING",
  html: false,
  body: "",
  attachments: [],
  attachmentsVariable: "",
  useAttachmentsVariable: false,
};

function parseSmtpAttachments(root: Element): SmtpAttachment[] {
  const container = root.querySelector(":scope > attachments");
  if (!container) return [];
  const result: SmtpAttachment[] = [];
  for (const el of Array.from(container.children)) {
    const t = (tag: string) => el.querySelector(tag)?.textContent ?? "";
    result.push({ name: t("name"), content: t("content"), mimeType: t("mimeType") });
  }
  return result;
}

/**
 * Drops entries whose (trimmed) name is blank and collapses case-insensitive duplicate names,
 * keeping the first occurrence. Mirrors the JMS connection-properties invariant
 * (`resolveJmsPropertyKey`) and Java's SMTP `getProperties(table)`, which skips blank keys and
 * whose backing Map silently collapses duplicates. Names are preserved as entered (not trimmed).
 */
function dropBlankAndDedupeByName<T extends { name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = row.name.trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(row);
  }
  return out;
}

function writeSmtpHeaders(root: Element, headers: NameValueEntry[], doc: Document): void {
  writeLinkedHashMap(root, "headers", dropBlankAndDedupeByName(headers), doc);
}

function writeSmtpAttachments(root: Element, attachments: SmtpAttachment[], doc: Document): void {
  let container = root.querySelector(":scope > attachments");
  if (!container) {
    container = doc.createElementNS(null, "attachments");
    root.appendChild(container);
  }
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const att of dropBlankAndDedupeByName(attachments)) {
    const el = doc.createElementNS(null, "com.mirth.connect.connectors.smtp.Attachment");
    const n = doc.createElementNS(null, "name");
    n.textContent = att.name;
    el.appendChild(n);
    const c = doc.createElementNS(null, "content");
    c.textContent = att.content;
    el.appendChild(c);
    const m = doc.createElementNS(null, "mimeType");
    m.textContent = att.mimeType;
    el.appendChild(m);
    container.appendChild(el);
  }
}

/**
 * Normalizes a stored `<encryption>` value to the canonical `"none" | "TLS" | "SSL"`.
 * Mirrors Java `SmtpSender.setProperties()` (lines 187-193), which matches the stored value
 * with `equalsIgnoreCase` — so a Swing-written `"SSL"`, a WebUI-written `"ssl"`, and `"tls"`
 * all resolve to the canonical radio value. Anything unrecognized (including the legacy WebUI
 * `"starttls"`) falls to `"none"`, matching what the server dispatcher does at runtime
 * (`"TLS".equalsIgnoreCase(...)` / `"SSL".equalsIgnoreCase(...)`).
 */
function normalizeSmtpEncryption(raw: string): string {
  if (/^ssl$/i.test(raw)) return "SSL";
  if (/^tls$/i.test(raw)) return "TLS";
  return "none";
}

export function parseSmtpSenderPropsFromXml(propertiesXml: string | null): SmtpSenderProps {
  if (!propertiesXml) return { ...DEFAULT_SMTP_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    smtpHost: t("smtpHost"),
    smtpPort: t("smtpPort", "25"),
    overrideLocalBinding: b("overrideLocalBinding"),
    localAddress: t("localAddress", "0.0.0.0"),
    localPort: t("localPort", "0"),
    timeout: t("timeout", "5000"),
    encryption: normalizeSmtpEncryption(t("encryption", "none")),
    authentication: b("authentication"),
    username: t("username"),
    password: t("password"),
    // Legacy upgrade (migrate26_3_0): if authType absent, derive from authentication boolean
    authType: (() => {
      const raw = t("authType", "");
      if (raw === "BASIC" || raw === "OAUTH") return raw;
      return b("authentication") ? "BASIC" : "NONE";
    })(),
    oAuthClientId: t("oAuthClientId"),
    oAuthClientSecret: t("oAuthClientSecret"),
    oAuthTokenEndpointUrl: t("oAuthTokenEndpointUrl"),
    oAuthScope: t("oAuthScope", "https://outlook.office365.com/.default"),
    to: t("to"),
    from: t("from"),
    cc: t("cc"),
    bcc: t("bcc"),
    replyTo: t("replyTo"),
    headers: parseLinkedHashMap(root, "headers"),
    headersVariable: t("headersVariable"),
    useHeadersVariable: b("isUseHeadersVariable"),
    subject: t("subject"),
    charsetEncoding: t("charsetEncoding", "DEFAULT_ENCODING"),
    html: b("html"),
    body: tRaw("body"),
    attachments: parseSmtpAttachments(root),
    attachmentsVariable: t("attachmentsVariable"),
    useAttachmentsVariable: b("isUseAttachmentsVariable"),
  };
}

export function updateSmtpSenderPropsInXml(propertiesXml: string, props: SmtpSenderProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("smtpHost", props.smtpHost);
  set("smtpPort", props.smtpPort);
  set("overrideLocalBinding", String(props.overrideLocalBinding));
  set("localAddress", props.localAddress);
  set("localPort", props.localPort);
  set("timeout", props.timeout);
  set("encryption", props.encryption);
  // Keep legacy boolean in sync with authType — true only for BASIC, mirroring
  // Java SmtpSender.getProperties() line 124: setAuthentication("BASIC".equals(authType)).
  // OAUTH must serialize false, else the dispatcher fallback degrades OAUTH to basic auth.
  set("authentication", String(props.authType === "BASIC"));
  set("username", props.username);
  set("password", props.password);
  set("authType", props.authType);
  set("oAuthClientId", props.oAuthClientId);
  set("oAuthClientSecret", props.oAuthClientSecret);
  set("oAuthTokenEndpointUrl", props.oAuthTokenEndpointUrl);
  set("oAuthScope", props.oAuthScope);
  set("to", props.to);
  set("from", props.from);
  // Deliberately do NOT write cc / bcc / replyTo. The Java Swing panel has no widgets for
  // these and SmtpSender.getProperties() never persists them item 4). We leave any
  // existing <cc>/<bcc>/<replyTo> elements untouched so values set via API/import survive a
  // WebUI save — this is intentionally NOT a replica of Java's wipe-on-save behavior.
  writeSmtpHeaders(root, props.headers, doc);
  set("headersVariable", props.headersVariable);
  set("isUseHeadersVariable", String(props.useHeadersVariable));
  set("subject", props.subject);
  set("charsetEncoding", props.charsetEncoding);
  set("html", String(props.html));
  set("body", props.body);
  writeSmtpAttachments(root, props.attachments, doc);
  set("attachmentsVariable", props.attachmentsVariable);
  set("isUseAttachmentsVariable", String(props.useAttachmentsVariable));
  return serialize(doc);
}

// ─── JMS Sender ───────────────────────────────────────────────────────────────

export interface JmsSenderProps {
  useJndi: boolean;
  jndiProviderUrl: string;
  jndiInitialContextFactory: string;
  jndiConnectionFactoryName: string;
  connectionFactoryClass: string;
  connectionProperties: NameValueEntry[];
  username: string;
  password: string;
  destinationName: string;
  topic: boolean;
  clientId: string;
  template: string;
}

const DEFAULT_JMS_SENDER_PROPS: JmsSenderProps = {
  useJndi: false,
  jndiProviderUrl: "",
  jndiInitialContextFactory: "",
  jndiConnectionFactoryName: "",
  connectionFactoryClass: "",
  connectionProperties: [],
  username: "",
  password: "",
  destinationName: "",
  topic: false,
  clientId: "",
  template: "${message.encodedData}",
};

export function parseJmsSenderPropsFromXml(propertiesXml: string | null): JmsSenderProps {
  if (!propertiesXml) return { ...DEFAULT_JMS_SENDER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    useJndi: b("useJndi"),
    jndiProviderUrl: t("jndiProviderUrl"),
    jndiInitialContextFactory: t("jndiInitialContextFactory"),
    jndiConnectionFactoryName: t("jndiConnectionFactoryName"),
    connectionFactoryClass: t("connectionFactoryClass"),
    connectionProperties: parseLinkedHashMap(root, "connectionProperties"),
    username: t("username"),
    password: t("password"),
    destinationName: t("destinationName"),
    topic: b("topic"),
    clientId: t("clientId"),
    template: tRaw("template", "${message.encodedData}"),
  };
}

export function updateJmsSenderPropsInXml(propertiesXml: string, props: JmsSenderProps): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("useJndi", String(props.useJndi));
  set("jndiProviderUrl", props.jndiProviderUrl);
  set("jndiInitialContextFactory", props.jndiInitialContextFactory);
  set("jndiConnectionFactoryName", props.jndiConnectionFactoryName);
  set("connectionFactoryClass", props.connectionFactoryClass);
  writeLinkedHashMap(root, "connectionProperties", props.connectionProperties, doc);
  set("username", props.username);
  set("password", props.password);
  set("destinationName", props.destinationName);
  set("topic", String(props.topic));
  set("clientId", props.clientId);
  set("template", props.template);
  return serialize(doc);
}

// ─── Document Writer ──────────────────────────────────────────────────────────

export interface DocumentWriterProps {
  host: string; // directory
  outputPattern: string; // filename
  documentType: string; // "pdf" | "rtf"
  encrypt: boolean;
  output: string; // "FILE" | "ATTACHMENT" | "BOTH"
  password: string;
  pageWidth: string;
  pageHeight: string;
  pageUnit: string; // "INCHES" | "MM" | "TWIPS" (Java com.mirth.connect.connectors.doc.Unit)
  template: string; // HTML template
}

const DEFAULT_DOC_WRITER_PROPS: DocumentWriterProps = {
  host: "",
  outputPattern: "",
  documentType: "pdf",
  encrypt: false,
  output: "FILE",
  password: "",
  pageWidth: "8.5",
  pageHeight: "11",
  pageUnit: "INCHES",
  template: "",
};

export function parseDocumentWriterPropsFromXml(propertiesXml: string | null): DocumentWriterProps {
  if (!propertiesXml) return { ...DEFAULT_DOC_WRITER_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    host: t("host"),
    outputPattern: t("outputPattern"),
    documentType: t("documentType", "pdf"),
    encrypt: b("encrypt"),
    output: t("output", "FILE"),
    pageWidth: t("pageWidth", "8.5"),
    pageHeight: t("pageHeight", "11"),
    pageUnit: t("pageUnit", "INCHES"),
    // Preserve leading/trailing characters in a real password — do not trim.
    password: tRaw("password"),
    template: tRaw("template"),
  };
}

export function updateDocumentWriterPropsInXml(
  propertiesXml: string,
  props: DocumentWriterProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("host", props.host);
  set("outputPattern", props.outputPattern);
  set("documentType", props.documentType);
  set("encrypt", String(props.encrypt));
  set("output", props.output);
  set("password", props.password);
  set("pageWidth", props.pageWidth);
  set("pageHeight", props.pageHeight);
  set("pageUnit", props.pageUnit);
  set("template", props.template);
  return serialize(doc);
}

// ─── DICOM Sender ─────────────────────────────────────────────────────────────

export interface DicomSenderProps {
  host: string;
  port: string;
  applicationEntity: string;
  localHost: string;
  localPort: string;
  localApplicationEntity: string;
  template: string;
  // Timing/buffer fields are stored as strings (matching the Java
  // DICOMDispatcherProperties model and the DICOM Listener) so that leading
  // zeros and templated values (e.g. ${timeout}) round-trip verbatim.
  acceptTo: string;
  async: string;
  bufSize: string;
  connectTo: string;
  priority: string; // "high" | "med" | "low"
  passcode: string;
  pdv1: boolean;
  rcvpdulen: string;
  reaper: string;
  releaseTo: string;
  rspTo: string;
  shutdownDelay: string;
  sndpdulen: string;
  soCloseDelay: string;
  sorcvbuf: string;
  sosndbuf: string;
  stgcmt: boolean;
  tcpDelay: boolean;
  ts1: boolean;
  uidnegrsp: boolean;
  username: string;
  keyPW: string;
  keyStore: string;
  keyStorePW: string;
  noClientAuth: boolean;
  nossl2: boolean;
  tls: string; // "notls" | "3des" | "aes" | "without"
  trustStore: string;
  trustStorePW: string;
}

const DEFAULT_DICOM_PROPS: DicomSenderProps = {
  host: "127.0.0.1",
  port: "104",
  applicationEntity: "",
  localHost: "",
  localPort: "",
  localApplicationEntity: "",
  template: "${DICOMMESSAGE}",
  acceptTo: "5000",
  async: "0",
  bufSize: "1",
  connectTo: "0",
  priority: "med",
  passcode: "",
  pdv1: false,
  rcvpdulen: "16",
  reaper: "10",
  releaseTo: "5",
  rspTo: "60",
  shutdownDelay: "1000",
  sndpdulen: "16",
  soCloseDelay: "50",
  sorcvbuf: "0",
  sosndbuf: "0",
  stgcmt: false,
  tcpDelay: true,
  ts1: false,
  uidnegrsp: false,
  username: "",
  keyPW: "",
  keyStore: "",
  keyStorePW: "",
  noClientAuth: true,
  nossl2: true,
  tls: "notls",
  trustStore: "",
  trustStorePW: "",
};

export function parseDicomSenderPropsFromXml(propertiesXml: string | null): DicomSenderProps {
  if (!propertiesXml) return { ...DEFAULT_DICOM_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    // Java DICOMDispatcherProperties defaults host to "127.0.0.1"; mirror it so a
    // hand-built XML missing <host> parses to the model default rather than "".
    host: t("host", "127.0.0.1"),
    port: t("port", "104"),
    applicationEntity: t("applicationEntity"),
    localHost: t("localHost"),
    localPort: t("localPort"),
    localApplicationEntity: t("localApplicationEntity"),
    template: tRaw("template", "${DICOMMESSAGE}"),
    acceptTo: t("acceptTo", "5000"),
    async: t("async", "0"),
    bufSize: t("bufSize", "1"),
    connectTo: t("connectTo", "0"),
    priority: t("priority", "med"),
    passcode: t("passcode"),
    pdv1: b("pdv1"),
    rcvpdulen: t("rcvpdulen", "16"),
    reaper: t("reaper", "10"),
    releaseTo: t("releaseTo", "5"),
    rspTo: t("rspTo", "60"),
    shutdownDelay: t("shutdownDelay", "1000"),
    sndpdulen: t("sndpdulen", "16"),
    soCloseDelay: t("soCloseDelay", "50"),
    sorcvbuf: t("sorcvbuf", "0"),
    sosndbuf: t("sosndbuf", "0"),
    stgcmt: b("stgcmt"),
    tcpDelay: b("tcpDelay", true),
    ts1: b("ts1"),
    uidnegrsp: b("uidnegrsp"),
    username: t("username"),
    keyPW: t("keyPW"),
    keyStore: t("keyStore"),
    keyStorePW: t("keyStorePW"),
    noClientAuth: b("noClientAuth", true),
    nossl2: b("nossl2", true),
    tls: t("tls", "notls"),
    trustStore: t("trustStore"),
    trustStorePW: t("trustStorePW"),
  };
}

export function updateDicomSenderPropsInXml(
  propertiesXml: string,
  props: DicomSenderProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("host", props.host);
  set("port", props.port);
  set("applicationEntity", props.applicationEntity);
  set("localHost", props.localHost);
  set("localPort", props.localPort);
  set("localApplicationEntity", props.localApplicationEntity);
  set("template", props.template);
  set("acceptTo", props.acceptTo);
  set("async", props.async);
  set("bufSize", props.bufSize);
  set("connectTo", props.connectTo);
  set("priority", props.priority);
  set("passcode", props.passcode);
  set("pdv1", String(props.pdv1));
  set("rcvpdulen", props.rcvpdulen);
  set("reaper", props.reaper);
  set("releaseTo", props.releaseTo);
  set("rspTo", props.rspTo);
  set("shutdownDelay", props.shutdownDelay);
  set("sndpdulen", props.sndpdulen);
  set("soCloseDelay", props.soCloseDelay);
  set("sorcvbuf", props.sorcvbuf);
  set("sosndbuf", props.sosndbuf);
  set("stgcmt", String(props.stgcmt));
  set("tcpDelay", String(props.tcpDelay));
  set("ts1", String(props.ts1));
  set("uidnegrsp", String(props.uidnegrsp));
  set("username", props.username);
  set("keyPW", props.keyPW);
  set("keyStore", props.keyStore);
  set("keyStorePW", props.keyStorePW);
  set("noClientAuth", String(props.noClientAuth));
  set("nossl2", String(props.nossl2));
  set("tls", props.tls);
  set("trustStore", props.trustStore);
  set("trustStorePW", props.trustStorePW);
  return serialize(doc);
}

// ─── Web Service Sender ───────────────────────────────────────────────────────

export interface WebServiceAttachment {
  name: string;
  content: string;
  type: string;
}

export interface WsPortInformation {
  /** Ordered list of operation names from the WSDL binding. */
  operations: string[];
  /** SOAP Action URIs, parallel-indexed with operations. May be empty strings. */
  actions: string[];
  locationURI: string;
}

/** Nested map: service QName → port QName → port info. */
export type WsdlDefinitionMap = Record<string, Record<string, WsPortInformation>>;

export interface WebServiceSenderProps {
  wsdlUrl: string;
  service: string;
  port: string;
  locationURI: string;
  socketTimeout: string;
  useAuthentication: boolean;
  username: string;
  password: string;
  envelope: string;
  oneWay: boolean;
  operation: string;
  soapAction: string;
  headers: NameValueEntry[];
  headersVariable: string;
  useHeadersVariable: boolean;
  useMtom: boolean;
  attachments: WebServiceAttachment[];
  attachmentsVariable: string;
  useAttachmentsVariable: boolean;
  wsdlDefinitionMap: WsdlDefinitionMap;
}

const DEFAULT_WS_PROPS: WebServiceSenderProps = {
  wsdlUrl: "",
  service: "",
  port: "",
  locationURI: "",
  socketTimeout: "30000",
  useAuthentication: false,
  username: "",
  password: "",
  envelope: "",
  oneWay: false,
  operation: "Press Get Operations",
  soapAction: "",
  headers: [],
  headersVariable: "",
  useHeadersVariable: false,
  useMtom: false,
  attachments: [],
  attachmentsVariable: "",
  useAttachmentsVariable: false,
  wsdlDefinitionMap: {},
};

// XStream FQN element names for DefinitionServiceMap inner classes.
// Dots are valid XML NameChar so DOMParser handles these without issue.
const WS_PORT_MAP_TAG = "com.mirth.connect.connectors.ws.DefinitionServiceMap_-DefinitionPortMap";
const WS_PORT_INFO_TAG = "com.mirth.connect.connectors.ws.DefinitionServiceMap_-PortInformation";

function parseWsdlDefinitionMap(root: Element): WsdlDefinitionMap {
  const defMapEl = root.querySelector(":scope > wsdlDefinitionMap");
  if (!defMapEl) return {};
  // Use children traversal instead of querySelector to avoid CSS selector escaping issues
  // with tag names containing dots (e.g. "com.mirth.connect...").
  const outerMapEl = Array.from(defMapEl.children).find((el) => el.tagName === "map");
  if (!outerMapEl) return {};

  const result: WsdlDefinitionMap = {};
  for (const svcEntry of Array.from(outerMapEl.children).filter((el) => el.tagName === "entry")) {
    const serviceKey =
      Array.from(svcEntry.children)
        .find((el) => el.tagName === "string")
        ?.textContent?.trim() ?? "";
    const portMapWrapper = Array.from(svcEntry.children).find(
      (el) => el.tagName === WS_PORT_MAP_TAG
    );
    if (!serviceKey || !portMapWrapper) continue;

    const innerMapEl = Array.from(portMapWrapper.children).find((el) => el.tagName === "map");
    if (!innerMapEl) continue;

    const portMap: Record<string, WsPortInformation> = {};
    for (const portEntry of Array.from(innerMapEl.children).filter(
      (el) => el.tagName === "entry"
    )) {
      const portKey =
        Array.from(portEntry.children)
          .find((el) => el.tagName === "string")
          ?.textContent?.trim() ?? "";
      const portInfoEl = Array.from(portEntry.children).find(
        (el) => el.tagName === WS_PORT_INFO_TAG
      );
      if (!portKey || !portInfoEl) continue;

      const operations = Array.from(
        portInfoEl.querySelector(":scope > operations")?.children ?? []
      ).map((el) => el.textContent?.trim() ?? "");

      const actions = Array.from(portInfoEl.querySelector(":scope > actions")?.children ?? []).map(
        (el) => el.textContent?.trim() ?? ""
      );

      const locationURI =
        portInfoEl.querySelector(":scope > locationURI")?.textContent?.trim() ?? "";

      portMap[portKey] = { operations, actions, locationURI };
    }
    result[serviceKey] = portMap;
  }
  return result;
}

function writeWsdlDefinitionMap(root: Element, map: WsdlDefinitionMap, doc: Document): void {
  let defMapEl = root.querySelector(":scope > wsdlDefinitionMap");
  if (!defMapEl) {
    defMapEl = doc.createElementNS(null, "wsdlDefinitionMap");
    root.appendChild(defMapEl);
  }
  while (defMapEl.firstChild) defMapEl.removeChild(defMapEl.firstChild);

  const outerMapEl = doc.createElementNS(null, "map");
  outerMapEl.setAttribute("class", "linked-hash-map");
  defMapEl.appendChild(outerMapEl);

  for (const [serviceKey, portMap] of Object.entries(map)) {
    const svcEntry = doc.createElementNS(null, "entry");

    const svcKeyEl = doc.createElementNS(null, "string");
    svcKeyEl.textContent = serviceKey;
    svcEntry.appendChild(svcKeyEl);

    const portMapWrapper = doc.createElementNS(null, WS_PORT_MAP_TAG);
    const innerMapEl = doc.createElementNS(null, "map");
    innerMapEl.setAttribute("class", "linked-hash-map");
    portMapWrapper.appendChild(innerMapEl);

    for (const [portKey, portInfo] of Object.entries(portMap)) {
      const portEntry = doc.createElementNS(null, "entry");

      const portKeyEl = doc.createElementNS(null, "string");
      portKeyEl.textContent = portKey;
      portEntry.appendChild(portKeyEl);

      const portInfoEl = doc.createElementNS(null, WS_PORT_INFO_TAG);

      const writeStringList = (tag: string, items: string[] | undefined | null) => {
        const el = doc.createElementNS(null, tag);
        for (const s of items ?? []) {
          const strEl = doc.createElementNS(null, "string");
          strEl.textContent = s;
          el.appendChild(strEl);
        }
        portInfoEl.appendChild(el);
      };

      writeStringList("operations", portInfo.operations);
      writeStringList("actions", portInfo.actions);
      const locEl = doc.createElementNS(null, "locationURI");
      locEl.textContent = portInfo.locationURI;
      portInfoEl.appendChild(locEl);

      portEntry.appendChild(portInfoEl);
      innerMapEl.appendChild(portEntry);
    }

    svcEntry.appendChild(portMapWrapper);
    outerMapEl.appendChild(svcEntry);
  }
}

function parseWsAttachments(root: Element): WebServiceAttachment[] {
  const names = Array.from(root.querySelectorAll(":scope > attachmentNames > string")).map(
    (e) => e.textContent ?? ""
  );
  const contents = Array.from(root.querySelectorAll(":scope > attachmentContents > string")).map(
    (e) => e.textContent ?? ""
  );
  const types = Array.from(root.querySelectorAll(":scope > attachmentTypes > string")).map(
    (e) => e.textContent ?? ""
  );
  return names.map((name, i) => ({ name, content: contents[i] ?? "", type: types[i] ?? "" }));
}

function writeWsAttachments(
  root: Element,
  attachments: WebServiceAttachment[],
  doc: Document
): void {
  const writeList = (tag: string, values: string[]) => {
    let container = root.querySelector(`:scope > ${tag}`);
    if (!container) {
      container = doc.createElementNS(null, tag);
      root.appendChild(container);
    }
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const v of values) {
      const s = doc.createElementNS(null, "string");
      s.textContent = v;
      container.appendChild(s);
    }
  };
  // Mirror Java WebServiceSender.getAttachments(): skip rows with a blank
  // ID/name so the parallel name/content/type lists stay index-aligned.
  const kept = attachments.filter((a) => a.name.trim() !== "");
  writeList(
    "attachmentNames",
    kept.map((a) => a.name)
  );
  writeList(
    "attachmentContents",
    kept.map((a) => a.content)
  );
  writeList(
    "attachmentTypes",
    kept.map((a) => a.type)
  );
}

export function parseWebServiceSenderPropsFromXml(
  propertiesXml: string | null
): WebServiceSenderProps {
  if (!propertiesXml) return { ...DEFAULT_WS_PROPS };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const t = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const tRaw = (tag: string, def = "") => root.querySelector(`:scope > ${tag}`)?.textContent ?? def;
  const b = (tag: string, def = false) => {
    const v = root.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    return v !== undefined ? v === "true" : def;
  };
  return {
    wsdlUrl: t("wsdlUrl"),
    service: t("service"),
    port: t("port"),
    locationURI: t("locationURI"),
    socketTimeout: t("socketTimeout", "30000"),
    useAuthentication: b("useAuthentication"),
    username: t("username"),
    password: t("password"),
    envelope: tRaw("envelope"),
    oneWay: b("oneWay"),
    operation: t("operation", "Press Get Operations"),
    soapAction: t("soapAction"),
    headers: parseLinkedHashMapList(root, "headers"),
    headersVariable: t("headersVariable"),
    useHeadersVariable: b("isUseHeadersVariable"),
    useMtom: b("useMtom"),
    attachments: parseWsAttachments(root),
    attachmentsVariable: t("attachmentsVariable"),
    useAttachmentsVariable: b("isUseAttachmentsVariable"),
    wsdlDefinitionMap: parseWsdlDefinitionMap(root),
  };
}

export function updateWebServiceSenderPropsInXml(
  propertiesXml: string,
  props: WebServiceSenderProps
): string {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const set = (tag: string, val: string) => {
    ensureChild(root, tag, doc).textContent = val;
  };
  set("wsdlUrl", props.wsdlUrl);
  set("service", props.service);
  set("port", props.port);
  set("locationURI", props.locationURI);
  set("socketTimeout", props.socketTimeout);
  set("useAuthentication", String(props.useAuthentication));
  set("username", props.username);
  set("password", props.password);
  set("envelope", props.envelope);
  set("oneWay", String(props.oneWay));
  set("operation", props.operation);
  set("soapAction", props.soapAction);
  writeLinkedHashMapList(root, "headers", props.headers, doc);
  set("headersVariable", props.headersVariable);
  set("isUseHeadersVariable", String(props.useHeadersVariable));
  set("useMtom", String(props.useMtom));
  writeWsAttachments(root, props.attachments, doc);
  set("attachmentsVariable", props.attachmentsVariable);
  set("isUseAttachmentsVariable", String(props.useAttachmentsVariable));
  writeWsdlDefinitionMap(root, props.wsdlDefinitionMap, doc);
  return serialize(doc);
}

// ─── Library Resources per-context helpers ────────────────────────────────────

/**
 * Keying convention (mirrors Java LibraryResourcesPanel.selectedResourceIds):
 *   "channel" → channel.properties.resourceIds  (Java: null)
 *   0         → sourceConnectorProperties.resourceIds
 *   N (>0)    → destinationConnectorProperties.resourceIds for that metaDataId
 */
export type ResourceContextKey = "channel" | number;
export type ResourceIdsByContext = Map<ResourceContextKey, string[]>;

function readResourceIds(parent: Element | null): string[] {
  if (!parent) return [];
  const mapEl = parent.querySelector(":scope > resourceIds");
  if (!mapEl) return [];
  return Array.from(mapEl.querySelectorAll(":scope > entry > string:first-child")).map(
    (el) => el.textContent?.trim() ?? ""
  );
}

/**
 * Read the library resource IDs stored inside a single connector's own
 * `<properties>` XML (the blob passed to a connector section as `propertiesXml`),
 * not the whole channel. Source connectors keep them under
 * `<sourceConnectorProperties>`, destinations under `<destinationConnectorProperties>`.
 *
 * Mirrors the Java client passing `channelEditPanel.resourceIds.get(metaDataId).keySet()`
 * into DatabaseConnectionInfo — the server uses these IDs to build an isolated
 * classloader for custom driver jars. Returns e.g. `["Default Resource"]` for defaults,
 * or `[]` when the connector has no resource map.
 */
export function parseConnectorResourceIds(
  propertiesXml: string,
  kind: "source" | "destination"
): string[] {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const container = doc.querySelector(
    kind === "source" ? "sourceConnectorProperties" : "destinationConnectorProperties"
  );
  return readResourceIds(container);
}

export function parseResourceIdsByContext(xml: string): ResourceIdsByContext {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const result: ResourceIdsByContext = new Map();

  result.set("channel", readResourceIds(doc.querySelector("channel > properties")));
  result.set(
    0,
    readResourceIds(
      doc.querySelector("channel > sourceConnector > properties > sourceConnectorProperties")
    )
  );

  const connEls = doc.querySelectorAll("channel > destinationConnectors > connector");
  for (const conn of connEls) {
    const metaDataId = parseInt(
      conn.querySelector(":scope > metaDataId")?.textContent?.trim() ?? "1",
      10
    );
    const dcp = conn.querySelector(":scope > properties > destinationConnectorProperties");
    result.set(metaDataId, readResourceIds(dcp));
  }

  return result;
}

function buildResourceIdsMapEl(
  ids: string[],
  resources: ResourceProperties[],
  doc: Document
): Element {
  const mapEl = doc.createElement("resourceIds");
  mapEl.setAttribute("class", "linked-hash-map");
  for (const id of ids) {
    const name = resources.find((r) => r.id === id)?.name ?? id;
    const entryEl = doc.createElement("entry");
    const keyEl = doc.createElement("string");
    keyEl.textContent = id;
    const valueEl = doc.createElement("string");
    valueEl.textContent = name;
    entryEl.appendChild(keyEl);
    entryEl.appendChild(valueEl);
    mapEl.appendChild(entryEl);
  }
  return mapEl;
}

function writeContextResourceIds(
  parent: Element | null,
  ids: string[],
  resources: ResourceProperties[],
  doc: Document
): void {
  if (!parent) return;
  parent.querySelector(":scope > resourceIds")?.remove();
  parent.appendChild(buildResourceIdsMapEl(ids, resources, doc));
}

export function serializeResourceIdsByContext(
  xml: string,
  byContext: ResourceIdsByContext,
  resources: ResourceProperties[]
): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  writeContextResourceIds(
    doc.querySelector("channel > properties"),
    byContext.get("channel") ?? [],
    resources,
    doc
  );
  writeContextResourceIds(
    doc.querySelector("channel > sourceConnector > properties > sourceConnectorProperties"),
    byContext.get(0) ?? [],
    resources,
    doc
  );

  const connEls = doc.querySelectorAll("channel > destinationConnectors > connector");
  for (const conn of connEls) {
    const metaDataId = parseInt(
      conn.querySelector(":scope > metaDataId")?.textContent?.trim() ?? "1",
      10
    );
    const dcp = conn.querySelector(":scope > properties > destinationConnectorProperties");
    writeContextResourceIds(dcp, byContext.get(metaDataId) ?? [], resources, doc);
  }

  return serialize(doc);
}

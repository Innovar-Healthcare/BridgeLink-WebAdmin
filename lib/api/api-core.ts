/**
 * API core — shared infrastructure used by all domain API modules.
 *
 * Contains: PROXY_BASE, getServerUrl, normalizeXStream, request, escXml.
 * Domain modules import from this file; consumers import from api-client.ts (barrel).
 */

import { clearClientCaches } from "@/lib/logout";
import { logWarn } from "@/lib/dev-logger";

export const PROXY_BASE = "/api/proxy";

// Default Accept for rawText fetches (bodies are XML or plain text, never the
// XStream JSON we parse elsewhere). Preferring application/xml with a text/plain
// then */* fallback un-misleads engine content negotiation without 406-ing any
// existing raw-body endpoint. Callers needing a specific type override via
// `headers: { Accept }`..
const RAW_TEXT_ACCEPT = "application/xml, text/plain;q=0.9, */*;q=0.8";

/**
 * Extract a user-friendly message from a BridgeLink API error body.
 *
 * The server returns JSON envelopes of the form
 *   {"status":"error","code":"...","message":"...","timestamp":"..."}
 * but legacy endpoints may return plain text, an HTML stack trace, or an
 * empty body. This helper is forgiving on all of those.
 */
export function extractApiErrorMessage(text: string): string {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return "Unknown server error";

  // Cap so multi-KB stack traces / messages don't blow up the UI.
  const MAX = 500;
  const cap = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

  // JSON envelope path — try to pull out .message
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown };
      if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
      // Parsed as JSON but no useful message — don't expose the raw JSON to users
      return "Unknown server error";
    } catch {
      // fall through to raw-text handling
    }
  }

  // XML body. BridgeLink serializes a server exception as an XStream-encoded Java
  // Throwable and returns it as the error body (e.g. a 500 from PUT /server/configuration).
  // Surface its real <detailMessage>/<message> — the same text the Java client shows —
  // instead of hiding it. A genuine HTML error page has no such element, so we keep the
  // generic fallback rather than dumping markup at the user.
  if (trimmed.startsWith("<")) {
    const xmlMessage = extractXmlExceptionMessage(trimmed);
    return xmlMessage ? cap(xmlMessage) : "The server returned an unexpected response";
  }

  // Plain text
  return cap(trimmed);
}

/**
 * Pull the human-readable message out of a BridgeLink XStream-serialized exception body, e.g.
 *   <com.mirth.connect.client.core.ControllerException>
 *     <detailMessage>Restoring server configuration did not successfully complete. …</detailMessage>
 *     <cause .../>
 *   </com.mirth.connect.client.core.ControllerException>
 *
 * Returns the outermost exception's message, or null when the body has no recognizable
 * message element (e.g. a Jetty HTML error page). Regex-based so it is safe on the server
 * (no DOMParser dependency).
 */
function extractXmlExceptionMessage(xml: string): string | null {
  // First <detailMessage>/<message> in document order is the outermost exception's message;
  // nested causes appear later. The backreference keeps the open/close tag names matched.
  const match = /<(detailMessage|message)>([\s\S]*?)<\/\1>/.exec(xml);
  const raw = match?.[2]?.trim();
  return raw ? decodeXmlEntities(raw) : null;
}

/** Decode the XML entities XStream may emit inside a serialized message. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&"); // decode &amp; last so "&amp;lt;" -> "&lt;", not "<"
}

/**
 * Throw a user-friendly error for a failed raw-fetch response.
 * Handles 401 (session redirect), 403 (permission denied), and generic errors
 * identically to request() so all API callers behave consistently.
 *
 * @param status  HTTP status code from the response
 * @param text    Response body text (already read from the response)
 * @param prefix  Optional prefix for non-401/403 errors (e.g. "Save failed")
 */
/**
 * Error carrying the HTTP status that produced it. Extends Error with the same
 * message text as before, so existing `e instanceof Error ? e.message` consumers
 * are unaffected; callers that need to discriminate (e.g. tolerate 403 but not a
 * transient 502) can check `e instanceof ApiError && e.status === 403`.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function throwForStatus(status: number, text: string, prefix?: string): never {
  if (status === 401 && typeof window !== "undefined") {
    clearClientCaches();
    const returnUrl = window.location.pathname + window.location.search;
    window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  }
  if (status === 403) {
    throw new ApiError(
      403,
      "Permission denied — your role does not have write access to this feature"
    );
  }
  const detail = extractApiErrorMessage(text);
  throw new ApiError(status, prefix ? `${prefix}: ${detail}` : detail);
}

export function getServerUrl(): string {
  if (typeof window === "undefined") return "";
  const raw = sessionStorage.getItem("bl_session");
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { serverUrl: string }).serverUrl ?? "";
  } catch (e) {
    logWarn("API", "Failed to parse server URL from session", e);
    return "";
  }
}

/**
 * XStream JSON normalizer.
 *
 * BridgeLink serializes with XStream which produces non-standard JSON:
 *   - Lists:  {"list": {"dashboardStatus": [...]}}  or  {"list": {"string": [...]}}
 *   - Maps:   {"@class":"linked-hash-map","entry":[{key},{value},{key},{value},...]}
 *   - Dates:  {"time": 1234567890, "timezone": "America/New_York"}
 *   - Typed wrappers: {"com.mirth.connect.model.Foo": {...}}
 *
 * This function recursively normalizes the raw parsed JSON into plain JS objects/arrays.
 */
/** Raw JSON value as returned by JSON.parse (before XStream normalization). */
export type XStreamRaw =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

/** Typed recursive representation of parsed XStream JSON for consuming raw responses. */
export type XStreamValue = string | number | boolean | null | XStreamObject | XStreamValue[];
export type XStreamObject = { [key: string]: XStreamValue };

// XStream element names for Java collections. When one of these is the VALUE field of a
// map entry, indexing entry[valueField] strips the collection wrapper and leaves a bare
// {<elementType>: ...} object, which downstream handlers mistake for a keyed property. The
// value must be re-wrapped before normalization so the list/collection logic collapses it
// to a plain array.
const XSTREAM_COLLECTION_FIELDS = new Set([
  "list",
  "linked-list",
  "set",
  "hash-set",
  "tree-set",
  "linked-hash-set",
  "sorted-set",
  "enum-set",
]);

/**
 * Decode an XStream "custom"-serialized Apache Commons hashed map (e.g. CaseInsensitiveMap —
 * how MessageHeaders stores HTTP/WS response headers) into a plain {key: value} object.
 *
 * AbstractHashedMap.doWriteObject writes loadFactor, capacity, size, then size key/value pairs.
 * Staxon groups the resulting elements by type, so the keys land in the "string" array (these maps
 * are always String-keyed) and the parallel List<String> values land in the "list" array. We pair
 * them by index. Returns null when the shape doesn't match (caller falls through)..
 */
function decodeCustomSerializedMap(obj: Record<string, unknown>): Record<string, unknown> | null {
  const fqnKey = Object.keys(obj).find((k) => k.includes(".") && k.toLowerCase().includes("map"));
  if (!fqnKey || typeof obj[fqnKey] !== "object" || obj[fqnKey] === null) return null;
  const block = obj[fqnKey] as Record<string, unknown>;
  const rawKeys = block["string"];
  if (rawKeys == null) return null;
  const keyArr = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
  // Value array = the non-metadata field whose length matches the key array.
  const META = new Set(["default", "float", "int", "string"]);
  const valueField = Object.keys(block).find(
    (k) =>
      !META.has(k) &&
      (Array.isArray(block[k]) ? (block[k] as unknown[]).length : 1) === keyArr.length
  );
  const valArr = valueField
    ? Array.isArray(block[valueField])
      ? (block[valueField] as unknown[])
      : [block[valueField]]
    : [];
  const result: Record<string, unknown> = {};
  for (let i = 0; i < keyArr.length; i++) {
    // List<String> values arrive as {string: "x"} / {string: ["x","y"]} — wrap so the
    // list-wrapper handler yields a flat array. Other value types pass through directly.
    result[String(keyArr[i])] =
      valueField === "list"
        ? _normalizeXStream({ list: valArr[i] })
        : valueField
          ? _normalizeXStream(valArr[i])
          : null;
  }
  return result;
}

// Internal implementation casts to Record<string, unknown> after the primitive/array guards
// because it operates on dynamically-typed XStream JSON whose structure cannot be statically
// determined. The public `normalizeXStream` enforces the XStreamRaw input type for callers.
function _normalizeXStream(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object") return val;

  // Arrays — recurse into each element
  if (Array.isArray(val)) return (val as unknown[]).map(_normalizeXStream);

  // After the above guards, val is a non-null, non-array object — safe to index dynamically.
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj);

  // XStream list wrapper: {"list": {"someName": [...] or {...}}}
  if (keys.length === 1 && keys[0] === "list") {
    const inner = obj["list"];
    if (inner === null || inner === undefined) return [];
    // The inner object has one key whose value is the actual array (or single item)
    const innerObj = inner as Record<string, unknown>;
    const innerKeys = Object.keys(innerObj);
    if (innerKeys.length === 1) {
      const items = innerObj[innerKeys[0]];
      // XStream collapses single-item lists to an object instead of array
      const arr = Array.isArray(items) ? (items as unknown[]) : [items];
      return arr.map(_normalizeXStream);
    }
    return _normalizeXStream(innerObj);
  }

  // XStream top-level HashMap envelope: {"map": {"entry": [...]}}
  // XStream serializes Map<K,V> as <map><entry>...</entry></map> → Staxon converts to
  // {"map": {"entry": [...]}}. This is the outer wrapper returned by endpoints like
  // GET /server/channelMetadata and GET /channels/idsAndNames.
  // We must process it before the generic single-key heuristic below, which would
  // otherwise misidentify "entry" as an inline list field.
  // NOTE: An empty Java Map serializes as <map/>, which Staxon may represent as either
  // {"map": {}} or {"map": null}. Both must be treated as an empty result ({}).
  if (keys.length === 1 && keys[0] === "map") {
    const mapVal = obj["map"];
    // Null or non-object inner value → empty map
    if (mapVal === null || typeof mapVal !== "object") return {};
    const mapInner = mapVal as Record<string, unknown>;
    // Empty map: {"map": {}} → return {}
    if (Object.keys(mapInner).length === 0) return {};
    const rawEntries = mapInner["entry"];
    if (rawEntries == null) return _normalizeXStream(mapInner);
    // Delegate to the shared entry-processing logic below by re-entering with a
    // synthetic linked-hash-map object that the existing handler will pick up.
    return _normalizeXStream({ "@class": "linked-hash-map", entry: rawEntries });
  }

  // XStream inline linked-hash-map without @class: {"entry": {...}} or {"entry": [...]}
  // This occurs when XStream omits the @class attribute on a known Map field (e.g. ServerEvent.attributes).
  // Single entry: {"entry": {"string": ["key", "value"]}}
  // Multiple entries: {"entry": [{"string": ["k1","v1"]}, {"string": ["k2","v2"]}]}
  if (keys.length === 1 && keys[0] === "entry") {
    return _normalizeXStream({ "@class": "linked-hash-map", entry: obj["entry"] });
  }

  // Java Collections.unmodifiableMap() / synchronizedMap() / checkedMap() wrappers:
  // XStream serializes these with the FQN as @class and the inner map under field "m":
  //   {"@class": "java.util.Collections$UnmodifiableMap", "m": { "entry": [...] }}
  // Unwrap by recursively normalizing the inner "m" field.
  if (
    obj["@class"] &&
    typeof obj["@class"] === "string" &&
    obj["@class"].startsWith("java.util.Collections$") &&
    obj["m"] != null
  ) {
    return _normalizeXStream(obj["m"]);
  }

  // XStream Map types (linked-hash-map, sorted-map, tree-map, concurrent-hash-map):
  // Each entry is one object with a key field and a value field.
  // Two cases:
  //   a) Key is a typed Java object → key field has a fully-qualified class name (contains ".")
  //      e.g. {"com.mirth.connect.donkey.model.message.Status":"RECEIVED","long":0}
  //   b) Key is a plain String → key field is "string" (no dot)
  //      e.g. {"string":"<channelId>","com.mirth.connect.model.ChannelMetadata":{...}}
  //      e.g. {"string":"<channelId>","string":{"..."}  — single-value map (Map<String,String>)
  // Staxon's autoArray collapses single-item lists to objects — normalize entry to array.
  // TreeMap → @class="sorted-map" or "tree-map", LinkedHashMap → @class="linked-hash-map",
  // ConcurrentHashMap → @class="concurrent-hash-map", HashMap → @class="hash-map"
  const XSTREAM_MAP_CLASSES = new Set([
    "linked-hash-map",
    "sorted-map",
    "tree-map",
    "hash-map",
    "concurrent-hash-map",
    "map",
  ]);
  if (obj["@class"] && XSTREAM_MAP_CLASSES.has(obj["@class"] as string)) {
    // Empty map (no entries)
    if (obj["entry"] == null) return {};
    // Non-empty map — process entries
    const rawEntries = obj["entry"];
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    const result: Record<string, unknown> = {};
    for (const rawEntry of entries) {
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry !== "object" || entry === null) continue;
      const entryKeys = Object.keys(entry).filter((k) => k !== "@class");

      // Determine key/value fields.
      // Rule: "string" always wins as the key field when present.
      //   Case (a): Map<String, X> — {"string": "<id>", "<typeName>": {...}}
      //             OR Map<String, String> — {"string": ["key","val"]} / {"string": "key", "string": ...}
      //   Case (b): Map<K, V> where K is a typed Java object serialized as its FQN class name
      //             e.g. {"com.mirth.connect.donkey.model.message.Status": "RECEIVED", "long": 0}
      //             In this case there is no "string" field.
      const hasStringKey = entryKeys.includes("string");
      const fqnKeys = entryKeys.filter((k) => k.includes("."));

      // Java primitive type names used as map keys in XStream
      const PRIMITIVE_KEY_TYPES = new Set([
        "int",
        "long",
        "double",
        "float",
        "short",
        "byte",
        "boolean",
        "char",
      ]);

      if (hasStringKey) {
        // Case (a): "string" is always the map key.
        const nonStringFields = entryKeys.filter((k) => k !== "string");
        if (nonStringFields.length > 0) {
          // Map<String, SomeObject> or Map<String, FQNObject>
          const keyStr = String(entry["string"]);
          const valueField = nonStringFields[0];
          const rawValue = entry[valueField];
          // A map value that is itself an XStream collection (e.g. an ArrayList serialized as
          // <list><string>…</string></list>) arrives as {list: {string: [...]}}. Indexing
          // entry[valueField] strips the wrapper and leaves {string: [...]}, which downstream
          // handlers mistake for a keyed object. Re-wrap so the list/collection logic yields a
          // plain array. Non-collection value fields keep the direct pass-through.
          result[keyStr] = XSTREAM_COLLECTION_FIELDS.has(valueField)
            ? _normalizeXStream({ [valueField]: rawValue })
            : _normalizeXStream(rawValue);
        } else {
          // Map<String, String> — XStream emits entry["string"] as [key, value] when both K and V
          // are "string" type, or just the value when the key was already used.
          const strVal = entry["string"];
          if (Array.isArray(strVal) && strVal.length === 2) {
            result[String(strVal[0])] = strVal[1];
          }
        }
      } else if (fqnKeys.length > 0) {
        // Case (b): no "string" field — key is a FQN-typed Java object.
        // The FQN field whose value is a primitive/string is the key; the other field is the value.
        // Heuristic: find the field whose value is a primitive (string/number/boolean) → that is the key.
        const keyField = fqnKeys.find((k) => typeof entry[k] !== "object") ?? fqnKeys[0];
        const valueField = entryKeys.find((k) => k !== keyField);
        const keyStr = String(entry[keyField]);
        const rawVal = valueField !== undefined ? entry[valueField] : null;
        result[keyStr] = _normalizeXStream(rawVal);
      } else {
        // Case (c): Map<PrimitiveType, SomeObject> — e.g. Map<Integer, ConnectorMessage>
        // XStream entry: {"int": 0, "connectorMessage": {...}}
        // The primitive type field ("int", "long", etc.) is the key; the other field is the value.
        const primitiveKeyField = entryKeys.find((k) => PRIMITIVE_KEY_TYPES.has(k));
        if (primitiveKeyField) {
          const keyStr = String(entry[primitiveKeyField]);
          const valueField = entryKeys.find((k) => k !== primitiveKeyField);
          const rawVal = valueField !== undefined ? entry[valueField] : null;
          result[keyStr] = _normalizeXStream(rawVal);
        }
      }
    }
    return result;
  }

  // XStream Set/List collections serialized with an explicit @class attribute, e.g.
  //   {"@class": "linked-hash-set", "string": ["a", "b"]}  (LinkedHashSet<String>, multiple)
  //   {"@class": "linked-hash-set", "string": "a"}         (single — XStream collapses to a scalar)
  //   {"@class": "sorted-set", "com.x.Y": [...]}           (TreeSet of typed elements)
  //   {"@class": "empty-set"}                              (Collections.emptySet())
  // XStream writes the class attribute whenever the concrete collection type is NOT the default
  // implementation of the field's declared type (e.g. a LinkedHashSet in a Set field, whose default
  // impl is HashSet). Staxon maps that attribute to "@class". The map-class handler above only covers
  // Map types; without this block such a collection falls through to the plain-object loop and is
  // mis-normalized to {<elementName>: [...]} (an object) instead of a flat array — which broke the
  // dashboard's remainingChannelIds two-stage fetch.
  const XSTREAM_COLLECTION_CLASSES = new Set([
    "list",
    "linked-list",
    "set",
    "hash-set",
    "tree-set",
    "linked-hash-set",
    "sorted-set",
    "enum-set",
    "empty-set",
    "empty-list",
    "singleton-set",
    "singleton-list",
  ]);
  if (typeof obj["@class"] === "string" && XSTREAM_COLLECTION_CLASSES.has(obj["@class"])) {
    // Elements are grouped under one key per element type (e.g. "string", or an FQN class name).
    // Collect across every element-type key so a heterogeneous collection doesn't drop members,
    // and re-wrap XStream's single-element-collapses-to-scalar form back into an array.
    const elementKeys = keys.filter((k) => k !== "@class" && k !== "@reference");
    if (elementKeys.length === 0) return []; // empty collection (e.g. empty-set)
    const arr = elementKeys.flatMap((k) => {
      const items = obj[k];
      return Array.isArray(items) ? (items as unknown[]) : [items];
    });
    return arr.map(_normalizeXStream);
  }

  // MessageHeaders (HTTP/WS response headers) serializes as {delegate: <custom map>}.
  // Java MessageHeaders.toString() == delegate.toString(), so unwrap to the bare map..
  if (keys.length === 1 && keys[0] === "delegate") {
    const inner = obj["delegate"];
    if (
      inner &&
      typeof inner === "object" &&
      (inner as Record<string, unknown>)["@serialization"] === "custom"
    ) {
      const decoded = decodeCustomSerializedMap(inner as Record<string, unknown>);
      if (decoded) return decoded;
    }
  }

  // Bare XStream "custom"-serialized hashed map (e.g. Apache Commons CaseInsensitiveMap)..
  if (obj["@serialization"] === "custom") {
    const decoded = decodeCustomSerializedMap(obj);
    if (decoded) return decoded;
  }

  // XStream date object: {"time": number, "timezone": string}
  if (keys.length === 2 && "time" in obj && "timezone" in obj) {
    return new Date(obj["time"] as number).toISOString();
  }

  // Java primitive type wrappers: {"int": N}, {"long": N}, {"double": N}, {"boolean": B}
  // XStream serializes scalar return values (Integer, Long, etc.) with the Java type name as key.
  const PRIMITIVE_TYPES = new Set([
    "int",
    "long",
    "double",
    "float",
    "short",
    "byte",
    "boolean",
    "char",
  ]);
  if (keys.length === 1 && PRIMITIVE_TYPES.has(keys[0])) {
    return obj[keys[0]];
  }

  // Fully-qualified class name wrapper: {"com.mirth.connect.model.Foo": {...}}
  if (keys.length === 1 && keys[0].includes(".")) {
    return _normalizeXStream(obj[keys[0]]);
  }

  // Known XStream @XStreamAlias wrappers — camelCase class aliases (no dot).
  // XStream serializes the root object of a GET response wrapped in its alias key.
  // e.g. GET /server/settings → {"serverSettings": {...}} must be unwrapped to {...}.
  // Add more aliases here as new endpoints are discovered.
  const XSTREAM_ALIASES = new Set([
    "serverSettings",
    "updateSettings",
    "attachment",
    "alertInfo",
    "alertModel",
    "dashboardChannelInfo",
  ]);
  if (keys.length === 1 && XSTREAM_ALIASES.has(keys[0])) {
    return _normalizeXStream(obj[keys[0]]);
  }

  // XStream map-type root wrappers without @class attribute.
  // Occurs when XStream serializes a Java Map as the top-level return value using the
  // collection class alias as the XML element name (e.g. <concurrent-hash-map>).
  // Example: GET /extensions/dashboardstatus/connectorStates → {"concurrent-hash-map": {"entry": [...]}}
  // Must be handled BEFORE the generic single-key inline-list heuristic below, which would
  // otherwise misidentify {"concurrent-hash-map": {"entry": [...]}} as a list wrapper and
  // return an array of entry objects instead of the expected Record<string, ...> map.
  // (The "map" key is already handled by the dedicated {"map": ...} block above.)
  if (keys.length === 1 && XSTREAM_MAP_CLASSES.has(keys[0]) && keys[0] !== "map") {
    const mapInner = obj[keys[0]] as Record<string, unknown>;
    if (!mapInner || typeof mapInner !== "object" || Array.isArray(mapInner)) return {};
    if (Object.keys(mapInner).length === 0) return {};
    const rawEntries = mapInner["entry"];
    if (rawEntries == null) return _normalizeXStream(mapInner);
    return _normalizeXStream({ "@class": keys[0], entry: rawEntries });
  }

  // Plain object — recurse into values
  // Special case: XStream inline list fields like {"childStatuses": {"dashboardStatus": [...]}}
  // where the outer key is the field name and inner key is the element type name.
  if (
    keys.length === 1 &&
    !keys[0].includes(".") &&
    typeof obj[keys[0]] === "object" &&
    obj[keys[0]] !== null
  ) {
    const inner = obj[keys[0]] as Record<string, unknown>;
    const innerKeys = Object.keys(inner);
    // If the inner object has exactly one key that looks like a type name (no "@"), treat as list
    if (innerKeys.length === 1 && !innerKeys[0].startsWith("@")) {
      const items = inner[innerKeys[0]];
      const arr = Array.isArray(items) ? (items as unknown[]) : [items];
      return arr.map(_normalizeXStream);
    }
  }

  const out: Record<string, unknown> = {};
  for (const k of keys) {
    // Strip XStream metadata keys
    if (k === "@class" || k === "@reference") continue;
    const v = obj[k];
    // Unwrap inline XStream list fields: {fieldName: {typeName: [...]}}
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const vObj = v as Record<string, unknown>;
      const vKeys = Object.keys(vObj);
      // If the field value is {"entry": ...}, treat it as a linked-hash-map (e.g. ServerEvent.attributes).
      // Must check this BEFORE the generic single-key list heuristic below, which would otherwise
      // misidentify {"entry": [{...}]} as an inline list.
      if (vKeys.length === 1 && vKeys[0] === "entry") {
        out[k] = _normalizeXStream(vObj);
        continue;
      }
      // XStream set class names — must NOT be treated as inline list type names.
      // {"set": {"string": "ANY"}} is a Set<String>, not a list field; delegate to _normalizeXStream(v)
      // which handles it via the top-level single-key heuristic and produces a flat string array.
      const XSTREAM_SET_CLASSES = new Set([
        "set",
        "hash-set",
        "tree-set",
        "linked-hash-set",
        "sorted-set",
        "enum-set",
      ]);
      if (
        vKeys.length === 1 &&
        !vKeys[0].startsWith("@") &&
        !vKeys[0].includes(".") &&
        !XSTREAM_SET_CLASSES.has(vKeys[0]) &&
        (Array.isArray(vObj[vKeys[0]]) || typeof vObj[vKeys[0]] === "object")
      ) {
        const items = vObj[vKeys[0]];
        const arr = Array.isArray(items) ? (items as unknown[]) : [items];
        out[k] = arr.map(_normalizeXStream);
        continue;
      }
    }
    out[k] = _normalizeXStream(v);
  }
  return out;
}

export function normalizeXStream(val: XStreamRaw): unknown {
  return _normalizeXStream(val);
}

export async function request<T>(
  path: string,
  options?: RequestInit & { skipNormalize?: boolean; rawText?: boolean }
): Promise<T> {
  const serverUrl = getServerUrl();

  // Build headers. When the body is FormData, omit Content-Type entirely so the browser
  // sets it automatically with the correct multipart boundary parameter.
  // Explicitly setting Content-Type without a boundary causes the server to return 415.
  const headers: Record<string, string> = {
    Accept: options?.rawText ? RAW_TEXT_ACCEPT : "application/json",
    ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (!(options?.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throwForStatus(res.status, text);
  }

  // 204 No Content — nothing to parse
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  // rawText: return the response body as a plain string without JSON parsing.
  // Used for endpoints that return text/plain (e.g. POST /events/_export).
  if (options?.rawText) return text as T;

  // Staxon auto-number: when Staxon converts XStream XML to JSON it may emit numeric text
  // content as a bare JSON number instead of a quoted string. This causes precision loss
  // for large integers when JavaScript's JSON.parse converts them to 64-bit floats.
  //
  // Pattern 1 — Map<String,String> entries:
  //   {"string": ["<key>", 12345678901234567890]}  →  {"string": ["<key>", "12345678901234567890"]}
  // Pattern 2 — "name" fields (channel/connector names that are purely numeric):
  //   "name": 12345678901234567890  →  "name": "12345678901234567890"
  // Quote the number before parsing so the original digit string is preserved.
  const safeText = text
    .replace(
      /"string":\[("[^"]*"),([-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\]/g,
      (_, key: string, num: string) => `"string":[${key},"${num}"]`
    )
    .replace(
      /"name"\s*:\s*([-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([,}\]])/g,
      (_, num: string, tail: string) => `"name":"${num}"${tail}`
    );
  const data = JSON.parse(safeText);
  // skipNormalize: return raw parsed JSON without XStream normalization.
  // Used for endpoints that use non-standard serialization (e.g. java.util.Properties).
  if (options?.skipNormalize) return data as T;
  return normalizeXStream(data) as T;
}

/** Escape XML special characters. Used by channel group and code template serializers. */
export function escXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

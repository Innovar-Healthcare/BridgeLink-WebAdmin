/**
 * Shared XML helpers used by the filter/transformer serializer, parser, and
 * the transformer-step registry.
 *
 * Kept in a standalone module so that step-plugin modules can consume the
 * helpers without pulling filter-transformer-xml.ts into a circular import.
 */

export interface Replacement {
  regex: string;
  replaceWith: string;
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

export function childEl(parent: Element, tag: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (c.tagName === tag) return c;
  }
  return null;
}

export function childText(parent: Element, tag: string, fallback = ""): string {
  return childEl(parent, tag)?.textContent?.trim() ?? fallback;
}

/**
 * Like `childText` but returns the text content VERBATIM (no trim).
 *
 * Use for whitespace-significant content — script bodies, mapper mappings/default
 * values, message-builder segments, XSLT templates — where Java/XStream round-trips
 * byte-exact. Trimming on parse would rewrite such fields on open+save (leading/
 * trailing blank lines stripped → spurious revision bumps). Display/validation
 * layers trim on their own where needed. #49)
 */
export function childTextRaw(parent: Element, tag: string, fallback = ""): string {
  return childEl(parent, tag)?.textContent ?? fallback;
}

export function childBool(parent: Element, tag: string, fallback: boolean): boolean {
  const v = childEl(parent, tag)?.textContent?.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

export function childStrings(parent: Element, containerTag: string): string[] {
  const container = childEl(parent, containerTag);
  if (!container) return [];
  return Array.from(container.children)
    .filter((c) => c.tagName === "string")
    .map((c) => c.textContent?.trim() ?? "");
}

/**
 * FQN of the XStream reflection element for a Mapper/Message Builder
 * replacement. The Java field is `List<Pair<String,String>>` populated with
 * `org.apache.commons.lang3.tuple.ImmutablePair` and no custom XStream
 * converter is registered, so XStream writes the reflection form:
 * `<org.apache.commons.lang3.tuple.ImmutablePair><left class="string">a</left>
 * <right class="string">b</right></...>`. The server rejects any other shape
 * (a bare `<entry>` pair fails deserialization with HTTP 500). See.
 */
const IMMUTABLE_PAIR_TAG = "org.apache.commons.lang3.tuple.ImmutablePair";

export function childReplacements(parent: Element, containerTag: string): Replacement[] {
  const container = childEl(parent, containerTag);
  if (!container) return [];
  const result: Replacement[] = [];
  for (const pair of Array.from(container.children)) {
    // XStream reflection form: <left class="string">a</left><right class="string">b</right>.
    // `left`/`right` are lowercase so they survive happy-dom tag-name casing,
    // regardless of how the FQN wrapper tag is cased.
    const left = childEl(pair, "left");
    const right = childEl(pair, "right");
    if (left || right) {
      result.push({
        regex: left?.textContent?.trim() ?? "",
        replaceWith: right?.textContent?.trim() ?? "",
      });
      continue;
    }
    // Tolerate the legacy `<entry><string>a</string><string>b</string></entry>`
    // shape (only ever existed in unsaved in-memory drafts — it never persisted).
    const strs = Array.from(pair.children).filter((c) => c.tagName === "string");
    if (strs.length >= 2) {
      result.push({
        regex: strs[0].textContent?.trim() ?? "",
        replaceWith: strs[1].textContent?.trim() ?? "",
      });
    }
  }
  return result;
}

export function childIntList(parent: Element, containerTag: string): number[] {
  const container = childEl(parent, containerTag);
  if (!container) return [];
  return Array.from(container.children)
    .filter((c) => c.tagName === "int")
    .map((c) => parseInt(c.textContent?.trim() ?? "0", 10))
    .filter((n) => !isNaN(n));
}

export function outerXml(el: Element | null | undefined): string | null {
  if (!el) return null;
  return new XMLSerializer().serializeToString(el);
}

// ─── Serialize helpers (string-based) ────────────────────────────────────────
//
// DOM-based element creation is unreliable in some test environments
// (e.g. happy-dom) which apply HTML case-normalisation to tag names even
// inside `application/xml` documents, corrupting FQN Java class names and
// camelCase names. String building is immune to this.

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}

/** Encode a UTF-8 string to base64 exactly as BridgeLink's Java encodes it. */
export function encodeBase64Utf8(text: string): string {
  const utf8Bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function tcStr(tag: string, value: string): string {
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

export function serializeStringsStr(tag: string, values: string[]): string {
  if (values.length === 0) return `<${tag}/>`;
  return `<${tag}>${values.map((v) => tcStr("string", v)).join("")}</${tag}>`;
}

/**
 * Drop blank (whitespace-only) entries from a Rule Builder value list.
 *
 * Mirrors Java `RuleBuilderPanel.getValues()`, which excludes empty rows before
 * they reach `RuleBuilderRule.getScript()` / serialization. Java tests
 * `length() > 0`; we trim first so a spaces-only row (which would emit malformed
 * JS such as `field ==   `) is also dropped. Apply at the script-generation and
 * serialization boundaries so blank rows stay editable in the UI but never
 * persist or run.
 */
export function dropBlankValues(values: string[]): string[] {
  return values.filter((v) => v.trim().length > 0);
}

/**
 * Drop replacement rows whose regex is blank.
 *
 * Mirrors Java `MapperPanel.getProperties()` /
 * `MessageBuilderPanel.getProperties()`, which only add a replacement when
 * `StringUtils.isNotBlank(regex)` — a blank-regex row is excluded before it
 * reaches `getScript()` / serialization, so it never emits a malformed
 * `new Array(, "x")` clause or persists. Apply at the script-generation and
 * serialization boundaries so blank rows stay editable in the UI but never run.
 */
export function dropBlankRegexReplacements(items: Replacement[]): Replacement[] {
  return items.filter((r) => r.regex.trim().length > 0);
}

export function serializeReplacementsStr(tag: string, items: Replacement[]): string {
  if (items.length === 0) return `<${tag}/>`;
  const entries = items
    .map(
      (r) =>
        `<${IMMUTABLE_PAIR_TAG}>` +
        `<left class="string">${escapeXml(r.regex)}</left>` +
        `<right class="string">${escapeXml(r.replaceWith)}</right>` +
        `</${IMMUTABLE_PAIR_TAG}>`
    )
    .join("");
  return `<${tag}>${entries}</${tag}>`;
}

export function serializeIntListStr(tag: string, values: number[]): string {
  if (values.length === 0) return `<${tag}/>`;
  return `<${tag}>${values.map((v) => tcStr("int", String(v))).join("")}</${tag}>`;
}

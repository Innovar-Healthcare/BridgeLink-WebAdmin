/**
 * Channel XML segmenter — extracts labeled, searchable text segments
 * from a channel's raw XML for the global configuration search.
 *
 * Uses DOMParser to parse the XML and extract text content from scripts,
 * connector filters/transformers, and properties.
 */

import type { NavigationTarget, SearchableSegment } from "./search-types";

/**
 * Parse a channel XML string into searchable segments.
 * Each segment represents a distinct region (script, connector filter, etc.)
 * with a human-readable label and navigation target.
 */
export function segmentChannelXml(channelId: string, xml: string): SearchableSegment[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const segments: SearchableSegment[] = [];

  // ── Channel description ──
  const description = doc.querySelector("channel > description")?.textContent?.trim();
  if (description) {
    segments.push({
      label: "Description",
      content: description,
      navigateTo: { type: "channel-summary", channelId },
    });
  }

  // ── Channel-level scripts ──
  const scriptMap: Array<{ tag: string; label: string; key: string }> = [
    { tag: "preprocessingScript", label: "Preprocessing Script", key: "preprocessing" },
    { tag: "postprocessingScript", label: "Postprocessing Script", key: "postprocessing" },
    { tag: "deployScript", label: "Deploy Script", key: "deploy" },
    { tag: "undeployScript", label: "Undeploy Script", key: "undeploy" },
  ];
  for (const { tag, label, key } of scriptMap) {
    const content = doc.querySelector(`channel > ${tag}`)?.textContent ?? "";
    if (content.trim() && !isDefaultScript(content)) {
      segments.push({
        label,
        content,
        navigateTo: { type: "channel-scripts", channelId, script: key },
      });
    }
  }

  // ── Source connector ──
  const src = doc.querySelector("channel > sourceConnector");
  if (src) {
    addConnectorSegments(segments, src, channelId, "source", 0, "Source");
  }

  // ── Destination connectors ──
  const dests = doc.querySelectorAll("channel > destinationConnectors > connector");
  dests.forEach((dest, i) => {
    const destName =
      dest.querySelector(":scope > name")?.textContent?.trim() ?? `Destination ${i + 1}`;
    addConnectorSegments(segments, dest, channelId, "destination", i, destName);
  });

  // ── Attachment handler (JavaScript type) ──
  const attachProps = doc.querySelector("channel > properties > attachmentProperties > properties");
  if (attachProps) {
    const className = attachProps.getAttribute("class") ?? "";
    if (className.includes("JavaScriptAttachmentHandler")) {
      const script = attachProps.querySelector("script")?.textContent ?? "";
      if (script.trim()) {
        segments.push({
          label: "Attachment Handler (JavaScript)",
          content: script,
          navigateTo: { type: "channel-attachment", channelId },
        });
      }
    }
  }

  return segments;
}

/** Check if a script is just the BridgeLink default placeholder. */
function isDefaultScript(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === "" ||
    trimmed ===
      "// This script executes once when the channel is deployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;" ||
    trimmed ===
      "// This script executes once when the channel is undeployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;" ||
    trimmed === "// Modify the message variable below to pre process data\nreturn message;" ||
    trimmed ===
      '// This script executes once after a message has been processed\n// Responses returned from here will be stored as "Postprocessor" in the response map\nreturn;' ||
    // Also match single-line defaults
    trimmed === "return;" ||
    trimmed === "return message;"
  );
}

/** Extract searchable segments from a connector (source or destination). */
function addConnectorSegments(
  segments: SearchableSegment[],
  connectorEl: Element,
  channelId: string,
  type: "source" | "destination",
  destIndex: number,
  displayName: string
): void {
  const prefix = type === "source" ? "Source" : `Dest ${destIndex + 1} '${displayName}'`;

  // Filter
  const filterEl = connectorEl.querySelector(":scope > filter");
  if (filterEl) {
    const filterText = extractScriptFromFilterTransformer(filterEl);
    if (filterText.trim()) {
      const navigateTo: NavigationTarget =
        type === "source"
          ? { type: "channel-source", channelId, sub: "filter" }
          : {
              type: "channel-destination",
              channelId,
              destIndex,
              destName: displayName,
              sub: "filter",
            };
      segments.push({ label: `${prefix} > Filter`, content: filterText, navigateTo });
    }
  }

  // Transformer
  const transformerEl = connectorEl.querySelector(":scope > transformer");
  if (transformerEl) {
    const transformerText = extractScriptFromFilterTransformer(transformerEl);
    if (transformerText.trim()) {
      const navigateTo: NavigationTarget =
        type === "source"
          ? { type: "channel-source", channelId, sub: "transformer" }
          : {
              type: "channel-destination",
              channelId,
              destIndex,
              destName: displayName,
              sub: "transformer",
            };
      segments.push({ label: `${prefix} > Transformer`, content: transformerText, navigateTo });
    }
  }

  // Response transformer (destinations only)
  if (type === "destination") {
    const responseTransformerEl = connectorEl.querySelector(":scope > responseTransformer");
    if (responseTransformerEl) {
      const rtText = extractScriptFromFilterTransformer(responseTransformerEl);
      if (rtText.trim()) {
        segments.push({
          label: `${prefix} > Response Transformer`,
          content: rtText,
          navigateTo: {
            type: "channel-destination",
            channelId,
            destIndex,
            destName: displayName,
            sub: "responseTransformer",
          },
        });
      }
    }
  }

  // Connector properties (full XML text — useful for searching URLs, paths, queries, etc.)
  const propsEl = connectorEl.querySelector(":scope > properties");
  if (propsEl) {
    const propsText = extractPropertiesText(propsEl);
    if (propsText.trim()) {
      const navigateTo: NavigationTarget =
        type === "source"
          ? { type: "channel-source", channelId, sub: "properties" }
          : {
              type: "channel-destination",
              channelId,
              destIndex,
              destName: displayName,
              sub: "properties",
            };
      segments.push({ label: `${prefix} > Properties`, content: propsText, navigateTo });
    }
  }
}

/**
 * Extract all JavaScript/code content from a filter or transformer element.
 * BridgeLink filters and transformers contain <elements> with <script> children.
 * We concatenate all script content separated by newlines.
 */
function extractScriptFromFilterTransformer(el: Element): string {
  const scripts: string[] = [];
  el.querySelectorAll("elements > * > script").forEach((scriptEl) => {
    const text = scriptEl.textContent ?? "";
    if (text.trim()) scripts.push(text);
  });
  return scripts.join("\n\n");
}

/**
 * Extract searchable text from connector properties.
 * Rather than parsing each connector type's specific fields, we extract
 * all text content from leaf elements — this catches URLs, queries,
 * file paths, JavaScript code, XSLT templates, etc.
 */
function extractPropertiesText(propsEl: Element): string {
  const lines: string[] = [];
  const walk = (el: Element) => {
    // Skip elements that have child elements (not leaf nodes)
    if (el.children.length === 0) {
      const text = el.textContent?.trim() ?? "";
      // Skip empty values, booleans, and pure numbers (not useful for search)
      if (text && text !== "true" && text !== "false" && !/^\d+$/.test(text)) {
        const tagName = el.tagName;
        lines.push(`${tagName}: ${text}`);
      }
    } else {
      for (const child of el.children) {
        walk(child);
      }
    }
  };
  walk(propsEl);
  return lines.join("\n");
}

/**
 * Channel XML segmenter — extracts labeled, searchable text segments
 * from a channel's raw XML for the global configuration search.
 *
 * Uses DOMParser to parse the XML and extract text content from scripts,
 * connector filters/transformers, and properties. Filter rules and transformer
 * steps are emitted one segment per element, each carrying the element's index
 * path so a search hit can deep-link to that exact step.
 *
 * ── Why this walks the DOM by hand instead of reusing the editor's parser ──
 *
 * `app/(app)/channels/_lib/filter-transformer-xml.ts` exports
 * `parseFilterFromXml` / `parseTransformerFromXml` / `flattenElements`, which
 * produce exactly the index paths this module needs. Importing them here would
 * be wrong for two reasons:
 *
 *  1. Bundle. That module statically imports `./filter-transformer-steps`,
 *     whose `index.ts` imports `./javascript`, which imports `JavaScriptPanel`,
 *     which imports `@/components/monaco-editor`. Importing the parser here
 *     would pull Monaco and the whole filter/transformer editor tree into the
 *     `/search` route chunk — a page that renders no editor at all.
 *  2. Cost. Those parsers take a *string*, so reaching them from a live
 *     `Element` means XMLSerializer + a second DOMParser pass per container per
 *     channel, on the main thread, on top of the whole-channel parse below.
 *
 * The correspondence this module depends on is narrow: document order of
 * `<elements>` children equals `flattenElements` index order, and container
 * children live at `properties > children`. That is pinned by an explicit
 * cross-check test in `__tests__/unit/channel-segmenter.test.ts`, which feeds
 * the same XML to both implementations and asserts the path lists match. Tests
 * are outside the bundle, so importing the editor's parser *there* is free.
 *
 * If you are about to "simplify" this by importing the parser: don't. Verify
 * the `/search` chunk first.
 */

import type {
  FtElementRef,
  NavigationTarget,
  SearchableSegment,
  SegmentLineBasis,
} from "./search-types";

/** Connector-scoped navigation context, minus the element ref and sub-view. */
type ConnectorRef =
  | { type: "source"; channelId: string }
  | { type: "destination"; channelId: string; destIndex: number; destName: string };

/** The three filter/transformer containers a connector can carry. */
type ContainerSub = "filter" | "transformer" | "responseTransformer";

/**
 * Parse a channel XML string into searchable segments.
 * Each segment represents a distinct region (a script, one filter rule or
 * transformer step, a connector's properties) with a human-readable label and
 * navigation target.
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
      lineBasis: "synthetic",
    });
  }

  // ── Channel-level scripts ──
  const scriptMap: Array<{ tag: string; label: string; key: string }> = [
    { tag: "preprocessingScript", label: "Preprocessor Script", key: "preprocessing" },
    { tag: "postprocessingScript", label: "Postprocessor Script", key: "postprocessing" },
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
        // The Scripts tab opens this exact buffer in one Monaco instance, so a
        // line number here is that editor's line number.
        lineBasis: "editor",
      });
    }
  }

  // ── Source connector ──
  const src = doc.querySelector("channel > sourceConnector");
  if (src) {
    addConnectorSegments(segments, src, { type: "source", channelId }, "Source");
  }

  // ── Destination connectors ──
  const dests = doc.querySelectorAll("channel > destinationConnectors > connector");
  dests.forEach((dest, i) => {
    const destName =
      dest.querySelector(":scope > name")?.textContent?.trim() ?? `Destination ${i + 1}`;
    addConnectorSegments(
      segments,
      dest,
      { type: "destination", channelId, destIndex: i, destName },
      `Dest ${i + 1} '${destName}'`
    );
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
          // Verbatim script, but the target lands on the Summary tab rather than
          // opening this buffer at a line — so no line is deep-linkable.
          lineBasis: "synthetic",
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

/** Build the navigation target for a connector sub-view, optionally element-scoped. */
function connectorTarget(
  ref: ConnectorRef,
  sub: ContainerSub | "properties",
  element?: FtElementRef
): NavigationTarget {
  if (ref.type === "source") {
    // The source connector has no response transformer; fall back to the
    // transformer sub-view rather than emitting a target the editor rejects.
    const srcSub = sub === "responseTransformer" ? "transformer" : sub;
    return { type: "channel-source", channelId: ref.channelId, sub: srcSub, element };
  }
  return {
    type: "channel-destination",
    channelId: ref.channelId,
    destIndex: ref.destIndex,
    destName: ref.destName,
    sub,
    element,
  };
}

/** Extract searchable segments from a connector (source or destination). */
function addConnectorSegments(
  segments: SearchableSegment[],
  connectorEl: Element,
  ref: ConnectorRef,
  prefix: string
): void {
  const containers: Array<{ tag: ContainerSub; label: string }> = [
    { tag: "filter", label: "Filter" },
    { tag: "transformer", label: "Transformer" },
  ];
  // Response transformers exist on destination connectors only.
  if (ref.type === "destination") {
    containers.push({ tag: "responseTransformer", label: "Response Transformer" });
  }

  for (const { tag, label } of containers) {
    const containerEl = connectorEl.querySelector(`:scope > ${tag}`);
    if (!containerEl) continue;
    const elementsEl = containerEl.querySelector(":scope > elements");
    if (!elementsEl) continue;
    addElementSegments(segments, elementsEl, ref, tag, `${prefix} > ${label}`);
  }

  // Connector properties (leaf text — useful for searching URLs, paths, queries, etc.)
  const propsEl = connectorEl.querySelector(":scope > properties");
  if (propsEl) {
    const propsText = extractPropertiesText(propsEl);
    if (propsText.trim()) {
      segments.push({
        label: `${prefix} > Properties`,
        content: propsText,
        navigateTo: connectorTarget(ref, "properties"),
        lineBasis: "synthetic",
      });
    }
  }
}

/**
 * Emit one segment per filter rule / transformer step, recursing into container
 * elements (Iterator) so nested steps get their own segments and their own
 * index paths.
 *
 * The index path mirrors the editor's selection model exactly: the i-th child
 * of `<elements>` is `[i]`, and the j-th child of an Iterator at `[i]` is
 * `[i, j]`. Every child element occupies an index, including one whose tag the
 * editor does not recognize — the editor preserves those as opaque elements
 * rather than dropping them, so skipping one here would shift every
 * later sibling's path.
 */
function addElementSegments(
  segments: SearchableSegment[],
  parentEl: Element,
  ref: ConnectorRef,
  sub: ContainerSub,
  labelPrefix: string,
  parentPath: number[] = []
): void {
  const children = Array.from(parentEl.children);
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const path = [...parentPath, i];
    const name = el.querySelector(":scope > name")?.textContent?.trim() || shortTag(el.tagName);
    const label = `${labelPrefix} > [${i}] '${name}'`;

    const scriptEl = el.querySelector(":scope > script");
    let content: string;
    let lineBasis: SegmentLineBasis;
    if (scriptEl) {
      // Verbatim, untrimmed, and alone. This string is byte-identical to what
      // the editor seeds Monaco with (`childTextRaw(el, "script")` ->
      // `defaultValue={element.script}`), and that identity is the entire
      // line-number contract: match line N here is Monaco line N there.
      // Consequence, accepted: a JavaScript step's <name> is not searchable,
      // because mixing it into `content` would break that contract.
      content = scriptEl.textContent ?? "";
      lineBasis = "editor";
    } else {
      content = extractElementText(el);
      lineBasis = "synthetic";
    }

    if (content.trim()) {
      segments.push({
        label,
        content,
        navigateTo: connectorTarget(ref, sub, { path, name }),
        lineBasis,
      });
    }

    // Container elements (Iterator, and any future plugin container) nest their
    // children under `properties > children`. Detect that structurally rather
    // than by tag name so a plugin container needs no registry lookup here.
    const childrenEl = el.querySelector(":scope > properties > children");
    if (childrenEl) {
      addElementSegments(segments, childrenEl, ref, sub, label, path);
    }
  }
}

/** Last dot-separated segment of an XStream FQN tag, e.g. "MapperStep". */
function shortTag(tagName: string): string {
  const idx = tagName.lastIndexOf(".");
  return idx === -1 ? tagName : tagName.slice(idx + 1);
}

/**
 * Searchable text for a filter rule / transformer step that carries no script:
 * Mapper, Message Builder, Rule Builder, XSLT, External Script, Destination Set
 * Filter, Iterator. Before these were not indexed at all, so searching
 * for a mapped variable name or an HL7 field path silently found nothing.
 */
function extractElementText(el: Element): string {
  // Bookkeeping fields that are never worth matching on, plus `children`, whose
  // contents are emitted as their own segments by the caller.
  const SKIP = new Set(["sequenceNumber", "enabled", "children"]);
  const lines: string[] = [];
  const walk = (node: Element) => {
    for (const child of node.children) {
      if (SKIP.has(child.tagName)) continue;
      if (child.children.length === 0) {
        const text = child.textContent?.trim() ?? "";
        if (isSearchableValue(text)) lines.push(`${child.tagName}: ${text}`);
      } else {
        walk(child);
      }
    }
  };
  walk(el);
  return lines.join("\n");
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
      if (isSearchableValue(text)) {
        lines.push(`${el.tagName}: ${text}`);
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

/** Skip empty values, booleans, and pure numbers — not useful for search. */
function isSearchableValue(text: string): boolean {
  return text !== "" && text !== "true" && text !== "false" && !/^\d+$/.test(text);
}

/**
 * Indent-only, text-preserving XML pretty-printer for the Manifest Preview
 * page.
 *
 * Unlike lib/format-content's regex formatter, this is DOM-based and never
 * touches the character data of a text-bearing element: it adds indentation
 * only between element-only children. So a whitespace-significant value (a
 * single-space delimiter, a multi-line template) round-trips byte-for-byte, and
 * the printer is IDEMPOTENT — re-formatting its own output yields the same
 * string — which is what makes the "Format" button safe to press repeatedly and
 * the read-only display echo faithful to the stored bytes. Unparseable input is
 * returned unchanged.
 */

const INDENT = "  ";

// DOM nodeType constants (avoid depending on a global `Node` across test envs).
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** The opening tag (with attributes) of `el`, e.g. `<foo a="1">`. */
function openTag(el: Element): string {
  const shallow = new XMLSerializer().serializeToString(el.cloneNode(false) as Element);
  // The serializer escapes any `>` inside attribute values, so the first `>`
  // always closes the start tag. Normalize a self-closing "<foo/>" to "<foo>".
  const tag = shallow.slice(0, shallow.indexOf(">") + 1);
  return tag.replace(/\/>$/, ">");
}

/** Non-whitespace text or CDATA — content that must be preserved inline verbatim. */
function isMeaningfulContent(node: ChildNode): boolean {
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? "").trim() !== "";
  return node.nodeType === CDATA_SECTION_NODE;
}

function serializeElement(el: Element, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  const children = Array.from(el.childNodes);
  const elementChildren = children.filter((n) => n.nodeType === ELEMENT_NODE) as Element[];
  const hasMeaningfulText = children.some(isMeaningfulContent);

  // Leaf, or mixed/text content → serialize verbatim on one line (text preserved).
  if (elementChildren.length === 0 || hasMeaningfulText) {
    out.push(pad + new XMLSerializer().serializeToString(el));
    return;
  }
  // Element-only children → each on its own indented line.
  out.push(pad + openTag(el));
  for (const child of elementChildren) serializeElement(child, depth + 1, out);
  out.push(`${pad}</${el.tagName}>`);
}

export function prettyPrintXml(xml: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return xml;
  }
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length > 0) return xml;
  const out: string[] = [];
  serializeElement(doc.documentElement, 0, out);
  return out.join("\n");
}

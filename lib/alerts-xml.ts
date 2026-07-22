/**
 * Shared XStream alert-XML helpers used by the Alerts import/export dialogs.
 *
 * The server serializes alerts as XStream XML — either a single `<alertModel>` (single-alert
 * export) or a `<list><alertModel>…</alertModel>…</list>` (GET /alerts, op getAlerts, used by
 * "Export All"). These helpers split that document into individual alert elements and rewrite the
 * `<id>` / `<name>` of a single alertModel string (for import id assignment / rename).
 */

export interface ParsedAlert {
  name: string;
  id: string;
  /** The full XML for this single alertModel element. */
  xml: string;
}

/**
 * Parse an XStream alert XML document into its individual alertModel elements.
 * Handles both a single `<alertModel>` root and a `<list><alertModel>…</list>` wrapper.
 */
export function parseAlertXml(rawXml: string): ParsedAlert[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawXml, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML file: " + parseError.textContent);
  }

  const results: ParsedAlert[] = [];
  const alertElements = doc.querySelectorAll("alertModel");
  const serializer = new XMLSerializer();

  if (alertElements.length === 0) {
    // The root element may itself be the alertModel (no list/wrapper).
    const root = doc.documentElement;
    if (root.tagName === "alertModel") {
      const name = root.querySelector(":scope > name")?.textContent ?? "";
      const id = root.querySelector(":scope > id")?.textContent ?? "";
      results.push({ name, id, xml: serializer.serializeToString(root) });
    } else {
      throw new Error("No alertModel elements found in the XML file.");
    }
  } else {
    for (const el of alertElements) {
      const name = el.querySelector(":scope > name")?.textContent ?? "";
      const id = el.querySelector(":scope > id")?.textContent ?? "";
      results.push({ name, id, xml: serializer.serializeToString(el) });
    }
  }

  return results;
}

/** Replace the `<id>` element value in an alertModel XML string. */
export function replaceAlertId(xml: string, newId: string): string {
  return xml.replace(/<id>[^<]*<\/id>/, `<id>${newId}</id>`);
}

/** Replace the `<name>` element value in an alertModel XML string. */
export function replaceAlertName(xml: string, newName: string): string {
  return xml.replace(/<name>[^<]*<\/name>/, `<name>${newName}</name>`);
}

/**
 * Helpers for reading metadata out of an exported ServerConfiguration backup XML
 * (the file produced by GET /server/configuration and consumed by the restore flow).
 *
 * The backup is XStream-serialized with the root alias `<serverConfiguration>` and
 * carries a plain-string `<date>` element recording when the backup was taken
 * (com.mirth.connect.model.ServerConfiguration#date). The Java client shows this
 * date in its restore confirmation prompt ("Import configuration from <date>?",
 * SettingsPanelServer.java:599-613); we surface the same value in the web UI.
 *
 * Version migration of older backups is handled server-side during the
 * PUT /server/configuration import, so we only read the date for display here —
 * there is no client-side migration step.
 */

/**
 * Extract the backup `<date>` from an exported ServerConfiguration XML, returning
 * its verbatim text (e.g. "Mon Jun 29 13:05:22 EDT 2026"). Returns null when the
 * XML can't be parsed or has no `<date>` element, so the restore flow degrades to
 * a generic prompt rather than failing.
 */
export function parseServerConfigurationDate(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;

  const root = doc.documentElement;
  if (!root) return null;

  // Prefer a `<date>` that is a direct child of the root element (the scalar
  // backup date), not a nested one belonging to some child object.
  const directChild = Array.from(root.children).find((el) => el.tagName === "date");
  const dateEl = directChild ?? root.querySelector("date");

  const text = dateEl?.textContent?.trim();
  return text ? text : null;
}

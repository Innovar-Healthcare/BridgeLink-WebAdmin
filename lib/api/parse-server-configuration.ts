/**
 * Helpers for reading metadata out of, and stamping metadata into, an exported
 * ServerConfiguration backup XML (the file produced by GET /server/configuration
 * and consumed by the restore flow).
 *
 * The backup is XStream-serialized with the root alias `<serverConfiguration>`.
 * Two pieces of metadata matter to the client:
 *
 *   - `<date>` — a plain-string child element recording when the backup was taken
 *     (`com.mirth.connect.model.ServerConfiguration#date`). It is the first
 *     declared field, so XStream always emits it first. The **server never sets
 *     it** — `DefaultConfigurationController.getServerConfiguration()` leaves it
 *     null; Java's Swing client stamps it client-side in
 *     `SettingsPanelServer.doBackup()` (`:547,570`) just before serializing, and
 *     both clients show it in the restore prompt ("Import configuration from
 *     <date>?"). We mirror that stamp — see {@link injectServerConfigurationDate}.
 *   - `version` — a root **attribute** (not a field; `MigratableConverter.marshal`
 *     adds it), always normalized to three parts. Java's
 *     `Frame.promptObjectMigration` (`Frame.java:4965-5000`) hard-blocks a restore
 *     whose file version is newer than the connected server.
 *
 * Migration of *older* backups is handled server-side during the
 * PUT /server/configuration import, so there is no client-side migration step —
 * only the newer-version block.
 */

/** Metadata read from a backup XML in a single parse. */
export interface ServerConfigurationMeta {
  /** True when the document parsed and its root element is `<serverConfiguration>`. */
  valid: boolean;
  /**
   * The root `version` attribute, falling back to a direct-child `<version>`
   * element (the pre-3.0.0 layout), mirroring
   * `MigrationUtil.getSerializedObjectVersion`. Null when absent or blank.
   */
  version: string | null;
  /** The backup `<date>` text verbatim (e.g. "2026-08-14 14:07:33"), or null. */
  date: string | null;
}

const INVALID_META: ServerConfigurationMeta = { valid: false, version: null, date: null };

const ROOT_TAG = "serverConfiguration";

/**
 * Read the root element name, `version` and `date` from a backup XML in one DOM
 * parse. `valid` is false — with null version/date — for anything that isn't a
 * parseable `<serverConfiguration>` document, which is what the restore flow
 * rejects with Java's "Invalid server configuration file." before showing its
 * destructive confirm (`SettingsPanelServer.java:655`).
 */
export function parseServerConfigurationMeta(xml: string): ServerConfigurationMeta {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return INVALID_META;
  }
  if (doc.querySelector("parsererror")) return INVALID_META;

  const root = doc.documentElement;
  if (!root || root.tagName !== ROOT_TAG) return INVALID_META;

  const children = Array.from(root.children);

  let version = root.getAttribute("version")?.trim() || null;
  if (!version) {
    version = children.find((el) => el.tagName === "version")?.textContent?.trim() || null;
  }

  // Prefer a `<date>` that is a direct child of the root element (the scalar
  // backup date), not a nested one belonging to some child object.
  const directChild = children.find((el) => el.tagName === "date");
  const dateEl = directChild ?? root.querySelector("date");
  const date = dateEl?.textContent?.trim() || null;

  return { valid: true, version, date };
}

/**
 * Normalize a version string to exactly three dot-separated parts, right-padding
 * with "0" and truncating: "26.3" → "26.3.0", "4.5.1.2" → "4.5.1". Faithful to
 * `MigrationUtil.normalizeVersion(version, 3)`, which is the form Java displays
 * in its newer-version block message.
 *
 * Deliberately NOT the same as `normalizeXmlVersion` in
 * `app/(app)/channels/_lib/channel-xml.ts`, which truncates but does not pad —
 * correct for stamping a `version` attribute onto WebUI-created XML, wrong here.
 * Do not unify them.
 */
export function normalizeVersion3(version: string): string {
  const parts = version.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
}

/**
 * Format a local-time backup timestamp as "yyyy-MM-dd HH:mm:ss", mirroring
 * Java's `new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date())`
 * (`SettingsPanelServer.java:547`) — no timezone argument there, so it is the
 * JVM's local zone. Never derive this from `toISOString()`: an 8pm CDT backup
 * would be stamped and named with tomorrow's date.
 */
export function formatBackupTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** The exact shape {@link injectServerConfigurationDate} will splice, and nothing else. */
const BACKUP_STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Index of the `<` that opens the root element, skipping a leading XML prolog,
 * comments and a DOCTYPE. Returns -1 when the document runs out first.
 */
function findRootTagStart(xml: string): number {
  let i = 0;
  for (;;) {
    while (i < xml.length && /\s/.test(xml[i])) i++;
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i);
      if (end < 0) return -1;
      i = end + 2;
    } else if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i);
      if (end < 0) return -1;
      i = end + 3;
    } else if (xml.startsWith("<!", i)) {
      const end = xml.indexOf(">", i);
      if (end < 0) return -1;
      i = end + 1;
    } else {
      return i < xml.length ? i : -1;
    }
  }
}

/**
 * Insert `<date>{stamp}</date>` as the first child of the `<serverConfiguration>`
 * root, matching what the Java client serializes (finding 14 /.
 *
 * This is a surgical string splice rather than a DOM parse + re-serialize: the
 * backup can be tens of megabytes and is authoritative on restore, so every byte
 * outside the inserted element must survive untouched. Every failure path returns
 * the input unchanged — a malformed or unexpected root must never block a backup.
 *
 * No XML escaping is needed (or done): `stamp` is rejected unless it matches
 * {@link BACKUP_STAMP_RE}, which admits only digits, dashes, colons and a space.
 */
export function injectServerConfigurationDate(xml: string, stamp: string): string {
  if (!BACKUP_STAMP_RE.test(stamp)) return xml;

  const start = findRootTagStart(xml);
  if (start < 0 || !xml.startsWith(`<${ROOT_TAG}`, start)) return xml;

  // Reject a longer tag that merely shares the prefix (`<serverConfigurationFoo>`).
  let i = start + ROOT_TAG.length + 1;
  if (i < xml.length && !/[\s/>]/.test(xml[i])) return xml;

  // Scan to the `>` closing the root open tag, honoring quoted attribute values
  // (an attribute value may legally contain `>`).
  let quote = "";
  for (; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      break;
    }
  }
  if (i >= xml.length) return xml;

  const dateEl = `<date>${stamp}</date>`;

  // Self-closing root (an empty configuration): expand it around the new child.
  if (xml[i - 1] === "/") {
    return `${xml.slice(0, i - 1)}>${dateEl}</${ROOT_TAG}>${xml.slice(i + 1)}`;
  }

  // Already stamped? XStream emits `date` first, so it can only be right here.
  let j = i + 1;
  while (j < xml.length && /\s/.test(xml[j])) j++;
  if (/^<date[\s/>]/.test(xml.slice(j, j + 6))) return xml;

  return `${xml.slice(0, i + 1)}${dateEl}${xml.slice(i + 1)}`;
}

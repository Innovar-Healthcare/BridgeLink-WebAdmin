/**
 * XML parser for the server settings returned by GET /server/settings.
 *
 * ServerSettings is fetched as XML (not JSON) on purpose: several of its fields are Java
 * Strings that legitimately hold numeric-looking values — smtpPort ("025"), smtpPassword
 * ("0123"), serverName ("10e33") — and the server's XStream-XML → Staxon autoPrimitive → JSON
 * pipeline rewrites any such value to a bare JSON number, losing leading zeros and precision
 * ("10e33" → 1.0E+34). The request()-level safeText salvage only re-quotes "string"/"name"
 * fields, never ServerSettings' own fields, so JSON cannot recover the literal. XML carries
 * the text content intact. Same class already fixed for channel tags and
 * the configuration map; here for ServerSettings under (finding 13).
 *
 * XML shape (com.mirth.connect.model.ServerSettings, alias "serverSettings"):
 *   <serverSettings>
 *     <environmentName>QA1</environmentName>
 *     <serverName>DemoServer</serverName>
 *     <clearGlobalMap>true</clearGlobalMap>
 *     <queueBufferSize>1000</queueBufferSize>
 *     <defaultMetaDataColumns>
 *       <metaDataColumn><name>SOURCE</name><type>STRING</type><mappingName>message_source</mappingName></metaDataColumn>
 *     </defaultMetaDataColumns>
 *     <defaultAdministratorBackgroundColor><red>244</red><green>244</green><blue>246</blue><alpha>255</alpha></defaultAdministratorBackgroundColor>
 *     <smtpHost>...</smtpHost> <smtpPort>587</smtpPort> <smtpTimeout>5000</smtpTimeout>
 *     <smtpSecure>tls</smtpSecure> ... <loginNotificationMessage>...</loginNotificationMessage>
 *   </serverSettings>
 *
 * An empty metadata list serializes as <defaultMetaDataColumns/> and yields [].
 *
 * Unenumerated fields (e.g. keystoreUsingDefaultPassword, or fields added by a future server)
 * are intentionally dropped from the parsed object — and therefore from the next PUT body. This
 * is SAFE, not lossy: the server's save path upserts only the keys present in the submitted
 * settings' getProperties() (DefaultConfigurationController.setServerSettings iterates
 * properties.keySet(); ServerSettings.getProperties() omits null fields), so an absent field is
 * preserved server-side — the same omission-means-preserve semantics the smtpPassword OAUTH fix
 * relies on finding 11). When adding a new Server-tab field, add it here too.
 */

import type { MetaDataColumn, ServerSettings } from "../types";

/** Text content of the first direct child element `<tag>`, or undefined when absent. */
function childText(parent: Element, tag: string): string | undefined {
  const el = parent.querySelector(`:scope > ${tag}`);
  // textContent is "" for <tag></tag>; only undefined when the element is absent.
  return el ? (el.textContent ?? "") : undefined;
}

/** Parse a `<tag>true|false</tag>` child to boolean, or undefined when absent. */
function childBool(parent: Element, tag: string): boolean | undefined {
  const t = childText(parent, tag);
  return t === undefined ? undefined : t === "true";
}

/** Parse a numeric `<tag>` child to number, or undefined when absent/blank/non-numeric. */
function childInt(parent: Element, tag: string): number | undefined {
  const t = childText(parent, tag);
  if (t === undefined || t.trim() === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse the `<serverSettings>` document returned by GET /server/settings into a ServerSettings.
 * String fields are read verbatim (never trimmed) so numeric-looking literals round-trip exactly.
 */
export function parseServerSettingsFromXml(xml: string): ServerSettings {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== "serverSettings") {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <serverSettings>.`);
  }

  const s: ServerSettings = {};

  // ── Plain string fields — read verbatim, do NOT trim (preserve numeric-looking literals). ──
  const stringFields: (keyof ServerSettings)[] = [
    "environmentName",
    "serverName",
    "smtpHost",
    "smtpPort",
    "smtpFrom",
    "smtpUsername",
    "smtpPassword",
    "smtpOAuthClientId",
    "smtpOAuthClientSecret",
    "smtpOAuthTokenEndpointUrl",
    "smtpOAuthScope",
    "loginNotificationMessage",
  ];
  for (const field of stringFields) {
    const v = childText(root, field);
    if (v !== undefined) (s as Record<string, unknown>)[field] = v;
  }

  // smtpAuthType is a constrained enum string — read verbatim if present.
  const authType = childText(root, "smtpAuthType");
  if (authType !== undefined) s.smtpAuthType = authType as ServerSettings["smtpAuthType"];

  // smtpTimeout is a Java String; keep the literal (display stringifies, save re-coerces).
  const smtpTimeout = childText(root, "smtpTimeout");
  if (smtpTimeout !== undefined) s.smtpTimeout = smtpTimeout;

  // smtpSecure is a Java String ("none"/"tls"/"ssl"). A digits-only value ("0"/"1"/"2") is the
  // legacy corruption the old WebUI wrote (finding 2) — surface it as a number so the load-side
  // heal in server-tab.tsx maps it back to a string and self-corrects on next save. Trimmed
  // (unlike the literal-preserving string fields above): it's an enum-ish value compared against
  // the RadioField options, so stray whitespace would silently mis-select the "None" radio.
  const smtpSecure = childText(root, "smtpSecure")?.trim();
  if (smtpSecure !== undefined) {
    s.smtpSecure = /^\d+$/.test(smtpSecure)
      ? Number(smtpSecure)
      : (smtpSecure as ServerSettings["smtpSecure"]);
  }

  // ── Boolean fields. ──
  const clearGlobalMap = childBool(root, "clearGlobalMap");
  if (clearGlobalMap !== undefined) s.clearGlobalMap = clearGlobalMap;
  const smtpAuth = childBool(root, "smtpAuth");
  if (smtpAuth !== undefined) s.smtpAuth = smtpAuth;
  const loginNotificationEnabled = childBool(root, "loginNotificationEnabled");
  if (loginNotificationEnabled !== undefined) s.loginNotificationEnabled = loginNotificationEnabled;
  const autoLogoutEnabled = childBool(root, "administratorAutoLogoutIntervalEnabled");
  if (autoLogoutEnabled !== undefined) s.administratorAutoLogoutIntervalEnabled = autoLogoutEnabled;

  // ── Integer fields. ──
  const queueBufferSize = childInt(root, "queueBufferSize");
  if (queueBufferSize !== undefined) s.queueBufferSize = queueBufferSize;
  const autoLogoutField = childInt(root, "administratorAutoLogoutIntervalField");
  if (autoLogoutField !== undefined) s.administratorAutoLogoutIntervalField = autoLogoutField;

  // ── java.awt.Color → {red,green,blue,alpha}. ──
  const colorEl = root.querySelector(":scope > defaultAdministratorBackgroundColor");
  if (colorEl) {
    s.defaultAdministratorBackgroundColor = {
      red: childInt(colorEl, "red") ?? 0,
      green: childInt(colorEl, "green") ?? 0,
      blue: childInt(colorEl, "blue") ?? 0,
      alpha: childInt(colorEl, "alpha") ?? 255,
    };
  }

  // ── List<MetaDataColumn> → {name,type,mappingName}[]. ──
  const listEl = root.querySelector(":scope > defaultMetaDataColumns");
  if (listEl) {
    const cols: MetaDataColumn[] = [];
    listEl.querySelectorAll(":scope > metaDataColumn").forEach((colEl) => {
      const name = childText(colEl, "name") ?? "";
      const type = childText(colEl, "type") ?? "";
      const mappingName = childText(colEl, "mappingName");
      cols.push(mappingName !== undefined ? { name, type, mappingName } : { name, type });
    });
    s.defaultMetaDataColumns = cols;
  }

  return s;
}

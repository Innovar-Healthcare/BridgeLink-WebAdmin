/**
 * API settings — server settings, configuration map, server config,
 * user preferences, database tasks, resources.
 */

import type {
  DatabaseTask,
  MetaDataColumn,
  PublicServerSettings,
  ResourceProperties,
  ServerSettings,
  SystemInfo,
  UpdateSettings,
} from "../types";
import { PROXY_BASE, getServerUrl, request, throwForStatus } from "./api-core";
import { parseConfigurationMapFromXml } from "./parse-configuration-map-xml";
import { parseServerSettingsFromXml } from "./parse-server-settings-xml";

// ─── Server Info (About dialog) ──────────────────────────────────────────────

/**
 * GET /server/buildDate
 * Mirrors Java's mirthClient.getBuildDate() called from Frame.java during init.
 * Returns the server build date as plain text (e.g. "January 5, 2026").
 */
export async function getServerBuildDate(): Promise<string> {
  const text = await request<string>("/server/buildDate", {
    rawText: true,
    headers: { Accept: "text/plain" },
  });
  return text.trim();
}

/**
 * GET /server/id
 * Mirrors Java's mirthClient.getServerId() called from Frame.java during init.
 * Returns the server UUID as plain text.
 */
export async function getServerId(): Promise<string> {
  const text = await request<string>("/server/id", {
    rawText: true,
    headers: { Accept: "text/plain" },
  });
  return text.trim();
}

/**
 * GET /server/jvm
 * Returns the JVM name/version running the BridgeLink server as plain text.
 * The Java client uses client-side System.getProperty("java.version") instead,
 * but the web UI displays the server's JVM info since there is no local JVM.
 */
export async function getServerJvm(): Promise<string> {
  const text = await request<string>("/server/jvm", {
    rawText: true,
    headers: { Accept: "text/plain" },
  });
  return text.trim();
}

/**
 * GET /system/info
 * Returns system info including the server JVM version, OS details, and database info.
 * Response is XStream-wrapped: {"com.mirth.connect.model.SystemInfo": {...}}
 * normalizeXStream unwraps the FQN key automatically.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return request<SystemInfo>("/system/info");
}

// ─── Server Settings ─────────────────────────────────────────────────────────

/**
 * GET /server/settings  (Accept: application/xml)
 * Mirrors Java's mirthClient.getServerSettings() called from SettingsPanelServer.doRefresh().
 *
 * Fetched as XML, not JSON: several ServerSettings fields are Java Strings that can hold
 * numeric-looking values (smtpPort "025", smtpPassword "0123", serverName "10e33"), and the
 * server's Staxon autoPrimitive pipeline rewrites those to bare JSON numbers, losing the literal
 * (the class already fixed for tags/config-map). XML carries them intact — see
 * parse-server-settings-xml.ts. finding 13)
 */
export async function getServerSettings(): Promise<ServerSettings> {
  const xml = await request<string>("/server/settings", {
    headers: { Accept: "application/xml" },
    rawText: true,
  });
  return parseServerSettingsFromXml(xml);
}

/**
 * GET /server/charsets
 * Mirrors Java's mirthClient.getAvailableCharsetEncodings() — the full set of
 * charset encodings supported by the server JVM, used to populate connector
 * "Encoding" dropdowns. XStream serializes the result as {"list":{"string":[...]}},
 * which normalizeXStream unwraps to a plain string[].
 */
export async function getAvailableCharsetEncodings(): Promise<string[]> {
  const result = (await request<unknown>("/server/charsets")) as unknown;
  if (Array.isArray(result)) return result.filter((c): c is string => typeof c === "string");
  if (typeof result === "string") return [result];
  return [];
}

/**
 * GET /server/publicSettings
 * Mirrors Java's mirthClient.getPublicServerSettings() called from
 * LoginPanel.handleSuccess(). Unlike GET /server/settings, this endpoint is
 * readable by ANY authenticated user (auditable=false), so it can be called
 * during login before we know the user's permissions. Used to decide whether to
 * show the login-notification consent screen.
 */
export async function getPublicServerSettings(): Promise<PublicServerSettings> {
  return request<PublicServerSettings>("/server/publicSettings");
}

/**
 * Server response to POST /server/keystore/regenerate.
 * Mirrors com.mirth.connect.util.KeystoreRegenerationResponse.
 * - REGENERATED    — passwords were on defaults and have been rotated.
 * - ALREADY_SECURE — passwords were already non-default; nothing changed.
 */
export interface KeystoreRegenerationResponse {
  type: "REGENERATED" | "ALREADY_SECURE";
  message: string;
}

/**
 * POST /server/keystore/regenerate
 * Mirrors Java's mirthClient.regenerateKeystore() called from
 * LoginPanel.triggerKeystoreRegeneration(). Takes no body; regenerates the
 * server keystore passwords when they are still set to their defaults and
 * returns a human-readable result message (BridgeLink must be restarted for the
 * new SSL certificate to take effect). Requires the SERVER_SETTINGS_EDIT
 * permission — a caller without it gets a 403 surfaced as an ApiError.
 */
export async function regenerateKeystore(): Promise<KeystoreRegenerationResponse> {
  return request<KeystoreRegenerationResponse>("/server/keystore/regenerate", { method: "POST" });
}

/** Fixed dashboard metadata column order — SOURCE, then TYPE, then VERSION. */
const META_COLUMN_ORDER: Record<string, number> = { SOURCE: 0, TYPE: 1, VERSION: 2 };

/**
 * SMTP credential fields to write into the PUT /server/settings body, blanked
 * per the selected auth type. `smtpOAuthClientSecret` is intentionally optional:
 * when absent, the caller omits the key entirely so the server keeps its stored
 * secret (see normalizeSmtpAuthForSave).
 */
interface SmtpAuthSaveFields {
  smtpAuth: boolean;
  smtpUsername: string;
  /**
   * Optional: OMITTED entirely by the OAUTH branch so the server preserves its
   * stored basic password (Java's OAUTH branch never calls setSmtpPassword —
   * null means "preserve"). BASIC/NONE always include it.
   */
  smtpPassword?: string;
  smtpOAuthClientId: string;
  smtpOAuthTokenEndpointUrl: string;
  smtpOAuthScope: string;
  smtpOAuthClientSecret?: string;
}

/**
 * Blank the SMTP credential fields that don't apply to the selected auth type so
 * switching auth types never persists stale credentials. Mirrors
 * SettingsPanelServer.java:473-502, which builds a fresh ServerSettings and only
 * sets the fields relevant to the chosen radio:
 *   - NONE  → smtpAuth=false; username, password and all OAuth fields blanked.
 *   - BASIC → smtpAuth=true; username + password kept; all OAuth fields blanked.
 *   - OAUTH → smtpAuth=true; username + OAuth client id/token-url/scope kept;
 *             the password key is OMITTED so the server preserves its stored
 *             basic password (Java leaves smtpPassword unset on the fresh object,
 *             and getProperties() omits null fields = "preserve", not "clear");
 *             the client secret is likewise OMITTED when empty so the server keeps
 *             its stored value (Java:473-483), otherwise sent.
 *
 * When smtpAuthType is absent (older servers) it is derived from the legacy
 * smtpAuth boolean, matching the load-time normalization in server-tab.tsx.
 */
export function normalizeSmtpAuthForSave(settings: ServerSettings): SmtpAuthSaveFields {
  const authType = settings.smtpAuthType ?? (settings.smtpAuth ? "BASIC" : "NONE");

  if (authType === "BASIC") {
    return {
      smtpAuth: true,
      smtpUsername: settings.smtpUsername ?? "",
      smtpPassword: settings.smtpPassword ?? "",
      smtpOAuthClientId: "",
      smtpOAuthClientSecret: "",
      smtpOAuthTokenEndpointUrl: "",
      smtpOAuthScope: "",
    };
  }

  if (authType === "OAUTH") {
    const secret = settings.smtpOAuthClientSecret ?? "";
    return {
      smtpAuth: true,
      smtpUsername: settings.smtpUsername ?? "",
      // smtpPassword is intentionally omitted (not "") so the PUT body drops the
      // key and the server preserves its stored basic password — Java's OAUTH
      // branch never calls setSmtpPassword, and null fields are omitted from the
      // saved Properties finding 11: BASIC→OAUTH→BASIC must keep it).
      smtpOAuthClientId: settings.smtpOAuthClientId ?? "",
      smtpOAuthTokenEndpointUrl: settings.smtpOAuthTokenEndpointUrl ?? "",
      smtpOAuthScope: settings.smtpOAuthScope ?? "",
      // Omit an empty secret so the server preserves its stored value.
      ...(secret !== "" ? { smtpOAuthClientSecret: secret } : {}),
    };
  }

  // NONE
  return {
    smtpAuth: false,
    smtpUsername: "",
    smtpPassword: "",
    smtpOAuthClientId: "",
    smtpOAuthClientSecret: "",
    smtpOAuthTokenEndpointUrl: "",
    smtpOAuthScope: "",
  };
}

/**
 * Serialize defaultMetaDataColumns into the XStream JSON the server expects for
 * List<MetaDataColumn> — {"metaDataColumn": col | [cols]} (no "list" wrapper).
 * Columns are emitted in the fixed SOURCE → TYPE → VERSION order regardless of
 * the order the user toggled them (mirrors SettingsPanelServer.java:434-458).
 * An empty selection serializes to an empty list so unchecking every column
 * sticks — sending null makes the server fall back to its SOURCE+TYPE default.
 */
export function serializeMetaDataColumns(cols: MetaDataColumn[]): {
  metaDataColumn: MetaDataColumn | MetaDataColumn[];
} {
  const sorted = [...cols].sort(
    (a, b) => (META_COLUMN_ORDER[a.name] ?? 99) - (META_COLUMN_ORDER[b.name] ?? 99)
  );
  if (sorted.length === 1) return { metaDataColumn: sorted[0] };
  return { metaDataColumn: sorted };
}

/**
 * PUT /server/settings
 * Mirrors Java's mirthClient.setServerSettings(serverSettings).
 *
 * The server deserializes via XStream (JSON → XML → Java), so the body must:
 *   - Be wrapped in {"serverSettings": {...}} (class alias wrapper)
 *   - Use {red,green,blue,alpha} for java.awt.Color (not {r,g,b})
 *   - Use {"metaDataColumn": col | [cols]} for List<MetaDataColumn> (no "list" wrapper)
 *   - Send smtpSecure as the string "none"/"tls"/"ssl" — it is a Java String
 *     persisted verbatim and consumed via equalsIgnoreCase(secure, "TLS"/"SSL")
 *     (ServerSMTPConnection.java). Sending 0/1/2 silently disables STARTTLS/SSL
 *     for all server email finding 2).
 *   - Send smtpTimeout as the field text verbatim (String, "" when cleared), mirroring
 *     Java's getText() — not Number("") === 0 L3).
 *   - Blank SMTP credentials that don't apply to the selected auth type
 */
export async function setServerSettings(settings: ServerSettings): Promise<void> {
  // Reverse of the load-side heal map: a stray numeric that slipped past load
  // normalization is coerced back to the string form the server expects.
  const intToSecure: Record<number, "none" | "tls" | "ssl"> = { 0: "none", 1: "tls", 2: "ssl" };

  // Re-serialize color as XStream java.awt.Color {red,green,blue,alpha}
  let bgColor: { red: number; green: number; blue: number; alpha: number } | null = null;
  const c = settings.defaultAdministratorBackgroundColor;
  if (c) {
    const r = (c as { red?: number; r?: number }).red ?? (c as { r?: number }).r;
    const g = (c as { green?: number; g?: number }).green ?? (c as { g?: number }).g;
    const b = (c as { blue?: number; b?: number }).blue ?? (c as { b?: number }).b;
    const alpha = (c as { alpha?: number }).alpha ?? 255;
    if (r !== undefined && g !== undefined && b !== undefined) {
      bgColor = { red: r, green: g, blue: b, alpha };
    } else if ((c as { value?: number }).value !== undefined) {
      const v = (c as { value: number }).value;
      bgColor = {
        red: (v >> 16) & 0xff,
        green: (v >> 8) & 0xff,
        blue: v & 0xff,
        alpha: (v >> 24) & 0xff || 255,
      };
    }
  }

  // Re-serialize defaultMetaDataColumns in fixed SOURCE → TYPE → VERSION order;
  // an empty selection serializes to an empty list (not null) so it sticks.
  const metaDataColumns = serializeMetaDataColumns(settings.defaultMetaDataColumns ?? []);

  const smtpSecureVal = settings.smtpSecure;
  const smtpSecure =
    typeof smtpSecureVal === "number"
      ? (intToSecure[smtpSecureVal] ?? "none")
      : (smtpSecureVal ?? "none"); // default to the "None" radio, as Java always sends a value

  // Timeout: ServerSettings.smtpTimeout is a Java String, saved from the field's getText()
  // verbatim. Send the string as-is so an empty field stays "" (not Number("") === 0,
  // L3) and non-numeric input never becomes NaN → JSON null. undefined omits the key (preserve).
  const smtpTimeout = settings.smtpTimeout === undefined ? undefined : String(settings.smtpTimeout);

  // Blank the SMTP credential fields that don't apply to the selected auth type
  // (smtpAuth is derived here too, covering older servers without smtpAuthType).
  const smtp = normalizeSmtpAuthForSave(settings);

  const serverSettings = {
    ...settings,
    defaultAdministratorBackgroundColor: bgColor,
    defaultMetaDataColumns: metaDataColumns,
    smtpSecure,
    smtpTimeout,
    ...smtp,
  };

  // Omit an empty OAuth client secret entirely so the server keeps its stored
  // value (Java:473-483). The helper signals this by not returning the key;
  // remove the value the `...settings` spread copied in.
  if (!("smtpOAuthClientSecret" in smtp)) {
    delete (serverSettings as { smtpOAuthClientSecret?: string }).smtpOAuthClientSecret;
  }

  // Likewise omit smtpPassword entirely on OAUTH save so the server preserves its
  // stored basic password finding 11). normalizeSmtpAuthForSave signals
  // this by not returning the key; drop the value the `...settings` spread copied in.
  if (!("smtpPassword" in smtp)) {
    delete (serverSettings as { smtpPassword?: string }).smtpPassword;
  }

  await request<void>("/server/settings", {
    method: "PUT",
    body: JSON.stringify({ serverSettings }),
  });
}

/**
 * GET /server/updateSettings
 * Mirrors Java's mirthClient.getUpdateSettings() called from SettingsPanelServer.doRefresh()
 * (:116). The op is auditable=false. The fork hides the update/stats radios, so the result has
 * no UI consumer — it exists to mirror Java's refresh sequence and to read the current
 * statsEnabled flag if a caller ever needs it.
 */
export async function getUpdateSettings(): Promise<UpdateSettings> {
  return request<UpdateSettings>("/server/updateSettings");
}

/**
 * PUT /server/updateSettings
 * Mirrors Java's mirthClient.setUpdateSettings(updateSettings), issued on every Server-tab save
 * (SettingsPanelServer.doSave:232) with statsEnabled=false (:526-532). Forcing stats off heals a
 * server migrated from Mirth with stats.enabled=1 finding 12).
 *
 * The server deserializes via XStream; the body is wrapped in the {"updateSettings": {...}} class
 * alias (@XStreamAlias("updateSettings")). lastStatsTime is omitted (null → server preserves).
 */
export async function setUpdateSettings(settings: UpdateSettings): Promise<void> {
  await request<void>("/server/updateSettings", {
    method: "PUT",
    body: JSON.stringify({ updateSettings: { statsEnabled: settings.statsEnabled } }),
  });
}

/**
 * PUT /server/channelTags — saves updated tags set.
 * Mirrors Java's mirthClient.setChannelTags(tags).
 *
 * The server deserializes via XStream (JSON → XML → Java), so the body must be
 * in XStream's Set<ChannelTag> JSON format, NOT a plain array.
 *
 * XStream format for a single tag:
 *   {"set": {"channelTag": {
 *       "id": "...", "name": "...",
 *       "channelIds": {"string": ["id1","id2"]},
 *       "backgroundColor": {"red": 255, "green": 0, "blue": 0, "alpha": 255}
 *   }}}
 *
 * For multiple tags, "channelTag" becomes an array.
 * channelIds: Set<String> → {"string": [...]} or {"string": "single"}.
 * backgroundColor: java.awt.Color → {"red": R, "green": G, "blue": B, "alpha": 255}.
 */
export async function setChannelTags(tags: import("../types").ChannelTag[]): Promise<void> {
  // Re-wrap each tag into XStream-compatible JSON format
  const xstreamTags = tags.map((tag) => {
    // channelIds: Set<String> → {"string": [...]} or {"string": "single"} or null
    let channelIds: { string: string | string[] } | null = null;
    if (tag.channelIds.length === 1) {
      channelIds = { string: tag.channelIds[0] };
    } else if (tag.channelIds.length > 1) {
      channelIds = { string: tag.channelIds };
    }

    // backgroundColor: java.awt.Color → {"red": R, "green": G, "blue": B, "alpha": A}.
    // Honor the color's real alpha rather than forcing 255 L17): a color parsed
    // from stored XML (channel-editor tag-save path) may carry alpha≠255, and Java re-submits
    // it intact. The plain {r,g,b} form has no alpha channel, so default to 255 there.
    let backgroundColor: { red: number; green: number; blue: number; alpha: number } | null = null;
    if (tag.backgroundColor && typeof tag.backgroundColor === "object") {
      const c = tag.backgroundColor as {
        r?: number;
        g?: number;
        b?: number;
        red?: number;
        green?: number;
        blue?: number;
        alpha?: number;
        value?: number;
      };
      const r = c.r ?? c.red;
      const g = c.g ?? c.green;
      const b = c.b ?? c.blue;
      if (r !== undefined && g !== undefined && b !== undefined) {
        backgroundColor = { red: r, green: g, blue: b, alpha: c.alpha ?? 255 };
      } else if (c.value !== undefined) {
        // Unpack ARGB int
        const v = c.value;
        backgroundColor = {
          red: (v >> 16) & 0xff,
          green: (v >> 8) & 0xff,
          blue: v & 0xff,
          alpha: (v >> 24) & 0xff || 255,
        };
      }
    }

    // Omit the key entirely when no color could be resolved L19). Emitting
    // `backgroundColor: null` makes Staxon produce an empty `<backgroundColor/>` element that
    // XStream's ColorConverter NPEs on (HTTP 500) — reachable via the channel-editor tag-save
    // path for a tag whose XML lacked a color. This mirrors XStream omitting a null field.
    return {
      id: tag.id,
      name: tag.name,
      channelIds,
      ...(backgroundColor !== null ? { backgroundColor } : {}),
    };
  });

  // Wrap in XStream's Set envelope: {"set": {"channelTag": ...}}
  // XStream collapses single-element collections to a plain object (not array).
  let body: string;
  if (xstreamTags.length === 0) {
    body = JSON.stringify({ set: null });
  } else if (xstreamTags.length === 1) {
    body = JSON.stringify({ set: { channelTag: xstreamTags[0] } });
  } else {
    body = JSON.stringify({ set: { channelTag: xstreamTags } });
  }

  await request<void>("/server/channelTags", {
    method: "PUT",
    body,
  });
}

// ─── Configuration Map ───────────────────────────────────────────────────────

export interface ConfigurationMapEntry {
  key: string;
  value: string;
  comment: string;
}

/**
 * GET /server/configurationMap  (Accept: application/xml)
 *
 * Fetched as XML, not JSON: the server's XStream-XML → Staxon autoPrimitive → JSON
 * pipeline rewrites any numeric-looking value (e.g. "10e33" → 1.0E+34, "1.20" → 1.2)
 * to a bare JSON number, and JSON.parse loses precision on long digit strings — the
 * same gotcha already fixed for channel tags. The request()-level safeText
 * salvage only re-quotes "string"/"name" fields, never the "value" nested inside
 * ConfigurationProperty, so JSON cannot recover the literal. XML carries it intact.
 * See parse-configuration-map-xml.ts.
 */
export async function getConfigurationMap(): Promise<ConfigurationMapEntry[]> {
  const xml = await request<string>("/server/configurationMap", {
    headers: { Accept: "application/xml" },
    rawText: true,
  });
  if (!xml) return [];
  return parseConfigurationMapFromXml(xml);
}

/**
 * PUT /server/configurationMap
 *
 * Saved as JSON (unlike the XML load above): JSON.stringify always quotes string values,
 * so the server's inbound JSON → XML (Staxon) parse emits <value>10e33</value> verbatim —
 * a quoted JSON string is never auto-primitivized on the way in, at any nesting depth.
 * This mirrors setChannelTags, which saves JSON and is at parity for.
 *
 * XStream expects:
 *   {"map":{"entry":[{"string":"key","com.mirth.connect.util.ConfigurationProperty":{"value":"v","comment":"c"}},...]}}
 * Single entry collapses to plain object (not array); empty map is {"map":null}.
 */
export async function setConfigurationMap(entries: ConfigurationMapEntry[]): Promise<void> {
  const xstreamEntries = entries.map((e) => ({
    string: e.key,
    "com.mirth.connect.util.ConfigurationProperty": {
      value: e.value,
      comment: e.comment,
    },
  }));

  let body: string;
  if (xstreamEntries.length === 0) {
    body = JSON.stringify({ map: null });
  } else if (xstreamEntries.length === 1) {
    body = JSON.stringify({ map: { entry: xstreamEntries[0] } });
  } else {
    body = JSON.stringify({ map: { entry: xstreamEntries } });
  }

  await request<void>("/server/configurationMap", {
    method: "PUT",
    body,
  });
}

// ─── Server Configuration (Backup / Restore) ────────────────────────────────

/**
 * GET /server/configuration  (Accept: application/xml)
 * Mirrors Java's mirthClient.getServerConfiguration() called from SettingsPanelServer.doBackup().
 * Returns the full ServerConfiguration as raw XML text for file export.
 */
export async function getServerConfigurationXml(): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/server/configuration`, {
    headers: {
      Accept: "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return res.text();
}

/**
 * PUT /server/configuration?deploy={bool}&overwriteConfigMap={bool}
 * Mirrors Java's mirthClient.setServerConfiguration(config, deploy, overwriteConfigMap)
 * called from SettingsPanelServer.doRestore().
 *
 * Accepts raw XML body (the previously-exported ServerConfiguration).
 * This is an async server operation (ExecuteType.ASYNC) — the response returns
 * immediately while the server processes in the background.
 */
export async function restoreServerConfiguration(
  xml: string,
  deploy: boolean,
  overwriteConfigMap: boolean
): Promise<void> {
  const serverUrl = getServerUrl();
  const params = new URLSearchParams({
    deploy: String(deploy),
    overwriteConfigMap: String(overwriteConfigMap),
  });
  const res = await fetch(`${PROXY_BASE}/server/configuration?${params}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/xml",
      // Must send Accept: application/xml, matching the backup GET above and the
      // Fleet golden-config push. A browser fetch otherwise sends Accept: */*,
      // which the proxy forwards verbatim; the server then rejects the request
      // with a markup error body that surfaces as the generic "unexpected
      // response" message. restore regression.)
      Accept: "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: xml,
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
}

// ─── Global Scripts ───────────────────────────────────────────────────────────

/**
 * The four script keys supported by BridgeLink global scripts, in display order.
 * Stored in the database under groupId = "Global".
 */
export const GLOBAL_SCRIPT_KEYS = ["Deploy", "Undeploy", "Preprocessor", "Postprocessor"] as const;
export type GlobalScriptKey = (typeof GLOBAL_SCRIPT_KEYS)[number];

/**
 * Default global script templates, byte-exact from Java `JavaScriptConstants.DEFAULT_GLOBAL_*`.
 * Used to decide whether a global script differs from its default (the bold sub-tab cue),
 * mirroring the channel-script `DEFAULT_SCRIPTS` non-default comparison.
 */
export const DEFAULT_GLOBAL_SCRIPTS: Readonly<Record<GlobalScriptKey, string>> = {
  Deploy:
    "// This script executes once for each deploy or redeploy task\n// You only have access to the globalMap here to persist data\nreturn;",
  Undeploy:
    "// This script executes once for each deploy, undeploy, or redeploy task\n// if at least one channel was undeployed\n// You only have access to the globalMap here to persist data\nreturn;",
  Preprocessor:
    "// Modify the message variable below to pre process data\n// This script applies across all channels\nreturn message;",
  Postprocessor:
    '// This script executes once after a message has been processed\n// This script applies across all channels\n// Responses returned from here will be stored as "Postprocessor" in the response map\n// You have access to "response", if returned from the channel postprocessor\nreturn;',
};

/**
 * GET /server/globalScripts
 * Mirrors Java's mirthClient.getGlobalScripts() called from GlobalScriptsPanel.
 *
 * Raw XStream JSON (Map<String, String> as linked-hash-map):
 *   {"@class":"linked-hash-map","entry":[{"string":["Deploy","// script..."]}, ...]}
 *
 * normalizeXStream converts Map<String,String> entries ({"string":["key","val"]}) into
 * a plain JS object: {"Deploy":"...","Undeploy":"...","Preprocessor":"...","Postprocessor":"..."}
 */
export async function getGlobalScripts(): Promise<Record<GlobalScriptKey, string>> {
  const raw = await request<Record<string, unknown>>("/server/globalScripts");
  // Ensure all four keys are always present (server may omit blank scripts)
  const result = {} as Record<GlobalScriptKey, string>;
  for (const key of GLOBAL_SCRIPT_KEYS) {
    result[key] = typeof raw?.[key] === "string" ? (raw[key] as string) : "";
  }
  return result;
}

/**
 * PUT /server/globalScripts
 * Mirrors Java's mirthClient.setGlobalScripts(scripts) which triggers compilation.
 *
 * The server deserializes via XStream (JSON → XML → Java), expecting Map<String, String>
 * in the XStream linked-hash-map format.  Each entry uses {"string": ["key", "value"]}
 * because both key and value are the same Java type (String), which Staxon converts to
 * two sibling <string> elements inside <entry>.
 *
 * Body format:
 *   {"map": {"entry": [{"string": ["Deploy","// script"]}, ...]}}
 * Single-entry degenerate: {"map": {"entry": {"string": ["key","val"]}}}
 */
export async function setGlobalScripts(scripts: Record<GlobalScriptKey, string>): Promise<void> {
  const entries = GLOBAL_SCRIPT_KEYS.map((key) => ({ string: [key, scripts[key]] }));
  const body =
    entries.length === 1
      ? JSON.stringify({ map: { entry: entries[0] } })
      : JSON.stringify({ map: { entry: entries } });

  await request<void>("/server/globalScripts", {
    method: "PUT",
    body,
  });
}

// ─── Test Email ──────────────────────────────────────────────────────────────

/**
 * Properties sent to POST /server/_testEmail.
 * Mirrors the exact keys from SettingsPanelServer.java testEmailButtonActionPerformed().
 */
export interface TestEmailProperties {
  port: string;
  encryption: string;
  host: string;
  timeout: string;
  /** Legacy boolean string ("true"/"false") — kept for back-compat with older servers */
  authentication: string;
  /** "none" | "basic" | "oauth" — lowercase enum value */
  authType: string;
  username: string;
  password: string;
  oAuthClientId: string;
  oAuthClientSecret: string;
  oAuthTokenEndpointUrl: string;
  oAuthScope: string;
  toAddress: string;
  fromAddress: string;
}

/**
 * POST /server/_testEmail
 * Mirrors Java's mirthClient.sendTestEmail(properties) from SettingsPanelServer.
 *
 * The server deserializes via ObjectJSONSerializer (JSON → XML → XStream).
 * BridgeLink's custom PropertiesConverter (donkey/util/xstream/PropertiesConverter.java)
 * serializes java.util.Properties as:
 *   XML:  <properties><property name="k">v</property>…</properties>
 *   JSON: {"properties":{"property":[{"@name":"k","$":"v"},…]}}
 *
 * Staxon represents XML attributes as "@attrName" and text content as "$".
 * Single property collapses to a plain object (not array) — same Staxon rule.
 */
export async function sendTestEmail(
  properties: TestEmailProperties
): Promise<{ type: string; message: string }> {
  const props = Object.entries(properties).map(([k, v]) => ({ "@name": k, $: v }));
  const property = props.length === 1 ? props[0] : props;
  const body = JSON.stringify({ properties: { property } });

  return request<{ type: string; message: string }>("/server/_testEmail", {
    method: "POST",
    body,
  });
}

// ─── User Preferences ────────────────────────────────────────────────────────

/**
 * GET /users/{userId}/preferences/{name}
 * Returns a single user preference as plain text.
 * Mirrors Java's mirthClient.getUserPreference(userId, name).
 * Uses text/plain — NOT JSON — per UserServletInterface annotation.
 */
export async function getUserPreference(userId: number, name: string): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/users/${userId}/preferences/${name}`, {
    headers: {
      Accept: "text/plain",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) return "";
  return res.text();
}

/**
 * PUT /users/{userId}/preferences/{name}
 * Saves a single user preference as plain text body.
 * Mirrors Java's mirthClient.setUserPreference(userId, name, value).
 */
export async function setUserPreference(
  userId: number,
  name: string,
  value: string
): Promise<void> {
  const serverUrl = getServerUrl();
  await fetch(`${PROXY_BASE}/users/${userId}/preferences/${name}`, {
    method: "PUT",
    headers: {
      "Content-Type": "text/plain",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: value,
  });
}

/**
 * POST /users/{userId}/notificationAcknowledged
 * Mirrors Java's mirthClient.setUserNotificationAcknowledged(userId), called
 * from LoginPanel.handleSuccess() when the user accepts the login notification.
 * Records the consent server-side (audit event "Login notification accepted").
 * Empty body.
 */
export async function acknowledgeUserNotification(userId: number): Promise<void> {
  await request<void>(`/users/${userId}/notificationAcknowledged`, { method: "POST" });
}

// ─── Database Tasks ───────────────────────────────────────────────────────────

/**
 * GET /databaseTasks/
 * Mirrors Java's mirthClient.getDatabaseTasks() called from SettingsPanelDatabaseTasks.doRefresh().
 * Returns Map<String, DatabaseTask> normalized to Record<string, DatabaseTask>.
 *
 * Actual server response when no tasks exist (from live API testing):
 *   {"map":null}
 *
 * normalizeXStream's map handler only triggers when val["map"] !== null, so {"map":null}
 * falls through to the generic object handler and produces {map: null} — not {}.
 * We handle this explicitly: return {} whenever the result is not a useful object.
 */
export async function getDatabaseTasks(): Promise<Record<string, DatabaseTask>> {
  const raw = await request<Record<string, unknown>>("/databaseTasks/");
  if (!raw || typeof raw !== "object") return {};
  // {"map":null} — normalizeXStream passes through since map value is null (not a real map)
  if ("map" in raw && (raw["map"] === null || raw["map"] === undefined)) return {};
  return raw as Record<string, DatabaseTask>;
}

/**
 * POST /databaseTasks/{taskId}/_run
 * Mirrors Java's mirthClient.runDatabaseTask(taskId).
 * Returns a plain-text result message (may be blank if no message).
 * The server returns text/plain, so we use a raw fetch to avoid JSON parsing.
 */
export async function runDatabaseTask(taskId: string): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/databaseTasks/${encodeURIComponent(taskId)}/_run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/plain",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return res.text();
}

/**
 * POST /databaseTasks/{taskId}/_cancel
 * Mirrors Java's mirthClient.cancelDatabaseTask(taskId).
 */
export async function cancelDatabaseTask(taskId: string): Promise<void> {
  await request<void>(`/databaseTasks/${encodeURIComponent(taskId)}/_cancel`, {
    method: "POST",
  });
}

// ─── Resources ────────────────────────────────────────────────────────────────

/** com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties — the only resource type in OSS. */
export const DIRECTORY_RESOURCE_FQN =
  "com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties";
/** DirectoryResourceProperties.PLUGIN_POINT */
export const DIRECTORY_PLUGIN_POINT = "Directory Resource";

/** Coerce a Staxon JSON value to boolean (bare `true`/`false`, or the string forms). */
function asBool(v: unknown, fallback = false): boolean {
  if (v == null) return fallback;
  return v === true || v === "true";
}

/**
 * GET /server/resources
 * Mirrors Java's mirthClient.getResources() called from SettingsPanelResources.doRefresh().
 * Returns List<ResourceProperties>.
 *
 * Server response (XStream → Staxon JSON), keyed by each resource's real subclass FQN:
 *   {"list":{"com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties":
 *     {"@version":"4.6.0","pluginPointName":"Directory Resource","type":"Directory",
 *      "id":"Default Resource","name":"[Default Resource]","description":"...","directory":"custom-lib",
 *      "directoryRecursion":true,"includeWithGlobalScripts":true,"loadParentFirst":false}}}
 * A single-item list collapses to a plain object (XStream); two+ resources of one type form an array.
 *
 * We fetch with `skipNormalize` and walk the envelope ourselves so we can capture each resource's
 * real FQN (the list key) and pluginPointName — `normalizeXStream` strips the FQN class wrapper,
 * which would erase the type discriminator and force every resource back to Directory on save
 *. Resource fields arrive as plain JSON primitives here (no `{"boolean":…}` wrappers).
 *
 * Field name: the server uses "directoryRecursion" (not "includeSubdirectories").
 */
export async function getResources(): Promise<ResourceProperties[]> {
  const raw = await request<{ list?: unknown }>("/server/resources", { skipNormalize: true });
  const listObj = raw && typeof raw === "object" ? raw.list : null;
  if (!listObj || typeof listObj !== "object") return [];

  const out: ResourceProperties[] = [];
  for (const [fqn, val] of Object.entries(listObj as Record<string, unknown>)) {
    const entries = Array.isArray(val) ? val : [val];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      out.push({
        fqn,
        pluginPointName: e.pluginPointName != null ? String(e.pluginPointName) : undefined,
        type: e.type != null ? String(e.type) : "",
        id: e.id != null ? String(e.id) : "",
        name: e.name != null ? String(e.name) : "",
        description: e.description != null ? String(e.description) : "",
        includeWithGlobalScripts: asBool(e.includeWithGlobalScripts),
        loadParentFirst: asBool(e.loadParentFirst),
        directory: e.directory != null ? String(e.directory) : undefined,
        // Server model default is true (DirectoryResourceProperties.java:20).
        directoryRecursion: asBool(e.directoryRecursion, true),
        ...(typeof e["@version"] === "string" ? { "@version": e["@version"] as string } : {}),
      });
    }
  }
  return out;
}

/**
 * PUT /server/resources
 * Mirrors Java's mirthClient.setResources(resources).
 *
 * The server deserializes via XStream. The list is sent keyed by each resource's real subclass FQN:
 *   {"list":{"<FQN>": obj_or_array, ...}}
 * A single-item per-FQN group collapses to a plain object (XStream); two+ form an array.
 *
 * Each entry retains its "@version" and "pluginPointName" (captured on load) so the server can
 * dispatch it to the right plugin. We group by the captured `fqn` rather than forcing the Directory
 * FQN onto every entry — the latter silently re-typed any non-Directory resource to Directory on
 * save, destroying its subtype fields. Rows created in the WebUI carry the Directory FQN.
 *
 * Deferred limitations — none reachable without a non-Directory resource plugin (none exists in OSS
 * or any commercial plugin); each would require an XML round-trip rather than this JSON one:
 *   1. An InvalidResourceProperties (orphaned resource) round-trips verbatim only via XML.
 *   2. Subtype fields of a future non-Directory type aren't modeled here; such a type would ship
 *      its own WebUI panel (see resources-tab.tsx makeNewResource note).
 *   3. The JSON GET leaves numeric-looking string fields (directory/description) subject to Staxon
 *      autoPrimitive (the class already fixed for tags/config-map); an XML GET would fix it.
 */
export async function setResources(resources: ResourceProperties[]): Promise<void> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of resources) {
    const fqn = r.fqn ?? DIRECTORY_RESOURCE_FQN;
    const isDirectory = fqn === DIRECTORY_RESOURCE_FQN;
    const entry: Record<string, unknown> = {
      "@version": r["@version"] ?? "4.6.0",
      pluginPointName: r.pluginPointName ?? (isDirectory ? DIRECTORY_PLUGIN_POINT : ""),
      type: r.type,
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      includeWithGlobalScripts: r.includeWithGlobalScripts,
      loadParentFirst: r.loadParentFirst,
    };
    if (isDirectory) {
      entry.directory = r.directory ?? "";
      // Server model default is true (DirectoryResourceProperties.java:20).
      entry.directoryRecursion = r.directoryRecursion ?? true;
    }
    const group = groups.get(fqn);
    if (group) group.push(entry);
    else groups.set(fqn, [entry]);
  }

  let body: string;
  if (groups.size === 0) {
    body = JSON.stringify({ list: null });
  } else {
    const list: Record<string, unknown> = {};
    for (const [fqn, entries] of groups) {
      // XStream collapses a single-item list to a plain object.
      list[fqn] = entries.length === 1 ? entries[0] : entries;
    }
    body = JSON.stringify({ list });
  }

  await request<void>("/server/resources", { method: "PUT", body });
}

/**
 * POST /server/resources/{resourceId}/_reload
 * Mirrors Java's mirthClient.reloadResource(resourceId).
 * Forces the server to re-scan the resource's directory and reload all JAR files.
 */
export async function reloadResource(resourceId: string): Promise<void> {
  await request<void>(`/server/resources/${encodeURIComponent(resourceId)}/_reload`, {
    method: "POST",
  });
}

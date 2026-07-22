/**
 * Data Pruner utility functions and types.
 *
 * Extracted from data-pruner-tab.tsx to separate pure business logic
 * (XML parsing, form conversion, validation) from the React component.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

import type { CronJob } from "@/app/(app)/channels/_lib/channel-xml";
import { isValidCronExpression } from "@/lib/cron-utils";

export type { CronJob };
export type ScheduleType = "interval" | "time" | "cron";
export type IntervalUnit = "hours" | "minutes";
export type Compression = "none" | "zip" | "tar_gz" | "tar_bz2";
export type EncryptionType = "STANDARD" | "AES128" | "AES256";

export interface PrunerForm {
  // Schedule
  enabled: boolean;
  scheduleType: ScheduleType;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  // Time-of-day schedule (used when scheduleType === "time")
  pollingHour: number;
  pollingMinute: number;
  // Cron schedule (used when scheduleType === "cron")
  cronJobs: CronJob[];
  // Advanced polling restrictions (active-days / time-range). Round-tripped verbatim
  // from the loaded pollingProperties so Swing-configured restrictions survive a save.
  advancedPollingXml: string;
  // Prune settings
  blockSize: string;
  pruneEvents: boolean;
  maxEventAge: string;
  // Archive settings
  archiveEnabled: boolean;
  archiverBlockSize: string;
  // Archiver options (maps to MessageWriterOptions XML)
  contentTypeKey: string; // "" | "RAW|false" | "TRANSFORMED|true" | …
  includeAttachments: boolean; // only valid when contentTypeKey === ""
  encryptContent: boolean;
  compression: Compression;
  passwordEnabled: boolean;
  encryptionType: EncryptionType;
  password: string;
  rootPath: string;
  filePattern: string;
}

export interface PrunerStatus {
  currentState: string;
  currentProcess: string;
  lastProcess: string;
  nextProcess: string;
  isRunning: boolean;
}

// ─── Content Type Options ────────────────────────────────────────────────────

export interface ContentTypeOption {
  label: string;
  /** Encoded as "<contentType>|<destinationContent>" — empty contentType = XML Serialized */
  value: string;
}

export const CONTENT_TYPE_OPTIONS: ContentTypeOption[] = [
  { label: "XML Serialized Message", value: "|false" },
  { label: "Source - RAW", value: "RAW|false" },
  { label: "Source - Processed Raw", value: "PROCESSED_RAW|false" },
  { label: "Source - Transformed", value: "TRANSFORMED|false" },
  { label: "Source - Encoded", value: "ENCODED|false" },
  { label: "Source - Response", value: "RESPONSE|false" },
  { label: "Destination - RAW", value: "RAW|true" },
  { label: "Destination - Transformed", value: "TRANSFORMED|true" },
  { label: "Destination - Encoded", value: "ENCODED|true" },
  { label: "Destination - Sent", value: "SENT|true" },
  { label: "Destination - Response", value: "RESPONSE|true" },
  { label: "Destination - Processed Response", value: "PROCESSED_RESPONSE|true" },
  { label: "Source Map", value: "SOURCE_MAP|false" },
  { label: "Channel Map", value: "CHANNEL_MAP|false" },
  { label: "Response Map", value: "RESPONSE_MAP|false" },
];

/**
 * File-pattern "Available variables" hints — must match the Java client exactly
 * (MessageExportPanel.java:407-416 labels + VariableListHandler.java:56-81 tokens).
 * These tokens are resolved by the server's ValueReplacer; a wrong token silently
 * produces a wrong filename, so parity here is functional, not cosmetic.
 */
export const FILE_PATTERN_VARIABLES: { label: string; variable: string }[] = [
  { label: "Message ID", variable: "${message.messageId}" },
  { label: "Server ID", variable: "${message.serverId}" },
  { label: "Channel ID", variable: "${message.channelId}" },
  { label: "Original File Name", variable: "${originalFilename}" },
  {
    label: "Formatted Message Date",
    variable:
      "${date.format('yyyy-MM-dd',$message.getConnectorMessages().get(0).getReceivedDate())}",
  },
  { label: "Formatted Current Date", variable: "${date.get('yyyy-MM-dd')}" },
  { label: "Timestamp", variable: "${SYSTIME}" },
  { label: "Unique ID", variable: "${UUID}" },
  { label: "Count", variable: "${COUNT}" },
];

/**
 * Default cron job seeded when the pruner schedule type is switched to Cron with
 * no existing rows — mirrors Java PollingSettingsPanel.java:635-636 (pruner context).
 */
export const DEFAULT_CRON_JOB: CronJob = {
  expression: "0 0 */1 * * ?",
  description: "Run hourly.",
};

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Default <pollConnectorPropertiesAdvanced> block (weekly, no inactive days,
 * all-day). Used for fresh configs and as the fallback when the loaded
 * pollingProperties XML has no advanced block. Mirrors the Java defaults.
 */
export const DEFAULT_POLL_ADVANCED_XML = `<pollConnectorPropertiesAdvanced><weekly>true</weekly><inactiveDays><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean></inactiveDays><dayOfMonth>1</dayOfMonth><allDay>true</allDay><startingHour>8</startingHour><startingMinute>0</startingMinute><endingHour>17</endingHour><endingMinute>0</endingMinute></pollConnectorPropertiesAdvanced>`;

export function defaultForm(): PrunerForm {
  return {
    enabled: false,
    scheduleType: "interval",
    intervalValue: "1",
    intervalUnit: "hours",
    pollingHour: 0,
    pollingMinute: 0,
    cronJobs: [],
    advancedPollingXml: DEFAULT_POLL_ADVANCED_XML,
    blockSize: "1000",
    pruneEvents: false,
    maxEventAge: "",
    archiveEnabled: false,
    archiverBlockSize: "50",
    contentTypeKey: "|false",
    includeAttachments: false,
    encryptContent: false,
    compression: "none",
    passwordEnabled: false,
    encryptionType: "AES256",
    password: "",
    rootPath: "",
    filePattern: "${message.channelId}_message_${message.messageId}.xml",
  };
}

// ─── XML Parsing ────────────────────────────────────────────────────────────

/**
 * Parse the pollingProperties XML string (PollConnectorProperties XStream format).
 * Extracts the schedule type plus its type-specific fields:
 *   - INTERVAL → pollingFrequency (ms) → intervalValue/intervalUnit
 *   - TIME     → pollingHour / pollingMinute
 *   - CRON     → cronJobs (<cronProperty> entries)
 */
export function parsePollingProperties(xml: string): Partial<PrunerForm> {
  if (!xml) return {};
  try {
    const typeMatch = xml.match(/<pollingType>([^<]+)<\/pollingType>/);
    const freqMatch = xml.match(/<pollingFrequency>([^<]+)<\/pollingFrequency>/);
    const hourMatch = xml.match(/<pollingHour>([^<]+)<\/pollingHour>/);
    const minuteMatch = xml.match(/<pollingMinute>([^<]+)<\/pollingMinute>/);

    const pollingType = typeMatch?.[1]?.toUpperCase() ?? "INTERVAL";
    const freqMs = parseInt(freqMatch?.[1] ?? "3600000", 10);

    let intervalValue = "1";
    let intervalUnit: IntervalUnit = "hours";

    if (pollingType === "INTERVAL") {
      const freqHours = freqMs / 3600000;
      const freqMinutes = freqMs / 60000;
      if (Number.isInteger(freqHours) && freqHours <= 24) {
        intervalValue = String(freqHours);
        intervalUnit = "hours";
      } else {
        intervalValue = String(freqMinutes);
        intervalUnit = "minutes";
      }
    }

    // Parse <cronJobs><cronProperty><expression/><description/></cronProperty></cronJobs>
    const cronJobs: CronJob[] = [];
    const cronJobsMatch = xml.match(/<cronJobs>([\s\S]*?)<\/cronJobs>/);
    if (cronJobsMatch) {
      const cronPropRe = /<cronProperty>([\s\S]*?)<\/cronProperty>/g;
      let m: RegExpExecArray | null;
      while ((m = cronPropRe.exec(cronJobsMatch[1])) !== null) {
        const block = m[1];
        const exprM = block.match(/<expression>([\s\S]*?)<\/expression>/);
        const descM = block.match(/<description>([\s\S]*?)<\/description>/);
        cronJobs.push({
          expression: xmlUnesc(exprM?.[1] ?? ""),
          description: xmlUnesc(descM?.[1] ?? ""),
        });
      }
    }

    const scheduleType: ScheduleType =
      pollingType === "TIME" ? "time" : pollingType === "CRON" ? "cron" : "interval";

    // Preserve the loaded advanced-restrictions block verbatim so Swing-configured
    // active-days / time-range settings survive a WebUI save (matches Java caching
    // getPollConnectorPropertiesAdvanced() and writing it back on fillProperties).
    const advancedMatch = xml.match(
      /<pollConnectorPropertiesAdvanced>[\s\S]*?<\/pollConnectorPropertiesAdvanced>/
    );

    return {
      scheduleType,
      intervalValue,
      intervalUnit,
      pollingHour: parseInt(hourMatch?.[1] ?? "0", 10) || 0,
      pollingMinute: parseInt(minuteMatch?.[1] ?? "0", 10) || 0,
      cronJobs,
      advancedPollingXml: advancedMatch ? advancedMatch[0] : DEFAULT_POLL_ADVANCED_XML,
    };
  } catch {
    return {};
  }
}

/**
 * Build the pollingProperties XML string from the form state.
 *
 * Produces a minimal valid XML that the server can deserialize.
 * The pollConnectorPropertiesAdvanced block is required to avoid NPEs server-side.
 */
export function buildPollingXml(form: PrunerForm): string {
  const advancedBlock = form.advancedPollingXml || DEFAULT_POLL_ADVANCED_XML;
  const open = `<com.mirth.connect.donkey.model.channel.PollConnectorProperties version="4.6.0">`;
  const close = `</com.mirth.connect.donkey.model.channel.PollConnectorProperties>`;

  if (form.scheduleType === "interval") {
    const freqMs =
      form.intervalUnit === "hours"
        ? parseInt(form.intervalValue || "1", 10) * 3600000
        : parseInt(form.intervalValue || "60", 10) * 60000;
    return `${open}<pollingType>INTERVAL</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>${freqMs}</pollingFrequency><pollingHour>0</pollingHour><pollingMinute>0</pollingMinute><cronJobs/>${advancedBlock}${close}`;
  }

  if (form.scheduleType === "time") {
    return `${open}<pollingType>TIME</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>3600000</pollingFrequency><pollingHour>${form.pollingHour}</pollingHour><pollingMinute>${form.pollingMinute}</pollingMinute><cronJobs/>${advancedBlock}${close}`;
  }

  // CRON — emit one <cronProperty> per job (matches CronProperty XStream alias)
  const cronJobsXml = form.cronJobs
    .filter((j) => j.expression.trim())
    .map(
      (j) =>
        `<cronProperty><description>${xmlEsc(j.description)}</description><expression>${xmlEsc(j.expression)}</expression></cronProperty>`
    )
    .join("");
  const cronJobsEl = cronJobsXml ? `<cronJobs>${cronJobsXml}</cronJobs>` : `<cronJobs/>`;
  return `${open}<pollingType>CRON</pollingType><pollOnStart>false</pollOnStart><pollingFrequency>3600000</pollingFrequency><pollingHour>0</pollingHour><pollingMinute>0</pollingMinute>${cronJobsEl}${advancedBlock}${close}`;
}

/** XML-escape a string for embedding in element text. */
function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reverse of xmlEsc — decode the entities we emit when reading element text. */
function xmlUnesc(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Read a text value from an XML element, returning "" if absent or self-closing.
 *
 * The element text is XML-unescaped so parse is symmetric with `buildArchiverOptionsXml`,
 * which escapes String field values via `xmlEsc`. Without this, a `rootFolder` /
 * `filePattern` / `password` containing `&`/`<`/`>` was double-escaped on every
 * load→save cycle (`in&out` → `in&amp;out` → `in&amp;amp;out` → …). Enum/format
 * fields never contain entities, so unescaping them is a harmless no-op.
 */
function xmlField(xml: string, tag: string): string {
  const selfClose = new RegExp(`<${tag}\\s*/>`);
  if (selfClose.test(xml)) return "";
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return m ? xmlUnesc(m[1]) : "";
}

/** Read a boolean element value ("true"/"false"), defaulting to false. */
function xmlBool(xml: string, tag: string): boolean {
  return xmlField(xml, tag) === "true";
}

/**
 * Decode a contentTypeKey from stored contentType + destinationContent values.
 * Returns "|false" (XML Serialized) when contentType is empty.
 */
function decodeContentTypeKey(contentType: string, destinationContent: boolean): string {
  if (!contentType) return "|false";
  return `${contentType}|${String(destinationContent)}`;
}

/**
 * Encode a contentTypeKey ("TRANSFORMED|true") into contentType + destinationContent.
 * "|false" → contentType="" (XML Serialized Message).
 */
function encodeContentTypeKey(key: string): { contentType: string; destinationContent: boolean } {
  const sep = key.lastIndexOf("|");
  if (sep === -1) return { contentType: "", destinationContent: false };
  const contentType = key.slice(0, sep);
  const destinationContent = key.slice(sep + 1) === "true";
  return { contentType, destinationContent };
}

/**
 * Decode the archiveFormat + compressFormat XML fields into the UI Compression enum.
 */
function decodeCompression(archiveFormat: string, compressFormat: string): Compression {
  if (archiveFormat === "zip") return "zip";
  if (archiveFormat === "tar" && compressFormat === "gz") return "tar_gz";
  if (archiveFormat === "tar" && compressFormat === "bz2") return "tar_bz2";
  return "none";
}

/**
 * Encode the UI Compression enum into archiveFormat + compressFormat XML values.
 */
function encodeCompression(compression: Compression): {
  archiveFormat: string;
  compressFormat: string;
} {
  switch (compression) {
    case "zip":
      return { archiveFormat: "zip", compressFormat: "" };
    case "tar_gz":
      return { archiveFormat: "tar", compressFormat: "gz" };
    case "tar_bz2":
      return { archiveFormat: "tar", compressFormat: "bz2" };
    default:
      return { archiveFormat: "", compressFormat: "" };
  }
}

/**
 * Parse a MessageWriterOptions XML string (XStream serialization of
 * com.mirth.connect.util.messagewriter.MessageWriterOptions) into PrunerForm fields.
 */
export function parseArchiverOptionsXml(xml: string): Partial<PrunerForm> {
  if (!xml || !xml.includes("MessageWriterOptions")) return {};
  try {
    const contentType = xmlField(xml, "contentType");
    const destinationContent = xmlBool(xml, "destinationContent");
    const encrypt = xmlBool(xml, "encrypt");
    const includeAttachments = xmlBool(xml, "includeAttachments");
    const rootFolder = xmlField(xml, "rootFolder");
    const filePattern = xmlField(xml, "filePattern");
    const archiveFormat = xmlField(xml, "archiveFormat");
    const compressFormat = xmlField(xml, "compressFormat");
    const passwordEnabled = xmlBool(xml, "passwordEnabled");
    const password = xmlField(xml, "password");
    const encryptionTypeRaw = xmlField(xml, "encryptionType");

    const validEncTypes: EncryptionType[] = ["STANDARD", "AES128", "AES256"];
    const encryptionType: EncryptionType = validEncTypes.includes(
      encryptionTypeRaw as EncryptionType
    )
      ? (encryptionTypeRaw as EncryptionType)
      : "AES256";

    return {
      contentTypeKey: decodeContentTypeKey(contentType, destinationContent),
      includeAttachments: !contentType ? includeAttachments : false,
      encryptContent: encrypt,
      compression: decodeCompression(archiveFormat, compressFormat),
      passwordEnabled: passwordEnabled && archiveFormat === "zip",
      encryptionType,
      password,
      rootPath: rootFolder,
      filePattern: filePattern || defaultForm().filePattern,
    };
  } catch {
    return {};
  }
}

/**
 * Build a MessageWriterOptions XML string from the form state.
 * Mirrors ObjectXMLSerializer output for com.mirth.connect.util.messagewriter.MessageWriterOptions.
 */
export function buildArchiverOptionsXml(form: PrunerForm): string {
  const { contentType, destinationContent } = encodeContentTypeKey(form.contentTypeKey);
  const { archiveFormat, compressFormat } = encodeCompression(form.compression);

  // includeAttachments is only meaningful for XML serialized (empty contentType)
  const includeAttachments = !contentType && form.includeAttachments;

  // passwordEnabled + password only apply when ZIP
  const passwordEnabled = form.compression === "zip" && form.passwordEnabled;
  const password = passwordEnabled ? form.password : "";
  // encryptionType is a Java enum (EncryptionType) — it must NEVER be an empty
  // element. XStream throws ConversionException on an empty enum, which breaks the
  // Swing pruner tab and silently stops server rescheduling. Always emit a concrete
  // value (Java's combo is always populated; AES256 is the default). See.
  const encryptionType = form.encryptionType || "AES256";

  // Plain String field: an empty element deserializes to "" (harmless to XStream).
  const el = (tag: string, value: string) =>
    value ? `<${tag}>${xmlEsc(value)}</${tag}>` : `<${tag}/>`;
  // Enum / format fields: OMIT the element entirely when empty so XStream reads null
  // (an empty <contentType/> / <archiveFormat/> / <compressFormat/> either throws on
  // the enum or NPEs in ArchiveFormat.lookup). Mirrors XStream's null-field output.
  const elOmit = (tag: string, value: string) => (value ? `<${tag}>${xmlEsc(value)}</${tag}>` : "");

  return [
    "<com.mirth.connect.util.messagewriter.MessageWriterOptions>",
    elOmit("contentType", contentType),
    `<destinationContent>${destinationContent}</destinationContent>`,
    `<encrypt>${form.encryptContent}</encrypt>`,
    `<includeAttachments>${includeAttachments}</includeAttachments>`,
    "<baseFolder/>",
    el("rootFolder", form.rootPath),
    el("filePattern", form.filePattern),
    "<archiveFileName/>",
    elOmit("archiveFormat", archiveFormat),
    elOmit("compressFormat", compressFormat),
    `<passwordEnabled>${passwordEnabled}</passwordEnabled>`,
    el("password", password),
    `<encryptionType>${xmlEsc(encryptionType)}</encryptionType>`,
    "</com.mirth.connect.util.messagewriter.MessageWriterOptions>",
  ].join("");
}

/**
 * Extract boolean from a property value that may be:
 *   - A plain string "true"/"false" (Staxon auto-typed boolean stringified)
 *   - An XML-wrapped string "<boolean>false</boolean>" (ObjectXMLSerializer format)
 */
export function parseBoolProp(val: string | undefined): boolean {
  if (!val) return false;
  const stripped = val.replace(/<[^>]+>/g, "").trim();
  return stripped === "true";
}

// ─── Form ↔ Record Conversion ───────────────────────────────────────────────

export function propsToForm(props: Record<string, string>): PrunerForm {
  const form = defaultForm();
  form.enabled = parseBoolProp(props["enabled"]);
  form.blockSize = props["pruningBlockSize"] || "1000";
  form.pruneEvents = parseBoolProp(props["pruneEvents"]);
  form.maxEventAge = props["maxEventAge"] ?? "";
  form.archiveEnabled = parseBoolProp(props["archiveEnabled"]);
  form.archiverBlockSize = props["archiverBlockSize"] || "50";

  const polling = props["pollingProperties"];
  if (polling) {
    Object.assign(form, parsePollingProperties(polling));
  }

  // Parse full archiver options — falls back to form defaults when not present
  const archiverOptions = props["archiverOptions"];
  if (archiverOptions) {
    Object.assign(form, parseArchiverOptionsXml(archiverOptions));
  }

  // includeAttachments was previously stored as a top-level property;
  // prefer the value from archiverOptions if present, fall back to the legacy key.
  if (!archiverOptions) {
    form.includeAttachments = parseBoolProp(props["includeAttachments"]);
  }

  return form;
}

export function formToProps(form: PrunerForm): Record<string, string> {
  return {
    enabled: String(form.enabled),
    pollingProperties: buildPollingXml(form),
    pruningBlockSize: form.blockSize || "1000",
    pruneEvents: String(form.pruneEvents),
    maxEventAge: form.maxEventAge,
    archiveEnabled: String(form.archiveEnabled),
    archiverBlockSize: form.archiverBlockSize || "50",
    // includeAttachments kept as a top-level property for backwards compat with
    // servers that read it directly; the canonical value is also in archiverOptions.
    includeAttachments: String(
      !form.contentTypeKey.startsWith("|") ? false : form.includeAttachments
    ),
    archiverOptions: buildArchiverOptionsXml(form),
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validatePruner(form: PrunerForm): string | null {
  const blockSize = parseInt(form.blockSize || "0", 10);
  if (isNaN(blockSize) || blockSize < 50 || blockSize > 10000) {
    return "Pruner Block size must be between 50 and 10000. The recommended value for most servers is 1000.";
  }
  if (form.pruneEvents && !form.maxEventAge.trim()) {
    return "Event Age is required when pruning events.";
  }
  if (form.enabled && form.scheduleType === "interval") {
    const freqMs =
      form.intervalUnit === "hours"
        ? parseInt(form.intervalValue || "1", 10) * 3600000
        : parseInt(form.intervalValue || "60", 10) * 60000;
    if (freqMs < 3600000 || freqMs >= 86400000) {
      return "Frequency must be between 1 and 24 hours.";
    }
  }

  if (form.enabled && form.scheduleType === "cron") {
    if (!form.cronJobs.some((j) => j.expression.trim())) {
      return "At least one cron expression is required.";
    }
    // Mirror Java PollingSettingsPanel.checkProperties: every row must be a valid
    // Quartz expression (a blank or invalid row blocks the save).
    for (const job of form.cronJobs) {
      const expr = job.expression.trim();
      if (!expr) {
        return "Cron expression cannot be blank.";
      }
      if (!isValidCronExpression(expr)) {
        return `Invalid cron expression: "${expr}".`;
      }
    }
  }

  if (form.archiveEnabled) {
    const archiverBlockSize = parseInt(form.archiverBlockSize || "0", 10);
    if (isNaN(archiverBlockSize) || archiverBlockSize < 1 || archiverBlockSize > 1000) {
      return "Archiver block size must be between 1 and 1000. The recommended value for most servers is 50.";
    }
    if (!form.rootPath.trim()) {
      return "Root path is required.";
    }
    if (!form.filePattern.trim()) {
      return "File pattern is required.";
    }
    if (form.compression === "zip" && form.passwordEnabled && !form.password) {
      return "A password is required.";
    }
  }

  return null;
}

// ─── Status Parsing ─────────────────────────────────────────────────────────

export function parseStatus(raw: Record<string, string>): PrunerStatus {
  return {
    currentState: raw["currentState"] ?? "Unknown",
    currentProcess: raw["currentProcess"] ?? "",
    lastProcess: raw["lastProcess"] ?? "",
    nextProcess: raw["nextProcess"] ?? "Not scheduled",
    isRunning: raw["isRunning"] === "true",
  };
}

/**
 * monaco-rhino.ts
 *
 * Shared Rhino JS language registration for Monaco.
 *
 * Registers the custom "rhino-js" language ID, a BridgeLink-colored Monarch tokenizer,
 * "mirth-js" / "mirth-js-dark" themes, and six providers:
 *   1. Top-level BridgeLink globals (msg, channelMap, DateUtil, logger, HL7 segments…)
 *   2. Dot-triggered member completions (DateUtil. → getCurrentDate, logger. → info…)
 *   3. JS snippet completions (if, for, while, try/catch, function, switch, …)
 *   4. Local-variable scraper — surfaces var/let/const/function names from current model
 *   5. Built-in reference snippets from CATEGORIES (Call System Function, Build Map, …)
 *   6. User-defined code templates filtered by ContextType and channel assignment
 *   7. Hover documentation for BridgeLink globals, member completions, and code templates
 *
 * Usage:
 *   import { RHINO_LANG_ID, registerRhinoLanguage } from "@/lib/monaco-rhino";
 *
 *   // In a Monaco <Editor> beforeMount callback:
 *   <Editor
 *     language={RHINO_LANG_ID}
 *     beforeMount={(monaco) => registerRhinoLanguage(monaco)}
 *     theme={isDark ? "mirth-js-dark" : "mirth-js"}
 *     ...
 *   />
 *
 * registerRhinoLanguage() is fully idempotent — safe to call from multiple
 * editor instances on the same page; completion providers are registered only
 * once per build version (guarded by a globalThis flag).
 */

import type * as MonacoType from "monaco-editor";
import {
  getCodeTemplatesCached,
  getCodeTemplateLibrariesCached,
  peekCodeTemplatesCached,
  peekCodeTemplateLibrariesCached,
} from "./api/api-code-templates";
import {
  filterTemplatesByChannel,
  parseCodeTemplateFunction,
  formatCodeTemplateSignature,
  extractFunctionCall,
} from "./code-template-utils";
import type { ContextType } from "./types";
import { CATEGORIES, SCRIPT_ONLY_CONTEXTS } from "./reference-data";
import { pluginRegistry } from "./plugin-registry";
import { ensureInstalledPluginsLoaded } from "./installed-plugins";
import { ensurePluginLicensesLoaded } from "./plugin-license";
import { surfaceGateEnabledSnapshot } from "./plugin-gating";
import { toMonacoSnippet } from "./snippet-convert";

// SCRIPT_ONLY_CONTEXTS (lifecycle script contexts where scriptExclude items are
// hidden) lives in reference-data.ts so the autocomplete provider and the
// reference panel's isRefItemVisibleInContext share one definition.

// JS identifier pattern — items whose insert code is just a variable name
// (e.g. "msg", "channelId") are already provided by the globals completion
// provider and should be skipped by Provider 5 to avoid duplicate entries.
const BARE_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// ─── BridgeLink globals — split by color category (matches MirthJavaScriptTokenMaker) ──

type GlobalDef = {
  label: string;
  detail: string;
  documentation: string;
  kind: "variable" | "class" | "function";
};

/** Blue — context variables, maps, shorthand helpers, status constants (MARKUP_TAG_NAME in Java UI) */
const MIRTH_GLOBALS_BLUE: GlobalDef[] = [
  // Core message variables
  {
    label: "msg",
    kind: "variable",
    detail: "XML (E4X)",
    documentation:
      "The inbound message as an E4X XML object. Use msg['PID']['PID.3']['CX.1'].toString() etc.",
  },
  {
    label: "tmp",
    kind: "variable",
    detail: "XML | Object | String",
    documentation:
      "The outbound template variable. Assigned from the outbound template when one exists; write your output here.",
  },
  {
    label: "message",
    kind: "variable",
    detail: "ImmutableMessage",
    documentation:
      "The full inbound message (ImmutableMessage). Available in filter/transformer contexts.",
  },
  {
    label: "connectorMessage",
    kind: "variable",
    detail: "ImmutableConnectorMessage",
    documentation:
      "The current connector message. Provides access to raw/encoded/sent/response content and all maps.",
  },
  // Maps
  {
    label: "channelMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation:
      "Scoped to the current channel. Values persist for the life of a message through the channel.",
  },
  {
    label: "sourceMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation:
      "Read-only map populated by the source connector with metadata about the inbound message.",
  },
  {
    label: "connectorMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation: "Connector-specific variables. Scoped to the current destination connector.",
  },
  {
    label: "responseMap",
    kind: "variable",
    detail: "Map<String,Response>",
    documentation:
      "Map of destination response objects. Keys are destination names or 'd1', 'd2', etc.",
  },
  {
    label: "globalMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation:
      "Shared across all channels on the server. Persists until the server is restarted.",
  },
  {
    label: "globalChannelMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation: "Scoped to a channel but shared across all messages. Resets on channel deploy.",
  },
  {
    label: "configurationMap",
    kind: "variable",
    detail: "Map<String,Object>",
    documentation:
      "Read-only map of configuration map entries defined in Settings > Configuration Map.",
  },
  // Shorthand map helpers (functions injected by JavaScriptBuilder)
  {
    label: "$co",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for connectorMap.get(key) / connectorMap.put(key, value).",
  },
  {
    label: "$c",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for channelMap.get(key) / channelMap.put(key, value).",
  },
  {
    label: "$s",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for sourceMap.get(key) / sourceMap.put(key, value).",
  },
  {
    label: "$gc",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for globalChannelMap.get(key) / globalChannelMap.put(key, value).",
  },
  {
    label: "$g",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for globalMap.get(key) / globalMap.put(key, value).",
  },
  {
    label: "$cfg",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for configurationMap.get(key) / configurationMap.put(key, value).",
  },
  {
    label: "$r",
    kind: "function",
    detail: "(key, value?): any",
    documentation: "Shorthand for responseMap.get(key) / responseMap.put(key, value).",
  },
  // Channel info
  {
    label: "channelId",
    kind: "variable",
    detail: "String",
    documentation: "UUID of the currently executing channel.",
  },
  {
    label: "channelName",
    kind: "variable",
    detail: "String",
    documentation: "Deployed name of the currently executing channel.",
  },
  {
    label: "contextFactory",
    kind: "variable",
    detail: "ContextFactory",
    documentation: "The Rhino ContextFactory wrapper for the current execution context.",
  },
  // Response context
  {
    label: "response",
    kind: "variable",
    detail: "ImmutableResponse",
    documentation: "The current response object (available in response transformer context).",
  },
  {
    label: "responseStatus",
    kind: "variable",
    detail: "Status",
    documentation: "The response status (SUCCESS, ERROR, QUEUED, FILTERED).",
  },
  {
    label: "responseErrorMessage",
    kind: "variable",
    detail: "String",
    documentation: "The error message from the response, if any.",
  },
  {
    label: "responseStatusMessage",
    kind: "variable",
    detail: "String",
    documentation: "The status message from the response.",
  },
  // Status constants
  {
    label: "SUCCESS",
    kind: "variable",
    detail: "Status",
    documentation: "Status constant — message processed successfully.",
  },
  {
    label: "ERROR",
    kind: "variable",
    detail: "Status",
    documentation: "Status constant — message processing failed with an error.",
  },
  {
    label: "QUEUED",
    kind: "variable",
    detail: "Status",
    documentation: "Status constant — message is queued for later processing.",
  },
  {
    label: "FILTERED",
    kind: "variable",
    detail: "Status",
    documentation: "Status constant — message was filtered out.",
  },
  // DB/SMTP helpers (global functions injected by JavaScriptBuilder)
  {
    label: "executeCachedQuery",
    kind: "function",
    detail: "(expression, paramList, db): ResultSet",
    documentation: "Executes a cached database query.",
  },
  {
    label: "createDatabaseConnection",
    kind: "function",
    detail: "(driver, address, user?, pass?): DatabaseConnection",
    documentation: "Creates a JDBC database connection.",
  },
  {
    label: "createSMTPConnection",
    kind: "function",
    detail: "(host, port, ...): SMTPConnection",
    documentation: "Creates an SMTP connection for sending email.",
  },
  {
    label: "executeUpdate",
    kind: "function",
    detail: "(expression, paramList, db): int",
    documentation: "Executes a database update/insert/delete statement.",
  },
];

/** Purple — utility/factory classes, logger, router, alerts, destinationSet + HL7V2 segment codes
 *  (LITERAL_BOOLEAN in Java UI / MirthJavaScriptTokenMaker) */
const MIRTH_GLOBALS_PURPLE: GlobalDef[] = [
  // Service/factory objects
  {
    label: "logger",
    kind: "variable",
    detail: "Logger",
    documentation:
      "Apache Log4j logger. Use logger.info(), logger.error(), logger.debug(), logger.warn().",
  },
  {
    label: "destinationSet",
    kind: "variable",
    detail: "DestinationSet",
    documentation: "Controls which destinations are active for this message (source context only).",
  },
  {
    label: "alerts",
    kind: "variable",
    detail: "AlertSender",
    documentation: "Send alert notifications. Use alerts.sendAlert(message) to trigger an alert.",
  },
  {
    label: "router",
    kind: "variable",
    detail: "VMRouter",
    documentation:
      "Route messages to other channels. Use router.routeMessage(channelName, message).",
  },
  {
    label: "replacer",
    kind: "variable",
    detail: "TemplateValueReplacer",
    documentation: "Replaces template variables in strings.",
  },
  // Utility classes
  {
    label: "DateUtil",
    kind: "class",
    detail: "DateUtil",
    documentation: "Date/time utility. E.g. DateUtil.getCurrentDate('yyyyMMdd').",
  },
  {
    label: "FileUtil",
    kind: "class",
    detail: "FileUtil",
    documentation: "File I/O utility. Read, write, encode/decode files.",
  },
  {
    label: "XmlUtil",
    kind: "class",
    detail: "XmlUtil",
    documentation: "XML utility. prettyPrint, encode, decode, toJson.",
  },
  {
    label: "JsonUtil",
    kind: "class",
    detail: "JsonUtil",
    documentation: "JSON utility. prettyPrint, escape, toXml.",
  },
  {
    label: "UUIDGenerator",
    kind: "class",
    detail: "UUIDGenerator",
    documentation: "Generates random UUIDs. Use UUIDGenerator.getUUID().",
  },
  {
    label: "HashUtil",
    kind: "class",
    detail: "HashUtil",
    documentation: "Hashing utility. Generates SHA-256 hashes via HashUtil.generate(data).",
  },
  {
    label: "EncryptionUtil",
    kind: "class",
    detail: "EncryptionUtil",
    documentation:
      "Encryption utility. Encrypt/decrypt strings using the server's encryption settings.",
  },
  {
    label: "SerializerFactory",
    kind: "class",
    detail: "SerializerFactory",
    documentation:
      "Factory for getting message serializers/deserializers by data type (e.g. 'HL7V2', 'XML').",
  },
  {
    label: "DatabaseConnectionFactory",
    kind: "class",
    detail: "DatabaseConnectionFactory",
    documentation:
      "Creates JDBC database connections. Use DatabaseConnectionFactory.createDatabaseConnection(...).",
  },
  {
    label: "SMTPConnectionFactory",
    kind: "class",
    detail: "SMTPConnectionFactory",
    documentation: "Creates SMTP connections for sending email.",
  },
  {
    label: "Packages",
    kind: "variable",
    detail: "Packages",
    documentation:
      "Rhino JS Packages object — provides access to Java classes. E.g. Packages.java.util.ArrayList.",
  },
  // HL7V2 segment codes (all colored purple in Java UI)
  { label: "ABS", kind: "variable", detail: "HL7 Segment", documentation: "HL7V2 ABS segment." },
  {
    label: "ACC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ACC segment — Accident.",
  },
  {
    label: "ADD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ADD segment — Addendum.",
  },
  {
    label: "AFF",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AFF segment — Professional Affiliation.",
  },
  {
    label: "AIG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AIG segment — Appointment Information - General Resource.",
  },
  {
    label: "AIL",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AIL segment — Appointment Information - Location Resource.",
  },
  {
    label: "AIP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AIP segment — Appointment Information - Personnel Resource.",
  },
  {
    label: "AIS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AIS segment — Appointment Information - Service.",
  },
  {
    label: "AL1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AL1 segment — Patient Allergy Information.",
  },
  {
    label: "APR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 APR segment — Appointment Preferences.",
  },
  {
    label: "ARQ",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ARQ segment — Appointment Request.",
  },
  {
    label: "AUT",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 AUT segment — Authorization Information.",
  },
  {
    label: "BHS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BHS segment — Batch Header.",
  },
  {
    label: "BLC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BLC segment — Blood Code.",
  },
  {
    label: "BLG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BLG segment — Billing.",
  },
  {
    label: "BPO",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BPO segment — Blood Product Order.",
  },
  {
    label: "BPX",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BPX segment — Blood Product Dispense Status.",
  },
  {
    label: "BTS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BTS segment — Batch Trailer.",
  },
  {
    label: "BTX",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 BTX segment — Blood Product Transfusion/Disposition.",
  },
  {
    label: "CDM",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CDM segment — Charge Description Master.",
  },
  {
    label: "CER",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CER segment — Certificate Detail.",
  },
  {
    label: "CM0",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CM0 segment — Clinical Study Master.",
  },
  {
    label: "CM1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CM1 segment — Clinical Study Phase Master.",
  },
  {
    label: "CM2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CM2 segment — Clinical Study Schedule Master.",
  },
  {
    label: "CNS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CNS segment — Clear Notification.",
  },
  {
    label: "CON",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CON segment — Consent Segment.",
  },
  {
    label: "CSP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CSP segment — Clinical Study Phase.",
  },
  {
    label: "CSR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CSR segment — Clinical Study Registration.",
  },
  {
    label: "CSS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CSS segment — Clinical Study Data Schedule.",
  },
  {
    label: "CTD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CTD segment — Contact Data.",
  },
  {
    label: "CTI",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 CTI segment — Clinical Trial Identification.",
  },
  {
    label: "DB1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 DB1 segment — Disability.",
  },
  {
    label: "DG1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 DG1 segment — Diagnosis.",
  },
  {
    label: "DRG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 DRG segment — Diagnosis Related Group.",
  },
  {
    label: "DSC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 DSC segment — Continuation Pointer.",
  },
  {
    label: "DSP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 DSP segment — Display Data.",
  },
  {
    label: "ECD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ECD segment — Equipment Command.",
  },
  {
    label: "ECR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ECR segment — Equipment Command Response.",
  },
  {
    label: "EDU",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 EDU segment — Educational Detail.",
  },
  {
    label: "EQL",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 EQL segment — Embedded Query Language.",
  },
  {
    label: "EQP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 EQP segment — Equipment/log/Service.",
  },
  {
    label: "EQU",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 EQU segment — Equipment Detail.",
  },
  {
    label: "ERQ",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ERQ segment — Event Replay Query.",
  },
  {
    label: "ERR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ERR segment — Error.",
  },
  {
    label: "EVN",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 EVN segment — Event Type.",
  },
  {
    label: "FAC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 FAC segment — Facility.",
  },
  {
    label: "FHS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 FHS segment — File Header.",
  },
  {
    label: "FT1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 FT1 segment — Financial Transaction.",
  },
  {
    label: "FTS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 FTS segment — File Trailer.",
  },
  {
    label: "GOL",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 GOL segment — Goal Detail.",
  },
  {
    label: "GP1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 GP1 segment — Grouping/Reimbursement - Visit Summary.",
  },
  {
    label: "GP2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 GP2 segment — Grouping/Reimbursement - Procedure Line Item.",
  },
  {
    label: "GT1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 GT1 segment — Guarantor.",
  },
  {
    label: "IAM",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IAM segment — Patient Adverse Reaction Information.",
  },
  {
    label: "IIM",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IIM segment — Inventory Item Master.",
  },
  {
    label: "IN1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IN1 segment — Insurance.",
  },
  {
    label: "IN2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IN2 segment — Insurance Additional Information.",
  },
  {
    label: "IN3",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IN3 segment — Insurance Additional Information, Certification.",
  },
  {
    label: "INV",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 INV segment — Inventory Detail.",
  },
  {
    label: "IPC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 IPC segment — Imaging Procedure Control.",
  },
  {
    label: "ISD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ISD segment — Interaction Status Detail.",
  },
  {
    label: "LAN",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LAN segment — Language Detail.",
  },
  {
    label: "LCC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LCC segment — Location Charge Code.",
  },
  {
    label: "LCH",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LCH segment — Location Characteristic.",
  },
  {
    label: "LDP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LDP segment — Location Department.",
  },
  {
    label: "LOC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LOC segment — Patient Location Definition.",
  },
  {
    label: "LRL",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 LRL segment — Location Relationship.",
  },
  {
    label: "MFA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MFA segment — Master File Acknowledgment.",
  },
  {
    label: "MFE",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MFE segment — Master File Entry.",
  },
  {
    label: "MFI",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MFI segment — Master File Identification.",
  },
  {
    label: "MRG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MRG segment — Merge Patient Information.",
  },
  {
    label: "MSA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MSA segment — Message Acknowledgment.",
  },
  {
    label: "MSH",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 MSH segment — Message Header.",
  },
  {
    label: "NCK",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NCK segment — System Clock.",
  },
  {
    label: "NDS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NDS segment — Notification Detail.",
  },
  {
    label: "NK1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NK1 segment — Next of Kin / Associated Parties.",
  },
  {
    label: "NPU",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NPU segment — Bed Status Update.",
  },
  {
    label: "NSC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NSC segment — Network Source Information.",
  },
  {
    label: "NST",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NST segment — Network Statistics.",
  },
  {
    label: "NTE",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 NTE segment — Notes and Comments.",
  },
  {
    label: "OBR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OBR segment — Observation Request.",
  },
  {
    label: "OBX",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OBX segment — Observation/Result.",
  },
  {
    label: "ODS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ODS segment — Dietary Orders, Supplements, and Preferences.",
  },
  {
    label: "ODT",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ODT segment — Diet Tray Instructions.",
  },
  {
    label: "OM1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM1 segment — General Segment.",
  },
  {
    label: "OM2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM2 segment — Numeric Observation.",
  },
  {
    label: "OM3",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM3 segment — Categorical Service/Test/Observation.",
  },
  {
    label: "OM4",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM4 segment — Observations that Require Specimens.",
  },
  {
    label: "OM5",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM5 segment — Observation Batteries.",
  },
  {
    label: "OM6",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM6 segment — Observations that are Calculated from Other Observations.",
  },
  {
    label: "OM7",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OM7 segment — Additional Basic Attributes.",
  },
  {
    label: "ORC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ORC segment — Common Order.",
  },
  {
    label: "ORG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ORG segment — Practitioner Organization Unit.",
  },
  {
    label: "OVR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 OVR segment — Override Segment.",
  },
  {
    label: "PCR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PCR segment — Possible Causal Relationship.",
  },
  {
    label: "PD1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PD1 segment — Patient Additional Demographic.",
  },
  {
    label: "PDA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PDA segment — Patient Death and Autopsy.",
  },
  {
    label: "PDC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PDC segment — Product Detail Country.",
  },
  {
    label: "PEO",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PEO segment — Product Experience Observation.",
  },
  {
    label: "PES",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PES segment — Product Experience Sender.",
  },
  {
    label: "PID",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PID segment — Patient Identification.",
  },
  {
    label: "PR1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PR1 segment — Procedures.",
  },
  {
    label: "PRA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PRA segment — Practitioner Detail.",
  },
  {
    label: "PRB",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PRB segment — Problem Detail.",
  },
  {
    label: "PRC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PRC segment — Pricing.",
  },
  {
    label: "PRD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PRD segment — Provider Data.",
  },
  {
    label: "PSH",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PSH segment — Product Summary Header.",
  },
  {
    label: "PTH",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PTH segment — Pathway.",
  },
  {
    label: "PV1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PV1 segment — Patient Visit.",
  },
  {
    label: "PV2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 PV2 segment — Patient Visit - Additional Information.",
  },
  {
    label: "QAK",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QAK segment — Query Acknowledgment.",
  },
  {
    label: "QID",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QID segment — Query Identification.",
  },
  {
    label: "QPD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QPD segment — Query Parameter Definition.",
  },
  {
    label: "QRD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QRD segment — Query Definition (deprecated).",
  },
  {
    label: "QRF",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QRF segment — Query Filter (deprecated).",
  },
  {
    label: "QRI",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 QRI segment — Query Response Instance.",
  },
  {
    label: "RCP",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RCP segment — Response Control Parameter.",
  },
  {
    label: "RDF",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RDF segment — Table Row Definition.",
  },
  {
    label: "RDT",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RDT segment — Table Row Data.",
  },
  {
    label: "RF1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RF1 segment — Referral Information.",
  },
  {
    label: "RGS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RGS segment — Resource Group.",
  },
  {
    label: "RMI",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RMI segment — Risk Management Incident.",
  },
  {
    label: "ROL",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ROL segment — Role.",
  },
  {
    label: "RQ1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RQ1 segment — Requisition Detail-1.",
  },
  {
    label: "RQD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RQD segment — Requisition Detail.",
  },
  {
    label: "RXA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXA segment — Pharmacy/Treatment Administration.",
  },
  {
    label: "RXC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXC segment — Pharmacy/Treatment Component Order.",
  },
  {
    label: "RXD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXD segment — Pharmacy/Treatment Dispense.",
  },
  {
    label: "RXE",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXE segment — Pharmacy/Treatment Encoded Order.",
  },
  {
    label: "RXG",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXG segment — Pharmacy/Treatment Give.",
  },
  {
    label: "RXO",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXO segment — Pharmacy/Treatment Order.",
  },
  {
    label: "RXR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 RXR segment — Pharmacy/Treatment Route.",
  },
  {
    label: "SAC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SAC segment — Specimen Container detail.",
  },
  {
    label: "SCH",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SCH segment — Scheduling Activity Information.",
  },
  {
    label: "SFT",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SFT segment — Software Segment.",
  },
  {
    label: "SID",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SID segment — Substance Identifier.",
  },
  {
    label: "SPM",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SPM segment — Specimen.",
  },
  {
    label: "SPR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 SPR segment — Stored Procedure Request Definition.",
  },
  {
    label: "STF",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 STF segment — Staff Detail.",
  },
  {
    label: "TCC",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 TCC segment — Test Code Configuration.",
  },
  {
    label: "TCD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 TCD segment — Test Code Detail.",
  },
  {
    label: "TQ1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 TQ1 segment — Timing/Quantity.",
  },
  {
    label: "TQ2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 TQ2 segment — Timing/Quantity Relationship.",
  },
  {
    label: "TXA",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 TXA segment — Transcription Document Header.",
  },
  {
    label: "UB1",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 UB1 segment — UB82.",
  },
  {
    label: "UB2",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 UB2 segment — UB92 Data.",
  },
  {
    label: "URD",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 URD segment — U.R.D.",
  },
  {
    label: "URS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 URS segment — U.R.S.",
  },
  {
    label: "VAR",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 VAR segment — Variance.",
  },
  {
    label: "VTQ",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 VTQ segment — Virtual Table Query Request.",
  },
  {
    label: "ZL7",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ZL7 segment — Custom Z-segment.",
  },
  {
    label: "ZCS",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ZCS segment — Custom Z-segment.",
  },
  {
    label: "ZFT",
    kind: "variable",
    detail: "HL7 Segment",
    documentation: "HL7V2 ZFT segment — Custom Z-segment.",
  },
];

/** Brown/function color — helper functions injected into global scope (FUNCTION in Java UI) */
const MIRTH_GLOBALS_FUNCTION: GlobalDef[] = [
  {
    label: "createSegment",
    kind: "function",
    detail: "(segmentName, msg): XML",
    documentation: "Creates a new HL7V2 segment XML element and appends it to msg.",
  },
  {
    label: "createSegmentAfter",
    kind: "function",
    detail: "(segmentName, segment): XML",
    documentation: "Creates a new HL7V2 segment and inserts it after the given segment.",
  },
  {
    label: "addAttachment",
    kind: "function",
    detail: "(type, content, mimeType?): Attachment",
    documentation: "Adds an attachment to the current message. Returns the Attachment object.",
  },
  {
    label: "getAttachments",
    kind: "function",
    detail: "(): Attachment[]",
    documentation: "Returns all attachments associated with the current message.",
  },
];

/** Combined array — used by completion providers (color doesn't matter for completions) */
const MIRTH_GLOBALS: GlobalDef[] = [
  ...MIRTH_GLOBALS_BLUE,
  ...MIRTH_GLOBALS_PURPLE,
  ...MIRTH_GLOBALS_FUNCTION,
];

// ─── BridgeLink member completions (dot-triggered) ─────────────────────────────────

interface MemberDef {
  label: string;
  detail: string;
  documentation: string;
  insertText: string; // snippet syntax
}

const MIRTH_MEMBERS: Record<string, MemberDef[]> = {
  DateUtil: [
    {
      label: "getCurrentDate",
      detail: "(pattern: string): string",
      documentation:
        "Returns the current date/time formatted with the given pattern (e.g. 'yyyyMMdd').",
      insertText: "getCurrentDate('${1:yyyyMMdd}')",
    },
    {
      label: "getDate",
      detail: "(pattern: string, date: string): Date",
      documentation: "Parses a date string using the given SimpleDateFormat pattern.",
      insertText: "getDate('${1:yyyyMMdd}', ${2:dateStr})",
    },
    {
      label: "formatDate",
      detail: "(pattern: string, date: Date): string",
      documentation: "Formats a Date object using the given SimpleDateFormat pattern.",
      insertText: "formatDate('${1:yyyyMMdd}', ${2:date})",
    },
    {
      label: "convertDate",
      detail: "(inPattern: string, outPattern: string, date: string): string",
      documentation: "Converts a date string from one format pattern to another.",
      insertText: "convertDate('${1:yyyyMMdd}', '${2:yyyy-MM-dd}', ${3:dateStr})",
    },
  ],
  FileUtil: [
    {
      label: "read",
      detail: "(fileName: string): string",
      documentation: "Reads the contents of a file as a string.",
      insertText: "read(${1:fileName})",
    },
    {
      label: "readBytes",
      detail: "(fileName: string): byte[]",
      documentation: "Reads the contents of a file as a byte array.",
      insertText: "readBytes(${1:fileName})",
    },
    {
      label: "write",
      detail: "(fileName: string, append: boolean, data: string): void",
      documentation: "Writes a string to a file. Set append=true to append, false to overwrite.",
      insertText: "write(${1:fileName}, ${2:false}, ${3:data})",
    },
    {
      label: "encode",
      detail: "(data: byte[]): string",
      documentation: "Base64-encodes a byte array to a string.",
      insertText: "encode(${1:data})",
    },
    {
      label: "decode",
      detail: "(data: string): byte[]",
      documentation: "Base64-decodes a string to a byte array.",
      insertText: "decode(${1:data})",
    },
    {
      label: "deleteFile",
      detail: "(file: File): boolean",
      documentation: "Deletes the given file. Returns true if successfully deleted.",
      insertText: "deleteFile(${1:file})",
    },
    {
      label: "rtfToPlainText",
      detail: "(message: string, replaceLinebreaksWith: string): string",
      documentation:
        "Converts RTF content to plain text, replacing line breaks with the given string.",
      insertText: "rtfToPlainText(${1:message}, '${2:\\n}')",
    },
  ],
  XmlUtil: [
    {
      label: "prettyPrint",
      detail: "(input: string): string",
      documentation: "Pretty-prints an XML string with proper indentation.",
      insertText: "prettyPrint(${1:xmlStr})",
    },
    {
      label: "encode",
      detail: "(s: string): string",
      documentation: "HTML-entity-encodes special XML characters (&, <, >, etc.).",
      insertText: "encode(${1:str})",
    },
    {
      label: "decode",
      detail: "(entity: string): string",
      documentation: "HTML-entity-decodes an encoded XML string.",
      insertText: "decode(${1:str})",
    },
    {
      label: "toJson",
      detail: "(xmlString: string, normalizeNamespaces?: boolean): string",
      documentation: "Converts an XML string to JSON. Optionally normalizes namespace prefixes.",
      insertText: "toJson(${1:xmlStr})",
    },
  ],
  JsonUtil: [
    {
      label: "prettyPrint",
      detail: "(input: string): string",
      documentation: "Pretty-prints a JSON string with proper indentation.",
      insertText: "prettyPrint(${1:jsonStr})",
    },
    {
      label: "escape",
      detail: "(input: string): string",
      documentation: "Escapes special characters in a JSON string value.",
      insertText: "escape(${1:str})",
    },
    {
      label: "toXml",
      detail: "(jsonString: string, multiplePI?: boolean, prettyPrint?: boolean): string",
      documentation: "Converts a JSON string to XML.",
      insertText: "toXml(${1:jsonStr})",
    },
  ],
  UUIDGenerator: [
    {
      label: "getUUID",
      detail: "(): string",
      documentation: "Generates and returns a new random UUID string.",
      insertText: "getUUID()",
    },
  ],
  HashUtil: [
    {
      label: "generate",
      detail: "(data: any, encoding?: string, algorithm?: string): string",
      documentation: "Generates a hash of the given data. Defaults to SHA-256. Returns hex string.",
      insertText: "generate(${1:data})",
    },
  ],
  EncryptionUtil: [
    {
      label: "encrypt",
      detail: "(data: string): string",
      documentation: "Encrypts a string using the server's configured encryption settings.",
      insertText: "encrypt(${1:data})",
    },
    {
      label: "decrypt",
      detail: "(data: string): string",
      documentation: "Decrypts a previously encrypted string.",
      insertText: "decrypt(${1:data})",
    },
  ],
  SerializerFactory: [
    {
      label: "getSerializer",
      detail: "(dataType: string): IMessageSerializer",
      documentation:
        "Returns a serializer/deserializer for the given data type (e.g. 'HL7V2', 'XML').",
      insertText: "getSerializer('${1:HL7V2}')",
    },
    {
      label: "getDefaultSerializationProperties",
      detail: "(dataType: string): Map",
      documentation: "Returns default serialization properties for the given data type.",
      insertText: "getDefaultSerializationProperties('${1:HL7V2}')",
    },
    {
      label: "getDefaultDeserializationProperties",
      detail: "(dataType: string): Map",
      documentation: "Returns default deserialization properties for the given data type.",
      insertText: "getDefaultDeserializationProperties('${1:HL7V2}')",
    },
  ],
  DatabaseConnectionFactory: [
    {
      label: "createDatabaseConnection",
      detail:
        "(driver: string, address: string, username?: string, password?: string): DatabaseConnection",
      documentation: "Creates a JDBC database connection.",
      insertText:
        "createDatabaseConnection('${1:driver}', '${2:address}', '${3:username}', '${4:password}')",
    },
  ],
  logger: [
    {
      label: "info",
      detail: "(msg: string): void",
      documentation: "Logs a message at INFO level.",
      insertText: "info(${1:msg})",
    },
    {
      label: "error",
      detail: "(msg: string): void",
      documentation: "Logs a message at ERROR level.",
      insertText: "error(${1:msg})",
    },
    {
      label: "warn",
      detail: "(msg: string): void",
      documentation: "Logs a message at WARN level.",
      insertText: "warn(${1:msg})",
    },
    {
      label: "debug",
      detail: "(msg: string): void",
      documentation: "Logs a message at DEBUG level.",
      insertText: "debug(${1:msg})",
    },
  ],
  alerts: [
    {
      label: "sendAlert",
      detail: "(errorMessage: string): void",
      documentation: "Sends an alert notification with the given error message.",
      insertText: "sendAlert(${1:msg})",
    },
  ],
  router: [
    {
      label: "routeMessage",
      detail: "(channelName: string, message: string): Response",
      documentation: "Routes a raw message string to another channel by name.",
      insertText: "routeMessage('${1:channelName}', ${2:message})",
    },
    {
      label: "routeMessageByChannelId",
      detail: "(channelId: string, message: string): Response",
      documentation: "Routes a raw message string to another channel by its UUID.",
      insertText: "routeMessageByChannelId('${1:channelId}', ${2:message})",
    },
  ],
  // Shared Map methods — applied to channelMap, globalMap, sourceMap, etc.
  _map: [
    {
      label: "get",
      detail: "(key: string): any",
      documentation: "Returns the value associated with the given key.",
      insertText: "get('${1:key}')",
    },
    {
      label: "put",
      detail: "(key: string, value: any): void",
      documentation: "Stores a value under the given key.",
      insertText: "put('${1:key}', ${2:value})",
    },
    {
      label: "containsKey",
      detail: "(key: string): boolean",
      documentation: "Returns true if the map contains the given key.",
      insertText: "containsKey('${1:key}')",
    },
    {
      label: "remove",
      detail: "(key: string): any",
      documentation: "Removes and returns the value for the given key.",
      insertText: "remove('${1:key}')",
    },
    {
      label: "keySet",
      detail: "(): Set<string>",
      documentation: "Returns the set of all keys in this map.",
      insertText: "keySet()",
    },
    {
      label: "size",
      detail: "(): number",
      documentation: "Returns the number of entries in this map.",
      insertText: "size()",
    },
    {
      label: "isEmpty",
      detail: "(): boolean",
      documentation: "Returns true if this map contains no entries.",
      insertText: "isEmpty()",
    },
  ],
  // ─── DatabaseConnection methods (returned by DatabaseConnectionFactory.createDatabaseConnection) ──
  // Source: com.mirth.connect.server.userutil.DatabaseConnection
  _dbconn: [
    {
      label: "executeCachedQuery",
      detail: "(expression: string): CachedRowSet",
      documentation:
        "Executes a SELECT statement and returns a cached, scrollable result set. The result set is disconnected from the database and can be iterated multiple times.",
      insertText: 'executeCachedQuery("${1:SELECT * FROM table}")',
    },
    {
      label: "executeCachedQuery",
      detail: "(expression: string, parameters: List): CachedRowSet",
      documentation:
        "Executes a parameterized SELECT statement with a List of parameters for the ? placeholders.",
      insertText: 'executeCachedQuery("${1:SELECT * FROM t WHERE id=?}", ${2:params})',
    },
    {
      label: "executeUpdate",
      detail: "(expression: string): int",
      documentation:
        "Executes an INSERT, UPDATE, or DELETE statement. Returns the number of rows affected.",
      insertText: 'executeUpdate("${1:UPDATE table SET col=val WHERE id=?}")',
    },
    {
      label: "executeUpdate",
      detail: "(expression: string, parameters: List): int",
      documentation:
        "Executes a parameterized INSERT/UPDATE/DELETE with a List of parameters for the ? placeholders.",
      insertText: 'executeUpdate("${1:UPDATE table SET col=? WHERE id=?}", ${2:params})',
    },
    {
      label: "executeUpdateAndGetGeneratedKeys",
      detail: "(expression: string): CachedRowSet",
      documentation:
        "Executes an INSERT statement and returns the auto-generated keys (e.g. identity/serial columns).",
      insertText: 'executeUpdateAndGetGeneratedKeys("${1:INSERT INTO table (col) VALUES (?)}")',
    },
    {
      label: "close",
      detail: "(): void",
      documentation:
        "Closes the database connection and releases all JDBC resources. Always call this in a finally block.",
      insertText: "close()",
    },
    {
      label: "setAutoCommit",
      detail: "(autoCommit: boolean): void",
      documentation:
        "Sets auto-commit mode. Pass false to manage transactions manually; call commit() or rollback() to finish.",
      insertText: "setAutoCommit(${1:false})",
    },
    {
      label: "commit",
      detail: "(): void",
      documentation: "Commits the current transaction. Only relevant when auto-commit is disabled.",
      insertText: "commit()",
    },
    {
      label: "rollback",
      detail: "(): void",
      documentation:
        "Rolls back the current transaction. Only relevant when auto-commit is disabled.",
      insertText: "rollback()",
    },
    {
      label: "getAddress",
      detail: "(): string",
      documentation: "Returns the JDBC connection URL this connection was opened with.",
      insertText: "getAddress()",
    },
    {
      label: "getConnection",
      detail: "(): java.sql.Connection",
      documentation:
        "Returns the underlying java.sql.Connection. Use this for advanced JDBC operations not covered by the helper methods.",
      insertText: "getConnection()",
    },
  ],
  // E4X XML members — applied to `msg` and `tmp` (the transformed XML documents).
  // Mirrors Java ReferenceListFactory.addE4XReferences(), which keys the full E4X
  // method set to beforeDotTextList = ["msg", "tmp"]. Names, signatures, and docs
  // are copied from that source of truth.
  _e4x: [
    {
      label: "addNamespace",
      detail: "(namespace: Namespace | string): XML",
      documentation:
        "Adds a namespace declaration to the in-scope namespaces for this XML object and returns this XML object.",
      insertText: "addNamespace(${1:namespace})",
    },
    {
      label: "appendChild",
      detail: "(child: XML): XML",
      documentation:
        "Appends the given child to the end of this XML object's properties and returns this XML object.",
      insertText: "appendChild(${1:child})",
    },
    {
      label: "attribute",
      detail: "(attributeName: string): XMLList",
      documentation:
        "Returns an XMLList containing zero or one XML attributes associated with this XML object that have the given name.",
      insertText: "attribute(${1:attributeName})",
    },
    {
      label: "attributes",
      detail: "(): XMLList",
      documentation: "Returns an XMLList containing the XML attributes of this object.",
      insertText: "attributes()",
    },
    {
      label: "child",
      detail: "(propertyName: string | number): XML",
      documentation:
        "Returns the list of children in this XML object matching the given property name or ordinal index.",
      insertText: "child(${1:propertyName})",
    },
    {
      label: "childIndex",
      detail: "(): number",
      documentation:
        "Returns the ordinal position of this XML object within the context of its parent.",
      insertText: "childIndex()",
    },
    {
      label: "children",
      detail: "(): XMLList",
      documentation:
        "Returns an XMLList containing all the properties of this XML object in order.",
      insertText: "children()",
    },
    {
      label: "comments",
      detail: "(): XMLList",
      documentation:
        "Returns an XMLList containing the properties of this XML object that represent XML comments.",
      insertText: "comments()",
    },
    {
      label: "contains",
      detail: "(value: XML | XMLList): boolean",
      documentation: "Returns the result of comparing this XML object with the given value.",
      insertText: "contains(${1:value})",
    },
    {
      label: "copy",
      detail: "(): XML",
      documentation:
        "Returns a deep copy of this XML object with the internal parent property set to null.",
      insertText: "copy()",
    },
    {
      label: "descendants",
      detail: "(name?: string): XMLList",
      documentation:
        "Returns all the XML-valued descendants of this XML object with the given name; when omitted, returns all descendants.",
      insertText: "descendants(${1})",
    },
    {
      label: "elements",
      detail: "(name?: string): XMLList",
      documentation:
        "Returns an XMLList of the child elements of this XML object with the given name; when omitted, returns all child elements.",
      insertText: "elements(${1})",
    },
    {
      label: "hasOwnProperty",
      detail: "(P: object): boolean",
      documentation:
        "Returns a Boolean indicating whether this object has the property specified by P.",
      insertText: "hasOwnProperty(${1:P})",
    },
    {
      label: "hasComplexContent",
      detail: "(): boolean",
      documentation:
        "Returns a Boolean indicating whether this XML object contains complex content (child elements).",
      insertText: "hasComplexContent()",
    },
    {
      label: "hasSimpleContent",
      detail: "(): boolean",
      documentation:
        "Returns a Boolean indicating whether this XML object contains simple content.",
      insertText: "hasSimpleContent()",
    },
    {
      label: "inScopeNamespaces",
      detail: "(): Namespace[]",
      documentation:
        "Returns an Array of Namespace objects representing the namespaces in scope for this XML object.",
      insertText: "inScopeNamespaces()",
    },
    {
      label: "insertChildAfter",
      detail: "(child1: XML, child2: XML): XML",
      documentation: "Inserts child2 after child1 in this XML object and returns this XML object.",
      insertText: "insertChildAfter(${1:child1}, ${2:child2})",
    },
    {
      label: "insertChildBefore",
      detail: "(child1: XML, child2: XML): XML",
      documentation: "Inserts child2 before child1 in this XML object and returns this XML object.",
      insertText: "insertChildBefore(${1:child1}, ${2:child2})",
    },
    {
      label: "length",
      detail: "(): number",
      documentation: "Always returns the integer 1 for XML objects.",
      insertText: "length()",
    },
    {
      label: "localName",
      detail: "(): string",
      documentation: "Returns the local name portion of the qualified name of this XML object.",
      insertText: "localName()",
    },
    {
      label: "name",
      detail: "(): QName",
      documentation: "Returns the qualified name associated with this XML object.",
      insertText: "name()",
    },
    {
      label: "namespace",
      detail: "(prefix?: string): Namespace",
      documentation:
        "Returns the Namespace associated with the qualified name of this XML object, or the in-scope namespace matching the given prefix.",
      insertText: "namespace(${1})",
    },
    {
      label: "namespaceDeclarations",
      detail: "(): Namespace[]",
      documentation:
        "Returns an Array of Namespace objects representing the namespace declarations associated with this XML object.",
      insertText: "namespaceDeclarations()",
    },
    {
      label: "nodeKind",
      detail: "(): string",
      documentation: "Returns a string representing the class of this XML object.",
      insertText: "nodeKind()",
    },
    {
      label: "normalize",
      detail: "(): XML",
      documentation:
        "Merges adjacent text nodes and eliminates empty text nodes, then returns this XML object.",
      insertText: "normalize()",
    },
    {
      label: "parent",
      detail: "(): XML",
      documentation: "Returns the parent of this XML object.",
      insertText: "parent()",
    },
    {
      label: "processingInstructions",
      detail: "(name?: string): XMLList",
      documentation:
        "Returns an XMLList of the processing-instruction children of this XML object with the given name; when omitted, returns all.",
      insertText: "processingInstructions(${1})",
    },
    {
      label: "prependChild",
      detail: "(child: XML): XML",
      documentation:
        "Inserts the given child into this object prior to its existing properties and returns this XML object.",
      insertText: "prependChild(${1:child})",
    },
    {
      label: "propertyIsEnumerable",
      detail: "(P: object): boolean",
      documentation:
        "Returns a Boolean indicating whether the property P will be included when this XML object is used in a for-in statement.",
      insertText: "propertyIsEnumerable(${1:P})",
    },
    {
      label: "removeNamespace",
      detail: "(namespace: Namespace | string): XML",
      documentation:
        "Removes the given namespace from the in-scope namespaces of this object and its descendants, then returns a copy.",
      insertText: "removeNamespace(${1:namespace})",
    },
    {
      label: "replace",
      detail: "(propertyName: string | number, value: XML): XML",
      documentation:
        "Replaces the XML properties matching propertyName with value and returns this XML object.",
      insertText: "replace(${1:propertyName}, ${2:value})",
    },
    {
      label: "setChildren",
      detail: "(value: XML | XMLList): XML",
      documentation:
        "Replaces the XML properties of this XML object with a new set of properties from value and returns this XML object.",
      insertText: "setChildren(${1:value})",
    },
    {
      label: "setLocalName",
      detail: "(name: string): void",
      documentation: "Replaces the local name of this XML object with the given name.",
      insertText: "setLocalName(${1:name})",
    },
    {
      label: "setName",
      detail: "(name: string | QName): void",
      documentation:
        "Replaces the name of this XML object with a QName constructed from the given name.",
      insertText: "setName(${1:name})",
    },
    {
      label: "setNamespace",
      detail: "(ns: Namespace | string): void",
      documentation:
        "Replaces the namespace associated with the name of this XML object with the given namespace.",
      insertText: "setNamespace(${1:ns})",
    },
    {
      label: "text",
      detail: "(): XMLList",
      documentation:
        "Returns an XMLList containing all XML properties of this XML object that represent text nodes.",
      insertText: "text()",
    },
    {
      label: "toString",
      detail: "(): string",
      documentation: "Returns a string representation of this XML object.",
      insertText: "toString()",
    },
    {
      label: "toXMLString",
      detail: "(): string",
      documentation:
        "Returns an XML-encoded string representation of this XML object, always including start tag, attributes, and end tag.",
      insertText: "toXMLString()",
    },
    {
      label: "valueOf",
      detail: "(): XML",
      documentation: "Returns this XML object.",
      insertText: "valueOf()",
    },
  ],
};

/** Globals that share the generic Map member completions. */
const MAP_GLOBALS = new Set([
  "channelMap",
  "globalMap",
  "globalChannelMap",
  "sourceMap",
  "responseMap",
  "connectorMap",
  "configurationMap",
  "$c",
  "$co",
  "$s",
  "$gc",
  "$g",
  "$cfg",
  "$r",
]);

/** Globals that are E4X XML documents and share the E4X member completions. */
const E4X_GLOBALS = new Set(["msg", "tmp"]);

/**
 * Resolves the dot-member completion list for the object identifier that
 * appears immediately before a ".". Covers the statically-known objects
 * (DateUtil, logger, …), the shared Map members (channelMap, $c, …), and the
 * E4X XML members (msg, tmp). DatabaseConnection inference — which needs the
 * full model text — is handled separately by the providers so this stays a
 * cheap, pure, Monaco-free lookup shared by the completion and hover providers.
 *
 * @returns the member list, or null when the object has no known members.
 */
export function resolveRhinoMembers(objName: string): MemberDef[] | null {
  // Internal sentinel keys (_map, _e4x, _dbconn) are reached only via the
  // MAP_GLOBALS/E4X_GLOBALS mappings below — never directly by a user
  // identifier — so reject any leading-underscore name up front.
  if (objName.startsWith("_")) return null;
  // Use hasOwnProperty so inherited Object.prototype keys (a variable literally
  // named `toString`, `constructor`, `valueOf`, …) don't resolve to an
  // inherited function masquerading as a MemberDef[].
  let members = Object.prototype.hasOwnProperty.call(MIRTH_MEMBERS, objName)
    ? MIRTH_MEMBERS[objName]
    : undefined;
  if (!members && MAP_GLOBALS.has(objName)) members = MIRTH_MEMBERS["_map"];
  if (!members && E4X_GLOBALS.has(objName)) members = MIRTH_MEMBERS["_e4x"];
  return members ?? null;
}

// ─── JS snippet completions ───────────────────────────────────────────────────

interface SnippetDef {
  label: string;
  detail: string;
  documentation: string;
  insertText: string; // Monaco snippet syntax
}

const JS_SNIPPETS: SnippetDef[] = [
  {
    label: "if",
    detail: "if statement",
    documentation: "Insert an if statement.",
    insertText: "if (${1:condition}) {\n\t${2}\n}",
  },
  {
    label: "if-else",
    detail: "if-else statement",
    documentation: "Insert an if-else statement.",
    insertText: "if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}",
  },
  {
    label: "for",
    detail: "for loop",
    documentation: "Insert a for loop.",
    insertText: "for (var ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t${3}\n}",
  },
  {
    label: "for-in",
    detail: "for-in loop",
    documentation: "Insert a for-in loop over object keys.",
    insertText: "for (var ${1:key} in ${2:object}) {\n\t${3}\n}",
  },
  {
    label: "while",
    detail: "while loop",
    documentation: "Insert a while loop.",
    insertText: "while (${1:condition}) {\n\t${2}\n}",
  },
  {
    label: "do-while",
    detail: "do-while loop",
    documentation: "Insert a do-while loop.",
    insertText: "do {\n\t${1}\n} while (${2:condition});",
  },
  {
    label: "try",
    detail: "try-catch block",
    documentation: "Insert a try-catch block.",
    insertText: "try {\n\t${1}\n} catch (${2:e}) {\n\t${3:logger.error(${2:e})}\n}",
  },
  {
    label: "try-finally",
    detail: "try-catch-finally block",
    documentation: "Insert a try-catch-finally block.",
    insertText:
      "try {\n\t${1}\n} catch (${2:e}) {\n\t${3:logger.error(${2:e})}\n} finally {\n\t${4}\n}",
  },
  {
    label: "function",
    detail: "function declaration",
    documentation: "Insert a named function declaration.",
    insertText: "function ${1:name}(${2:params}) {\n\t${3}\n}",
  },
  {
    label: "switch",
    detail: "switch statement",
    documentation: "Insert a switch statement.",
    insertText:
      "switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n}",
  },
  {
    label: "var",
    detail: "var declaration",
    documentation: "Insert a var declaration.",
    insertText: "var ${1:name} = ${2:value};",
  },
  {
    label: "return",
    detail: "return statement",
    documentation: "Insert a return statement.",
    insertText: "return ${1:value};",
  },
  {
    label: "log",
    detail: "logger.info(...)",
    documentation: "Insert a logger.info call.",
    insertText: "logger.info(${1:msg});",
  },
];

// ─── Custom language ID ───────────────────────────────────────────────────────
// Using a custom language instead of "javascript" so Monaco's built-in JS
// language service never fires — it only activates for the "javascript" language
// ID and would otherwise inject completions irrelevant to Rhino (Any, arg1, etc.).

/** Monaco language ID for BridgeLink Rhino JS editors. Pass as `language={RHINO_LANG_ID}`. */
export const RHINO_LANG_ID = "rhino-js";

// Internal alias
const LANG_ID = RHINO_LANG_ID;

/**
 * Word pattern for the rhino-js language — VS Code's default word regexp minus
 * the separators that are valid in JS identifiers (`$`, `_`). Whitespace must be
 * excluded via `\s` (the class), NOT `\\s` (a literal backslash + letter "s"):
 * the escaped form made whitespace part of "words" and the letter "s" a
 * separator, so the occurrence highlighter gray-highlighted tabs/spaces and
 * multi-word spans at the bare cursor.
 */
export const RHINO_WORD_PATTERN = /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[\]{}\\|;:'",.<>/?\s]+)/g;

// Version tag — bump this whenever the tokenizer or theme changes to force
// re-registration even if the guard key is already set from an older build.
const LANG_VERSION = "v10";

// Stored on globalThis so the one-time registration survives HMR and remounts.
const _g = globalThis as Record<string, unknown>;

// ─── Editor context registry ──────────────────────────────────────────────────

export interface EditorContext {
  /** BridgeLink ContextType for this editor, used to filter code templates. */
  contextType: ContextType;
  /** Channel ID — present for channel-scoped editors; absent for global scripts. */
  channelId?: string;
}

/**
 * Per-model URI registry that maps each Monaco editor instance to its
 * BridgeLink context. Providers are globally registered but read this map
 * at call time so each editor gets context-appropriate completions.
 */
const _editorContextMap = new Map<string, EditorContext>();

/**
 * Register (or clear) the BridgeLink context for a Monaco editor instance.
 * Call with `ctx = null` on unmount to clean up.
 *
 * @param modelUri - `model.uri.toString()` from the Monaco editor's onMount callback
 * @param ctx      - Context object, or null to deregister
 */
export function setEditorContext(modelUri: string, ctx: EditorContext | null): void {
  if (ctx === null) {
    _editorContextMap.delete(modelUri);
  } else {
    _editorContextMap.set(modelUri, ctx);
  }
}

/**
 * Cleanup-safe variant of setEditorContext used in onWillDispose handlers.
 * Only deletes the entry if it still references the same context object the
 * caller registered. Guards against the rare case where Monaco re-binds a
 * model URI to a fresh context before the previous model's dispose handler
 * fires — without this check the old dispose handler would clobber the new
 * mount's registration.
 */
export function clearEditorContextIfMatches(modelUri: string, ctx: EditorContext): void {
  if (_editorContextMap.get(modelUri) === ctx) {
    _editorContextMap.delete(modelUri);
  }
}

/**
 * Returns the registered EditorContext for the given model URI, or null if
 * the editor has not registered a context.
 */
export function getEditorContext(modelUri: string): EditorContext | null {
  return _editorContextMap.get(modelUri) ?? null;
}

// ─── rhino-js Monarch language definition ─────────────────────────────────────

// Build per-category name lists for the Monarch tokenizer
const mirthBlueNames = MIRTH_GLOBALS_BLUE.map((g) => g.label);
const mirthPurpleNames = MIRTH_GLOBALS_PURPLE.map((g) => g.label);
const mirthFunctionNames = MIRTH_GLOBALS_FUNCTION.map((g) => g.label);

/**
 * Builds the Monarch language definition for `rhino-js`.
 *
 * Copied from Monaco's built-in JavaScript/TypeScript definition so we get identical
 * syntax highlighting without the JS language service. Three separate @cases lists
 * give us three distinct colors matching the Java UI.
 *
 * Exported as a builder (rather than inlined in {@link registerRhinoLanguage}) so the
 * tokenizer can be unit-tested against Monaco's own Monarch compiler without a live
 * editor — see `__tests__/unit/monaco-rhino-e4x-tokenizer.test.ts`.
 */
export function buildRhinoMonarchLanguage(): MonacoType.languages.IMonarchLanguage {
  return {
    defaultToken: "invalid",
    tokenPostfix: ".js",
    keywords: [
      "abstract",
      "any",
      "as",
      "asserts",
      "bigint",
      "boolean",
      "break",
      "case",
      "catch",
      "class",
      "continue",
      "const",
      "constructor",
      "debugger",
      "declare",
      "default",
      "delete",
      "do",
      "else",
      "enum",
      "export",
      "extends",
      "false",
      "finally",
      "for",
      "from",
      "function",
      "get",
      "if",
      "implements",
      "import",
      "in",
      "infer",
      "instanceof",
      "interface",
      "is",
      "keyof",
      "let",
      "module",
      "never",
      "new",
      "null",
      "number",
      "object",
      "out",
      "package",
      "private",
      "protected",
      "public",
      "override",
      "readonly",
      "require",
      "global",
      "return",
      "satisfies",
      "set",
      "static",
      "string",
      "super",
      "switch",
      "symbol",
      "this",
      "throw",
      "true",
      "try",
      "type",
      "typeof",
      "undefined",
      "unique",
      "unknown",
      "var",
      "void",
      "while",
      "with",
      "yield",
      "async",
      "await",
      "of",
    ],
    mirthBlue: mirthBlueNames,
    mirthPurple: mirthPurpleNames,
    mirthFunction: mirthFunctionNames,
    operators: [
      "<=",
      ">=",
      "==",
      "!=",
      "===",
      "!==",
      "=>",
      "+",
      "-",
      "**",
      "*",
      "/",
      "%",
      "++",
      "--",
      "<<",
      "</",
      ">>",
      ">>>",
      "&",
      "|",
      "^",
      "!",
      "~",
      "&&",
      "||",
      "??",
      "?",
      ":",
      "=",
      "+=",
      "-=",
      "*=",
      "**=",
      "/=",
      "%=",
      "<<=",
      ">>=",
      ">>>=",
      "&=",
      "|=",
      "^=",
      "@",
    ],
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
    regexpctl: /[(){}\[\]\$\^|\-*+?\.]/,
    regexpesc: /\\(?:[bBdDfnrstvwWn0\\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,
    tokenizer: {
      root: [[/[{}]/, "delimiter.bracket"], { include: "common" }],
      common: [
        // Lowercase/$ identifiers: blue globals first, then purple, then function, then keywords
        [
          /#?[a-z_$][\w$]*/,
          {
            cases: {
              "@mirthBlue": "mirthGlobalBlue",
              "@mirthPurple": "mirthGlobalPurple",
              "@mirthFunction": "mirthGlobalFunction",
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        // Uppercase identifiers: purple (DateUtil, FileUtil…) or plain type
        [
          /[A-Z][\w$]*/,
          {
            cases: {
              "@mirthPurple": "mirthGlobalPurple",
              "@mirthBlue": "mirthGlobalBlue",
              "@default": "type.identifier",
            },
          },
        ],
        { include: "@whitespace" },
        [
          /\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/,
          { token: "regexp", bracket: "@open", next: "@regexp" },
        ],
        [/[()\[\]]/, "@brackets"],
        // E4X XML literals — must come before the generic <> bracket rule.
        // Consume the full <tagName so the tag name is colored as tag.xml, not as an attribute.
        // The lookahead requires the tag to plausibly complete as XML on this line
        // (`>`, `/>`, `{`, or an attribute `name=`), so space-less relational code like
        // `count<max`, `i<len;` or `a<b && c>d` stays JavaScript instead of being
        // mis-read as a tag (and, post-switchTo, graying out the rest of the file).
        [
          /<[a-zA-Z_:][a-zA-Z0-9_:.-]*(?=\s*(?:\/?>|\{|[a-zA-Z_:][\w:.-]*\s*=))/,
          { token: "tag.xml", next: "@xmlTag" },
        ],
        [/<\/[a-zA-Z_:][a-zA-Z0-9_:.-]*/, { token: "tag.xml", next: "@xmlClosingTag" }],
        // Anonymous XMLList literal <>…</> — no tag name, straight into content.
        [/<>/, { token: "tag.xml", next: "@xmlContent" }],
        [/[<>](?!@symbols)/, "@brackets"],
        [/!(?=([^=]|$))/, "delimiter"],
        [/@symbols/, { cases: { "@operators": "delimiter", "@default": "" } }],
        [/(@digits)[eE]([\-+]?(@digits))?/, "number.float"],
        [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, "number.float"],
        [/0[xX](@hexdigits)n?/, "number.hex"],
        [/0[oO]?(@octaldigits)n?/, "number.octal"],
        [/0[bB](@binarydigits)n?/, "number.binary"],
        [/(@digits)n?/, "number"],
        [/[;,.]/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/`/, "string", "@string_backtick"],
      ],
      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*\*(?!\/)/, "comment.doc", "@jsdoc"],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],
      jsdoc: [
        [/[^\/*]+/, "comment.doc"],
        [/\*\//, "comment.doc", "@pop"],
        [/[\/*]/, "comment.doc"],
      ],
      regexp: [
        [
          /(\{)(\d+(?:,\d*)?)(\})/,
          ["regexp.escape.control", "regexp.escape.control", "regexp.escape.control"],
        ],
        [
          /(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/,
          ["regexp.escape.control", { token: "regexp.escape.control", next: "@regexrange" }],
        ],
        [/(\()(\?:|\?=|\?!)/, ["regexp.escape.control", "regexp.escape.control"]],
        [/[()]/, "regexp.escape.control"],
        [/@regexpctl/, "regexp.escape.control"],
        [/[^\\\/]/, "regexp"],
        [/@regexpesc/, "regexp.escape"],
        [/\\./, "regexp.invalid"],
        [
          /(\/)([dgimsuy]*)/,
          [{ token: "regexp", bracket: "@close", next: "@pop" }, "keyword.other"],
        ],
      ],
      regexrange: [
        [/-/, "regexp.escape.control"],
        [/\^/, "regexp.invalid"],
        [/@regexpesc/, "regexp.escape"],
        [/[^\]]/, "regexp"],
        [/\]/, { token: "regexp.escape.control", next: "@pop", bracket: "@close" }],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"],
      ],
      string_backtick: [
        [/\$\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/[^\\`$]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/`/, "string", "@pop"],
      ],
      bracketCounting: [
        [/\{/, "delimiter.bracket", "@bracketCounting"],
        [/\}/, "delimiter.bracket", "@pop"],
        { include: "common" },
      ],
      // E4X XML states.
      //
      // xmlTag handles the opening tag and its attributes. A self-closing `/>` pops
      // back to the caller (JS or a parent xmlContent); a plain `>` switchTo's into
      // xmlContent WITHOUT growing the stack, so each opening tag adds exactly one
      // content level and its matching `</tag>` pops exactly one. Nesting therefore
      // stays balanced (the earlier "always pop on >" design could not tokenize the
      // text between tags — it fell through to JS, mis-coloring words and apostrophes).
      xmlTag: [
        [/\s+/, ""],
        [/\/>/, { token: "tag.xml", next: "@pop" }],
        [/>/, { token: "tag.xml", switchTo: "@xmlContent" }],
        [/[a-zA-Z_:][a-zA-Z0-9_:.-]*/, "attribute.name.xml"],
        [/=/, "delimiter.xml"],
        [/"/, { token: "attribute.value.xml", next: "@xmlAttrDouble" }],
        [/'/, { token: "attribute.value.xml", next: "@xmlAttrSingle" }],
        [/\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
      ],
      // Text content between tags. Plain text is inert (token "text.xml", no theme
      // rule → default foreground), matching the Java client where E4X inner text is
      // uncolored. `{ expr }` interpolation re-enters full JS via bracketCounting;
      // child elements, CDATA and comments get their own handling.
      xmlContent: [
        [/<!\[CDATA\[/, { token: "delimiter.xml", next: "@xmlCdata" }],
        [/<!--/, { token: "comment.xml", next: "@xmlComment" }],
        // Named closing tag — switchTo (not a bare pop) so the `>` may land on a later
        // line: xmlClosingTag consumes the `>` and pops, staying stack-balanced.
        [/<\/[a-zA-Z_:][a-zA-Z0-9_:.-]*/, { token: "tag.xml", switchTo: "@xmlClosingTag" }],
        [/<\/>/, { token: "tag.xml", next: "@pop" }],
        [/<>/, { token: "tag.xml", next: "@xmlContent" }],
        // Child element — same lookahead guard as the top-level open rule.
        [
          /<[a-zA-Z_:][a-zA-Z0-9_:.-]*(?=\s*(?:\/?>|\{|[a-zA-Z_:][\w:.-]*\s*=))/,
          { token: "tag.xml", next: "@xmlTag" },
        ],
        [/\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/[^<{]+/, "text.xml"],
        [/</, "text.xml"],
      ],
      xmlCdata: [
        [/[^\]]+/, "text.xml"],
        [/\]\]>/, { token: "delimiter.xml", next: "@pop" }],
        [/\]/, "text.xml"],
      ],
      xmlComment: [
        [/[^-]+/, "comment.xml"],
        [/-->/, { token: "comment.xml", next: "@pop" }],
        [/-/, "comment.xml"],
      ],
      xmlAttrDouble: [
        [/[^"\\{]+/, "attribute.value.xml"],
        [/\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/"/, { token: "attribute.value.xml", next: "@pop" }],
      ],
      xmlAttrSingle: [
        [/[^'\\{]+/, "attribute.value.xml"],
        [/\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/'/, { token: "attribute.value.xml", next: "@pop" }],
      ],
      // Closing tag: </ consumed by root.common, this state handles the > only
      xmlClosingTag: [[/\s*>/, { token: "tag.xml", next: "@pop" }]],
    },
  };
}

// ─── registerRhinoLanguage ────────────────────────────────────────────────────

/**
 * Registers (or re-registers) the "rhino-js" language, tokenizer, themes, and
 * completion providers on a Monaco instance.
 *
 * Safe to call from multiple editor instances — language/theme registration is
 * idempotent (Monaco dedupes), and completion providers are registered only once
 * per build version via a globalThis guard flag.
 */
export function registerRhinoLanguage(monaco: typeof MonacoType) {
  // Always re-apply tokenizer + theme (idempotent). Only skip provider
  // registration if already done this session (providers stack if duplicated).
  // NOTE: Use a stable key (no version) — globalThis resets on each page load
  // so versioning is unnecessary and causes HMR duplicate registrations.
  // Key includes LANG_VERSION so bumping the version forces re-registration
  // even during HMR. Old providers from prior versions remain in Monaco but are
  // harmless — they return empty for anything the new providers now handle.
  const providersKey = `__blRhinoProviders_${LANG_VERSION}`;
  const providersAlreadyRegistered = !!_g[providersKey];
  _g[providersKey] = true;

  // Register the custom language (safe to call multiple times — Monaco dedupes)
  monaco.languages.register({ id: LANG_ID, aliases: ["Rhino JS", "rhino-js"] });

  // Language configuration — required for auto-closing, bracket matching, and
  // on-Enter indentation rules. Without this the custom language ID gets no
  // bracket/indent behaviour (unlike the built-in "javascript" language ID).
  monaco.languages.setLanguageConfiguration(LANG_ID, {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: "`", close: "`", notIn: ["string"] },
      { open: "/**", close: " */", notIn: ["string"] },
    ],
    autoCloseBefore: ";:.,=}])>` \n\t",
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    wordPattern: RHINO_WORD_PATTERN,
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"'`]*$/,
      decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
    },
    onEnterRules: [
      // JSDoc comment continuation: /** → *
      {
        beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
        action: { indentAction: monaco.languages.IndentAction.None, appendText: " * " },
      },
      // Inside a JSDoc block: * → *
      {
        beforeText: /^(\t|[ ])*[ ]\*([ ]([^*]|\*(?!\/))*)?$/,
        previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
        action: { indentAction: monaco.languages.IndentAction.None, appendText: "* " },
      },
      // End of JSDoc block: */ → remove extra space
      {
        beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
        action: { indentAction: monaco.languages.IndentAction.None, removeText: 1 },
      },
      // Enter inside { | } (auto-closed brace): expand to indented block
      {
        beforeText: /^.*\{$/,
        afterText: /^\}/,
        action: { indentAction: monaco.languages.IndentAction.IndentOutdent },
      },
      // Enter after { with no immediate }: indent the next line
      {
        beforeText: /^.*\{$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });

  monaco.languages.setMonarchTokensProvider(LANG_ID, buildRhinoMonarchLanguage());

  // Theme — VS light base with colors matching the Java UI (MirthJavaScriptTokenMaker):
  //   Blue   (#0000FF) — context vars, maps, shorthand helpers  (MARKUP_TAG_NAME)
  //   Purple (#7B2D8B) — utility classes, logger, HL7 segments  (LITERAL_BOOLEAN)
  //   Brown  (#7B5000) — helper functions                        (FUNCTION)
  // tokenPostfix ".js" means tokens are suffixed, e.g. "mirthGlobalBlue.js"
  monaco.editor.defineTheme("mirth-js", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "mirthGlobalBlue.js", foreground: "0000FF" },
      { token: "mirthGlobalPurple.js", foreground: "7B2D8B" },
      { token: "mirthGlobalFunction.js", foreground: "7B5000" },
      // E4X XML tokens — approximate RSyntaxTextArea XML-in-JS colors
      { token: "tag.xml.js", foreground: "800000" },
      { token: "attribute.name.xml.js", foreground: "FF0000" },
      { token: "attribute.value.xml.js", foreground: "0000FF" },
      { token: "comment.xml.js", foreground: "3F7F5F" },
    ],
    // Shade the line-number gutter so it reads as a non-editable margin,
    // delineated from the white edit area item 4).
    colors: {
      "editorGutter.background": "#f3f4f6",
      "editorLineNumber.foreground": "#9ca3af",
      "editorLineNumber.activeForeground": "#374151",
    },
  });
  monaco.editor.defineTheme("mirth-js-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "mirthGlobalBlue.js", foreground: "6CB6FF" }, // light blue
      { token: "mirthGlobalPurple.js", foreground: "D4AAFF" }, // light lavender
      { token: "mirthGlobalFunction.js", foreground: "FFAB70" }, // light amber
      // E4X XML tokens
      { token: "tag.xml.js", foreground: "F28B82" }, // salmon
      { token: "attribute.name.xml.js", foreground: "9CDCFE" }, // light blue
      { token: "attribute.value.xml.js", foreground: "CE9178" }, // orange-tan
      { token: "comment.xml.js", foreground: "6A9955" }, // muted green
    ],
    // Shade the line-number gutter so it reads as a non-editable margin,
    // delineated from the edit area item 4). Values match VS Code's
    // dark gutter tone so it stays subtle against the vs-dark editor background.
    colors: {
      "editorGutter.background": "#252526",
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#c6c6c6",
    },
  });

  // ── Completion providers — only register once per version ───────────────────
  if (providersAlreadyRegistered) return;

  // ── Completion Provider 1: top-level BridgeLink globals ──────────────────────────
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      // Bail out when cursor is after a dot — Provider 2 handles that
      const charBeforeWord =
        word.startColumn > 2 ? model.getLineContent(position.lineNumber)[word.startColumn - 2] : "";
      if (charBeforeWord === ".") return { suggestions: [] };

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: MIRTH_GLOBALS.map((g) => ({
          label: g.label,
          kind:
            g.kind === "variable"
              ? monaco.languages.CompletionItemKind.Variable
              : g.kind === "class"
                ? monaco.languages.CompletionItemKind.Class
                : monaco.languages.CompletionItemKind.Function,
          detail: g.detail,
          documentation: g.documentation,
          insertText: g.label,
          range,
        })),
      };
    },
  });

  // ── Completion Provider 2: dot-triggered member completions ─────────────────
  // Handles both "." trigger (cursor right after dot) and manual trigger
  // (Ctrl+Space) when cursor is after "identifier." with a partial method name.
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    triggerCharacters: ["."],
    provideCompletionItems(model, position, context) {
      const line = model.getLineContent(position.lineNumber);
      let beforeDot: string;
      let replaceStart: number; // startColumn for the replacement range

      if (context.triggerCharacter === ".") {
        // Cursor is right after the dot — no partial method name typed yet
        beforeDot = line.substring(0, position.column - 2);
        replaceStart = position.column;
      } else {
        // Manual trigger or word-character trigger: check if there's a dot
        // immediately before the partially-typed word (e.g. `dbConn.ex|`)
        const word = model.getWordUntilPosition(position);
        if (word.startColumn < 2) return { suggestions: [] };
        // word.startColumn is 1-indexed; line is 0-indexed
        const dotCandidate = line[word.startColumn - 2];
        if (dotCandidate !== ".") return { suggestions: [] };
        beforeDot = line.substring(0, word.startColumn - 2);
        replaceStart = word.startColumn;
      }

      const match = beforeDot.match(/(\w+)$/);
      if (!match) return { suggestions: [] };

      const objName = match[1];
      let members = resolveRhinoMembers(objName);
      // If still unresolved, scan the model for `objName = ...createDatabaseConnection(`
      // to infer DatabaseConnection type — covers any variable name (dbConn, conn, etc.)
      if (!members) {
        const fullText = model.getValue();
        const safeObjName = objName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const dbConnAssignRe = new RegExp(
          `\\b${safeObjName}\\s*=\\s*(?:DatabaseConnectionFactory\\.)?createDatabaseConnection\\s*\\(`,
          "m"
        );
        if (dbConnAssignRe.test(fullText)) members = MIRTH_MEMBERS["_dbconn"];
      }
      if (!members) return { suggestions: [] };

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: replaceStart,
        endColumn: position.column,
      };
      return {
        suggestions: members.map((m) => ({
          label: m.label,
          kind: monaco.languages.CompletionItemKind.Method,
          detail: m.detail,
          documentation: m.documentation,
          insertText: m.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `0_${m.label}`,
          range,
        })),
      };
    },
  });

  // ── Completion Provider 3: JS snippets ───────────────────────────────────────
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      // Skip when cursor is after a dot — member completions handle that
      const charBeforeWord =
        word.startColumn > 2 ? model.getLineContent(position.lineNumber)[word.startColumn - 2] : "";
      if (charBeforeWord === ".") return { suggestions: [] };

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: JS_SNIPPETS.map((s) => ({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: s.detail,
          documentation: s.documentation,
          insertText: s.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `2_${s.label}`,
          range,
        })),
      };
    },
  });

  // ── Document Formatting Provider: delegate to Monaco's JS worker ─────────────
  // Creates a temporary "javascript" model so the TypeScript language service
  // can format the code. Converts TS TextChange[] (char offsets) to Monaco
  // TextEdit[] (line+col ranges). Falls back silently on any error.

  monaco.languages.registerDocumentFormattingEditProvider(LANG_ID, {
    async provideDocumentFormattingEdits(model, options) {
      const code = model.getValue();
      if (!code.trim()) return [];

      const tempUri = monaco.Uri.parse(`inmemory://rhino_fmt_${Date.now()}.js`);
      const tempModel = monaco.editor.createModel(code, "javascript", tempUri);

      try {
        type TsWorker = {
          getFormattingEditsForDocument(
            uri: string,
            options: Record<string, unknown>
          ): Promise<Array<{ span: { start: number; length: number }; newText: string }>>;
        };
        const getWorker = await (
          monaco.languages.typescript as unknown as {
            getJavaScriptWorker: () => Promise<(...uris: MonacoType.Uri[]) => Promise<TsWorker>>;
          }
        ).getJavaScriptWorker();
        const worker = await getWorker(tempUri);

        const edits: Array<{ span: { start: number; length: number }; newText: string }> =
          await worker.getFormattingEditsForDocument(tempUri.toString(), {
            baseIndentSize: 0,
            indentSize: options.tabSize,
            tabSize: options.tabSize,
            newLineCharacter: "\n",
            convertTabsToSpaces: options.insertSpaces,
            insertSpaceAfterCommaDelimiter: true,
            insertSpaceAfterSemicolonInForStatements: true,
            insertSpaceBeforeAndAfterBinaryOperators: true,
            insertSpaceAfterConstructor: false,
            insertSpaceAfterKeywordsInControlFlowStatements: true,
            insertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
            insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: true,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
            insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
            insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
            insertSpaceBeforeFunctionParenthesis: false,
            placeOpenBraceOnNewLineForFunctions: false,
            placeOpenBraceOnNewLineForControlBlocks: false,
            insertSpaceBeforeTypeAnnotation: false,
            semicolons: "insert",
          });

        if (!edits || edits.length === 0) return [];

        // Convert TypeScript char-offset spans → Monaco line+col ranges
        return edits.map((edit) => {
          const start = tempModel.getPositionAt(edit.span.start);
          const end = tempModel.getPositionAt(edit.span.start + edit.span.length);
          return {
            range: {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
            },
            text: edit.newText,
          };
        });
      } catch {
        return [];
      } finally {
        tempModel.dispose();
      }
    },
  });

  // ── Completion Provider 4: local variable / function / parameter names ───────
  // Scans the current model for identifiers declared with var/let/const, function
  // declarations, and function parameters so they appear in autocomplete.
  // Does NOT fire when the cursor is after a dot (member completions handle that).
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const line = model.getLineContent(position.lineNumber);

      // Skip when cursor is after a dot — member completions handle that
      const charBeforeWord = word.startColumn > 1 ? line[word.startColumn - 2] : "";
      if (charBeforeWord === ".") return { suggestions: [] };

      const fullText = model.getValue();
      const names = new Set<string>();

      // var / let / const declarations (single identifier, not destructuring)
      const declRe = /\b(?:var|let|const)\s+([a-zA-Z_$][\w$]*)/g;
      let m: RegExpExecArray | null;
      while ((m = declRe.exec(fullText)) !== null) names.add(m[1]);

      // Named function declarations: function foo(...)
      const funcDeclRe = /\bfunction\s+([a-zA-Z_$][\w$]*)\s*\(/g;
      while ((m = funcDeclRe.exec(fullText)) !== null) names.add(m[1]);

      // Function parameters: function anything(a, b, c) and arrow (a, b) =>
      // Capture simple identifier param lists only
      const paramRe = /(?:function\s*\w*|=>)\s*\(([^)]*)\)/g;
      while ((m = paramRe.exec(fullText)) !== null) {
        for (const param of m[1].split(",")) {
          const p = param.trim().replace(/\s*=.*$/, ""); // strip default value
          if (/^[a-zA-Z_$][\w$]*$/.test(p)) names.add(p);
        }
      }

      // Bare assignments that look like declarations: `foo = something` at
      // statement start (covers `dbConn = ...` which is declared with `var dbConn;`
      // on a separate line)
      const assignRe = /^[ \t]*([a-zA-Z_$][\w$]*)\s*=/gm;
      while ((m = assignRe.exec(fullText)) !== null) names.add(m[1]);

      // Remove names that are already covered by the global completions provider
      // (keep only names NOT in the predefined globals list) to avoid duplicates
      const globalNames = new Set(MIRTH_GLOBALS.map((g) => g.label));

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: [...names]
          .filter((n) => !globalNames.has(n))
          .map((n) => ({
            label: n,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: "(local variable)",
            insertText: n,
            sortText: `1_${n}`, // sort after globals (0_) but before snippets (2_)
            range,
          })),
      };
    },
  });

  // ── Completion Provider 5: built-in reference snippets ─────────────────────
  // Surfaces all CATEGORIES items (from lib/reference-data.ts) as Monaco snippet
  // suggestions — same data as the Reference panel sidebar, now also autocomplete.
  // Context-aware: scriptExclude items are hidden in channel lifecycle scripts;
  // items with an explicit contexts[] array are restricted to those context types.
  // Plugin-registered categories (registerReferenceCategory) are appended too,
  // gated on server-enablement AND license — warm both snapshots so
  // the gates read correctly. Must match reference-list.tsx, or an unlicensed
  // plugin's snippets would leak through autocomplete while hidden in the panel.
  ensureInstalledPluginsLoaded();
  ensurePluginLicensesLoaded();
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const charBeforeWord =
        word.startColumn >= 2
          ? model.getLineContent(position.lineNumber)[word.startColumn - 2]
          : "";
      if (charBeforeWord === ".") return { suggestions: [] };

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const ctx = getEditorContext(model.uri.toString());

      const suggestions: MonacoType.languages.CompletionItem[] = [];

      // Built-in categories plus enabled AND licensed plugin-registered
      // categories (last) — same AND-composed gate as reference-list.tsx.
      const pluginCategories = pluginRegistry.referenceCategories.filter((c) =>
        surfaceGateEnabledSnapshot(c)
      );

      for (const category of [...CATEGORIES, ...pluginCategories]) {
        // Variables category is already covered by the globals provider — skip
        if (category.id === "variables") continue;

        for (const item of category.items) {
          const insertCode = item.monacoSnippet ?? item.code;
          // Items with no code are simple variable references already in globals — skip
          if (!insertCode) continue;

          // Skip items whose insert text is a bare identifier (e.g. "msg", "message",
          // "channelId", "channelName"). Those are already provided by the globals
          // provider as kind: variable; surfacing them again here would create
          // duplicate entries in the dropdown.
          if (BARE_IDENTIFIER_RE.test(insertCode)) continue;

          // Items with an explicit contexts[] — only show in those context types
          if (item.contexts && item.contexts.length > 0) {
            if (ctx && !item.contexts.includes(ctx.contextType)) continue;
          } else if (item.scriptExclude) {
            // scriptExclude items are connector-only — hide in channel script contexts
            if (ctx && SCRIPT_ONLY_CONTEXTS.has(ctx.contextType)) continue;
          }

          const prefix = item.prefix ?? item.name.split(/\s+/)[0].toLowerCase();
          // Space-stripped, lowercased name for fuzzy matching against typed
          // identifiers (e.g. "getmerged" → "Get Merged Connector Message").
          const nameSmashed = item.name.replace(/\s+/g, "").toLowerCase();

          suggestions.push({
            label: { label: item.name, description: category.label },
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: category.label,
            documentation: { value: item.description, isTrusted: false },
            insertText: toMonacoSnippet(insertCode),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            // Sort alongside code templates (0_tmpl_) ahead of JS snippets (2_)
            sortText: `0_blref_${prefix}_${item.name}`,
            // Prefix first so prefix matches score highest; smashed name second so
            // typing the function-style name ("getmerged") matches even though the
            // friendly name has spaces. We intentionally omit the spaced original
            // name — including it caused "call" to subsequence-match items like
            // "Compare and Swap Lookup Value" via the 'l's in Lookup/Value.
            filterText: `${prefix} ${nameSmashed}`,
            range,
          });
        }
      }

      return { suggestions };
    },
  });

  // ── Completion Provider 6: user-defined code templates ──────────────────────
  // Reads code templates from the module-level promise cache, filters by the
  // editor's registered ContextType and channelId, then returns Monaco suggestions
  // with full signature, parameter docs, and return info — matching Java parity.
  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    async provideCompletionItems(model, position, _context, token) {
      // Skip when cursor is immediately after a dot (member-completion context)
      const word = model.getWordUntilPosition(position);
      const charBeforeWord =
        word.startColumn >= 2
          ? model.getLineContent(position.lineNumber)[word.startColumn - 2]
          : "";
      if (charBeforeWord === ".") return { suggestions: [] };

      const uri = model.uri.toString();
      const ctx = getEditorContext(uri);
      if (!ctx) return { suggestions: [] };

      let templates, libraries;
      try {
        [templates, libraries] = await Promise.all([
          getCodeTemplatesCached(),
          getCodeTemplateLibrariesCached(),
        ]);
      } catch {
        return { suggestions: [] };
      }

      // Bail if Monaco cancelled the request while we were awaiting the cache
      if (token.isCancellationRequested) return { suggestions: [] };

      // Re-verify the editor context — the model may have been disposed or
      // re-bound to a different context while the cache fetch was in flight.
      const ctxAfter = getEditorContext(uri);
      if (!ctxAfter || ctxAfter !== ctx) return { suggestions: [] };

      // Filter by ContextType — only templates applicable to this editor surface
      const contextFiltered = templates.filter((t) => t.contextTypes.includes(ctx.contextType));

      // Filter by channel when in a channel-scoped editor
      const filtered = filterTemplatesByChannel(contextFiltered, libraries, ctx.channelId);

      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: MonacoType.languages.CompletionItem[] = [];

      for (const t of filtered) {
        // COMPILED_CODE templates are not user-invocable — skip
        if (t.type === "COMPILED_CODE") continue;

        const parsed = parseCodeTemplateFunction(t.code);
        const isFunction = t.type === "FUNCTION";

        const signatureStr = parsed ? formatCodeTemplateSignature(parsed) : t.name;
        const insertText = isFunction ? (extractFunctionCall(t.code) ?? `${t.name}()`) : t.code;

        // Build markdown documentation for the detail panel
        const docLines: string[] = [];
        if (parsed?.description) {
          docLines.push(parsed.description);
        }
        if (parsed && parsed.params.length > 0) {
          docLines.push("");
          for (const p of parsed.params) {
            const descPart = p.description ? ` — ${p.description}` : "";
            docLines.push(`**\`@param\`** \`{${p.type}}\` **${p.name}**${descPart}`);
          }
        }
        if (parsed) {
          const retDesc = parsed.returnDescription ? ` — ${parsed.returnDescription}` : "";
          docLines.push("");
          docLines.push(`**\`@return\`** \`{${parsed.returnType}}\`${retDesc}`);
        }

        suggestions.push({
          label: {
            label: parsed?.name ?? t.name,
            detail: ` ${signatureStr}`,
            description: "code template",
          },
          kind: isFunction
            ? monaco.languages.CompletionItemKind.Function
            : monaco.languages.CompletionItemKind.Snippet,
          insertText: insertText ?? "",
          documentation: { value: docLines.join("\n") },
          sortText: `0_tmpl_${t.name}`,
          range,
        });
      }

      return { suggestions };
    },
  });

  // ── Hover Provider 7: documentation on hover ─────────────────────────────────
  monaco.languages.registerHoverProvider(LANG_ID, {
    async provideHover(model, position, token) {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const wordText = wordInfo.word;
      const line = model.getLineContent(position.lineNumber);
      const charBefore = line[wordInfo.startColumn - 2]; // char immediately before word

      // Member hover: "DateUtil.getCurrentDate" — cursor on method name
      if (charBefore === ".") {
        const beforeDot = line.substring(0, wordInfo.startColumn - 2);
        const objMatch = beforeDot.match(/(\w+)$/);
        if (objMatch) {
          const objName = objMatch[1];
          let members = resolveRhinoMembers(objName);
          if (!members) {
            const fullText = model.getValue();
            const dbConnAssignRe = new RegExp(
              `\\b${objName}\\s*=\\s*(?:DatabaseConnectionFactory\\.)?createDatabaseConnection\\s*\\(`,
              "m"
            );
            if (dbConnAssignRe.test(fullText)) members = MIRTH_MEMBERS["_dbconn"];
          }
          if (members) {
            const member = members.find((m) => m.label === wordText);
            if (member) {
              return {
                contents: [
                  { value: `**${objName}.${member.label}** \`${member.detail}\`` },
                  { value: member.documentation },
                ],
              };
            }
          }
        }
      }

      // Top-level global hover
      const global = MIRTH_GLOBALS.find((g) => g.label === wordText);
      if (global) {
        return {
          contents: [
            { value: `**${global.label}**: \`${global.detail}\`` },
            { value: global.documentation },
          ],
        };
      }

      // Code template hover — look up by function name in the cached templates.
      // This branch is intentionally last: the cheap built-in lookups above
      // return synchronously and never trigger a network call. Even on the
      // template branch we prefer the synchronous peek (avoids awaiting the
      // network roundtrip for hovers when the cache isn't warm yet); the
      // completion provider will warm the cache shortly after the user types.
      const uri = model.uri.toString();
      const ctx = getEditorContext(uri);
      if (ctx) {
        try {
          const peekedTemplates = peekCodeTemplatesCached();
          const peekedLibraries = peekCodeTemplateLibrariesCached();
          let templates: typeof peekedTemplates;
          let libraries: typeof peekedLibraries;
          if (peekedTemplates && peekedLibraries) {
            templates = peekedTemplates;
            libraries = peekedLibraries;
          } else {
            // Cache not warm — fetch in case the hover word is a known template
            [templates, libraries] = await Promise.all([
              getCodeTemplatesCached(),
              getCodeTemplateLibrariesCached(),
            ]);
            // Bail if Monaco cancelled the hover while we were awaiting the cache
            if (token.isCancellationRequested) return null;
            // Re-verify the editor context after the await
            const ctxAfter = getEditorContext(uri);
            if (!ctxAfter || ctxAfter !== ctx) return null;
          }
          const contextFiltered = templates.filter((t) => t.contextTypes.includes(ctx.contextType));
          const filtered = filterTemplatesByChannel(contextFiltered, libraries, ctx.channelId);

          for (const t of filtered) {
            if (t.type === "COMPILED_CODE") continue;
            const parsed = parseCodeTemplateFunction(t.code);
            if (!parsed || parsed.name !== wordText) continue;

            const sigLine = `**${formatCodeTemplateSignature(parsed)}** — *code template*`;
            const docLines: string[] = [sigLine];
            if (parsed.description) {
              docLines.push("", parsed.description);
            }
            if (parsed.params.length > 0) {
              docLines.push("");
              for (const p of parsed.params) {
                const descPart = p.description ? ` — ${p.description}` : "";
                docLines.push(`**\`@param\`** \`{${p.type}}\` **${p.name}**${descPart}`);
              }
            }
            const retDesc = parsed.returnDescription ? ` — ${parsed.returnDescription}` : "";
            docLines.push("", `**\`@return\`** \`{${parsed.returnType}}\`${retDesc}`);

            return { contents: [{ value: docLines.join("\n") }] };
          }
        } catch {
          // Ignore hover errors — fall through to return null
        }
      }

      return null;
    },
  });
}

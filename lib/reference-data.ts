/**
 * Static reference data for BridgeLink Rhino JS editors.
 *
 * Contains the RefItem / RefCategory types, the splitLabel utility, and
 * the CATEGORIES constant (mirrors Java ReferenceListFactory + Category enum).
 *
 * Used by:
 *  - filter/transformer Reference panel sidebar (drag-drop into editor)
 *  - Scripts tab and attachment-handler Reference panel
 *  - Monaco autocomplete completion provider (built-in reference snippets)
 *
 * No React imports needed — pure TypeScript.
 */

import type { ContextType } from "./types";

export interface RefItem {
  /** Display text shown in the list (variable name, function signature, or friendly name) */
  name: string;
  /** Description shown in the hover tooltip */
  description: string;
  /** Optional code snippet (shown in the tooltip when different from name) */
  code?: string;
  /**
   * When true, this item is connector-specific (filter/transformer, batch, dispatcher, etc.)
   * and should be EXCLUDED from the Scripts tab reference panel (Deploy/Undeploy/Preprocessor/Postprocessor).
   * Mirrors Java ReferenceListFactory context set — items tagged CONTEXT_CONNECTOR or
   * CONTEXT_RESPONSE_TRANSFORMER are not available in channel script contexts.
   */
  scriptExclude?: true;
  /**
   * Override the autocomplete insertion text with a Monaco snippet string
   * (e.g. `${1:placeholder}`).  When absent the completion provider derives
   * the snippet from `code` via `toMonacoSnippet()`, or falls back to `name`.
   */
  monacoSnippet?: string;
  /**
   * Explicit autocomplete trigger prefix.  When absent the provider uses the
   * first word of `name` lowercased (e.g. "Call System Function" → "call").
   * Set this when the default prefix would be misleading or too generic.
   */
  prefix?: string;
  /**
   * When set, this item is only surfaced in the listed ContextTypes.
   * Takes precedence over `scriptExclude`. Used by the Monaco autocomplete
   * provider and by `isRefItemVisibleInContext` (the Global Scripts reference
   * panel). Mirrors the per-`ContextType` set each item carries in Java
   * `ReferenceListFactory`.
   */
  contexts?: ContextType[];
}

export interface RefCategory {
  id: string;
  label: string;
  items: RefItem[];
}

// ─── Context-aware reference filtering ─────────────────────────────────────────
// Mirrors Java ReferenceListFactory: every reference item carries a set of
// ContextTypes in which it is valid, and the panel/autocomplete shows an item
// only when the active editor context is in that set.

/**
 * Lifecycle script contexts (global + channel Deploy/Undeploy/Preprocessor/
 * Postprocessor). `scriptExclude` items rely on connector-only globals
 * (`connectorMessage`/`msg`/`tmp`) that don't exist in these scopes, so they
 * are hidden here. Shared by the autocomplete provider (`monaco-rhino.ts`) and
 * `isRefItemVisibleInContext` so both honour the same rule.
 */
export const SCRIPT_ONLY_CONTEXTS = new Set<ContextType>([
  "GLOBAL_DEPLOY",
  "GLOBAL_UNDEPLOY",
  "GLOBAL_PREPROCESSOR",
  "GLOBAL_POSTPROCESSOR",
  "CHANNEL_DEPLOY",
  "CHANNEL_UNDEPLOY",
  "CHANNEL_PREPROCESSOR",
  "CHANNEL_POSTPROCESSOR",
]);

/**
 * The Java `CodeTemplateContextSet.getChannelContextSet()` — all channel and
 * connector contexts, but NOT any `GLOBAL_*`. Items tagged with this set are
 * available throughout a channel's scripts/connectors but hidden from every
 * global script (e.g. `channelMap`, `globalChannelMap`).
 */
export const CHANNEL_CONTEXT_SET: ContextType[] = [
  "CHANNEL_DEPLOY",
  "CHANNEL_UNDEPLOY",
  "CHANNEL_PREPROCESSOR",
  "CHANNEL_POSTPROCESSOR",
  "CHANNEL_ATTACHMENT",
  "CHANNEL_BATCH",
  "SOURCE_RECEIVER",
  "SOURCE_FILTER_TRANSFORMER",
  "DESTINATION_FILTER_TRANSFORMER",
  "DESTINATION_DISPATCHER",
  "DESTINATION_RESPONSE_TRANSFORMER",
];

/**
 * Whether a reference item should be shown in the given editor context.
 * Precedence matches the autocomplete provider in `monaco-rhino.ts`:
 *   1. explicit `contexts` → shown only when the context is in the set;
 *   2. `scriptExclude` → hidden in all lifecycle script contexts;
 *   3. otherwise shown.
 */
export function isRefItemVisibleInContext(item: RefItem, contextType: ContextType): boolean {
  if (item.contexts && item.contexts.length > 0) {
    return item.contexts.includes(contextType);
  }
  if (item.scriptExclude) {
    return !SCRIPT_ONLY_CONTEXTS.has(contextType);
  }
  return true;
}

// ─── splitLabel ──────────────────────────────────────────────────────────────
// Split a tree label into code + optional description parts.
// Matches labels like "MSH.5 (Receiving Application)" or "tag00100010 (Patient's Name)".
// For labels without parenthesized descriptions (XML, JSON, EDI, etc.), the entire
// label is returned as the code part with null description.
const LABEL_SPLIT_RE = /^(\S+) (\(.+)$/;

export function splitLabel(label: string): [string, string | null] {
  const m = LABEL_SPLIT_RE.exec(label);
  return m ? [m[1], m[2]] : [label, null];
}

// ─── Reference data (matches Java ReferenceListFactory + Category enum) ───────

export const CATEGORIES: RefCategory[] = [
  // ── Variables (misc items from addMiscellaneousReferences with null category)
  {
    id: "variables",
    label: "Variables",
    items: [
      {
        name: "msg",
        description:
          "In a filter/transformer, the inbound data as an E4X XML object (Raw → string, JSON → JS object).",
        scriptExclude: true,
      },
      {
        name: "tmp",
        description:
          "In a transformer, the outbound message template as an E4X XML object (or string/JS object).",
        scriptExclude: true,
      },
      {
        name: "connectorMessage",
        description: "The current ImmutableConnectorMessage object.",
        scriptExclude: true,
      },
      {
        name: "message",
        description:
          "The ImmutableMessage object containing all connector messages for the current message.",
        // Java CONTEXT_POSTPROCESSOR — only the postprocessor (channel + global) sees `message`.
        contexts: ["GLOBAL_POSTPROCESSOR", "CHANNEL_POSTPROCESSOR"],
      },
      {
        name: "channelMap",
        description:
          "Variable map for the current message — accessible to all downstream connectors and the postprocessor.",
        // Java CONTEXT_CHANNEL — channel-scoped, hidden from all global scripts.
        contexts: CHANNEL_CONTEXT_SET,
      },
      {
        name: "connectorMap",
        description: "Variable map for the current connector only — reset for each destination.",
        scriptExclude: true,
      },
      {
        name: "sourceMap",
        description:
          "Read-only map of source connector metadata (e.g. originalFilename, originalFileSize).",
        scriptExclude: true,
      },
      {
        name: "globalMap",
        description:
          "Global variable map — persists across all channels and messages on the server.",
      },
      {
        name: "globalChannelMap",
        description: "Channel-level global map — persists across messages within this channel.",
        // Java CONTEXT_CHANNEL — channel-scoped, hidden from all global scripts.
        contexts: CHANNEL_CONTEXT_SET,
      },
      {
        name: "configurationMap",
        description: "Read-only server configuration map (Settings → Configuration Map).",
      },
      {
        name: "responseMap",
        description: "Map used to store Response objects for the current message.",
        // Java CONTEXT_RESPONSE_MAP — postprocessor (channel + global), dispatcher,
        // and response transformer. Among global scripts only the postprocessor sees it.
        contexts: [
          "GLOBAL_POSTPROCESSOR",
          "CHANNEL_POSTPROCESSOR",
          "DESTINATION_DISPATCHER",
          "DESTINATION_RESPONSE_TRANSFORMER",
        ],
      },
      {
        name: "response",
        description:
          "In a response transformer, the ImmutableResponse object for the response data.",
        scriptExclude: true,
      },
      {
        name: "responseStatus",
        description:
          "In a response transformer, the status to set on the connector message (SENT / QUEUED / ERROR).",
        scriptExclude: true,
      },
      {
        name: "responseStatusMessage",
        description: "In a response transformer, a brief message explaining the current status.",
        scriptExclude: true,
      },
      {
        name: "responseErrorMessage",
        description: "In a response transformer, the error message for the connector message.",
        scriptExclude: true,
      },
      {
        name: "destinationSet",
        description:
          "DestinationSet — use in source filter/transformer to control which destinations process the message.",
        scriptExclude: true,
      },
      {
        name: "logger",
        description: "log4j Logger — use logger.info/error/warn/debug/trace('message').",
      },
      {
        name: "alerts",
        description:
          "AlertSender — use alerts.sendAlert('message') to trigger user-defined alerts.",
      },
      {
        name: "router",
        description:
          "VMRouter — use router.routeMessage(channelName, data) to dispatch to other channels.",
      },
      {
        name: "replacer",
        description:
          "TemplateValueReplacer — use replacer.replaceValues(template, context) for Velocity replacement.",
      },
      {
        name: "contextFactory",
        description:
          "JavaScript Context Factory for retrieving resource IDs and classloaders of the current JS context.",
      },
      {
        name: "reader",
        description: "In a batch script, a BufferedReader for reading the incoming data stream.",
        scriptExclude: true,
      },
    ],
  },

  // ── Message Functions
  {
    id: "message",
    label: "Message Functions",
    items: [
      // CONTEXT_CONNECTOR items — filter/transformer, dispatcher, batch, response transformer only (scriptExclude: true)
      {
        name: "Incoming Message (Raw)",
        description: "The original unprocessed message received by the connector.",
        code: "connectorMessage.getRawData()",
        scriptExclude: true,
      },
      {
        name: "Incoming Message (Transformed)",
        description: "The inbound data as an E4X XML object (or string/JS object).",
        code: "msg",
        scriptExclude: true,
      },
      {
        name: "Message Source",
        description: "The message source (sending facility).",
        code: "$('mirth_source')",
        scriptExclude: true,
      },
      {
        name: "Message Type",
        description: "The message type.",
        code: "$('mirth_type')",
        scriptExclude: true,
      },
      {
        name: "Message Version",
        description: "The message version.",
        code: "$('mirth_version')",
        scriptExclude: true,
      },
      {
        name: "Message ID",
        description: "The ID of the overall message being processed.",
        code: "connectorMessage.getMessageId()",
        scriptExclude: true,
      },
      {
        name: "Metadata ID",
        description: "The ID of the connector the message is currently being processed through.",
        code: "connectorMessage.getMetaDataId()",
        scriptExclude: true,
      },
      {
        name: "Message Inbound Data Type",
        description: "The inbound data type for this connector message.",
        code: "connectorMessage.getRaw().getDataType()",
        scriptExclude: true,
      },
      {
        name: "Iterate Over Segment",
        description:
          "Iterates over a repeating segment. Replace SEG with your segment name (e.g. OBX).",
        code: "for each (var seg in msg..SEG) {\n\tvar val = seg['SEG.1']['SEG.1.1'].toString();\n}",
        scriptExclude: true,
      },
      {
        name: "Iterate Over All Segments",
        description: "Iterates over all segments in a message with an if-statement filter.",
        code: "for each (var seg in msg.children()) {\n\tif (seg.name().toString() == 'SEG') {\n\t\tvar val = seg['SEG.1']['SEG.1.1'].toString();\n\t}\n}",
        scriptExclude: true,
      },
      {
        name: "createSegment(segmentName)",
        description: "Create a new segment that can be used in any message.",
        code: "createSegment(segmentName)",
        scriptExclude: true,
      },
      {
        name: "createSegment(segmentName, msg)",
        description: "Create a new segment in a specified message (msg or tmp).",
        code: "createSegment(segmentName, msg)",
        scriptExclude: true,
      },
      {
        name: "createSegment(segmentName, msg, i)",
        description: "Create a new segment at a specific index in a message.",
        code: "createSegment(segmentName, msg, i)",
        scriptExclude: true,
      },
      {
        name: "createSegmentAfter(name, afterSeg)",
        description: "Create a new segment and insert it after an existing segment.",
        code: "createSegmentAfter(insertSegmentName, afterThisSegment)",
        scriptExclude: true,
      },
      {
        name: "Delete Segment",
        description: "Delete a segment from the message.",
        code: "delete msg['SEG'];",
        scriptExclude: true,
      },
      {
        name: "destinationSet.remove([...])",
        description:
          "Stop one or more destinations from processing this message. Source filter/transformer only.",
        code: "destinationSet.remove([metaDataIdOrConnectorName]);",
        scriptExclude: true,
      },
      {
        name: "destinationSet.removeAllExcept([...])",
        description: "Stop all except the specified destinations. Source filter/transformer only.",
        code: "destinationSet.removeAllExcept([metaDataIdOrConnectorName]);",
        scriptExclude: true,
      },
      {
        name: "destinationSet.removeAll()",
        description: "Stop all destinations from processing this message.",
        code: "destinationSet.removeAll();",
        scriptExclude: true,
      },
      {
        name: "validate(input, default)",
        description: "Validates an input value and returns the default if empty.",
        code: "validate(input, defaultValue)",
        scriptExclude: true,
      },
      {
        name: "validate(input, default, replacements)",
        description: "Validates an input value with string replacements array.",
        code: "validate(input, defaultValue, replacements)",
        scriptExclude: true,
      },
      // CONTEXT_CHANNEL items — available in channel scripts (deploy, undeploy, preprocessor, postprocessor)
      {
        name: "Message Reprocessed",
        description: "Variable indicating if this message was reprocessed.",
        code: "var reprocessed = sourceMap.get('reprocessed') == true;",
      },
      {
        name: "Message Replaced",
        description: "Variable indicating if this message was reprocessed and replaced.",
        code: "var replaced = sourceMap.get('replaced') == true;",
      },
    ],
  },

  // ── Map Functions
  {
    id: "map",
    label: "Map Functions",
    items: [
      {
        name: "$('key')",
        description: "Returns the value of the key from any map.",
        code: "$('key')",
      },
      {
        name: "$cfg('key')",
        description: "Get a value from the configuration map.",
        code: "$cfg('key')",
      },
      { name: "$g('key')", description: "Get a value from the global map.", code: "$g('key')" },
      {
        name: "$g('key', value)",
        description: "Put a value into the global map.",
        code: "$g('key', value)",
      },
      {
        name: "$gc('key')",
        description: "Get a value from the global channel map.",
        code: "$gc('key')",
      },
      {
        name: "$gc('key', value)",
        description: "Put a value into the global channel map.",
        code: "$gc('key', value)",
      },
      { name: "$c('key')", description: "Get a value from the channel map.", code: "$c('key')" },
      {
        name: "$c('key', value)",
        description: "Put a value into the channel map.",
        code: "$c('key', value)",
      },
      {
        name: "$co('key')",
        description: "Get a value from the connector map.",
        code: "$co('key')",
        scriptExclude: true,
      },
      {
        name: "$co('key', value)",
        description: "Put a value into the connector map.",
        code: "$co('key', value)",
        scriptExclude: true,
      },
      {
        name: "$s('key')",
        description: "Get a value from the source map.",
        code: "$s('key')",
        scriptExclude: true,
      },
      { name: "$r('key')", description: "Get a value from the response map.", code: "$r('key')" },
      {
        name: "$r('key', value)",
        description: "Put a value into the response map.",
        code: "$r('key', value)",
      },
      {
        name: "Lookup Value in All Maps",
        description: "Returns the value of the key if it exists in any map.",
        code: "$('key')",
      },
      {
        name: "Get Configuration Variable Map",
        description: "The variable map containing server-specific settings.",
        code: "configurationMap.get('key')",
      },
      {
        name: "Get Global Variable Map",
        description: "The variable map that persists values between channels.",
        code: "globalMap.get('key')",
      },
      {
        name: "Put Global Variable Map",
        description: "The variable map that persists values between channels.",
        code: "globalMap.put('key', value)",
      },
      {
        name: "Get Global Channel Variable Map",
        description: "The variable map that persists values between messages in a single channel.",
        code: "globalChannelMap.get('key')",
      },
      {
        name: "Put Global Channel Variable Map",
        description: "The variable map that persists values between messages in a single channel.",
        code: "globalChannelMap.put('key', value)",
      },
      {
        name: "Get Connector Variable Map",
        description: "The variable map that will be sent to the connector.",
        code: "connectorMap.get('key')",
        scriptExclude: true,
      },
      {
        name: "Put Connector Variable Map",
        description: "The variable map that will be sent to the connector.",
        code: "connectorMap.put('key', value)",
        scriptExclude: true,
      },
      {
        name: "Get Channel Variable Map",
        description: "The variable map that can be used anywhere in the channel.",
        code: "channelMap.get('key')",
      },
      {
        name: "Put Channel Variable Map",
        description: "The variable map that can be used anywhere in the channel.",
        code: "channelMap.put('key', value)",
      },
      {
        name: "Get Source Variable Map",
        description: "The variable map containing metadata about the original message. Read-only.",
        code: "sourceMap.get('key')",
        scriptExclude: true,
      },
      {
        name: "Get Response Variable Map",
        description: "The variable map that stores responses.",
        code: "responseMap.get('key')",
      },
      {
        name: "Put Sent Response Variable",
        description: "Places a successful response in the response variable map.",
        code: "responseMap.put('key', ResponseFactory.getSentResponse('message'))",
      },
      {
        name: "Put Error Response Variable",
        description: "Places an unsuccessful response in the response variable map.",
        code: "responseMap.put('key', ResponseFactory.getErrorResponse('message'))",
      },
      {
        name: "Create Sent Response",
        description: "Creates a successful response object.",
        code: "ResponseFactory.getSentResponse('message')",
      },
      {
        name: "Create Error Response",
        description: "Creates an unsuccessful response object.",
        code: "ResponseFactory.getErrorResponse('message')",
      },
    ],
  },

  // ── Logging and Alerts
  {
    id: "logging",
    label: "Logging and Alerts",
    items: [
      {
        name: "Log an Info Statement",
        description: "Outputs the message to the system info log.",
        code: "logger.info('message');",
      },
      {
        name: "Log an Error Statement",
        description: "Outputs the message to the system error log.",
        code: "logger.error('message');",
      },
      {
        name: "logger.warn('message')",
        description: "Outputs the message to the system warning log.",
        code: "logger.warn('message');",
      },
      {
        name: "logger.debug('message')",
        description: "Outputs the message to the system debug log.",
        code: "logger.debug('message');",
      },
      {
        name: "logger.trace('message')",
        description: "Outputs the message to the system trace log.",
        code: "logger.trace('message');",
      },
      {
        name: "Trigger an Alert",
        description: "Trigger a custom alert for the current channel.",
        code: "alerts.sendAlert('message');",
      },
      {
        name: "Send an Email",
        description: "Sends an alert email using the alert SMTP properties.",
        code: "var smtpConn = SMTPConnectionFactory.createSMTPConnection();\nsmtpConn.send('to', 'cc', 'from', 'subject', 'body', 'charset');",
      },
    ],
  },

  // ── Database Functions
  {
    id: "database",
    label: "Database Functions",
    items: [
      {
        name: "Perform Database Query",
        description: "Performs a database query and returns the rowset.",
        code: "var dbConn;\nvar result;\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('driver', 'address', 'username', 'password');\n\tresult = dbConn.executeCachedQuery('expression');\n} finally {\n\tif (dbConn) dbConn.close();\n}",
      },
      {
        name: "Perform Parameterized Database Query",
        description: "Performs a database query with a list of parameters.",
        code: "var dbConn;\nvar result;\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('driver', 'address', 'username', 'password');\n\tresult = dbConn.executeCachedQuery('expression', paramList);\n} finally {\n\tif (dbConn) dbConn.close();\n}",
      },
      {
        name: "Perform Database Update",
        description: "Performs a database update.",
        code: "var dbConn;\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('driver', 'address', 'username', 'password');\n\tdbConn.executeUpdate('expression');\n} finally {\n\tif (dbConn) dbConn.close();\n}",
      },
      {
        name: "Perform Parameterized Database Update",
        description: "Performs a database update with a list of parameters.",
        code: "var dbConn;\ntry {\n\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('driver', 'address', 'username', 'password');\n\tdbConn.executeUpdate('expression', paramList);\n} finally {\n\tif (dbConn) dbConn.close();\n}",
      },
      {
        name: "Postgres Connection Template",
        description: "String template for a Postgres database connection.",
        code: '"jdbc:postgresql://host:port/dbname"',
      },
      {
        name: "MySQL Connection Template",
        description: "String template for a MySQL database connection.",
        code: '"jdbc:mysql://host:port/dbname"',
      },
      {
        name: "SQL Server/Sybase (jTDS) Template",
        description: "String template for SQL Server/Sybase (jTDS) database connection.",
        code: '"jdbc:jtds:sqlserver://host:port/dbname"',
      },
      {
        name: "Microsoft SQL Server Template",
        description: "String template for Microsoft SQL Server database connection.",
        code: '"jdbc:sqlserver://host:port;databaseName=dbname"',
      },
      {
        name: "Oracle Connection Template",
        description: "String template for Oracle database connection.",
        code: '"jdbc:oracle:thin:@host:port:dbname"',
      },
      {
        name: "Postgres Driver",
        description: "String for Postgres JDBC driver.",
        code: '"org.postgresql.Driver"',
      },
      {
        name: "MySQL Driver",
        description: "String for MySQL JDBC driver.",
        code: '"com.mysql.cj.jdbc.Driver"',
      },
      {
        name: "SQL Server/Sybase (jTDS) Driver",
        description: "String for SQL Server/Sybase (jTDS) JDBC driver.",
        code: '"net.sourceforge.jtds.jdbc.Driver"',
      },
      {
        name: "Microsoft SQL Server Driver",
        description: "String for Microsoft SQL Server JDBC driver.",
        code: '"com.microsoft.sqlserver.jdbc.SQLServerDriver"',
      },
      {
        name: "Oracle Driver",
        description: "String for Oracle JDBC driver.",
        code: '"oracle.jdbc.OracleDriver"',
      },
      {
        name: "Initialize Driver",
        description: "Initialize the specified JDBC driver (same as Class.forName).",
        code: "DatabaseConnectionFactory.initializeDriver('driver');",
      },
    ],
  },

  // ── Utility Functions
  {
    id: "utility",
    label: "Utility Functions",
    items: [
      {
        name: "Generate Unique ID",
        description: "Generate a Universally Unique Identifier.",
        code: "var uuid = UUIDGenerator.getUUID();",
      },
      {
        name: "Route Message to Channel",
        description: "Sends the specified data to a different channel by name.",
        code: "router.routeMessage('channelName', 'message');",
      },
      {
        name: "Route Message by Channel ID",
        description: "Sends the specified data to a different channel by ID.",
        code: "router.routeMessageByChannelId('channelId', 'message');",
      },
      {
        name: "Read File As String",
        description: "Read file contents into a string.",
        code: "var contents = FileUtil.read('filename');",
      },
      {
        name: "Read File As Bytes",
        description: "Read file contents into a byte array.",
        code: "var contents = FileUtil.readBytes('filename');",
      },
      {
        name: "Write String to File",
        description: "Write a string to a file.",
        code: "FileUtil.write('filename', false, stringData);",
      },
      {
        name: "Write Bytes to File",
        description: "Write a byte array to a file.",
        code: "FileUtil.write('filename', false, byteData);",
      },
      {
        name: "BASE-64 Encode Data",
        description: "Encode a byte array to a BASE-64 string.",
        code: "FileUtil.encode(data);",
      },
      {
        name: "Decode BASE-64 Data",
        description: "Decode a BASE-64 string to a byte array.",
        code: "FileUtil.decode(data);",
      },
      {
        name: "Use Java Class",
        description: "Access any Java class in the current classpath.",
        code: "var obj = Packages.fully.qualified.ClassName;",
      },
      {
        name: "Build Map",
        description: "Creates a new HashMap and adds an entry to it.",
        code: "var map = Maps.map().add('key', value);",
      },
      {
        name: "Build List",
        description: "Creates a new ArrayList and adds an element to it.",
        code: "var list = Lists.list().append(element);",
      },
      {
        name: "Perform Message Object Value Replacement",
        description: "Velocity template replacement with a connectorMessage context.",
        code: "var result = replacer.replaceValues(template, connectorMessage);",
      },
      {
        name: "Perform Map Value Replacement",
        description: "Velocity template replacement with a map context.",
        code: "var result = replacer.replaceValues(template, map);",
      },
      {
        name: "Strip Namespaces",
        description: "Remove XML namespace declarations from a string.",
        code: 'var newMsg = message.replace(/xmlns:?[^=]*=[""][^""]*[""]/g, \'\');',
      },
      {
        name: "Remove Illegal XML Characters",
        description: "Remove XML control characters that cause E4X parsing errors.",
        code: "var newMsg = message.replace(/[\\x00-\\x08]|[\\x0B-\\x0C]|[\\x0E-\\x1F]/g, '');",
      },
      {
        name: "Pretty Print XML",
        description: "Formats an XML string with indented markup.",
        code: "XmlUtil.prettyPrint(xmlString)",
      },
      {
        name: "Pretty Print JSON",
        description: "Formats a JSON string with indented markup.",
        code: "JsonUtil.prettyPrint(jsonString)",
      },
      {
        name: "Parse HTTP Headers",
        description: "Takes an HTTP response string and returns a map.",
        code: "var headers = HTTPUtil.parseHeaders(header);",
      },
      {
        name: "Format Overpunch NCPDP Number",
        description: "Returns a number with decimal points and correct sign.",
        code: "var number = NCPDPUtil.formatNCPDPNumber('number', decimalpoints);",
      },
      {
        name: "Generate Hash (Object)",
        description: "Returns the hash of the passed-in Object.",
        code: "var hash = HashUtil.generate(object);",
      },
      {
        name: "Generate Hash (String)",
        description: "Returns the hash of a String with specified encoding and algorithm.",
        code: "var hash = HashUtil.generate(string, encoding, algorithm);",
      },
      {
        name: "Generate Hash (byte[])",
        description: "Returns the hash of a byte array with specified algorithm.",
        code: "var hash = HashUtil.generate(bytes, algorithm);",
      },
      {
        name: "Call System Function",
        description: "Execute a command on the server system (requires proper security).",
        code: 'java.lang.Runtime.getRuntime().exec("system_command");',
      },
      {
        name: "Add Attachment",
        description: "Add an attachment (String or byte[]) to the current message.",
        code: "addAttachment(data, type, base64Encode)",
      },
      {
        name: "Get Attachments",
        description: "Get all Attachments associated with this message.",
        code: "getAttachments(base64Decode)",
      },
      {
        name: "Get Single Attachment (current)",
        description: "Get a specific Attachment associated with this message.",
        code: "getAttachment(attachmentId, base64Decode)",
      },
      {
        name: "Get Single Attachment (any)",
        description: "Get a specific Attachment from any channel/message.",
        code: "getAttachment(channelId, messageId, attachmentId, base64Decode)",
      },
      {
        name: "Get Attachment IDs (current)",
        description: "Get all attachment IDs for the current message.",
        code: "getAttachmentIds()",
      },
      {
        name: "Get Attachment IDs (any)",
        description: "Get all attachment IDs for any channel/message.",
        code: "getAttachmentIds(channelId, messageId)",
      },
      {
        name: "Create Attachment List → Connector Map",
        description:
          "Create an Attachment List and add to Connector Map (for SMTP/Web Service Sender).",
        code: "var attachmentList = Lists.list();\nattachmentList.add(new AttachmentEntry(name, content, type));\nconnectorMap.put('attachmentList', attachmentList);",
      },
      {
        name: "Create Headers Map → Connector Map",
        description:
          "Create a Header Map and add to Connector Map (for HTTP/SMTP/Web Service Sender).",
        code: "var headersMap = Maps.map();\nheadersMap.put('X-Custom-Header', value);\nconnectorMap.put('headersMap', headersMap);",
      },
      {
        name: "Create Parameters Map → Connector Map",
        description: "Create a Query Parameter Map and add to Connector Map (for HTTP Sender).",
        code: "var parametersMap = Maps.map();\nparametersMap.put('param1', value);\nconnectorMap.put('parametersMap', parametersMap);",
      },
    ],
  },

  // ── Conversion Functions
  {
    id: "conversion",
    label: "Conversion Functions",
    items: [
      // ── General serialization utilities
      {
        name: "Get Serializer",
        description:
          "Creates a data type serializer with serialization and deserialization properties.",
        code: "var dataType = 'HL7V2';\nvar serProps = SerializerFactory.getDefaultSerializationProperties(dataType);\nvar deserProps = SerializerFactory.getDefaultDeserializationProperties(dataType);\nvar serializer = SerializerFactory.getSerializer(dataType, serProps, deserProps);",
      },
      {
        name: "Convert XML to JSON",
        description: "Converts an XML string to JSON.",
        code: "XmlUtil.toJson(xmlString)",
      },
      {
        name: "Convert JSON to XML",
        description: "Converts a JSON string to XML.",
        code: "JsonUtil.toXml(jsonString)",
      },

      // ── Delimited Text — DataTypeCodeTemplatePlugin (isDefaultOnly:false → 4 items)
      {
        name: "Convert Delimited Text to XML (default parameters)",
        description:
          "Converts an encoded Delimited Text string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('DELIMITED').toXML(message);",
      },
      {
        name: "Convert Delimited Text to XML (custom parameters)",
        description:
          "Converts an encoded Delimited Text string to XML with custom serializer parameters.",
        code: "var serializationProperties = SerializerFactory.getDefaultSerializationProperties('DELIMITED');\nSerializerFactory.getSerializer('DELIMITED', serializationProperties, null).toXML(message);",
      },
      {
        name: "Convert XML to Delimited Text (default parameters)",
        description:
          "Converts an XML string to Delimited Text with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('DELIMITED').fromXML(message);",
      },
      {
        name: "Convert XML to Delimited Text (custom parameters)",
        description: "Converts an XML string to Delimited Text with custom serializer parameters.",
        code: "var deserializationProperties = SerializerFactory.getDefaultDeserializationProperties('DELIMITED');\nSerializerFactory.getSerializer('DELIMITED', null, deserializationProperties).fromXML(message);",
      },

      // ── HL7 v2.x — DataTypeCodeTemplatePlugin (isDefaultOnly:false → 4 items)
      {
        name: "Convert HL7 v2.x to XML (default parameters)",
        description:
          "Converts an encoded HL7 v2.x string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('HL7V2').toXML(message);",
      },
      {
        name: "Convert HL7 v2.x to XML (custom parameters)",
        description:
          "Converts an encoded HL7 v2.x string to XML with custom serializer parameters.",
        code: "var serializationProperties = SerializerFactory.getDefaultSerializationProperties('HL7V2');\nSerializerFactory.getSerializer('HL7V2', serializationProperties, null).toXML(message);",
      },
      {
        name: "Convert XML to HL7 v2.x (default parameters)",
        description: "Converts an XML string to HL7 v2.x with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('HL7V2').fromXML(message);",
      },
      {
        name: "Convert XML to HL7 v2.x (custom parameters)",
        description: "Converts an XML string to HL7 v2.x with custom serializer parameters.",
        code: "var deserializationProperties = SerializerFactory.getDefaultDeserializationProperties('HL7V2');\nSerializerFactory.getSerializer('HL7V2', null, deserializationProperties).fromXML(message);",
      },

      // ── DICOM — DataTypeCodeTemplatePlugin (isDefaultOnly:true → 2 items, no custom variants)
      {
        name: "Convert DICOM to XML (default parameters)",
        description:
          "Converts an encoded DICOM string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('DICOM').toXML(message);",
      },
      {
        name: "Convert XML to DICOM (default parameters)",
        description: "Converts an XML string to DICOM with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('DICOM').fromXML(message);",
      },

      // ── HL7 v3.x — DataTypeCodeTemplatePlugin (isDefaultOnly:false, but no deserialization properties → 3 items)
      {
        name: "Convert HL7 v3.x to XML (default parameters)",
        description:
          "Converts an encoded HL7 v3.x string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('HL7V3').toXML(message);",
      },
      {
        name: "Convert HL7 v3.x to XML (custom parameters)",
        description:
          "Converts an encoded HL7 v3.x string to XML with custom serializer parameters.",
        code: "var serializationProperties = SerializerFactory.getDefaultSerializationProperties('HL7V3');\nSerializerFactory.getSerializer('HL7V3', serializationProperties, null).toXML(message);",
      },
      {
        name: "Convert XML to HL7 v3.x (default parameters)",
        description: "Converts an XML string to HL7 v3.x with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('HL7V3').fromXML(message);",
      },

      // ── NCPDP — DataTypeCodeTemplatePlugin (isDefaultOnly:false → 4 items)
      {
        name: "Convert NCPDP to XML (default parameters)",
        description:
          "Converts an encoded NCPDP string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('NCPDP').toXML(message);",
      },
      {
        name: "Convert NCPDP to XML (custom parameters)",
        description: "Converts an encoded NCPDP string to XML with custom serializer parameters.",
        code: "var serializationProperties = SerializerFactory.getDefaultSerializationProperties('NCPDP');\nSerializerFactory.getSerializer('NCPDP', serializationProperties, null).toXML(message);",
      },
      {
        name: "Convert XML to NCPDP (default parameters)",
        description: "Converts an XML string to NCPDP with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('NCPDP').fromXML(message);",
      },
      {
        name: "Convert XML to NCPDP (custom parameters)",
        description: "Converts an XML string to NCPDP with custom serializer parameters.",
        code: "var deserializationProperties = SerializerFactory.getDefaultDeserializationProperties('NCPDP');\nSerializerFactory.getSerializer('NCPDP', null, deserializationProperties).fromXML(message);",
      },

      // ── EDI / X12 — DataTypeCodeTemplatePlugin (isDefaultOnly:false → 4 items; plugin name "EDI/X12")
      {
        name: "Convert EDI / X12 to XML (default parameters)",
        description:
          "Converts an encoded EDI/X12 string to XML with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('EDI/X12').toXML(message);",
      },
      {
        name: "Convert EDI / X12 to XML (custom parameters)",
        description: "Converts an encoded EDI/X12 string to XML with custom serializer parameters.",
        code: "var serializationProperties = SerializerFactory.getDefaultSerializationProperties('EDI/X12');\nSerializerFactory.getSerializer('EDI/X12', serializationProperties, null).toXML(message);",
      },
      {
        name: "Convert XML to EDI / X12 (default parameters)",
        description: "Converts an XML string to EDI/X12 with the default serializer parameters.",
        code: "SerializerFactory.getSerializer('EDI/X12').fromXML(message);",
      },
      {
        name: "Convert XML to EDI / X12 (custom parameters)",
        description: "Converts an XML string to EDI/X12 with custom serializer parameters.",
        code: "var deserializationProperties = SerializerFactory.getDefaultDeserializationProperties('EDI/X12');\nSerializerFactory.getSerializer('EDI/X12', null, deserializationProperties).fromXML(message);",
      },

      // ── DICOM image utilities (require connectorMessage → connector-context only)
      {
        name: "Convert DICOM to BASE-64 Image",
        description:
          "Convert uncompressed DICOM to a BASE-64 image string (TIF, JPEG, BMP, PNG, or RAW).",
        code: "DICOMUtil.convertDICOM('imagetype', connectorMessage, sliceIndex)",
        scriptExclude: true,
      },
      {
        name: "Convert DICOM to byte array",
        description: "Convert uncompressed DICOM to a byte array image.",
        code: "DICOMUtil.convertDICOMToByteArray('imagetype', connectorMessage, sliceIndex)",
        scriptExclude: true,
      },
      {
        name: "Get DICOM image slice count",
        description: "Returns the number of image slices in an uncompressed DICOM image.",
        code: "DICOMUtil.getSliceCount(connectorMessage)",
        scriptExclude: true,
      },
      {
        name: "Get DICOM message",
        description: "Gets the full DICOM message with image data.",
        code: "DICOMUtil.getDICOMMessage(connectorMessage)",
        scriptExclude: true,
      },
    ],
  },

  // ── Date Functions
  {
    id: "date",
    label: "Date Functions",
    items: [
      {
        name: "Get Date Object From Pattern",
        description: "Parse a date string according to the specified pattern.",
        code: "var date = DateUtil.getDate(pattern, date);",
      },
      {
        name: "Format Date Object",
        description: "Format a Date object to a string based on the given pattern.",
        code: "var dateString = DateUtil.formatDate(pattern, date);",
      },
      {
        name: "Convert Date String",
        description: "Parse a date string and reformat it to a new pattern.",
        code: "var dateString = DateUtil.convertDate(inpattern, outpattern, date);",
      },
      {
        name: "Get Current Date",
        description: "Returns the current date/time formatted with the given pattern.",
        code: "var dateString = DateUtil.getCurrentDate(pattern);",
      },
    ],
  },

  // ── Response Transformer
  {
    id: "response",
    label: "Response Transformer",
    items: [
      {
        name: "Set Response Status to SENT",
        description: "Indicates message was successfully SENT.",
        code: "responseStatus = SENT;",
        // Response Transformer scope only — `responseStatus` / `responseStatusMessage`
        // / `responseErrorMessage` are not defined in regular filter/transformer
        // editors. Mirrors Java's CONTEXT_RESPONSE_TRANSFORMER.
        contexts: ["DESTINATION_RESPONSE_TRANSFORMER"],
      },
      {
        name: "Set Response Status to QUEUED",
        description: "Indicates message should be QUEUED (or ERROR if queuing disabled).",
        code: "responseStatus = QUEUED;",
        // Response Transformer scope only — `responseStatus` / `responseStatusMessage`
        // / `responseErrorMessage` are not defined in regular filter/transformer
        // editors. Mirrors Java's CONTEXT_RESPONSE_TRANSFORMER.
        contexts: ["DESTINATION_RESPONSE_TRANSFORMER"],
      },
      {
        name: "Set Response Status to ERROR",
        description: "Indicates message status should be set to ERROR.",
        code: "responseStatus = ERROR;",
        // Response Transformer scope only — `responseStatus` / `responseStatusMessage`
        // / `responseErrorMessage` are not defined in regular filter/transformer
        // editors. Mirrors Java's CONTEXT_RESPONSE_TRANSFORMER.
        contexts: ["DESTINATION_RESPONSE_TRANSFORMER"],
      },
      {
        name: "Set Response Status Message",
        description: "Sets the status message of the response.",
        code: "responseStatusMessage = '';",
        // Response Transformer scope only — `responseStatus` / `responseStatusMessage`
        // / `responseErrorMessage` are not defined in regular filter/transformer
        // editors. Mirrors Java's CONTEXT_RESPONSE_TRANSFORMER.
        contexts: ["DESTINATION_RESPONSE_TRANSFORMER"],
      },
      {
        name: "Set Response Error Message",
        description: "Sets the error message of the response.",
        code: "responseErrorMessage = '';",
        // Response Transformer scope only — `responseStatus` / `responseStatusMessage`
        // / `responseErrorMessage` are not defined in regular filter/transformer
        // editors. Mirrors Java's CONTEXT_RESPONSE_TRANSFORMER.
        contexts: ["DESTINATION_RESPONSE_TRANSFORMER"],
      },
    ],
  },

  // ── Channel Functions
  {
    id: "channel",
    label: "Channel Functions",
    items: [
      {
        name: "channelId",
        description: "The current channel's unique ID string.",
        code: "channelId",
      },
      {
        name: "channelName",
        description: "The current channel's name string.",
        code: "channelName",
      },
    ],
  },

  // ── Postprocessor Functions
  {
    id: "postprocessor",
    label: "Postprocessor Functions",
    items: [
      {
        name: "Completed Message Object",
        description:
          "The final ImmutableMessage object, containing all processed source and destination connector messages.",
        code: "message",
        contexts: ["CHANNEL_POSTPROCESSOR", "GLOBAL_POSTPROCESSOR"],
      },
      {
        name: "Get Merged Connector Message",
        description:
          "Returns a connector message with merged channel/response maps from all connectors.",
        code: "message.getMergedConnectorMessage()",
        contexts: ["CHANNEL_POSTPROCESSOR", "GLOBAL_POSTPROCESSOR"],
      },
      {
        name: "Get Source Connector Message",
        description: "Returns the source connector message from the final message object.",
        code: "message.getConnectorMessages().get(0)",
        contexts: ["CHANNEL_POSTPROCESSOR", "GLOBAL_POSTPROCESSOR"],
      },
      {
        name: "Get Destination Connector Message",
        description:
          "Returns a specific destination connector message from the final message object.",
        code: "message.getConnectorMessages().get(metaDataId)",
        contexts: ["CHANNEL_POSTPROCESSOR", "GLOBAL_POSTPROCESSOR"],
      },
    ],
  },

  // ── E4X XML Functions
  {
    id: "e4x",
    label: "E4X Functions",
    items: [
      {
        name: "XML()",
        description: "Construct a new E4X XML object (optionally pass a string or XML value).",
        code: "new XML(value)",
      },
      {
        name: "XMLList()",
        description: "Construct a new E4X XMLList object.",
        code: "new XMLList(value)",
      },
      {
        name: "Namespace()",
        description: "Construct a new Namespace object (pass uri, or prefix + uri).",
        code: "new Namespace(uriValue)",
      },
      {
        name: "addNamespace()",
        description: "Add a namespace declaration to the in-scope namespaces of this XML object.",
        code: "msg.addNamespace(namespace)",
      },
      {
        name: "appendChild()",
        description: "Append the given child to the end of this XML object's properties.",
        code: "msg.appendChild(child)",
      },
      {
        name: "attribute()",
        description: "Returns an XMLList of zero or one XML attributes with the given name.",
        code: "msg.attribute('attributeName')",
      },
      {
        name: "attributes()",
        description: "Returns an XMLList of all XML attributes of this object.",
        code: "msg.attributes()",
      },
      {
        name: "child()",
        description: "Returns the list of children matching the given name or index.",
        code: "msg.child('propertyName')",
      },
      {
        name: "childIndex()",
        description: "Returns the ordinal position of this XML object within its parent.",
        code: "msg.childIndex()",
      },
      {
        name: "children()",
        description: "Returns an XMLList of all properties of this XML object in order.",
        code: "msg.children()",
      },
      {
        name: "comments()",
        description: "Returns an XMLList of XML comment properties of this object.",
        code: "msg.comments()",
      },
      {
        name: "contains()",
        description: "Compares this XML object with the given value.",
        code: "msg.contains(value)",
      },
      {
        name: "copy()",
        description: "Returns a deep copy of this XML object with parent set to null.",
        code: "msg.copy()",
      },
      {
        name: "descendants()",
        description:
          "Returns all XML valued descendants of this object, optionally matching a name.",
        code: "msg.descendants('name')",
      },
      {
        name: "elements()",
        description: "Returns an XMLList of child XML elements, optionally matching a name.",
        code: "msg.elements('name')",
      },
      {
        name: "hasComplexContent()",
        description: "Returns true if this XML object contains complex content (child elements).",
        code: "msg.hasComplexContent()",
      },
      {
        name: "hasSimpleContent()",
        description:
          "Returns true if this XML object contains simple content (text/attribute/no child elements).",
        code: "msg.hasSimpleContent()",
      },
      {
        name: "insertChildAfter()",
        description: "Insert child2 after child1 in this XML object.",
        code: "msg.insertChildAfter(child1, child2)",
      },
      {
        name: "insertChildBefore()",
        description: "Insert child2 before child1 in this XML object.",
        code: "msg.insertChildBefore(child1, child2)",
      },
      {
        name: "length()",
        description: "Returns 1 for a single XML object (or the length for XMLList).",
        code: "msg.length()",
      },
      {
        name: "localName()",
        description: "Returns the local name portion of the qualified name.",
        code: "msg.localName()",
      },
      {
        name: "name()",
        description: "Returns the qualified name (QName) of this XML object.",
        code: "msg.name()",
      },
      {
        name: "namespace()",
        description:
          "Returns the namespace associated with this XML object (optionally pass prefix).",
        code: "msg.namespace()",
      },
      {
        name: "normalize()",
        description:
          "Merge adjacent text nodes and eliminate empty text nodes; returns this XML object.",
        code: "msg.normalize()",
      },
      {
        name: "parent()",
        description: "Returns the parent of this XML object.",
        code: "msg.parent()",
      },
      {
        name: "prependChild()",
        description: "Insert the given child before all existing XML properties.",
        code: "msg.prependChild(child)",
      },
      {
        name: "removeNamespace()",
        description: "Remove the given namespace from this object and all its descendants.",
        code: "msg.removeNamespace(namespace)",
      },
      {
        name: "replace()",
        description:
          "Replace the XML properties of this object specified by propertyName with value.",
        code: "msg.replace('propertyName', value)",
      },
      {
        name: "setChildren()",
        description: "Replace all XML properties of this object with a new set.",
        code: "msg.setChildren(value)",
      },
      {
        name: "setLocalName()",
        description: "Replace the local name of this XML object.",
        code: "msg.setLocalName('name')",
      },
      {
        name: "setName()",
        description: "Replace the qualified name of this XML object.",
        code: "msg.setName('name')",
      },
      {
        name: "setNamespace()",
        description: "Replace the namespace associated with the name of this XML object.",
        code: "msg.setNamespace(ns)",
      },
      {
        name: "text()",
        description: "Returns an XMLList of all text node properties of this object.",
        code: "msg.text()",
      },
      {
        name: "toString()",
        description: "Returns a string representation of this XML object.",
        code: "msg.toString()",
      },
      {
        name: "toXMLString()",
        description: "Returns an XML-encoded string representation including start/end tags.",
        code: "msg.toXMLString()",
      },
    ],
  },

  // ── HTTP Listener Functions (connector plugin — HTTP Listener source)
  {
    id: "httpListener",
    label: "HTTP Listener Functions",
    items: [
      {
        name: "sourceMap.get('method')",
        description: "Retrieves the method (e.g. GET, POST) from an incoming HTTP request.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('contextPath')",
        description: "Retrieves the context path from an incoming HTTP request.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('headers').getHeader('Header-Name')",
        description: "Retrieves a header value from an incoming HTTP request.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('parameters').getParameter('parameterName')",
        description:
          "Retrieves a query/form parameter from an incoming HTTP request. If multiple values exist for the parameter, an array will be returned.",
        scriptExclude: true,
      },
      {
        name: "HTTPUtil.httpBodyToXml(httpBody, contentType)",
        description:
          "Serializes an HTTP request body into XML. Multipart requests will also automatically be parsed into separate XML nodes. The body may be passed in as a string or input stream.",
        scriptExclude: true,
      },
    ],
  },

  // ── HTTP Sender Functions (connector plugin — HTTP Sender response transformer)
  {
    id: "httpSender",
    label: "HTTP Sender Functions",
    items: [
      {
        name: "$('responseStatusLine')",
        description:
          'Retrieves the status line (e.g. "HTTP/1.1 200 OK") from an HTTP response, for use in the response transformer.',
        scriptExclude: true,
      },
      {
        name: "$('responseHeaders').getHeader('Header-Name')",
        description:
          "Retrieves a header value from an HTTP response, for use in the response transformer.",
        scriptExclude: true,
      },
    ],
  },

  // ── File Reader Functions (connector plugin — File Reader source)
  {
    id: "fileReader",
    label: "File Reader Functions",
    items: [
      {
        name: "sourceMap.get('originalFilename')",
        description: "Retrieves the name of the file read by the File Reader.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('fileDirectory')",
        description: "Retrieves the parent directory of the file read by the File Reader.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('fileSize')",
        description: "Retrieves the size (in bytes) of the file read by the File Reader.",
        scriptExclude: true,
      },
      {
        name: "sourceMap.get('fileLastModified')",
        description:
          "Retrieves the last modified timestamp (in milliseconds since January 1st, 1970) of the file read by the File Reader.",
        scriptExclude: true,
      },
    ],
  },

  // ── Lookup Table Functions (custom extension plugin — LookupHelper global utility)
  // Source: LookupTableReferencePlugin.java — uses CodeTemplateContextSet.getConnectorContextSet()
  {
    id: "lookupTable",
    label: "Lookup Table Functions",
    items: [
      {
        name: "Lookup Value by Key",
        description:
          "Retrieves a value from the specified lookup group using the given key. Returns null if no match is found.",
        code: "var value = LookupHelper.get(group, key);",
        scriptExclude: true,
      },
      {
        name: "Lookup Value by Key with TTL",
        description:
          "Retrieves a value from the specified lookup group using the given key and a TTL expressed in hours and minutes. If both values are 0, TTL is ignored. If the cached or database value is older than the TTL, null is returned.",
        code: "var value = LookupHelper.get(group, key, /*ttlHours*/ 0, /*ttlMinutes*/ 30);",
        scriptExclude: true,
      },
      {
        name: "Lookup Value with Default Fallback",
        description:
          "Retrieves a value from a lookup group, or returns the default if the group or key is missing.",
        code: "var value = LookupHelper.get(group, key, defaultValue);",
        scriptExclude: true,
      },
      {
        name: "Lookup Value with TTL and Default Fallback",
        description:
          "Retrieves a value from the specified lookup group using the given key and a TTL expressed in hours and minutes. If both hours and minutes are 0, TTL is ignored. If the value is missing or stale, the provided default value is returned instead.",
        code: "var value = LookupHelper.get(group, key, /*ttlHours*/ 0, /*ttlMinutes*/ 30, /*defaultValue*/ 'N/A');",
        scriptExclude: true,
      },
      {
        name: "Lookup Values Matching Pattern",
        description:
          "Retrieves key-value pairs from the specified lookup group using the default limit (1000). Returns an empty map if the group does not exist or no matches are found.",
        code: "var values = LookupHelper.getMatching(group, keyPattern);",
        scriptExclude: true,
      },
      {
        name: "Lookup Values Matching Pattern (Custom Limit)",
        description:
          "Retrieves key-value pairs from the specified lookup group using a custom limit. The limit is capped internally to prevent excessive memory usage. Returns an empty map if the group does not exist or no matches are found.",
        code: "var values = LookupHelper.getMatching(group, keyPattern, limit);",
        scriptExclude: true,
      },
      {
        name: "Lookup Values Count Matching Pattern",
        description:
          "Retrieves the number of entries in the specified lookup group whose keys match the given pattern. Returns 0 if the group does not exist or no matches are found.",
        code: "var count = LookupHelper.getMatchingCount(group, keyPattern);",
        scriptExclude: true,
      },
      {
        name: "Batch Lookup by Keys",
        description:
          "Retrieves multiple key-value pairs from the specified lookup group in a single operation. Returns an empty map if the group is not found or none of the keys exist.",
        code: 'var keys = ["key1", "key2", "key3"];\nvar values = LookupHelper.getBatch(group, keys);',
        scriptExclude: true,
      },
      {
        name: "Batch Lookup by Keys with TTL",
        description:
          "Retrieves multiple key-value pairs from the specified lookup group using a TTL expressed in hours and minutes. If both hours and minutes are 0, TTL is ignored. Only values updated within the TTL window are returned. Returns an empty map if the group is not found, or if all values are stale or missing.",
        code: 'var keys = ["key1", "key2", "key3"];\nvar batch = LookupHelper.getBatch(group, keys, /*ttlHours*/ 0, /*ttlMinutes*/ 30);',
        scriptExclude: true,
      },
      {
        name: "Lookup Key Existence in Group",
        description:
          "Checks whether the specified key exists in the given lookup group. Returns true if found; false if the group or key does not exist, or if an error occurs.",
        code: "var found = LookupHelper.exists(group, key);",
        scriptExclude: true,
      },
      {
        name: "Get Lookup Cache Statistics",
        description:
          "Retrieves cache and usage statistics for the specified lookup group, including hit/miss counts, hit rate, evictions, total lookups, and last accessed time. Returns an empty map if the group is not found or an error occurs.",
        code: "var stats = LookupHelper.getCacheStats(group);",
        scriptExclude: true,
      },
      {
        name: "Set Lookup Value by Key",
        description:
          "Sets a value in the specified lookup group using the given key. Returns true if successful, false otherwise.",
        code: "var success = LookupHelper.set(group, key, value);",
        scriptExclude: true,
      },
      {
        name: "Deletes a lookup value by group name and key",
        description:
          "Deletes a value in the specified lookup group by key. Returns true if successful, false otherwise.",
        code: "var success = LookupHelper.deleteValue(group, key);",
        scriptExclude: true,
      },
      {
        name: "Deletes all lookup values in the specified group",
        description:
          "Deletes all values in the given lookup group. Returns true if successful, false otherwise.",
        code: "var success = LookupHelper.deleteAllValues(group);",
        scriptExclude: true,
      },
      {
        name: "Imports multiple values into a lookup group",
        description:
          "Imports key-value pairs into the specified lookup group. If clearExisting is true, all existing values are removed before import. Returns { ok: 'true', groupId, importedCount } on success; otherwise { ok: 'false', errorCode, errorMessage }.",
        code: "var payload = {\n  \"key1\": \"value1\",\n  \"key2\": \"value2\"\n};\nvar res = LookupHelper.importValues(group, payload, true);\nif (!res || String(res.ok) !== 'true') {\n  logger.error('Import values failed for group: ' + group + (res ? (' - ' + res.errorMessage) : ''));\n} else {\n  logger.info('Imported ' + res.importedCount + ' entries into groupId=' + res.groupId);\n}",
        scriptExclude: true,
      },
      {
        name: "Put Lookup Value If Absent",
        description:
          "Inserts a value into the specified lookup group only if the key does not already exist. Returns true if the value was inserted, false otherwise.",
        code: "var success = LookupHelper.putIfAbsent(group, key, value);\nif (!success) {\n  logger.warn('Key already exists or insert failed in group: ' + group);\n}",
        scriptExclude: true,
      },
      {
        name: "Compare and Swap Lookup Value",
        description:
          "Atomically updates a lookup value only if its current value matches the expected value. Returns true if the value was successfully updated; false if the key does not exist, the value does not match, or an error occurred.",
        code: "var success = LookupHelper.compareAndSwap(group, key, expectedValue, newValue);\nif (!success) {\n  logger.warn('Compare-and-swap failed for group: ' + group + ', key: ' + key + ', expectedValue: ' + expectedValue + ', newValue: ' + newValue);\n}",
        scriptExclude: true,
      },
      {
        name: "Update Lookup Value by Delta",
        description:
          "Atomically increments or decrements the numeric value of a lookup key by the specified delta. Returns true if the value was successfully updated; false if the group or key was not found, or if an error occurred.",
        code: "var success = LookupHelper.updateValueByDelta(group, key, delta);\nif (!success) {\n  logger.warn('Failed to update lookup value by delta for group: ' + group + ', key: ' + key + ', delta: ' + delta);\n}",
        scriptExclude: true,
      },
      {
        name: "Search lookup values by JSON filter (Advanced)",
        description:
          "Retrieves lookup values using advanced JSON field filtering with an optional key pattern. Filters are provided as an array of conditions (field, operator, valueType, value) and converted to JSON before execution. Nested JSON paths are supported. The key pattern uses SQL LIKE semantics. For performance reasons, only the first 1000 matching entries are returned.",
        code: 'var groupName = "MyGroup";\nvar keyPattern = "user_%";\nvar filterObj = [\n  { "field": "user.profile.age", "op": ">=", "valueType": "NUMBER", "value": "40" },\n  { "field": "meta.role", "op": "=", "valueType": "STRING", "value": "support" }\n];\nvar filterJson = JSON.stringify(filterObj);\nvar results = LookupHelper.searchValuesByJsonFields(groupName, keyPattern, filterJson);',
        scriptExclude: true,
      },
      {
        name: "Creates a lookup group",
        description:
          "Creates a lookup group. Required fields: name, description, version, cacheSize, cachePolicy. Optional: valueType (TEXT/JSON), jsonIndexMode (NONE/FIELD), and indexedJsonFields (JSON array string) when FIELD mode is used. JSON is not available on Derby; the server validates JSON support per database. Returns { ok: 'true', group: {...} } on success; otherwise { ok: 'false', errorCode, errorMessage }.",
        code: "var payload = {\n  name: 'MyGroup',\n  description: 'optional',\n  version: '1.0.0',\n  cacheSize: '1000',\n  cachePolicy: 'LRU'\n};\nvar res = LookupHelper.createGroup(payload);\nif (!res || String(res.ok) !== 'true') {\n  logger.error('Create group failed: ' + (res ? (res.errorCode + ' - ' + res.errorMessage) : 'unknown'));\n} else {\n  logger.info('Created group id=' + res.group.id + ', name=' + res.group.name);\n}",
        scriptExclude: true,
      },
      {
        name: "Deletes a lookup group",
        description:
          "Deletes the specified lookup group by name. Returns true if successful, false otherwise.",
        code: "var success = LookupHelper.deleteGroup(group);",
        scriptExclude: true,
      },
    ],
  },
];

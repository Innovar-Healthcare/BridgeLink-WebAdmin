// ─── Dashboard bottom panel ───────────────────────────────────────────────────

/**
 * A single server log entry returned by GET /extensions/serverlog/.
 * Individual fields are preserved for structured display and the detail dialog.
 */
export interface ServerLogItem {
  id: number;
  level: string; // "ERROR" | "WARN" | "INFO" | "DEBUG" | ""
  date: string; // UTC timestamp: "yyyy-MM-dd HH:mm:ss.SSS" (may be empty)
  category: string; // FQN class name (e.g. "com.mirth.connect.connectors.tcp.TcpReceiver")
  lineNumber: string; // Source line number (e.g. "746")
  message: string; // The actual log message text only
  throwableInformation: string | null; // Stack trace, if present
}

/**
 * A single connection log entry returned by
 * GET /extensions/dashboardstatus/connectionLogs.
 * eventState mirrors Java's ConnectorState enum.
 */
export interface ConnectionLogItem {
  logId: number;
  channelId: string;
  channelName: string;
  /** e.g. "Source: TCP Listener (HL7 -> HL7)" or "Destination: TCP Sender - dest1" */
  connectorType: string;
  eventState: "CONNECTED" | "IDLE" | "DISCONNECTED" | "INITIALIZED" | "DONE" | string;
  information: string;
  /** Formatted as "yyyy-MM-dd HH:mm:ss.SSS" */
  dateAdded: string;
}

/**
 * One time-series bucket from GET /statistics/timeseries/channels/{id}.
 * All counts are for the bucket's time window (bucketSizeMinutes).
 */
export interface MessageStatisticsTimeseries {
  id: number;
  channelId: string;
  connectorId: string | null;
  serverId: string;
  /** ISO timestamp for the start of this bucket */
  ts: string;
  bucketSizeMinutes: number;
  received: number;
  filtered: number;
  queued: number;
  sent: number;
  error: number;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginStatus {
  status: "SUCCESS" | "FAIL" | "FAIL_EXPIRED" | "FAIL_LOCKED_OUT" | "FAIL_VERSION_MISMATCH";
  message: string;
  updatedUsername?: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  description?: string;
  phoneNumber?: string;
  industry?: string;
  country?: string;
  stateTerritory?: string;
  role?: string;
  lastLogin?: string;
  // Server-only fields (brute-force protection). Calendar values normalized
  // to ISO strings by XStream. NEVER send back — server expects Calendar format.
  gracePeriodStart?: string;
  lastStrikeTime?: string;
  strikeCount?: number;
}

// ─── Dashboard / Channels ────────────────────────────────────────────────────

export type DeployedState =
  | "STARTED"
  | "STARTING"
  | "PAUSED"
  | "PAUSING"
  | "STOPPED"
  | "STOPPING"
  | "DEPLOYING"
  | "UNDEPLOYING"
  | "SYNCING";

// After XStream normalization, statistics is a map keyed by status name
export interface ChannelStatistics {
  RECEIVED?: number;
  SENT?: number;
  ERROR?: number;
  FILTERED?: number;
  QUEUED?: number;
  // legacy camelCase fields (may appear on some endpoints)
  received?: number;
  sent?: number;
  error?: number;
  filtered?: number;
  queued?: number;
}

export type StatusType = "CHANNEL" | "CHAIN" | "SOURCE_CONNECTOR" | "DESTINATION_CONNECTOR";

export interface DashboardStatus {
  channelId: string;
  name: string;
  state: DeployedState;
  deployedRevisionDelta?: number;
  codeTemplatesChanged?: boolean;
  deployedDate?: string;
  statistics?: ChannelStatistics;
  lifetimeStatistics?: ChannelStatistics;
  metaDataId?: number;
  statusType?: StatusType;
  queueEnabled?: boolean;
  queued?: number;
  childStatuses?: DashboardStatus[];
}

/**
 * Response of GET /channels/statuses/initial (com.mirth.connect.model.DashboardChannelInfo).
 * The first batch of statuses, the IDs of the channels not yet fetched, and the
 * total deployed channel count. Shapes are post-normalizeXStream: the XStream
 * List and Set both collapse to plain arrays.
 */
export interface DashboardChannelInfo {
  dashboardStatuses: DashboardStatus[];
  remainingChannelIds: string[];
  deployedChannelCount: number;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  revision: number;
  enabled: boolean;
  exportData?: {
    metadata?: {
      enabled: boolean;
      lastModified?: string; // Java: channel.getExportData().getMetadata().getLastModified()
    };
  };
  sourceConnector?: {
    transportName?: string;
    properties?: Record<string, unknown>;
    transformer?: {
      inboundDataType?: string;
      outboundDataType?: string;
    };
  };
  destinationConnectors?: Array<{
    metaDataId: number;
    name: string;
    transportName?: string;
    enabled: boolean;
  }>;
  tags?: Array<{ name: string; backgroundColor?: string }>;
}

/**
 * One entry in the XStream JSON map sent as the request body to POST /channels/_getSummary.
 * Mirrors Java's ChannelHeader exactly:
 *   com.mirth.connect.model.ChannelHeader { int revision; Calendar deployedDate; boolean codeTemplatesChanged }
 *
 * The full body must be wrapped in XStream's linked-hash-map format — see getChannelSummary()
 * in api-client.ts for the exact envelope.
 *
 * deployedDate: XStream serializes java.util.Calendar as {"time": <epochMillis>, "timezone": "<tz>"}.
 * Send null when the channel has not been deployed.
 * Do NOT send an ISO-8601 string — XStream's GregorianCalendarConverter expects {time, timezone}.
 */
export interface ChannelHeader {
  revision: number;
  deployedDate?: { time: number; timezone: string }; // omitted (not null) when channel is undeployed
  codeTemplatesChanged: boolean;
}

/**
 * One item in the List<ChannelSummary> returned by POST /channels/_getSummary.
 * channelStatus.channel is only populated when the channel has changed since
 * the cached revision — otherwise it is null/absent (delta pattern).
 */
export interface ChannelSummary {
  channelId: string;
  deleted?: boolean;
  undeployed?: boolean;
  channelStatus?: {
    channel?: Channel; // full Channel object, only when changed
    deployedDate?: string; // ISO string
    deployedRevisionDelta?: number;
    codeTemplatesChanged?: boolean;
    localChannelId?: number;
  };
}

export interface ChannelGroup {
  id: string;
  name: string;
  description?: string;
  // Null when the server returns a group with no channels assigned (an empty
  // <channels/> normalizes to null, not []). Always read via `channels ?? []`.
  channels?: Array<{ id: string }> | null;
  lastModified?: string;
  revision?: number;
}

/**
 * Mirrors Java's ChannelTag model.
 * Tags are server-side entities; each tag holds the set of channel IDs it applies to.
 * backgroundColor comes from XStream-serialized java.awt.Color — after normalization
 * it may be an object with r/g/b int fields, or we fall back to a hex string.
 */
export interface ChannelTag {
  id: string;
  name: string;
  channelIds: string[]; // normalized from Set<String>
  backgroundColor?: XStreamColor | string;
}

/** XStream serialization of java.awt.Color */
export interface XStreamColor {
  r?: number;
  red?: number;
  g?: number;
  green?: number;
  b?: number;
  blue?: number;
  alpha?: number;
  value?: number; // packed ARGB int (fallback)
}

// ─── Server Settings (mirrors com.mirth.connect.model.ServerSettings) ────────

export interface MetaDataColumn {
  name: string;
  type: string;
  mappingName?: string; // present in server response, read-only / not displayed
}

/**
 * Mirrors Java's ServerSettings model.
 * Returned by GET /server/settings (wrapped in {"serverSettings":{...}}), saved with PUT /server/settings.
 *
 * Note on field types:
 *  - defaultAdministratorBackgroundColor: server returns {red,green,blue,alpha} (java.awt.Color XStream format)
 *  - smtpSecure: server returns integer 0/1/2; web UI converts to/from "none"/"tls"/"ssl"
 *  - smtpTimeout: server returns integer (ms); web UI converts to/from string
 */
export interface ServerSettings {
  // General
  environmentName?: string;
  serverName?: string;
  /** java.awt.Color — server sends {red,green,blue,alpha}; color picker works with {r,g,b} */
  defaultAdministratorBackgroundColor?: {
    red?: number;
    green?: number;
    blue?: number;
    alpha?: number;
    r?: number;
    g?: number;
    b?: number;
    value?: number; // legacy / color-picker format
  } | null;
  // Auto logout
  administratorAutoLogoutIntervalEnabled?: boolean;
  administratorAutoLogoutIntervalField?: number; // minutes (1-60)
  // Channel
  clearGlobalMap?: boolean;
  queueBufferSize?: number;
  defaultMetaDataColumns?: MetaDataColumn[];
  // SMTP
  smtpHost?: string;
  smtpPort?: string;
  smtpTimeout?: string | number; // server returns integer (ms); UI keeps as string
  smtpFrom?: string;
  smtpSecure?: "none" | "tls" | "ssl" | number; // server returns 0/1/2; UI maps to string
  /** Legacy boolean — kept for round-trip; use smtpAuthType for display logic */
  smtpAuth?: boolean;
  /** "NONE" | "BASIC" | "OAUTH" — added in BridgeLink 4.x; absent on older servers */
  smtpAuthType?: "NONE" | "BASIC" | "OAUTH";
  smtpUsername?: string;
  smtpPassword?: string;
  // OAuth 2.0 Client Credentials fields (used when smtpAuthType === "OAUTH")
  smtpOAuthClientId?: string;
  smtpOAuthClientSecret?: string;
  smtpOAuthTokenEndpointUrl?: string;
  smtpOAuthScope?: string;
  // Notification
  loginNotificationEnabled?: boolean;
  loginNotificationMessage?: string;
}

/**
 * Subset of server settings readable by any authenticated user via
 * GET /server/publicSettings (Java's PublicServerSettings, which extends
 * ServerSettings). The login flow only needs the login-notification and
 * keystore fields; the server also returns environmentName/serverName/etc.
 * which we ignore here.
 */
export interface PublicServerSettings {
  loginNotificationEnabled?: boolean;
  loginNotificationMessage?: string;
  /**
   * True when the server's keystore (SSL/TLS cert for the API + Administrator on
   * port 8443) is still using its default passwords. Java decodes this via
   * intToBooleanObject exactly like loginNotificationEnabled, so it arrives as a
   * plain boolean after normalizeXStream. Drives the post-login keystore warning
   *, mirrors Java LoginPanel.handleSuccess / KeystoreWarningDialog).
   */
  keystoreUsingDefaultPassword?: boolean;
}

/**
 * Mirrors com.mirth.connect.model.UpdateSettings. Fetched via GET /server/updateSettings
 * and re-saved on every Server-tab save with statsEnabled=false, matching Java's
 * SettingsPanelServer (the update/stats radios are hidden in this fork). Forcing
 * statsEnabled=false heals servers migrated from Mirth with stats.enabled=1.
 */
export interface UpdateSettings {
  statsEnabled: boolean;
  lastStatsTime?: number;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export type MessageStatus =
  | "RECEIVED"
  | "TRANSFORMED"
  | "FILTERED"
  | "QUEUED"
  | "SENT"
  | "ERROR"
  | "PENDING";

/** Single piece of message content (raw, encoded, sent, response, etc.) */
export interface MessageContent {
  content: string;
  dataType: string;
  encrypted: boolean;
  contentType?: string; // e.g., "RAW", "SENT"
}

export interface ConnectorMessage {
  messageId: number;
  channelId: string;
  metaDataId: number;
  channelName: string;
  connectorName: string;
  receivedDate: string;
  sendDate?: string;
  responseDate?: string;
  status: MessageStatus;
  sendAttempts: number;
  errorCode?: number;

  // Content types — returned when includeContent=true or when fetching a single message
  content?: Record<string, MessageContent>;
  // Individual content accessors (may come from normalizeXStream depending on API response shape)
  raw?: MessageContent;
  processedRaw?: MessageContent;
  transformed?: MessageContent;
  encoded?: MessageContent;
  sent?: MessageContent;
  response?: MessageContent;
  responseTransformed?: MessageContent;
  processedResponse?: MessageContent;

  // Mappings — for the Mappings tab
  sourceMap?: Record<string, unknown>;
  connectorMap?: Record<string, unknown>;
  channelMap?: Record<string, unknown>;
  responseMap?: Record<string, unknown>;

  // Errors — for the Errors tab
  processingError?: string;
  postProcessorError?: string;
  responseError?: string;

  // Additional table columns
  originalReceivedDate?: string;
  serverId?: string;
  originalServerId?: string;
  originalId?: number;
  importId?: number;
  importChannelId?: string;

  // Custom metadata values (keyed by metadata column name)
  metaDataMap?: Record<string, unknown>;
}

export interface Message {
  messageId: number;
  channelId: string;
  receivedDate: string;
  processed: boolean;
  connectorMessages: Record<string, ConnectorMessage>;
  // Set by client after fetch (from channel cache)
  channelName?: string;
  // Original/import IDs (message-level)
  originalId?: number;
  importId?: number;
  importChannelId?: string;
  serverId?: string;
}

/**
 * Content search element for the advanced filter.
 * Matches Java's ContentSearchElement: groups search strings by content type code.
 */
export interface ContentSearchElement {
  contentCode: number;
  searches: string[];
}

/**
 * Metadata search element for the advanced filter.
 * Matches Java's MetaDataSearchElement.
 */
export interface MetaDataSearchElement {
  columnName: string;
  operator: string; // "EQUAL", "NOT_EQUAL", "LESS_THAN", etc.
  value: unknown;
  ignoreCase: boolean;
  /** Column type used to wrap the value with the correct XStream class attribute. */
  columnType?: string; // "STRING" | "NUMBER" | "BOOLEAN" | "TIMESTAMP"
}

/** Metadata column types (from Java MetaDataColumnType enum) */
export type MetaDataColumnType = "STRING" | "NUMBER" | "BOOLEAN" | "TIMESTAMP";

/**
 * Attachment metadata (returned from GET /channels/{channelId}/messages/{messageId}/attachments).
 * When includeContent=false, content is not populated.
 */
export interface Attachment {
  id: string;
  type: string;
  content?: string; // base64 encoded when present
}

// ─── Message Import / Export ──────────────────────────────────────────────────

/** Mirrors Java MessageImportResult (com.mirth.connect.model.MessageImportResult). */
export interface MessageImportResult {
  totalCount: number;
  successCount: number;
}

/**
 * Mirrors Java MessageWriterOptions (com.mirth.connect.util.MessageExporter$MessageWriterOptions).
 * Used as a form-data part in POST /channels/{channelId}/messages/_exportUsingFilter.
 */
export interface MessageWriterOptions {
  /** null = full XML serialized message; otherwise a ContentType enum name (e.g. "RAW", "SENT") */
  contentType?: string | null;
  /** true = export destination content, false = export source content */
  destinationContent: boolean;
  /** Whether to encrypt exported content */
  encrypt: boolean;
  /** Whether to include attachments (only valid for XML serialized message) */
  includeAttachments: boolean;
  /** Base folder for relative paths (usually user's home directory) */
  baseFolder?: string;
  /** Root output directory on the server */
  rootFolder: string;
  /** File naming pattern using ${message.*} variables */
  filePattern: string;
  /** Archive file name (used when archiveFormat is set) */
  archiveFileName?: string;
  /** Archive format: "zip" | "tar" | null */
  archiveFormat?: string | null;
  /** Compression format: "gz" | "bzip2" | null */
  compressFormat?: string | null;
  /** Whether password protection is enabled (ZIP only) */
  passwordEnabled: boolean;
  /** Password for ZIP encryption */
  password?: string;
  /** Encryption type: "STANDARD" | "AES128" | "AES256" */
  encryptionType?: string | null;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventLevel = "INFORMATION" | "WARNING" | "ERROR";
export type EventOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";

export interface ServerEvent {
  id: number;
  dateTime: string;
  /** XStream Calendar normalized to ISO string — actual event creation time (DATE_CREATED). */
  eventTime?: string;
  level: EventLevel;
  outcome: EventOutcome;
  name: string;
  userId?: number;
  ipAddress?: string;
  serverId?: string;
  channelId?: string;
  channelName?: string;
  patientId?: string;
  attributes?: Record<string, string>;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

/**
 * Mirrors Java's AlertStatus model (com.mirth.connect.model.alert.AlertStatus).
 * Returned by GET /alerts/statuses.
 */
export interface AlertStatus {
  id: string;
  name: string;
  enabled: boolean;
  alertedCount?: number; // only populated when enabled=true
}

/**
 * Per-connector enable/disable state within a partially-enabled channel.
 * metaDataId=0 is the source connector; destinations are 1+; `null` is the
 * per-channel "[New Destinations]" pseudo-connector (alert on destinations
 * added to this channel in the future).
 * Mirrors Java's AlertConnectors.java (two Set<Integer> that may contain null).
 */
export interface AlertConnectors {
  enabledConnectors: (number | null)[];
  disabledConnectors: (number | null)[];
}

/**
 * Controls which channels/connectors trigger an alert.
 * Mirrors Java's AlertChannels.java.
 *
 * - enabledChannels: all connectors enabled for these channel IDs
 * - disabledChannels: all connectors disabled for these channel IDs
 * - partialChannels: per-connector enable/disable (channelId → AlertConnectors)
 * - newChannelSource/newChannelDestination: whether to auto-enable newly created channels
 */
export interface AlertChannels {
  newChannelSource: boolean;
  newChannelDestination: boolean;
  enabledChannels: string[];
  disabledChannels: string[];
  partialChannels: Record<string, AlertConnectors>;
}

/**
 * A single protocol+recipient action within an AlertActionGroup.
 * protocol: "Email" | "Channel" | other registered protocol names.
 * recipient: email address (Email), channel ID (Channel), etc.
 * Mirrors Java's AlertAction.java (@XStreamAlias("alertAction")).
 */
export interface AlertAction {
  protocol: string;
  recipient: string;
}

/**
 * A group of actions sharing a subject and Velocity template.
 * The Java UI only ever creates one group per alert; we follow the same convention.
 * Mirrors Java's AlertActionGroup.java (@XStreamAlias("alertActionGroup")).
 */
export interface AlertActionGroup {
  actions: AlertAction[];
  subject: string;
  template: string;
}

/**
 * The default trigger — fires on error events matching errorEventTypes + optional regex.
 * Mirrors Java's DefaultTrigger.java (@XStreamAlias("defaultTrigger")).
 * errorEventTypes: subset of ErrorEventType enum names (ANY, SOURCE_CONNECTOR, etc.)
 */
export interface AlertTrigger {
  errorEventTypes: string[];
  regex: string;
  alertChannels: AlertChannels;
}

/**
 * Full alert configuration model.
 * Mirrors Java's AlertModel.java (@XStreamAlias("alertModel")).
 * id is absent on create (server assigns UUID).
 */
export interface AlertModel {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: AlertTrigger;
  actionGroups: AlertActionGroup[];
}

/**
 * Response from POST /alerts/_getInfo (no alertId) and POST /alerts/{id}/_getInfo.
 * model is null when called without an alertId (new alert context).
 * protocolOptions: protocol name → { recipientId: recipientName } map
 *   e.g. { "Channel": { "abc-123": "My Channel" }, "Email": {} }
 * changedChannels: channel summaries (used to detect new/removed channels since last save).
 * Mirrors Java's AlertInfo.java.
 */
export interface AlertInfo {
  model: AlertModel | null;
  protocolOptions: Record<string, Record<string, string>>;
  changedChannels: unknown[];
}

// ─── Extensions ──────────────────────────────────────────────────────────────

export interface PluginMetaData {
  name: string;
  pluginVersion: string;
  author: string;
  url: string;
  // NOTE: enabled is NOT returned by GET /extensions/plugins/
  // Use GET /extensions/{name}/enabled for enabled status.
  description?: string;
  /**
   * The extension's folder path (e.g. "smtp") — required by the uninstall API.
   * MetaData.path is `@XStreamAsAttribute` on the server, so after normalizeXStream the
   * key is "@path", not "path". Read "@path" first; "path" is a defensive fallback.
   */
  "@path"?: string;
  path?: string;
}

export interface ConnectorMetaData {
  name: string;
  pluginVersion: string;
  author: string;
  url: string;
  enabled: boolean;
  description?: string;
  /** See PluginMetaData["@path"] — XStream attribute, arrives as "@path" post-normalize. */
  "@path"?: string;
  path?: string;
  type?: string;
  transportName?: string;
  protocol?: string;
}

// ─── Database Tasks ───────────────────────────────────────────────────────────

/** Mirrors com.mirth.connect.model.DatabaseTask.Status */
export type DatabaseTaskStatus = "IDLE" | "RUNNING" | "Idle" | "Running";

/**
 * Mirrors com.mirth.connect.model.DatabaseTask.
 * Returned by GET /databaseTasks/ as Map<String, DatabaseTask> (normalized to Record<string, DatabaseTask>).
 * affectedChannels: Map<String, String> (channelId → channelName).
 */
export interface DatabaseTask {
  id: string;
  status: DatabaseTaskStatus;
  name?: string;
  description?: string;
  confirmationMessage?: string | null;
  affectedChannels?: Record<string, string>;
  startDateTime?: string | null; // ISO string after XStream normalization
}

// ─── Resources ────────────────────────────────────────────────────────────────

/**
 * Mirrors com.mirth.connect.model.ResourceProperties (abstract base class).
 * Concrete implementations add type-specific fields (e.g. directory path).
 * The only concrete type available in open-source BridgeLink is "Directory".
 */
export interface ResourceProperties {
  /** Always "Default Resource" for the built-in default resource. */
  id: string;
  name: string;
  /** Resource type as registered by the ResourceClientPlugin — e.g. "Directory" */
  type: string;
  description?: string;
  /** If true, libraries in this resource are included in global script contexts. */
  includeWithGlobalScripts: boolean;
  /** If true, parent classloader is searched first (prevents overriding server classes). */
  loadParentFirst: boolean;
  /** Directory resource: path to watch. Other resource types may add fields here. */
  directory?: string;
  /**
   * Directory resource: whether to recursively include all subdirectories.
   * Server field name is "directoryRecursion" (com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties).
   */
  directoryRecursion?: boolean;
  /** Populated server-side for InvalidResourceProperties entries. */
  className?: string;
  /** XStream @version attribute (e.g. "4.6.0") — preserved for round-trip serialization. */
  "@version"?: string;
  /**
   * The resource's real XStream element FQN (the list-envelope key, e.g.
   * "com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties"),
   * captured on load and re-emitted on save so each resource round-trips under its
   * own subclass element instead of being forced to Directory. Absent on rows created
   * in the WebUI (which are always Directory — see makeNewResource).
   */
  fqn?: string;
  /**
   * Server plugin point name (e.g. "Directory Resource"), captured on load and
   * re-emitted on save. The server uses it to dispatch the resource to its plugin.
   */
  pluginPointName?: string;
}

// ─── Code Templates ───────────────────────────────────────────────────────────

/**
 * All 15 context types from Java's ContextType enum.
 * Controls which script contexts a code template is available in.
 */
export type ContextType =
  | "GLOBAL_DEPLOY"
  | "GLOBAL_UNDEPLOY"
  | "GLOBAL_PREPROCESSOR"
  | "GLOBAL_POSTPROCESSOR"
  | "CHANNEL_DEPLOY"
  | "CHANNEL_UNDEPLOY"
  | "CHANNEL_PREPROCESSOR"
  | "CHANNEL_POSTPROCESSOR"
  | "CHANNEL_ATTACHMENT"
  | "CHANNEL_BATCH"
  | "SOURCE_RECEIVER"
  | "SOURCE_FILTER_TRANSFORMER"
  | "DESTINATION_FILTER_TRANSFORMER"
  | "DESTINATION_DISPATCHER"
  | "DESTINATION_RESPONSE_TRANSFORMER";

/** Code template type — mirrors Java's CodeTemplateProperties.CodeTemplateType enum. */
export type CodeTemplateType = "FUNCTION" | "DRAG_AND_DROP_CODE" | "COMPILED_CODE";

/**
 * Mirrors com.mirth.connect.model.codetemplates.CodeTemplate.
 * Normalized from XStream JSON — contextTypes flattened from contextSet.delegate.contextType.
 */
export interface CodeTemplate {
  id: string;
  name: string;
  revision?: number;
  lastModified?: string;
  /** Which script contexts this template is available in. */
  contextTypes: ContextType[];
  type: CodeTemplateType;
  code: string;
}

/**
 * Mirrors com.mirth.connect.model.codetemplates.CodeTemplateLibrary.
 * Libraries are containers for code templates.
 *
 * NOTE: GET /codeTemplateLibraries returns libraries with only template ID stubs
 * (no full template data). Use GET /codeTemplates for full template data.
 *
 * XStream single-item quirk: if a library has exactly one template, the server
 * collapses the array to a plain object — we always normalize to string[].
 */
export interface CodeTemplateLibrary {
  id: string;
  name: string;
  revision?: number;
  lastModified?: string;
  description?: string;
  includeNewChannels?: boolean;
  enabledChannelIds?: string[];
  disabledChannelIds?: string[];
  /** IDs of templates belonging to this library (order is authoritative). */
  codeTemplateIds: string[];
}

/**
 * Result of POST /codeTemplateLibraries/_bulkUpdate.
 * Mirrors Java's CodeTemplateLibrarySaveResult.
 */
export interface CodeTemplateLibrarySaveResult {
  overrideNeeded?: boolean;
  librariesSuccess?: boolean;
  libraryResults?: Record<string, { newRevision: number; newLastModified?: string }>;
  codeTemplateResults?: Record<
    string,
    {
      success: boolean;
      newRevision?: number;
      newLastModified?: string;
      cause?: { detailMessage?: string };
    }
  >;
}

// ─── SSL Settings Plugin Types ──────────────────────────────────────────────

/** Keystore or truststore metadata (no password/data). */
export interface KeystoreResponse {
  uid: string; // e.g., "mystore.JKS"
  name: string;
  type: string; // JKS | JCEKS | PKCS12
}

/** Certificate metadata returned by the SSL plugin (Jackson JSON). */
export interface CertificateResponse {
  alias: string;
  subject: string; // X.500 DN, e.g., "CN=example.com,O=MyOrg,C=US"
  issuer: string; // X.500 DN
  validDate: string; // ISO-8601, e.g., "2025-01-01T00:00:00.000+00:00"
  expiredDate: string; // ISO-8601
  keyAlgorithm: string; // "RSA"
  keySize: string; // "1024" | "2048" | "3072" | "4096"
  signatureAlgorithm: string;
  sans: string[]; // Subject Alternative Names
}

/** Certificate monitoring configuration. */
export interface CertificateMonitoringConfig {
  id?: number;
  enabled: boolean;
  warningThresholdDays: number;
  alertLevel: "WARNING" | "ERROR";
  dailyCheckTime: string; // "HH:mm"
  notificationMethods: ("DASHBOARD" | "EMAIL" | "EVENT_LOG")[];
  emailRecipients: string[];
}

/** How a certificate is used by a channel connector. */
export interface ConnectorCertUsage {
  channelId: string;
  channelName: string;
  metaDataId: number; // 0 = Source, 1..n = Destination
  connectorName: string;
  connectorType: "SOURCE" | "DESTINATION";
  transportName: string;
  certificateType: "SERVER" | "CLIENT" | "TRUSTSTORE";
}

/** System information returned by GET /system/info. */
export interface SystemInfo {
  jvmVersion: string;
  osName: string;
  osVersion: string;
  osArchitecture: string;
  dbName: string;
  dbVersion: string;
}

/** Snapshot of a certificate's expiration status from the monitoring system. */
export interface CertificateExpirationSnapshot {
  // Certificate identity
  certificateFingerprint: string;
  certificateSubject: string; // Full DN
  certificateIssuer: string; // Full DN
  certificateSerialNumber: string;
  notBefore: string; // ISO-8601
  expirationDate: string; // ISO-8601

  // Store info
  storeSourceType: "SYSTEM" | "MANUAL";
  storeUid: string | null; // non-null when storeSourceType = SYSTEM
  storeName: string;
  storeDescription: string;
  storePath: string | null; // non-null when storeSourceType = MANUAL
  storeType: "KEYSTORE" | "TRUSTSTORE";
  alias: string;

  // Expiration
  daysUntilExpiry: number; // negative = already expired
  expirationStatus: "GOOD" | "EXPIRING" | "EXPIRED";
  lastScanTimestamp: string; // ISO-8601

  // Connector usages
  affectedConnectorUsages: ConnectorCertUsage[];
}

export interface DriverInfo {
  className: string;
  name: string;
  template: string;
  selectLimit: string;
  alternativeClassNames: string[];
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { useChannels } from "@/lib/hooks/use-cache";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  getCodeTemplateLibraries,
  getCodeTemplateLibrariesCached,
} from "@/lib/api/api-code-templates";
import type { CodeTemplateLibrary } from "@/lib/types";
import {
  Copy,
  Check,
  GitMerge,
  Plus,
  Trash2,
  Settings,
  HardDrive,
  Scissors,
  Table2,
  AlertTriangle,
} from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { SETTINGS_TAB_MIN_WIDTH } from "@/components/settings/settings-tab-scroll";
import type {
  SummaryState,
  PruningSettings,
  MessageStorageMode,
  AttachmentHandlerType,
  AttachmentHandlerState,
} from "../_lib/channel-xml";
import { ATTACHMENT_HANDLER_CLASS_NAMES } from "../_lib/channel-xml";
import {
  isReservedMetaDataColumnName,
  METADATA_COLUMN_NAME_MAXLEN,
  sanitizeDayInput,
} from "../_lib/summary-validation";
import { getQueueStorageError } from "../_lib/queue-storage-validation";
import type { ChannelTag } from "@/lib/types";
import type { DataTypesState } from "../_lib/channel-xml";
import { DATA_TYPE_REGISTRY } from "../_datatypes/index";
import { ChannelDependenciesDialog } from "./channel-dependencies-dialog";
import { AttachmentHandlerPropertiesDialog } from "./attachment-handler-properties-dialog";
import { SetDataTypesDialog } from "./set-data-types-dialog";
import { ChannelTagsField } from "./channel-tags-field";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { ChannelDescriptionField } from "./channel-description-field";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return whether a library is currently enabled for the given channelId. */
function isLibEnabledForChannel(lib: CodeTemplateLibrary, channelId: string): boolean {
  const enabled = lib.enabledChannelIds ?? [];
  const disabled = lib.disabledChannelIds ?? [];
  if (enabled.includes(channelId)) return true;
  if (lib.includeNewChannels && !disabled.includes(channelId)) return true;
  return false;
}

/** Format ISO date to yyyy-MM-dd HH:mm:ss (matches Java SimpleDateFormat) */
function formatLastModified(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Storage mode metadata ─────────────────────────────────────────────────────

const STORAGE_MODES: {
  value: MessageStorageMode;
  label: string;
  content: string;
  metadata: string;
  durable: { text: string; color: string };
}[] = [
  {
    value: "DEVELOPMENT",
    label: "Development",
    content: "Content: All",
    metadata: "Metadata: All",
    durable: { text: "On", color: "text-green-700 dark:text-green-400" },
  },
  {
    value: "PRODUCTION",
    label: "Production",
    content: "Content: Raw, Encoded, Sent, Response, Maps",
    metadata: "Metadata: All",
    durable: { text: "On", color: "text-green-700 dark:text-green-400" },
  },
  {
    value: "RAW",
    label: "Raw",
    content: "Content: Raw",
    metadata: "Metadata: All",
    durable: { text: "Reprocess only", color: "text-orange-600 dark:text-orange-400" },
  },
  {
    value: "METADATA",
    label: "Metadata",
    content: "Content: None",
    metadata: "Metadata: All",
    durable: { text: "Off", color: "text-red-700 dark:text-red-400" },
  },
  {
    value: "DISABLED",
    label: "Disabled",
    content: "Content: None",
    metadata: "Metadata: None",
    durable: { text: "Off", color: "text-red-700 dark:text-red-400" },
  },
];

const META_COLUMN_TYPES = ["STRING", "NUMBER", "BOOLEAN", "TIMESTAMP"] as const;

// ─── Field hover tooltips ──────────────────────────────────────────────────────
// Ported verbatim from Java ChannelSetup.java field tooltips.
// HTML <br>/<b> markup collapsed to plain single-line strings.
const TIP = {
  enabled: "Enable this channel so that it can be deployed.",
  clearGlobalChannelMap:
    "Clear the global channel map on both single channel deploy and a full redeploy.",
  storeAttachments:
    "If checked, attachments will be stored in the database and available for reattachment.",
  encryptData:
    "Encrypt message content that is stored in the database. Messages that are stored while this option is enabled will still be viewable in the message browser, but the content will not be searchable.",
  encryptAttachments:
    "Encrypt message attachments that are stored in the database. Attachments that are stored while this option is enabled will still be viewable in the message browser.",
  encryptCustomMetaData:
    "Encrypt custom metadata columns that are stored in the database. Custom metadata values that are stored while this option is enabled will still be viewable in the message browser, but the metadata will not be searchable. This will only apply to STRING type custom metadata columns.",
  removeContent:
    "Remove message content once the message has completed processing. Not applicable for messages that are errored or queued.",
  removeAttachments:
    "Remove message attachments once the message has completed processing. Not applicable for messages that are errored or queued.",
  removeOnlyFiltered: "If checked, only content for filtered connector messages will be removed.",
  archive:
    "If checked and the data pruner and archiver are enabled, messages in this channel will be archived before being pruned.",
  pruneErrored:
    "If checked and the data pruner is enabled, errored messages in this channel will be pruned.",
} as const;

// ─── Storage mode enable/disable rules ────────────────────────────────────────
// Mirrors ChannelSetup.java updateStorageMode() + messageStorageSliderStateChanged()

const STORAGE_MODE_RULES: Record<
  MessageStorageMode,
  {
    encryptData: boolean;
    encryptAttachments: boolean;
    encryptCustomMetaData: boolean;
    removeContent: boolean;
    removeAttachments: boolean;
    storeAttachments: boolean;
  }
> = {
  DEVELOPMENT: {
    encryptData: true,
    encryptAttachments: true,
    encryptCustomMetaData: true,
    removeContent: true,
    removeAttachments: true,
    storeAttachments: true,
  },
  PRODUCTION: {
    encryptData: true,
    encryptAttachments: true,
    encryptCustomMetaData: true,
    removeContent: true,
    removeAttachments: true,
    storeAttachments: true,
  },
  RAW: {
    encryptData: true,
    encryptAttachments: true,
    encryptCustomMetaData: true,
    removeContent: true,
    removeAttachments: true,
    storeAttachments: true,
  },
  METADATA: {
    encryptData: false,
    encryptAttachments: false,
    encryptCustomMetaData: true,
    removeContent: false,
    removeAttachments: false,
    storeAttachments: false,
  },
  DISABLED: {
    encryptData: false,
    encryptAttachments: false,
    encryptCustomMetaData: false,
    removeContent: false,
    removeAttachments: false,
    storeAttachments: false,
  },
};

/**
 * Compute the state changes for switching to a new message storage mode. Mirrors the
 * Java client's messageStorageSliderStateChanged() (ChannelSetup.java:2836-2858): the
 * ONLY checkbox it force-manages is Store Attachments — cleared on the durable ->
 * METADATA/DISABLED transition, recomputed as (handler != None) when leaving them.
 * Both branches are guarded on the checkbox's enabled state in Java, so a
 * METADATA <-> DISABLED move (or re-selecting the active mode) leaves the retained
 * flag untouched — a Java-authored METADATA channel with storeAttachments=true keeps
 * it. The encrypt/remove flags are merely disabled by updateStorageMode(), keep their
 * checked state, and persist as-is on save (saveMessageStorage:1339-1348) — so a
 * DEVELOPMENT -> METADATA -> DEVELOPMENT round-trip retains the user's flags.
 */
export function normalizeForStorageMode(
  s: SummaryState,
  mode: MessageStorageMode
): Partial<SummaryState> {
  const u: Partial<SummaryState> = { messageStorageMode: mode };
  const wasAllowed = STORAGE_MODE_RULES[s.messageStorageMode].storeAttachments;
  if (!STORAGE_MODE_RULES[mode].storeAttachments) {
    // Entering METADATA/DISABLED from a durable mode: force-clear. Java guards on
    // isEnabled(), so METADATA <-> DISABLED keeps the retained value.
    if (wasAllowed) u.storeAttachments = false;
  } else if (!wasAllowed) {
    // Leaving METADATA/DISABLED: recompute storeAttachments = (handler != None).
    u.storeAttachments = s.attachmentHandler.type !== "None";
  }
  return u;
}

/**
 * Whether Store Attachments is checked+enabled for a given storage mode. Mirrors the
 * durable/METADATA-DISABLED split in the Java client's attachmentComboBoxActionPerformed
 * (ChannelSetup.java:2746-2759), which force-sets the checkbox from the storage mode on
 * every attachment combo action: durable modes -> checked, METADATA/DISABLED -> unchecked.
 */
export function storeAttachmentsForMode(mode: MessageStorageMode): boolean {
  return STORAGE_MODE_RULES[mode].storeAttachments;
}

// ─── Shared sub-components ─────────────────────────────────────────────────────

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  indent,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
  title?: string;
}) {
  return (
    <HoverTooltip content={title}>
      <FormCheckbox
        label={label}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={indent ? "ml-5" : undefined}
      />
    </HoverTooltip>
  );
}

// Shared input class for number + text inputs
const inputCls = `h-8 px-3 text-sm rounded border border-border
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  placeholder:text-gray-400 dark:placeholder:text-gray-500
  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30
  disabled:opacity-40 disabled:cursor-not-allowed`;

// ─── SummaryTab ───────────────────────────────────────────────────────────────

interface SummaryTabProps {
  summary: SummaryState;
  channelId: string;
  onChange: (updates: Partial<SummaryState>) => void;
  allTags: ChannelTag[];
  onTagsChange: (updated: ChannelTag[]) => void;
  tagsLoading?: boolean;
  dataTypes: DataTypesState | null;
  onDataTypesChange: (updated: DataTypesState) => void;
  /** Current channel XML from the editor — threaded into the Dependencies dialog so
   * Library Resource changes flow back into the editor's local state instead of being
   * written directly to the server. */
  currentXml?: string | null;
  onLibraryResourcesChanged?: (newXml: string) => void;
  /** Source connector transport name — used to check for required inbound data type. */
  sourceTransportName?: string;
  /** Source connector properties XML — used by connectors with conditional requirements. */
  sourcePropertiesXml?: string | null;
  /** Whether the source connector queues (source queue enabled) — for the live storage warning. */
  sourceQueueEnabled?: boolean;
  /** Whether any destination connector queues — for the live storage warning. */
  destinationQueueEnabled?: boolean;
}

export function SummaryTab({
  summary,
  channelId,
  onChange,
  allTags,
  onTagsChange,
  tagsLoading,
  dataTypes,
  onDataTypesChange,
  currentXml,
  onLibraryResourcesChanged,
  sourceTransportName,
  sourcePropertiesXml,
  sourceQueueEnabled = false,
  destinationQueueEnabled = false,
}: SummaryTabProps) {
  const { viewDensity } = useCompactMode();
  const selectH = densityHeight(viewDensity);
  const [copied, setCopied] = useState(false);
  const [depsDialogOpen, setDepsDialogOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [dataTypesDialogOpen, setDataTypesDialogOpen] = useState(false);
  const [libCount, setLibCount] = useState<number | null>(null);

  // Channel-to-channel deploy/start dependency counts (mirrors Libraries / Resources chips).
  const { channelDependencies } = useChannels();
  const { dependsOnCount, dependedByCount } = useMemo(() => {
    if (!channelId) return { dependsOnCount: 0, dependedByCount: 0 };
    let on = 0;
    let by = 0;
    for (const d of channelDependencies) {
      if (d.dependentId === channelId) on++;
      if (d.dependencyId === channelId) by++;
    }
    return { dependsOnCount: on, dependedByCount: by };
  }, [channelDependencies, channelId]);

  const fetchLibCount = useCallback(
    async (cached: boolean) => {
      if (!channelId) return;
      try {
        const libs = cached
          ? await getCodeTemplateLibrariesCached()
          : await getCodeTemplateLibraries();
        setLibCount(libs.filter((l) => isLibEnabledForChannel(l, channelId)).length);
      } catch {
        // Non-critical — just leave count hidden
      }
    },
    [channelId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLibCount(true);
    const onInvalidate = () => fetchLibCount(false);
    window.addEventListener("bl-code-template-cache-invalidated", onInvalidate);
    return () => window.removeEventListener("bl-code-template-cache-invalidated", onInvalidate);
  }, [fetchLibCount]);

  function copyId() {
    if (!channelId) return;
    navigator.clipboard.writeText(channelId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const selectedMode = STORAGE_MODES.find((m) => m.value === summary.messageStorageMode);

  // Live queue-vs-storage warning (mirrors Java ChannelSetup.updateQueueWarning): surfaced the
  // moment an incompatible storage mode is picked with queueing on — not only at save #39).
  const queueStorageWarning = getQueueStorageError(
    summary.messageStorageMode,
    sourceQueueEnabled,
    destinationQueueEnabled
  );

  // ── Storage mode business logic ────────────────────────────────────────────
  const rules = STORAGE_MODE_RULES[summary.messageStorageMode];
  const filteredOnlyEnabled = rules.removeContent && summary.removeContentOnCompletion;
  // Archive / prune-errored are enabled when EITHER metadata or content pruning is on
  // (mirrors Java: both the metadata-on and content-days radios enable these checkboxes
  // independently — ChannelSetup.java:2865-2887). Content-only pruning is a valid config.
  const pruningControlsEnabled =
    summary.pruningSettings.pruneMetaDataDays !== null ||
    summary.pruningSettings.pruneContentDays !== null;

  // ── Pruning helpers ────────────────────────────────────────────────────────

  function setPruning(updates: Partial<PruningSettings>) {
    onChange({ pruningSettings: { ...summary.pruningSettings, ...updates } });
  }

  // Metadata and content pruning are independent (mirrors Java's separate radio groups);
  // blanking metadata days no longer wipes content days. The content > metadata age check
  // is enforced at save time (validatePruning) when both are set.
  function handlePruneMetaDays(raw: string) {
    const sanitized = sanitizeDayInput(raw);
    const val = sanitized === "" ? null : parseInt(sanitized, 10);
    setPruning({ pruneMetaDataDays: val });
  }

  function handlePruneContentDays(raw: string) {
    const sanitized = sanitizeDayInput(raw);
    const val = sanitized === "" ? null : parseInt(sanitized, 10);
    setPruning({ pruneContentDays: val });
  }

  // ── Metadata column helpers ────────────────────────────────────────────────

  function addColumn() {
    onChange({
      metaDataColumns: [...summary.metaDataColumns, { name: "", type: "STRING", mappingName: "" }],
    });
  }

  function removeColumn(idx: number) {
    onChange({ metaDataColumns: summary.metaDataColumns.filter((_, i) => i !== idx) });
  }

  function updateColumn(
    idx: number,
    patch: Partial<{ name: string; type: string; mappingName: string }>
  ) {
    onChange({
      metaDataColumns: summary.metaDataColumns.map((col, i) =>
        i === idx ? { ...col, ...patch } : col
      ),
    });
  }

  // ── Attachment handler helpers ─────────────────────────────────────────────

  const DEFAULT_JS_ATTACHMENT_SCRIPT =
    "// Modify the message variable below to create attachments\nreturn message;";

  function handleAttachmentTypeChange(newType: AttachmentHandlerType) {
    const next: AttachmentHandlerState = {
      ...summary.attachmentHandler,
      type: newType,
      // Seed one empty row when switching to Regex with no existing patterns
      regexPatterns:
        newType === "Regex" && summary.attachmentHandler.regexPatterns.length === 0
          ? [{ pattern: "", mimeType: "" }]
          : summary.attachmentHandler.regexPatterns,
      // Seed default MIME type when switching to "Entire Message" with no existing value
      identityMimeType:
        newType === "Entire Message" && !summary.attachmentHandler.identityMimeType
          ? "text/plain"
          : summary.attachmentHandler.identityMimeType,
      // Seed default JS script when switching to "JavaScript" with no existing script
      javaScriptScript:
        newType === "JavaScript" && !summary.attachmentHandler.javaScriptScript
          ? DEFAULT_JS_ATTACHMENT_SCRIPT
          : summary.attachmentHandler.javaScriptScript,
      customClassName:
        newType === "Custom"
          ? (summary.attachmentHandler.customClassName ?? "")
          : summary.attachmentHandler.customClassName,
      customProperties:
        newType === "Custom"
          ? (summary.attachmentHandler.customProperties ?? [])
          : summary.attachmentHandler.customProperties,
    };
    // Mirror Java's attachmentComboBoxActionPerformed (ChannelSetup.java:2746-2759):
    // on ANY attachment-type change (including selecting None), Store Attachments is
    // recomputed purely from the current storage mode — checked in durable modes,
    // unchecked in METADATA/DISABLED. (The old WebUI logic only ever *enabled* it for
    // non-None types, which left storeAttachments=true in METADATA mode — a persisted
    // divergence from Java. See #44.)
    //
    // Java also prompts "…lose all of the current handler data?" before switching away
    // from a modified handler and discards it. The WebUI intentionally does NOT: it
    // retains each type's state in memory (see `next` above), so switching types loses
    // nothing and there is nothing to confirm.
    const extra: Partial<SummaryState> = {
      storeAttachments: storeAttachmentsForMode(summary.messageStorageMode),
    };
    onChange({ attachmentHandler: next, ...extra });
  }

  const p = summary.pruningSettings;

  return (
    <div className="overflow-auto h-full">
      <div
        className={`${SETTINGS_TAB_MIN_WIDTH} max-w-6xl ${viewDensity === "comfortable" ? "p-6 space-y-5" : viewDensity === "compact" ? "p-3 space-y-2" : "p-4 space-y-3"}`}
      >
        {/* ── Channel Properties ───────────────────────────────────────── */}
        <SettingsSection
          title="Channel Properties"
          icon={Settings}
          defaultExpanded={true}
          storageKey="bl-summary-channel-props"
        >
          {/* Name */}
          <FieldRow label="Name">
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={40}
                  data-testid="channel-name-input"
                  value={summary.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  className={`flex-1 ${inputCls}`}
                />
                {summary.name.length > 30 && (
                  <span
                    className={`text-xs tabular-nums shrink-0 ${
                      summary.name.length >= 40
                        ? "text-red-500 dark:text-red-400"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {summary.name.length}/40
                  </span>
                )}
              </div>
            </div>
          </FieldRow>

          {/* Initial State */}
          <FieldRow label="Initial State">
            <select
              value={summary.initialState}
              onChange={(e) =>
                onChange({ initialState: e.target.value as SummaryState["initialState"] })
              }
              className={`${selectH} px-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400`}
            >
              <option value="STARTED">Started</option>
              <option value="PAUSED">Paused</option>
              <option value="STOPPED">Stopped</option>
            </select>
          </FieldRow>

          {/* Checkboxes row */}
          <FieldRow label="">
            <Checkbox
              label="Enabled"
              checked={summary.enabled}
              onChange={(v) => onChange({ enabled: v })}
              title={TIP.enabled}
            />
            <Checkbox
              label="Clear global channel map on deploy"
              checked={summary.clearGlobalChannelMap}
              onChange={(v) => onChange({ clearGlobalChannelMap: v })}
              title={TIP.clearGlobalChannelMap}
            />
          </FieldRow>

          {/* ID (read-only) */}
          {channelId && (
            <FieldRow label="Channel ID">
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                {channelId}
              </span>
              <HoverTooltip content="Copy ID to clipboard">
                <button
                  onClick={copyId}
                  className="ml-1 shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </HoverTooltip>
            </FieldRow>
          )}

          {/* Revision (read-only, edit mode only) */}
          {channelId && summary.revision > 0 && (
            <FieldRow label="Revision">
              <span className="text-sm text-gray-700 dark:text-gray-300">{summary.revision}</span>
            </FieldRow>
          )}

          {/* Last Modified (read-only, edit mode only) */}
          {channelId && summary.lastModified && (
            <FieldRow label="Last Modified">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {formatLastModified(summary.lastModified)}
              </span>
            </FieldRow>
          )}

          {/* Dependencies */}
          <FieldRow label="Dependencies">
            <button
              onClick={() => setDepsDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border
              border-border text-gray-700 dark:text-gray-300
              hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-border
              transition-colors font-medium"
            >
              <GitMerge className="w-3.5 h-3.5" />
              Set Dependencies…
            </button>
            {libCount !== null && libCount > 0 && (
              <SummaryChip label="Libraries" value={String(libCount)} />
            )}
            {summary.resourceIdCount > 0 && (
              <SummaryChip label="Resources" value={String(summary.resourceIdCount)} />
            )}
            {dependsOnCount > 0 && (
              <SummaryChip label="Depends on" value={String(dependsOnCount)} />
            )}
            {dependedByCount > 0 && (
              <SummaryChip label="Depended by" value={String(dependedByCount)} />
            )}
          </FieldRow>

          {/* Data Types */}
          <FieldRow label="Data Types">
            <button
              onClick={() => setDataTypesDialogOpen(true)}
              disabled={!dataTypes}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border
              border-border text-gray-700 dark:text-gray-300
              hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-border
              transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Set Data Types…
            </button>
          </FieldRow>

          {/* Attachment Handler type selector */}
          <FieldRow label="Attachment Handler">
            <select
              value={summary.attachmentHandler.type}
              onChange={(e) => handleAttachmentTypeChange(e.target.value as AttachmentHandlerType)}
              className={`${selectH} px-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400`}
            >
              <option value="None">None</option>
              <option value="Entire Message">Entire Message</option>
              <option value="Regex">Regex</option>
              <option value="DICOM">DICOM</option>
              <option value="JavaScript">JavaScript</option>
              <option value="Custom">Custom</option>
            </select>

            {/* Properties… button — only for configurable types */}
            {(
              ["Entire Message", "Regex", "JavaScript", "Custom"] as AttachmentHandlerType[]
            ).includes(summary.attachmentHandler.type) && (
              <button
                onClick={() => setAttachDialogOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border
                border-border text-gray-700 dark:text-gray-300
                hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-border
                transition-colors font-medium"
              >
                Properties…
              </button>
            )}
          </FieldRow>

          {/* storeAttachments warning — shown when handler is active but storage is off */}
          {summary.attachmentHandler.type !== "None" && !summary.storeAttachments && (
            <FieldRow label="">
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>
                  &quot;Store attachments&quot; is disabled — attachments will be extracted but not
                  saved.
                </span>
              </p>
            </FieldRow>
          )}

          {/* Tags */}
          {channelId && (
            <FieldRow label="Tags">
              <ChannelTagsField
                channelId={channelId}
                allTags={allTags}
                onAllTagsChange={onTagsChange}
                loading={tagsLoading}
              />
            </FieldRow>
          )}
        </SettingsSection>

        <ChannelDependenciesDialog
          channelId={channelId}
          open={depsDialogOpen}
          onOpenChange={setDepsDialogOpen}
          currentXml={currentXml}
          onLibraryResourcesChanged={onLibraryResourcesChanged}
        />

        <AttachmentHandlerPropertiesDialog
          open={attachDialogOpen}
          onOpenChange={setAttachDialogOpen}
          attachmentHandler={summary.attachmentHandler}
          onSave={(updated) => onChange({ attachmentHandler: updated })}
          channelId={channelId}
        />

        {dataTypes && (
          <SetDataTypesDialog
            open={dataTypesDialogOpen}
            onOpenChange={setDataTypesDialogOpen}
            dataTypes={dataTypes}
            onSave={(updated) => {
              onDataTypesChange(updated);
              // Check if the source inbound data type has a default attachment handler.
              // When it does, pre-select that handler type — mirrors Java's auto-fill behavior
              // for plugins like Sectra's DIMSE type that require a specific attachment handler.
              const sourceRow = updated.connectors.find((c) => c.id === "source");
              if (sourceRow) {
                const plugin = DATA_TYPE_REGISTRY.get(sourceRow.inboundDataType);
                const defaultClass = plugin?.getDefaultAttachmentHandler?.() ?? null;
                if (defaultClass !== null) {
                  const matchedType = (
                    Object.entries(ATTACHMENT_HANDLER_CLASS_NAMES) as [
                      AttachmentHandlerType,
                      string,
                    ][]
                  ).find(([, cls]) => cls === defaultClass)?.[0];
                  if (matchedType) {
                    onChange({
                      attachmentHandler: { ...summary.attachmentHandler, type: matchedType },
                    });
                  }
                }
              }
              setDataTypesDialogOpen(false);
            }}
            sourceTransportName={sourceTransportName}
            sourcePropertiesXml={sourcePropertiesXml}
            channelId={channelId}
          />
        )}

        {/* ── Message Storage ──────────────────────────────────────────── */}
        <SettingsSection
          title="Message Storage"
          icon={HardDrive}
          defaultExpanded={true}
          storageKey="bl-summary-msg-storage"
          summary={selectedMode && <SummaryChip value={selectedMode.label} />}
        >
          {/* Mode selector */}
          <div className="flex flex-wrap gap-1.5 pb-1">
            {STORAGE_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => onChange(normalizeForStorageMode(summary, m.value))}
                className={`px-3 py-1.5 text-sm rounded border font-medium transition-colors
                ${
                  summary.messageStorageMode === m.value
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    : "border-border bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-border hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Live queue-vs-storage warning (Java ChannelSetup.updateQueueWarning) */}
          {queueStorageWarning && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400 pb-1">
              {queueStorageWarning}
            </p>
          )}

          {/* Mode details: content, metadata, durable message delivery */}
          {selectedMode && (
            <div className="text-xs space-y-0.5 pb-2">
              <p className="text-gray-500 dark:text-gray-400">{selectedMode.content}</p>
              <p className="text-gray-500 dark:text-gray-400">{selectedMode.metadata}</p>
              <p className="text-gray-500 dark:text-gray-400">
                Durable Message Delivery:{" "}
                <span className={`font-medium ${selectedMode.durable.color}`}>
                  {selectedMode.durable.text}
                </span>
              </p>
            </div>
          )}

          {/* Checkboxes — two columns */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 pt-1">
            {/* Left column */}
            <div className="space-y-2">
              <Checkbox
                label="Encrypt message content"
                checked={summary.encryptData}
                onChange={(v) => onChange({ encryptData: v })}
                disabled={!rules.encryptData}
                title={TIP.encryptData}
              />
              <Checkbox
                label="Encrypt attachments"
                checked={summary.encryptAttachments}
                onChange={(v) => onChange({ encryptAttachments: v })}
                disabled={!rules.encryptAttachments}
                title={TIP.encryptAttachments}
              />
              <Checkbox
                label="Encrypt custom metadata"
                checked={summary.encryptCustomMetaData}
                onChange={(v) => onChange({ encryptCustomMetaData: v })}
                disabled={!rules.encryptCustomMetaData}
                title={TIP.encryptCustomMetaData}
              />
              <Checkbox
                label="Store attachments"
                checked={summary.storeAttachments}
                onChange={(v) => onChange({ storeAttachments: v })}
                disabled={!rules.storeAttachments}
                title={TIP.storeAttachments}
              />
            </div>
            {/* Right column */}
            <div className="space-y-2">
              <Checkbox
                label="Remove content on completion"
                checked={summary.removeContentOnCompletion}
                onChange={(v) => onChange({ removeContentOnCompletion: v })}
                disabled={!rules.removeContent}
                title={TIP.removeContent}
              />
              <Checkbox
                label="Filtered only"
                checked={summary.removeOnlyFilteredOnCompletion}
                onChange={(v) => onChange({ removeOnlyFilteredOnCompletion: v })}
                disabled={!filteredOnlyEnabled}
                indent
                title={TIP.removeOnlyFiltered}
              />
              <Checkbox
                label="Remove attachments on completion"
                checked={summary.removeAttachmentsOnCompletion}
                onChange={(v) => onChange({ removeAttachmentsOnCompletion: v })}
                disabled={!rules.removeAttachments}
                title={TIP.removeAttachments}
              />
            </div>
          </div>
        </SettingsSection>

        {/* ── Message Pruning ──────────────────────────────────────────── */}
        <SettingsSection
          title="Message Pruning"
          icon={Scissors}
          defaultExpanded={false}
          storageKey="bl-summary-msg-pruning"
          summary={
            p.pruneMetaDataDays === null && p.pruneContentDays === null ? (
              <SummaryChip value="No pruning" />
            ) : (
              <>
                {p.pruneMetaDataDays !== null && (
                  <SummaryChip label="Metadata" value={`${p.pruneMetaDataDays}d`} />
                )}
                {p.pruneContentDays !== null && (
                  <SummaryChip label="Content" value={`${p.pruneContentDays}d`} />
                )}
              </>
            )
          }
        >
          <FieldRow label="Prune metadata after">
            <input
              type="number"
              min={1}
              value={p.pruneMetaDataDays ?? ""}
              onChange={(e) => handlePruneMetaDays(e.target.value)}
              placeholder="Days (blank = no pruning)"
              className={`w-52 ${inputCls}`}
            />
            {p.pruneMetaDataDays !== null && (
              <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
            )}
          </FieldRow>

          <FieldRow label="Prune content after">
            <input
              type="number"
              min={1}
              value={p.pruneContentDays ?? ""}
              onChange={(e) => handlePruneContentDays(e.target.value)}
              placeholder={
                p.pruneMetaDataDays !== null
                  ? `On metadata removal (${p.pruneMetaDataDays}d)`
                  : "Days (blank = no pruning)"
              }
              className={`w-52 ${inputCls}`}
            />
            {p.pruneContentDays !== null && (
              <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
            )}
          </FieldRow>

          <FieldRow label="">
            <div className="flex flex-col gap-2">
              <Checkbox
                label="Archive messages before pruning"
                checked={p.archiveEnabled}
                onChange={(v) => setPruning({ archiveEnabled: v })}
                disabled={!pruningControlsEnabled}
                title={TIP.archive}
              />
              <Checkbox
                label="Prune errored messages"
                checked={p.pruneErroredMessages}
                onChange={(v) => setPruning({ pruneErroredMessages: v })}
                disabled={!pruningControlsEnabled}
                title={TIP.pruneErrored}
              />
              {/* Caveat label — mirrors Java PRUNING_WARNING_DEFAULT/ERRORED_TEXT, only when pruning is on */}
              {pruningControlsEnabled && (
                <p className="text-xs italic text-gray-500 dark:text-gray-400">
                  {p.pruneErroredMessages
                    ? "(incomplete and queued messages will not be pruned)"
                    : "(incomplete, errored, and queued messages will not be pruned)"}
                </p>
              )}
            </div>
          </FieldRow>
        </SettingsSection>

        {/* ── Custom Metadata Columns ──────────────────────────────────── */}
        <SettingsSection
          title="Custom Metadata Columns"
          icon={Table2}
          defaultExpanded={false}
          storageKey="bl-summary-metadata"
        >
          {summary.metaDataColumns.length > 0 && (
            <div className="mb-3">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_9rem_1fr_1.5rem] gap-2 mb-1 px-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Name
                </span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Type
                </span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Variable Mapping
                </span>
                <span />
              </div>
              {/* Data rows */}
              <div className="space-y-1.5">
                {(() => {
                  // Compute which non-empty names appear more than once
                  const nameCounts = new Map<string, number>();
                  for (const col of summary.metaDataColumns) {
                    const n = col.name.trim();
                    if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
                  }
                  const duplicateNames = new Set(
                    [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n)
                  );
                  return summary.metaDataColumns.map((col, idx) => {
                    const nameEmpty = col.name.trim() === "";
                    const nameDupe = !nameEmpty && duplicateNames.has(col.name.trim());
                    const nameReserved = !nameEmpty && isReservedMetaDataColumnName(col.name);
                    const nameInvalid = nameEmpty || nameDupe || nameReserved;
                    const inputCls =
                      "h-7 px-2 text-sm rounded border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30";
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_9rem_1fr_1.5rem] gap-2 items-center"
                      >
                        {/* Name input */}
                        <HoverTooltip
                          content={
                            nameReserved
                              ? `"${col.name.trim()}" is a reserved keyword and cannot be used as a column name.`
                              : nameDupe
                                ? `Duplicate column name: "${col.name}"`
                                : undefined
                          }
                        >
                          <input
                            type="text"
                            value={col.name}
                            onChange={(e) =>
                              updateColumn(idx, {
                                // Force-uppercase (matches Java's post-save uppercasing) and
                                // enforce the Java field constraint: charset ^[A-Z0-9_]$, max 30.
                                name: e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z0-9_]/g, "")
                                  .slice(0, METADATA_COLUMN_NAME_MAXLEN),
                              })
                            }
                            placeholder="COLUMN_NAME"
                            className={`${inputCls} font-mono ${nameInvalid ? "border-red-400 dark:border-red-500 focus:ring-red-400/30" : "border-border"}`}
                          />
                        </HoverTooltip>
                        {/* Type select */}
                        <select
                          value={col.type}
                          onChange={(e) => updateColumn(idx, { type: e.target.value })}
                          className={`${selectH} px-1.5 text-sm rounded border border-border
                        bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                        focus:outline-none focus:border-blue-500 dark:focus:border-blue-400`}
                        >
                          {META_COLUMN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        {/* Variable Mapping input */}
                        <input
                          type="text"
                          value={col.mappingName ?? ""}
                          onChange={(e) =>
                            updateColumn(idx, {
                              // Java constrains the mapping cell to ^[a-zA-Z_0-9]*$, max 30
                              // (AlphaNumericCellEditor) — but, unlike the name cell, does NOT
                              // uppercase it (ChannelSetup.java:2167-2183, #41).
                              mappingName: e.target.value
                                .replace(/[^a-zA-Z0-9_]/g, "")
                                .slice(0, METADATA_COLUMN_NAME_MAXLEN),
                            })
                          }
                          placeholder="variable_name"
                          className={`${inputCls} border-border`}
                        />
                        {/* Delete button */}
                        <HoverTooltip content="Remove column">
                          <button
                            onClick={() => removeColumn(idx)}
                            className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </HoverTooltip>
                      </div>
                    );
                  });
                })()}
              </div>
              {/* Duplicate / reserved name warnings */}
              {(() => {
                const nameCounts = new Map<string, number>();
                for (const col of summary.metaDataColumns) {
                  const n = col.name.trim();
                  if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
                }
                const dupes = [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
                const reserved = [...nameCounts.keys()].filter((n) =>
                  isReservedMetaDataColumnName(n)
                );
                return dupes.length > 0 || reserved.length > 0 ? (
                  <div className="mt-1.5 space-y-0.5 text-xs text-red-600 dark:text-red-400">
                    {dupes.length > 0 && (
                      <p>
                        Duplicate column name{dupes.length > 1 ? "s" : ""}: {dupes.join(", ")}
                      </p>
                    )}
                    {reserved.length > 0 && (
                      <p>
                        Reserved column name{reserved.length > 1 ? "s" : ""}: {reserved.join(", ")}
                      </p>
                    )}
                  </div>
                ) : null;
              })()}
            </div>
          )}

          {/* Add column button */}
          <button
            onClick={addColumn}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed
            border-border text-gray-500 dark:text-gray-400
            hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
            hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Column
          </button>
        </SettingsSection>

        {/* ── Channel Description ──────────────────────────────────────── */}
        <ChannelDescriptionField
          value={summary.description}
          onChange={(v) => onChange({ description: v })}
          viewDensity={viewDensity}
          channelName={summary.name || undefined}
          channelXml={currentXml}
        />
      </div>
    </div>
  );
}

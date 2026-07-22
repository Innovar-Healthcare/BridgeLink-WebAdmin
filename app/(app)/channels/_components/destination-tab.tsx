"use client";

import { useMemo, useRef, useState } from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  Download,
  Filter,
  GripVertical,
  Plus,
  Power,
  Shuffle,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { SETTINGS_TAB_MIN_WIDTH } from "@/components/settings/settings-tab-scroll";
import type {
  DestinationConnectorState,
  DestinationQueueSettings,
  MessageStorageMode,
} from "../_lib/channel-xml";
import { defaultQueueForType, resolveXmlVersion, withVersion } from "../_lib/channel-xml";
import {
  DESTINATION_CONNECTOR_REGISTRY,
  destinationDefaultPropertiesXml,
  visibleDestinationConnectorTypes,
} from "../_connectors/destinations";
import { DESTINATION_PLUGIN_REGISTRY } from "../_connectors/destinations/plugins";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import {
  AdvancedQueueSettingsDialog,
  formatAdvancedQueueSummary,
  type QueueMode,
} from "./advanced-queue-settings-dialog";
import { DestinationMappings } from "./destination-mappings";
import { selectCls } from "../_connectors/shared/styles";
import { RadioGroup } from "../_connectors/shared/radio-group";

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Storage modes that cause a warning when queue is enabled, because queued
 * messages may be lost on server restart if raw content is not stored.
 */
const QUEUE_WARN_STORAGE_MODES = new Set<MessageStorageMode>(["RAW", "METADATA", "DISABLED"]);

// Per-field help text. Ported verbatim from Java DestinationSettingsPanel and
// ChannelSetup (HTML/<br/> flattened to plain strings); shown on hover over each control.
const TIP = {
  queueNever: "Disable the destination queue.",
  queueOnFailure:
    "Attempt to send the message first before queueing it. This will allow subsequent destinations and the Postprocessor to use the response from this destination if it successfully sends before queueing.",
  queueAlways:
    "Immediately queue the message. Subsequent destinations and the Postprocessor will always see this destination's response as QUEUED.",
  validateResponse:
    "Select Yes to validate the response. Responses can only be validated if the response transformer's inbound properties contains a Response Validation section. If validation fails, the message will be marked as queued or errored.",
  reattachAttachments:
    "If enabled, replacement tokens using the ${ATTACH:...} syntax will automatically be replaced with the associated attachment content before the message is sent. If disabled, the tokens will be expanded to the full ${ATTACH:channelId:messageId:attachmentId} syntax which can then be reattached in downstream channels.",
  waitForPrevious:
    "Wait for the previous destination to finish before processing the current destination. Each destination connector for which this is not selected marks the beginning of a destination chain, such that all chains execute asynchronously, but each destination within a particular chain executes in order. This option has no effect on the first destination connector, which always marks the beginning of the first chain.",
} as const;

// ─── Queue mode helpers ────────────────────────────────────────────────────────

function queueModeFrom(q: DestinationQueueSettings): QueueMode {
  if (!q.queueEnabled) return "never";
  return q.sendFirst ? "onFailure" : "always";
}

function queueModeToSettings(
  mode: QueueMode
): Pick<DestinationQueueSettings, "queueEnabled" | "sendFirst"> {
  if (mode === "never") return { queueEnabled: false, sendFirst: false };
  if (mode === "onFailure") return { queueEnabled: true, sendFirst: true };
  /* always */ return { queueEnabled: true, sendFirst: false };
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface DestinationTabProps {
  destinations: DestinationConnectorState[];
  /** Used to show a warning when queuing is enabled but messages may not be stored. */
  messageStorageMode?: MessageStorageMode;
  onChange: (index: number, updates: Partial<DestinationConnectorState>) => void;
  onAdd: (transportName: string) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Export the destination at `index` to an XML file. */
  onExport: (index: number) => void;
  /** Import a destination connector from an XML file (appends a new destination). */
  onImport: () => void;
  isDark: boolean;
  channelId?: string;
  channelName?: string;
  onOpenFilter?: (destIndex: number) => void;
  onOpenTransformer?: (destIndex: number) => void;
  onOpenResponseTransformer?: (destIndex: number) => void;
  /** Controlled selection — when provided, the flow panel drives which destination is shown. */
  selectedIndex?: number;
  onSelectedIndexChange?: (i: number) => void;
  /** Raw XML of the source connector's transformer — passed to DestinationMappings for variable extraction. */
  sourceTransformerXml?: string | null;
  /** Field names per destination index that failed save-time validation — keyed by destination index. */
  externalInvalidFieldsByDestIndex?: Map<number, Set<string>>;
  /** Called when the user edits any field — clears save-time highlights from the parent. */
  onClearExternalErrors?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compare two XML strings ignoring insignificant whitespace between tags. */
function xmlEffectivelyEqual(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const norm = (s: string) =>
    s
      .replace(/>\s+</g, "><")
      .replace(/\s+version="[^"]*"/g, "")
      .replace(/<queueBufferSize>\d+<\/queueBufferSize>/g, "")
      // XMLSerializer round-trips self-closing tags to open/close pairs — normalize both forms.
      .replace(/<(\w[\w.-]*)(\s[^>]*)?\s*\/>/g, "<$1$2></$1>")
      // XMLSerializer may inject xmlns="" on elements imported into a document — strip them.
      .replace(/\s+xmlns=""/g, "")
      .trim();
  return norm(a) === norm(b);
}

/** Count top-level elements inside <elements> of a filter or transformer XML string. */
function countXmlElements(xml: string | null | undefined): number {
  if (!xml) return 0;
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return doc.querySelector("elements")?.children.length ?? 0;
  } catch {
    return 0;
  }
}

// ─── Destination Table ─────────────────────────────────────────────────────────

interface DestinationListProps {
  destinations: DestinationConnectorState[];
  selectedIndex: number;
  duplicateNames: Set<string>;
  onSelect: (i: number) => void;
  onToggle: (i: number) => void;
  onRemove: (i: number) => void;
  onDuplicate: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onExport: (i: number) => void;
  onImport: () => void;
}

function DestinationList({
  destinations,
  selectedIndex,
  duplicateNames,
  onSelect,
  onToggle,
  onRemove,
  onDuplicate,
  onReorder,
  onExport,
  onImport,
}: DestinationListProps) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Check whether disabling or deleting destination[index] is allowed.
  // Rule: at least 1 enabled destination must always remain.
  function canRemoveOrDisable(index: number): boolean {
    const target = destinations[index];
    if (!target) return false;
    if (!target.enabled) return destinations.length > 1;
    return destinations.some((d, j) => j !== index && d.enabled);
  }

  // Compute chain numbers: increments each time a destination does NOT wait for the previous one
  const chainOf: number[] = [];
  let chainCounter = 0;
  for (let i = 0; i < destinations.length; i++) {
    if (i === 0 || !destinations[i].waitForPrevious) chainCounter++;
    chainOf.push(chainCounter);
  }

  function handleDragStart(e: React.DragEvent, i: number) {
    dragFrom.current = i;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(i);
  }

  function handleDrop(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragFrom.current !== null && dragFrom.current !== i) {
      onReorder(dragFrom.current, i);
    }
    dragFrom.current = null;
    setDragOver(null);
  }

  function handleDragEnd() {
    dragFrom.current = null;
    setDragOver(null);
  }

  if (destinations.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 italic px-3 py-3 text-center">
        No destinations yet.
      </p>
    );
  }

  return (
    <>
      {/* ── Column headers ───────────────────────────────────────────── */}
      <div
        className="flex items-center px-2 py-0.5 border-b border-border
        bg-gray-50 dark:bg-gray-800/60 text-[10px] font-medium text-gray-400 dark:text-gray-500
        uppercase tracking-wide select-none"
      >
        {/* Align with drag handle */}
        <span className="shrink-0 w-4" />
        {/* Align with checkbox */}
        <span className="shrink-0 w-5" />
        <span className="flex-1 min-w-0 max-w-[240px] pl-1">Destination Name</span>
        <span className="shrink-0 w-40 pl-2">Connector Type</span>
        <HoverTooltip content="Destination Id">
          <span className="shrink-0 w-8 text-center">Id</span>
        </HoverTooltip>
        {/* Spacer pushes Chain to the right */}
        <span className="flex-1" />
        <HoverTooltip content="Chain (based on Wait For Previous Destination)">
          <span className="shrink-0 w-12 text-center">Chain</span>
        </HoverTooltip>
        {/* Align with delete button */}
        <span className="shrink-0 w-8" />
      </div>

      {/* ── Rows (scrollable) ────────────────────────────────────────── */}
      <div className="max-h-40 overflow-y-auto">
        {
          // eslint-disable-next-line react-hooks/refs -- dragFrom is a drag-state ref; reading during render is intentional to avoid re-renders on every drag event
          destinations.map((d, i) => {
            const isSelected = selectedIndex === i;
            const isDragTarget = dragOver === i && dragFrom.current !== i;
            return (
              <ContextMenu key={d.metaDataId}>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onSelect(i)}
                    className={`group flex items-center px-2 py-1.5 cursor-pointer select-none
                border-b border-border last:border-b-0
                border-l-2 transition-colors
                ${isDragTarget ? "border-t-2 border-t-blue-400 dark:border-t-blue-500" : ""}
                ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-900/20 border-l-blue-500"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/40 border-l-transparent"
                }`}
                  >
                    {/* Drag handle */}
                    <HoverTooltip content="Drag to reorder">
                      <span className="shrink-0 w-4">
                        <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing" />
                      </span>
                    </HoverTooltip>

                    {/* Enabled toggle */}
                    <span className="shrink-0 w-5">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggle(i);
                        }}
                        className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                        title={d.enabled ? "Disable destination" : "Enable destination"}
                      />
                    </span>

                    {/* Name */}
                    <span
                      className={`flex-1 min-w-0 max-w-[240px] text-xs pl-1 flex items-center gap-1
                ${
                  !d.enabled
                    ? "text-gray-400 dark:text-gray-500 line-through"
                    : isSelected
                      ? "text-blue-700 dark:text-blue-300 font-medium"
                      : "text-gray-800 dark:text-gray-200"
                }`}
                    >
                      <span className="truncate">{d.name || `Destination ${i + 1}`}</span>
                      {d.name.trim() !== "" && duplicateNames.has(d.name.trim()) && (
                        <span title={`Duplicate destination name: "${d.name}"`}>
                          <AlertTriangle className="w-3 h-3 shrink-0 text-amber-500 dark:text-amber-400" />
                        </span>
                      )}
                    </span>

                    {/* Connector Type */}
                    <span
                      className={`shrink-0 w-40 text-xs truncate pl-2
                ${!d.enabled ? "text-gray-400 dark:text-gray-500" : "text-gray-500 dark:text-gray-400"}`}
                    >
                      {d.transportName}
                    </span>

                    {/* Id */}
                    <span
                      className="shrink-0 w-8 text-center text-[10px] text-gray-400 dark:text-gray-500 font-mono"
                      title={`Destination Id: ${i + 1}`}
                    >
                      {i + 1}
                    </span>

                    {/* Spacer — pushes Chain to the right */}
                    <span className="flex-1" />

                    {/* Chain */}
                    <span
                      className="shrink-0 w-12 text-center text-[10px] text-gray-400 dark:text-gray-500 font-mono"
                      title={`Chain ${chainOf[i]}`}
                    >
                      {chainOf[i]}
                    </span>

                    {/* Remove button — dedicated column, fades in on row hover / always visible when selected */}
                    <span className="shrink-0 w-8 flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(i);
                        }}
                        title={
                          destinations.length === 1
                            ? "Cannot remove the only destination"
                            : "Remove destination"
                        }
                        disabled={destinations.length === 1}
                        className={`p-0.5 rounded transition-colors
                    text-gray-400 dark:text-gray-500
                    hover:text-red-500 dark:hover:text-red-400
                    hover:bg-red-50 dark:hover:bg-red-900/30
                    disabled:opacity-30 disabled:cursor-not-allowed
                    ${isSelected ? "" : "opacity-0 group-hover:opacity-100"}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem disabled={i === 0} onClick={() => onReorder(i, i - 1)}>
                    Move Up
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={i === destinations.length - 1}
                    onClick={() => onReorder(i, i + 1)}
                  >
                    Move Down
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={d.enabled && !canRemoveOrDisable(i)}
                    onClick={() => onToggle(i)}
                  >
                    {d.enabled ? "Disable" : "Enable"}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onDuplicate(i)}>Duplicate</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onExport(i)}>Export Connector</ContextMenuItem>
                  <ContextMenuItem onClick={() => onImport()}>Import Connector</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    disabled={!canRemoveOrDisable(i)}
                    onClick={() => onRemove(i)}
                  >
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        }
      </div>
    </>
  );
}

// ─── Fallback for connectors without a registered definition ──────────────────

function UnimplementedBottomSection({ transportName }: { transportName: string }) {
  return (
    <SettingsSection title={`${transportName} Settings`}>
      <p className="text-sm text-gray-500 dark:text-gray-400 italic">
        Settings for <span className="font-medium not-italic">{transportName}</span> can be
        configured in the XML tab.
      </p>
    </SettingsSection>
  );
}

// ─── DestinationTab ────────────────────────────────────────────────────────────

export function DestinationTab({
  destinations,
  messageStorageMode,
  onChange,
  onAdd,
  onRemove,
  onDuplicate,
  onReorder,
  onExport,
  onImport,
  isDark,
  channelId,
  channelName,
  onOpenFilter,
  onOpenTransformer,
  onOpenResponseTransformer,
  selectedIndex: controlledSelectedIndex,
  onSelectedIndexChange,
  sourceTransformerXml,
  externalInvalidFieldsByDestIndex,
  onClearExternalErrors,
}: DestinationTabProps) {
  const { viewDensity } = useCompactMode();
  const surfaceEnabled = usePluginSurfaceEnabled();
  const connectorTypes = visibleDestinationConnectorTypes(surfaceEnabled);
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingDestType, setPendingDestType] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  // Controlled when the flow panel drives selection; uncontrolled otherwise (tab mode).
  const isControlled = controlledSelectedIndex !== undefined;
  const selectedIndex = isControlled ? controlledSelectedIndex : internalSelectedIndex;

  function setSelectedIndex(i: number) {
    if (isControlled && onSelectedIndexChange) {
      onSelectedIndexChange(i);
    } else {
      setInternalSelectedIndex(i);
    }
  }

  // Guard: keep selectedIndex in range
  const safeIndex = destinations.length > 0 ? Math.min(selectedIndex, destinations.length - 1) : 0;
  const selected = destinations[safeIndex] ?? null;

  // Whether this is the first destination — "Wait for Previous" must be locked to Yes
  const isFirstDestination = safeIndex === 0;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // Wrap onChange to clear field highlights when user edits any field
  function handleDestChange(index: number, updates: Partial<DestinationConnectorState>) {
    if (invalidFields.size > 0) setInvalidFields(new Set());
    onClearExternalErrors?.();
    onChange(index, updates);
  }

  function set<K extends keyof DestinationConnectorState>(
    key: K,
    val: DestinationConnectorState[K]
  ) {
    handleDestChange(safeIndex, { [key]: val } as Partial<DestinationConnectorState>);
  }

  function setQueue(updates: Partial<DestinationQueueSettings>) {
    if (!selected) return;
    handleDestChange(safeIndex, { queue: { ...selected.queue, ...updates } });
  }

  function applyDestTypeChange(newType: string) {
    setInvalidFields(new Set());
    // Registry-aware resolution: built-ins from the static map, registered
    // connectors (runtime plugin manifests, from their definition's
    // defaultPropertiesXml. A null here would leave the new destination's
    // panel bound to nothing — i.e. read-only.
    let defaultXml = destinationDefaultPropertiesXml(newType);
    if (defaultXml !== null) {
      for (const plugin of DESTINATION_PLUGIN_REGISTRY) {
        if (!surfaceEnabled(plugin)) continue;
        if (plugin.injectDefaults) defaultXml = plugin.injectDefaults(newType, defaultXml);
      }
      // Resolve the version="{{VERSION}}" placeholder in the injected default, mirroring the
      // source tab (source-tab.tsx) and addDestinationToXml. Without this the connector props
      // carry a literal {{VERSION}}, which the server's XStream deserialization rejects (500) on
      // Test Connection / Test Write / Get Operations for a freshly type-changed destination.
      defaultXml = withVersion(defaultXml, resolveXmlVersion());
    }
    onChange(safeIndex, {
      transportName: newType,
      propertiesXml: defaultXml,
      queue: defaultQueueForType(newType, defaultXml),
    });
  }

  function handleTypeChange(newType: string) {
    if (!selected || newType === selected.transportName) return;

    // Compare current properties against defaults for the CURRENT connector type.
    // If they differ, the user has configured settings — warn before losing them.
    let currentDefault = destinationDefaultPropertiesXml(selected.transportName);
    if (currentDefault) {
      for (const plugin of DESTINATION_PLUGIN_REGISTRY) {
        if (!surfaceEnabled(plugin)) continue;
        if (plugin.injectDefaults)
          currentDefault = plugin.injectDefaults(selected.transportName, currentDefault);
      }
    }

    if (currentDefault && !xmlEffectivelyEqual(selected.propertiesXml, currentDefault)) {
      setPendingDestType(newType);
      return;
    }

    applyDestTypeChange(newType);
  }

  function handleQueueModeChange(mode: QueueMode) {
    setQueue(queueModeToSettings(mode));
  }

  function handleAdd() {
    // Always add with Channel Writer as the default type (matches Java UI behaviour).
    // The user can change the connector type in the settings panel afterwards.
    onAdd("Channel Writer");
    // Select the newly added destination (it'll be appended at the end)
    setSelectedIndex(destinations.length);
  }

  function handleRemove(i: number) {
    const nextSelected = i > 0 ? i - 1 : 0;
    onRemove(i);
    setSelectedIndex(nextSelected);
  }

  function handleReorder(from: number, to: number) {
    onReorder(from, to);
    // Keep the same logical destination selected after reorder
    if (selectedIndex === from) {
      setSelectedIndex(to);
    } else if (from < to) {
      if (selectedIndex > from && selectedIndex <= to) setSelectedIndex(selectedIndex - 1);
    } else {
      if (selectedIndex >= to && selectedIndex < from) setSelectedIndex(selectedIndex + 1);
    }
  }

  function canRemoveOrDisable(index: number): boolean {
    const target = destinations[index];
    if (!target) return false;
    if (!target.enabled) return destinations.length > 1;
    return destinations.some((d, j) => j !== index && d.enabled);
  }

  function handleValidateConnector() {
    if (!selected) return;
    const validate = DESTINATION_CONNECTOR_REGISTRY[selected.transportName]?.validate;
    if (!validate) {
      setInvalidFields(new Set());
      toast.success("The connector was successfully validated.");
      return;
    }
    const errors = validate(selected.propertiesXml);
    if (errors.length === 0) {
      setInvalidFields(new Set());
      toast.success("The connector was successfully validated.");
    } else {
      setInvalidFields(new Set(errors.map((e) => e.field)));
      toast.error("Validation failed", {
        description: errors.map((e) => e.message).join("\n"),
        duration: 8000,
      });
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────────

  // Duplicate name detection: find names (trimmed, non-empty) that appear more than once
  const duplicateNames = useMemo<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const d of destinations) {
      const n = d.name.trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [destinations]);

  const isDupeName =
    !!selected && selected.name.trim() !== "" && duplicateNames.has(selected.name.trim());

  const connectorDef = selected
    ? DESTINATION_CONNECTOR_REGISTRY[selected.transportName]
    : undefined;
  const BottomSection = connectorDef?.BottomSection;

  // Mirrors the Java client's ConnectorTypeDecoration: a connector plugin (e.g. SSL Settings)
  // can secure the transport with TLS, which HTTP/WS Sender use to suppress the
  // "(SSL Not Configured)" warning on https URLs. True when any applicable + enabled plugin
  // reports securesTransport() for the current properties (mirror of source-tab.tsx).
  const securesTransport =
    !!selected &&
    DESTINATION_PLUGIN_REGISTRY.some(
      (p) =>
        surfaceEnabled(p) &&
        p.isApplicable(selected.transportName, selected.propertiesXml) &&
        p.securesTransport?.(selected.propertiesXml) === true
    );

  const sectionProps = selected
    ? {
        propertiesXml: selected.propertiesXml,
        onChange: (updates: Partial<DestinationConnectorState>) =>
          handleDestChange(safeIndex, updates),
        isDark,
        channelId,
        channelName,
        invalidFields: new Set([
          ...invalidFields,
          ...(externalInvalidFieldsByDestIndex?.get(safeIndex) ?? []),
        ]),
        transportName: selected.transportName,
        securesTransport,
      }
    : null;

  const queueMode = selected ? queueModeFrom(selected.queue) : "never";
  // Defer to per-connector metadata (mirrors Java propertiesInterface.canValidateResponse()).
  // Connectors default to allowing response validation unless their definition opts out.
  const canValidate = selected
    ? (DESTINATION_CONNECTOR_REGISTRY[selected.transportName]?.canValidateResponse ?? true)
    : false;
  const showQueueWarn =
    selected?.queue.queueEnabled &&
    messageStorageMode &&
    QUEUE_WARN_STORAGE_MODES.has(messageStorageMode);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top section: full-width destination table (hidden in flow mode — flow panel handles selection) */}
      {!isControlled && (
        <div className="shrink-0 border-b border-border">
          {/* ── Destinations toolbar ──────────────────────────────────────── */}
          <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-gray-50 dark:bg-gray-800/40">
            <HoverTooltip content="Add Destination">
              <button
                onClick={handleAdd}
                data-testid="add-destination"
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <HoverTooltip content="Move Up">
              <button
                disabled={destinations.length === 0 || safeIndex === 0}
                onClick={() => handleReorder(safeIndex, safeIndex - 1)}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <HoverTooltip content="Move Down">
              <button
                disabled={destinations.length === 0 || safeIndex >= destinations.length - 1}
                onClick={() => handleReorder(safeIndex, safeIndex + 1)}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
            <HoverTooltip content={selected?.enabled ? "Disable" : "Enable"}>
              <button
                disabled={!selected || (!!selected.enabled && !canRemoveOrDisable(safeIndex))}
                onClick={() => selected && onChange(safeIndex, { enabled: !selected.enabled })}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <HoverTooltip content="Duplicate">
              <button
                disabled={!selected}
                onClick={() => {
                  onDuplicate(safeIndex);
                  setSelectedIndex(safeIndex + 1);
                }}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <HoverTooltip content="Delete">
              <button
                disabled={!selected || !canRemoveOrDisable(safeIndex)}
                onClick={() => selected && handleRemove(safeIndex)}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
            <HoverTooltip content="Export Connector">
              <button
                disabled={!selected}
                onClick={() => selected && onExport(safeIndex)}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
            <HoverTooltip content="Import Connector">
              <button
                onClick={() => onImport()}
                className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
          </div>
          <DestinationList
            destinations={destinations}
            selectedIndex={safeIndex}
            duplicateNames={duplicateNames}
            onSelect={setSelectedIndex}
            onToggle={(i) => onChange(i, { enabled: !destinations[i].enabled })}
            onRemove={handleRemove}
            onDuplicate={(i) => {
              onDuplicate(i);
              setSelectedIndex(i + 1);
            }}
            onReorder={handleReorder}
            onExport={onExport}
            onImport={onImport}
          />
        </div>
      )}

      {/* ── Bottom section: config panel + mappings ─────────────────────────── */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
            No destinations. Click{" "}
            <strong className="not-italic font-medium">Add Destination</strong> to begin.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Config panel */}
          <div className="flex-1 overflow-auto min-w-0">
            <div
              className={`${SETTINGS_TAB_MIN_WIDTH} ${viewDensity === "comfortable" ? "p-6 space-y-5" : viewDensity === "compact" ? "p-3 space-y-2" : "p-4 space-y-3"}`}
            >
              {/* ── Filter / Transformer / Response Transformer / Validate buttons ── */}
              <div className="flex items-center gap-2">
                {onOpenFilter &&
                  (() => {
                    const n = countXmlElements(selected?.filterXml);
                    return (
                      <button
                        onClick={() => onOpenFilter(safeIndex)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                      >
                        <Filter className="w-3.5 h-3.5" />
                        Edit Filter
                        {n > 0 && (
                          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                            ({n})
                          </span>
                        )}
                      </button>
                    );
                  })()}
                {onOpenTransformer &&
                  (() => {
                    const n = countXmlElements(selected?.transformerXml);
                    return (
                      <button
                        onClick={() => onOpenTransformer(safeIndex)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        Edit Transformer
                        {n > 0 && (
                          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                            ({n})
                          </span>
                        )}
                      </button>
                    );
                  })()}
                {onOpenResponseTransformer &&
                  (() => {
                    const n = countXmlElements(selected?.responseTransformerXml);
                    return (
                      <button
                        onClick={() => onOpenResponseTransformer(safeIndex)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        Edit Response Transformer
                        {n > 0 && (
                          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                            ({n})
                          </span>
                        )}
                      </button>
                    );
                  })()}
                <button
                  onClick={handleValidateConnector}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Validate Connector
                </button>
              </div>

              {/* ── Connector Type ──────────────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0 w-[160px] text-right">
                  Connector Type:
                </span>
                <select
                  value={selected.transportName}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className={selectCls(viewDensity)}
                >
                  {connectorTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {/* Pin this destination's current transport when it is gated
                      off or unknown, so the select shows it (disabled) instead
                      of silently switching to the first option on next save. */}
                  {!connectorTypes.includes(selected.transportName) && (
                    <option value={selected.transportName} disabled>
                      {selected.transportName} (unavailable)
                    </option>
                  )}
                </select>
              </div>

              {/* ── Destination Name ────────────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0 w-[160px] text-right">
                  Destination Name:
                </span>
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={selected.name}
                    onChange={(e) => set("name", e.target.value)}
                    title={
                      isDupeName ? `Duplicate destination name: "${selected.name}"` : undefined
                    }
                    className={`w-96 h-8 px-3 text-sm rounded border
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                    focus:outline-none focus:ring-1
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${
                      isDupeName
                        ? "border-red-400 dark:border-red-500 focus:border-red-400 dark:focus:border-red-400 focus:ring-red-400/30"
                        : "border-border focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/30"
                    }`}
                  />
                  {isDupeName && (
                    <p className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Duplicate destination name
                    </p>
                  )}
                </div>
              </div>

              {/* ── Wait For Previous ────────────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0 w-[160px] text-right">
                  Wait For Previous:
                </span>
                <RadioGroup
                  name={`wait-${safeIndex}`}
                  value={selected.waitForPrevious ? "yes" : "no"}
                  onChange={(v) => set("waitForPrevious", v === "yes")}
                  disabled={isFirstDestination}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  title={
                    isFirstDestination
                      ? "The first destination always runs immediately — there is no previous destination to wait for."
                      : TIP.waitForPrevious
                  }
                />
              </div>

              {/* ── Enabled ──────────────────────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0 w-[160px] text-right">
                  Enabled:
                </span>
                <RadioGroup
                  name={`enabled-${safeIndex}`}
                  value={selected.enabled ? "yes" : "no"}
                  onChange={(v) => set("enabled", v === "yes")}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  title="Select Yes to enable this destination. Disabled destinations are skipped during message processing."
                />
              </div>

              {/* ── Destination Settings ─────────────────────────────────────────── */}
              <SettingsSection
                title="Destination Settings"
                icon={ArrowUpFromLine}
                defaultExpanded={true}
                storageKey="bl-dest-settings"
                summary={
                  <>
                    <SummaryChip
                      label="Queue"
                      value={
                        queueMode === "never"
                          ? "Never"
                          : queueMode === "onFailure"
                            ? "On Failure"
                            : "Always"
                      }
                    />
                    {selected.queue.threadCount > 1 && (
                      <SummaryChip label="Threads" value={String(selected.queue.threadCount)} />
                    )}
                  </>
                }
              >
                <FieldRow label="Queue Messages:">
                  <RadioGroup
                    name={`queue-${safeIndex}`}
                    value={queueMode}
                    onChange={(v) => handleQueueModeChange(v as QueueMode)}
                    options={[
                      { label: "Never", value: "never" },
                      { label: "On Failure", value: "onFailure" },
                      { label: "Always", value: "always" },
                    ]}
                    title={`Never: ${TIP.queueNever} On Failure: ${TIP.queueOnFailure} Always: ${TIP.queueAlways}`}
                  />
                </FieldRow>

                {/* Queueing is hard-blocked (not merely risky) in these storage modes; match Java's
                    DestinationSettingsPanel text exactly ("Queueing", no trailing period). */}
                {showQueueWarn && (
                  <div className="ml-[168px] text-xs text-amber-600 dark:text-amber-400 leading-snug max-w-sm">
                    Queueing is not supported by the current message storage mode
                  </div>
                )}

                <FieldRow label="">
                  <button
                    onClick={() => setAdvancedOpen(true)}
                    className="px-3 py-1 text-sm rounded border border-border
                    text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                    hover:border-border transition-colors"
                  >
                    Advanced...
                  </button>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {formatAdvancedQueueSummary(selected.queue)}
                  </span>
                </FieldRow>

                <FieldRow label="Validate Response:">
                  <RadioGroup
                    name={`validate-${safeIndex}`}
                    value={selected.queue.validateResponse ? "yes" : "no"}
                    onChange={(v) => setQueue({ validateResponse: v === "yes" })}
                    disabled={!canValidate}
                    options={[
                      { label: "Yes", value: "yes" },
                      { label: "No", value: "no" },
                    ]}
                    title={
                      canValidate
                        ? TIP.validateResponse
                        : "Response validation is not supported for this connector type."
                    }
                  />
                </FieldRow>

                <FieldRow label="Reattach Attachments:">
                  <RadioGroup
                    name={`reattach-${safeIndex}`}
                    value={selected.queue.reattachAttachments ? "yes" : "no"}
                    onChange={(v) => setQueue({ reattachAttachments: v === "yes" })}
                    options={[
                      { label: "Yes", value: "yes" },
                      { label: "No", value: "no" },
                    ]}
                    title={TIP.reattachAttachments}
                  />
                </FieldRow>
              </SettingsSection>

              {/* ── Destination plugin sections (e.g. SSL Settings) ─────────────
                A section renders only when:
                  1. its pluginName (if set) is in the server's installed+enabled set, AND
                  2. its isApplicable() returns true for the current connector + XML.
                The pluginName gate prevents server-backed plugins from rendering on
                servers where the underlying plugin isn't installed. */}
              {sectionProps &&
                DESTINATION_PLUGIN_REGISTRY.filter(
                  (p) =>
                    surfaceEnabled(p) &&
                    p.isApplicable(selected.transportName, selected.propertiesXml)
                ).map((p, i) => <p.Section key={i} {...sectionProps} />)}

              {/* ── Connector-specific Bottom Section ────────────────────────────── */}
              {sectionProps &&
                (BottomSection ? (
                  <BottomSection {...sectionProps} />
                ) : (
                  <UnimplementedBottomSection transportName={selected.transportName} />
                ))}
            </div>
          </div>

          {/* Destination Mappings panel */}
          <DestinationMappings
            destinations={destinations}
            selectedIndex={safeIndex}
            sourceTransformerXml={sourceTransformerXml}
          />
        </div>
      )}

      {/* ── Advanced Queue Settings Dialog ──────────────────────────────────── */}
      {selected && (
        <AdvancedQueueSettingsDialog
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          settings={selected.queue}
          queueMode={queueMode}
          onSave={(updates) => setQueue(updates)}
        />
      )}

      {/* ── Connector type change confirmation dialog ─────────────────────── */}
      <Dialog
        open={pendingDestType !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDestType(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Change Connector Type?</DialogTitle>
            <DialogDescription>
              Are you sure you would like to change this connector type and lose all of the current
              connector data?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setPendingDestType(null)}>
              No
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingDestType) applyDestTypeChange(pendingDestType);
                setPendingDestType(null);
              }}
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

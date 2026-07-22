"use client";

import { useState, useRef, useEffect, useCallback, createElement } from "react";
import {
  Plus,
  Settings,
  FileCode,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  Filter,
  ArrowRightLeft,
  ListOrdered,
  Globe,
  Network,
  FileText,
  Database,
  Code2,
  Activity,
  Mail,
  MessageSquare,
  Plug,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SourceConnectorState, DestinationConnectorState } from "../_lib/channel-xml";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FlowSelection =
  | "summary"
  | "source"
  | { type: "destination"; index: number }
  | "scripts";

export interface ChannelFlowPanelProps {
  sourceConnector: SourceConnectorState | null;
  destinations: DestinationConnectorState[];
  selection: FlowSelection;
  onSelect: (panel: FlowSelection) => void;
  onAddDestination: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleEnabled: (index: number) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
  onRequestDelete: (index: number) => void;
  /** Export the source connector to an XML file. */
  onExportSource: () => void;
  /** Replace the source connector from an imported XML file. */
  onImportSource: () => void;
  /** Export the destination at `index` to an XML file. */
  onExportDest: (index: number) => void;
  /** Import a destination connector from an XML file (appends a new destination). */
  onImportDest: () => void;
  pluginTabs?: { key: string; label: string }[];
  activePluginTab?: string | null;
  onSelectPluginTab?: (key: string) => void;
  /** Number of channel scripts that differ from their default template (0–4). */
  scriptCount?: number;
}

// ─── Connector icon lookup ─────────────────────────────────────────────────────

const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  "Channel Reader": GitBranch,
  "Channel Writer": GitBranch,
  "HTTP Listener": Globe,
  "HTTP Sender": Globe,
  "TCP Listener": Network,
  "TCP Sender": Network,
  "File Reader": FileText,
  "File Writer": FileText,
  "Database Reader": Database,
  "Database Writer": Database,
  "JavaScript Writer": Code2,
  "DICOM Listener": Activity,
  "DICOM Sender": Activity,
  "SMTP Sender": Mail,
  "JMS Reader": MessageSquare,
  "JMS Writer": MessageSquare,
};

function connectorIcon(transportName: string): LucideIcon {
  return CONNECTOR_ICONS[transportName] ?? Plug;
}

// ─── Data type helpers ─────────────────────────────────────────────────────────

const DATA_TYPE_ABBREV: Record<string, string> = {
  HL7V2: "HL7v2",
  XML: "XML",
  RAW: "Raw",
  EDI_X12: "EDI/X12",
  HL7V3: "HL7v3",
  NCPDP: "NCPDP",
  DICOM: "DICOM",
  DELIMITED: "Delimited",
  JSON: "JSON",
};

function abbreviateDataType(raw: string): string {
  return DATA_TYPE_ABBREV[raw] ?? raw;
}

/** Extract inbound/outbound data types from a <transformer> XML string. */
function getTransformerDataTypes(
  xml: string | null | undefined
): { inbound: string; outbound: string } | null {
  if (!xml) return null;
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const inbound = doc.querySelector("inboundDataType")?.textContent?.trim();
    const outbound = doc.querySelector("outboundDataType")?.textContent?.trim();
    if (!inbound || !outbound) return null;
    return { inbound: abbreviateDataType(inbound), outbound: abbreviateDataType(outbound) };
  } catch {
    return null;
  }
}

// ─── XML element counter ──────────────────────────────────────────────────────

/** Count top-level elements inside <elements> of a filter or transformer XML string. */
function countXmlElements(xml: string | null | undefined): number {
  if (!xml) return 0;
  try {
    return (
      new DOMParser().parseFromString(xml, "application/xml").querySelector("elements")?.children
        .length ?? 0
    );
  } catch {
    return 0;
  }
}

// ─── Chain grouping ───────────────────────────────────────────────────────────

interface ChainGroup {
  chainNumber: number;
  destinations: { dest: DestinationConnectorState; index: number }[];
}

/**
 * Groups destinations into sequential chains based on `waitForPrevious`.
 * - Destination 0 always starts Chain 1.
 * - `waitForPrevious: false` starts a new parallel chain.
 * - `waitForPrevious: true` continues the current chain.
 */
function computeChainGroups(destinations: DestinationConnectorState[]): ChainGroup[] {
  const groups: ChainGroup[] = [];
  let current: ChainGroup | null = null;
  for (let i = 0; i < destinations.length; i++) {
    if (i === 0 || !destinations[i].waitForPrevious) {
      current = { chainNumber: groups.length + 1, destinations: [] };
      groups.push(current);
    }
    current!.destinations.push({ dest: destinations[i], index: i });
  }
  return groups;
}

// ─── Destination guard ────────────────────────────────────────────────────────

/** Check whether disabling or deleting destination[index] is allowed.
 *  Rule: at least 1 enabled destination must always remain. */
function canRemoveOrDisable(destinations: DestinationConnectorState[], index: number): boolean {
  const target = destinations[index];
  if (!target) return false;
  // Deleting/disabling a disabled destination is fine as long as there are 2+ dests
  if (!target.enabled) return destinations.length > 1;
  // Target is enabled: need at least 1 other enabled dest to remain
  return destinations.filter((d) => d.enabled).length > 1;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Small icon+count badge for filter rules or transformer steps. */
function CountBadge({
  count,
  icon: Icon,
  label,
}: {
  count: number;
  icon: LucideIcon;
  label: string;
}) {
  if (count === 0) return null;
  return (
    <span
      title={`${count} ${label}`}
      className="inline-flex items-center gap-0.5 text-[10px] font-medium
                 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60
                 px-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800"
    >
      <Icon className="w-2.5 h-2.5 shrink-0" />
      {count}
    </span>
  );
}

/** Small queue indicator badge. */
function QueueBadge({ sendFirst, title: titleOverride }: { sendFirst: boolean; title?: string }) {
  return (
    <span
      title={titleOverride ?? (sendFirst ? "Queued: On Failure" : "Queued: Always")}
      className="inline-flex items-center gap-0.5 text-[10px] font-medium
                 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60
                 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800"
    >
      <ListOrdered className="w-2.5 h-2.5 shrink-0" />Q
    </span>
  );
}

/** Connector arrow between source and destinations (or within a chain). */
function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-0.5 select-none">
      <div className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
      {label && (
        <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 tracking-wide my-0.5">
          {label}
        </span>
      )}
      <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-500 -mt-0.5" />
    </div>
  );
}

/** Separator between parallel chain groups. */
function ParallelSeparator() {
  return (
    <div className="flex items-center gap-1.5 py-1 select-none">
      <div className="flex-1 border-t border-dashed border-border" />
      <GitBranch className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0" />
      <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tracking-wide">
        parallel
      </span>
      <div className="flex-1 border-t border-dashed border-border" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChannelFlowPanel({
  sourceConnector,
  destinations,
  selection,
  onSelect,
  onAddDestination,
  onReorder,
  onToggleEnabled,
  onDuplicate,
  onRequestDelete,
  onExportSource,
  onImportSource,
  onExportDest,
  onImportDest,
  pluginTabs,
  activePluginTab,
  onSelectPluginTab,
  scriptCount = 0,
}: ChannelFlowPanelProps) {
  const srcFilterRules = countXmlElements(sourceConnector?.filterXml);
  const srcTxSteps = countXmlElements(sourceConnector?.transformerXml);
  const srcDataTypes = getTransformerDataTypes(sourceConnector?.transformerXml);
  const srcQueueEnabled = sourceConnector?.respondAfterProcessing === false;
  // Plain value (not aliased to a capitalized component) so the React Compiler
  // doesn't treat it as a component created during render (react-hooks/static-components).
  const srcIcon = connectorIcon(sourceConnector?.transportName ?? "");

  // Arrow label: show outbound data type of the source transformer
  const arrowLabel = srcDataTypes
    ? srcDataTypes.inbound === srcDataTypes.outbound
      ? srcDataTypes.outbound
      : `${srcDataTypes.inbound}→${srcDataTypes.outbound}`
    : undefined;

  // ── Collapse state ─────────────────────────────────────────────────────────
  // Auto-collapse on initial mount when there are 5+ destinations
  const [collapsed, setCollapsed] = useState(() => destinations.length >= 5);

  // ── Drag-to-reorder state ──────────────────────────────────────────────────
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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
      // Keep selection in sync with moved destination
      if (typeof selection === "object" && selection.type === "destination") {
        if (selection.index === dragFrom.current) {
          onSelect({ type: "destination", index: i });
        }
      }
    }
    dragFrom.current = null;
    setDragOver(null);
  }

  function handleDragEnd() {
    dragFrom.current = null;
    setDragOver(null);
  }

  // ── Scroll-to-selected refs ──────────────────────────────────────────────
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    if (typeof selection === "object" && selection.type === "destination") {
      cardRefs.current.get(selection.index)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selection]);

  // ── Keyboard navigation ──────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Build flat nav order: summary → scripts → source → dest0…destN
      const navOrder: FlowSelection[] = [
        "summary",
        "scripts",
        "source",
        ...destinations.map((_, i) => ({ type: "destination" as const, index: i })),
      ];

      const currentIdx = navOrder.findIndex((s) => {
        if (typeof s === "string" && typeof selection === "string") return s === selection;
        if (typeof s === "object" && typeof selection === "object")
          return s.type === selection.type && s.index === selection.index;
        return false;
      });

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, navOrder.length - 1)
            : Math.max(currentIdx - 1, 0);
        if (next !== currentIdx) onSelect(navOrder[next]);
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        typeof selection === "object" &&
        selection.type === "destination" &&
        canRemoveOrDisable(destinations, selection.index)
      ) {
        e.preventDefault();
        onRequestDelete(selection.index);
      }
    },
    [selection, destinations, onSelect, onRequestDelete]
  );

  // ── Shared card style helpers ──────────────────────────────────────────────

  const cardBase =
    "w-full text-left rounded-lg border-2 px-3 py-2.5 cursor-pointer transition-all duration-150 group";

  const cardSelected = "border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-sm";

  const cardIdle =
    "border-border bg-white dark:bg-gray-800 " +
    "hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm";

  const navBase =
    "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors";

  const navSelected = "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium";

  const navIdle =
    "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-800 dark:hover:text-gray-200";

  // ── Chain groups ───────────────────────────────────────────────────────────

  const chainGroups = computeChainGroups(destinations);
  const multipleChains = chainGroups.length > 1;

  // ── Destination card renderer ──────────────────────────────────────────────

  function renderDestCard(
    dest: DestinationConnectorState,
    i: number,
    isLast: boolean,
    compact: boolean,
    chainNumber?: number
  ) {
    const filterRules = countXmlElements(dest.filterXml);
    const txSteps = countXmlElements(dest.transformerXml);
    const isEnabled = dest.enabled;
    const isSelected =
      !activePluginTab &&
      typeof selection === "object" &&
      selection.type === "destination" &&
      selection.index === i;
    const isDragTarget = dragOver === i && dragFrom.current !== i;
    const DestIcon = connectorIcon(dest.transportName);

    // In compact (collapsed) mode, non-selected cards render as a single slim row
    const useCompact = compact && !isSelected;

    const dragTargetClass = isDragTarget
      ? "border-t-2 border-t-blue-400 dark:border-t-blue-500"
      : "";

    return (
      <div
        key={dest.metaDataId ?? i}
        ref={(el) => {
          if (el) cardRefs.current.set(i, el);
          else cardRefs.current.delete(i);
        }}
        draggable
        onDragStart={(e) => handleDragStart(e, i)}
        onDragOver={(e) => handleDragOver(e, i)}
        onDrop={(e) => handleDrop(e, i)}
        onDragEnd={handleDragEnd}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {useCompact ? (
              /* ── Compact (collapsed) card ─────────────────────────── */
              <button
                onClick={() => onSelect({ type: "destination", index: i })}
                className={`w-full text-left rounded-md border px-2 py-1.5 cursor-pointer
                            transition-all duration-150
                            ${isSelected ? cardSelected : cardIdle} ${dragTargetClass}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0 cursor-grab active:cursor-grabbing" />
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isEnabled ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
                    }`}
                  />
                  <span
                    className={`text-xs truncate flex-1 ${
                      isEnabled
                        ? "text-gray-700 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {dest.name}
                  </span>
                  <span
                    className={`text-xs shrink-0 ${
                      isEnabled
                        ? "text-gray-500 dark:text-gray-400"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {dest.transportName}
                  </span>
                  {multipleChains && chainNumber !== undefined && (
                    <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 shrink-0">
                      [{chainNumber}]
                    </span>
                  )}
                  {!isEnabled && (
                    <span
                      className="text-[10px] font-medium text-gray-400 dark:text-gray-500
                                     bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded shrink-0"
                    >
                      Off
                    </span>
                  )}
                </div>
              </button>
            ) : (
              /* ── Full card ────────────────────────────────────────── */
              <button
                onClick={() => onSelect({ type: "destination", index: i })}
                className={`${cardBase} ${isSelected ? cardSelected : cardIdle} ${dragTargetClass}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0 cursor-grab active:cursor-grabbing -ml-0.5" />
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isEnabled ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
                    }`}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 truncate flex-1">
                    {dest.name}
                  </span>
                  <span
                    className="text-[10px] font-mono text-gray-400 dark:text-gray-500 shrink-0"
                    title="Destination ID (metaDataId)"
                  >
                    #{dest.metaDataId}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <DestIcon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isEnabled
                          ? "text-gray-500 dark:text-gray-400"
                          : "text-gray-300 dark:text-gray-600"
                      }`}
                    />
                    <span
                      className={`text-sm font-semibold truncate ${
                        isEnabled
                          ? "text-gray-800 dark:text-gray-200"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {dest.transportName}
                    </span>
                  </div>
                  {!isEnabled && (
                    <span
                      className="text-[10px] font-medium text-gray-400 dark:text-gray-500
                                     bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded shrink-0"
                    >
                      Off
                    </span>
                  )}
                </div>
                {(filterRules > 0 || txSteps > 0 || dest.queue.queueEnabled) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <CountBadge
                      count={filterRules}
                      icon={Filter}
                      label={filterRules === 1 ? "filter rule" : "filter rules"}
                    />
                    <CountBadge
                      count={txSteps}
                      icon={ArrowRightLeft}
                      label={txSteps === 1 ? "transformer step" : "transformer steps"}
                    />
                    {dest.queue.queueEnabled && <QueueBadge sendFirst={dest.queue.sendFirst} />}
                  </div>
                )}
              </button>
            )}
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
              disabled={isEnabled && !canRemoveOrDisable(destinations, i)}
              onClick={() => onToggleEnabled(i)}
            >
              {isEnabled ? "Disable" : "Enable"}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onDuplicate(i)}>Duplicate</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onExportDest(i)}>Export Connector</ContextMenuItem>
            <ContextMenuItem onClick={() => onImportDest()}>Import Connector</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!canRemoveOrDisable(destinations, i)}
              onClick={() => onRequestDelete(i)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-1 min-h-full outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md"
    >
      {/* ── Channel-level navigation ────────────────────────────────────── */}
      <button
        onClick={() => onSelect("summary")}
        className={`${navBase} ${selection === "summary" && !activePluginTab ? navSelected : navIdle}`}
      >
        <Settings className="w-3.5 h-3.5 shrink-0" />
        <span>Summary & Settings</span>
      </button>

      <button
        onClick={() => onSelect("scripts")}
        className={`${navBase} ${selection === "scripts" && !activePluginTab ? navSelected : navIdle}`}
      >
        <FileCode className="w-3.5 h-3.5 shrink-0" />
        <span>{scriptCount > 0 ? `Scripts (${scriptCount})` : "Scripts"}</span>
      </button>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="my-2 border-t border-border" />

      {/* ── SOURCE node ─────────────────────────────────────────────────── */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => onSelect("source")}
            className={`${cardBase} ${selection === "source" && !activePluginTab ? cardSelected : cardIdle}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Source
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {createElement(srcIcon, {
                className: "w-3.5 h-3.5 shrink-0 text-gray-500 dark:text-gray-400",
              })}
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                {sourceConnector?.transportName ?? "Channel Reader"}
              </span>
            </div>
            {(srcFilterRules > 0 || srcTxSteps > 0 || srcQueueEnabled) && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <CountBadge
                  count={srcFilterRules}
                  icon={Filter}
                  label={srcFilterRules === 1 ? "filter rule" : "filter rules"}
                />
                <CountBadge
                  count={srcTxSteps}
                  icon={ArrowRightLeft}
                  label={srcTxSteps === 1 ? "transformer step" : "transformer steps"}
                />
                {srcQueueEnabled && <QueueBadge sendFirst={false} title="Source Queue: ON" />}
              </div>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onExportSource()}>Export Connector</ContextMenuItem>
          <ContextMenuItem onClick={() => onImportSource()}>Import Connector</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* ── Connector arrow ─────────────────────────────────────────────── */}
      {destinations.length > 0 && <FlowArrow label={arrowLabel} />}

      {/* ── Destinations header with collapse toggle ────────────────────── */}
      {destinations.length > 0 && (
        <div className="flex items-center justify-between px-0.5 mb-0.5">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand destinations" : "Collapse destinations"}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest
                       text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300
                       transition-colors select-none"
          >
            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {destinations.length} {destinations.length === 1 ? "Destination" : "Destinations"}
          </button>
        </div>
      )}

      {/* ── DESTINATION nodes (grouped by chain) ────────────────────────── */}
      {
        // eslint-disable-next-line react-hooks/refs -- dragFrom is a drag-state ref; reading during render is intentional to avoid re-renders on every drag event
        chainGroups.map((group, groupIdx) => {
          const isLastGroup = groupIdx === chainGroups.length - 1;

          // Single-chain optimization: no wrapper container
          if (!multipleChains) {
            return group.destinations.map(({ dest, index }, j) =>
              renderDestCard(
                dest,
                index,
                j === group.destinations.length - 1,
                collapsed,
                group.chainNumber
              )
            );
          }

          // Multi-chain: wrap each group in a labeled container
          return (
            <div key={group.chainNumber}>
              <div className="rounded-md border border-dashed border-border p-1.5 flex flex-col gap-0">
                {/* Chain label */}
                <div className="px-1 pb-1 flex items-center gap-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Chain {group.chainNumber}
                  </span>
                </div>

                {/* Destination cards within this chain */}
                {group.destinations.map(({ dest, index }, j) =>
                  renderDestCard(
                    dest,
                    index,
                    j === group.destinations.length - 1,
                    collapsed,
                    group.chainNumber
                  )
                )}
              </div>

              {/* Parallel separator between chains */}
              {!isLastGroup && <ParallelSeparator />}
            </div>
          );
        })
      }

      {/* ── Add Destination ─────────────────────────────────────────────── */}
      <button
        onClick={onAddDestination}
        className="mt-1 w-full flex items-center justify-center gap-1.5 px-3 py-1.5
                   text-xs font-medium text-blue-600 dark:text-blue-400
                   border border-dashed border-blue-300 dark:border-blue-700
                   rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/40
                   hover:border-blue-400 dark:hover:border-blue-600
                   transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add Destination
      </button>

      {/* ── Plugin tab nav items ────────────────────────────────────────── */}
      {pluginTabs && pluginTabs.length > 0 && (
        <>
          <div className="my-2 border-t border-border" />
          {pluginTabs.map((pluginTab) => (
            <button
              key={pluginTab.key}
              onClick={() => onSelectPluginTab?.(pluginTab.key)}
              className={`${navBase} ${activePluginTab === pluginTab.key ? navSelected : navIdle}`}
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span>{pluginTab.label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

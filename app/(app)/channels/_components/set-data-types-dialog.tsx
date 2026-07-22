"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/lib/hooks/use-theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import {
  TableContainer,
  Table,
  TableColGroup,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/data-table";
import { HeaderCell } from "@/components/sortable-header-cell";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";

type DTCol = "connector" | "inbound" | "outbound";

const DT_COLS: ColDef<DTCol>[] = [
  { key: "connector", label: "Connector", defaultWidth: 360, minWidth: 120, defaultVisible: true },
  { key: "inbound", label: "Inbound", defaultWidth: 176, minWidth: 100, defaultVisible: true },
  { key: "outbound", label: "Outbound", defaultWidth: 176, minWidth: 100, defaultVisible: true },
];
import type { ConnectorDataTypeRow, DataTypesState } from "../_lib/channel-xml";
import { defaultPropertiesXml } from "../_lib/channel-xml";
import { applyDataTypeChange } from "../_lib/data-type-cascade";
import { DATA_TYPE_REGISTRY } from "../_datatypes/index";
import { useVisibleDataTypes } from "../_datatypes/use-visible-data-types";
import { CONNECTOR_REGISTRY } from "../_connectors";

// Re-exported for back-compat: the shared cascade now lives in ../_lib/data-type-cascade
// so the transformer Message Templates path can reuse it. Existing importers
// (and the dialog's own tests) continue to import applyDataTypeChange from here.
export { applyDataTypeChange };

// ─── Properties panel (one side: header + type selector + plugin section) ──────

function PropertiesPanel({
  title,
  row,
  side,
  onUpdateRow,
  onChangeType,
  transformerType,
  isDark,
  locked,
  lockedTitle,
  channelId,
  version,
}: {
  title: string;
  row: ConnectorDataTypeRow;
  side: "in" | "out";
  onUpdateRow: (updated: ConnectorDataTypeRow) => void;
  /** Type change entry point — funnels through the shared cascade (see changeType). */
  onChangeType: (id: string, side: "in" | "out", newType: string) => void;
  /** Transformer context of this row — gates data-type property groups (mirrors Java). */
  transformerType: "source" | "destination" | "response";
  isDark: boolean;
  /** When true, the type selector is read-only (connector forces this type). */
  locked?: boolean;
  /** Tooltip shown when locked is true. */
  lockedTitle?: string;
  /** Forwarded to the data-type PropertiesSection for code-template scoping. */
  channelId?: string;
  /** Channel/server version stamped on Restore-Defaults property XML (mirrors Java marshal). */
  version: string;
}) {
  const dataType = side === "in" ? row.inboundDataType : row.outboundDataType;
  const propsXml = side === "in" ? row.inboundPropertiesXml : row.outboundPropertiesXml;
  const visibleTypes = useVisibleDataTypes();

  // Registry plugin for this type (used for outbound-only serialization panels)
  const plugin = DATA_TYPE_REGISTRY.get(dataType);
  // Incremented when type changes or defaults restored → remounts plugin.PropertiesSection
  const [restoreKey, setRestoreKey] = useState(0);
  const PluginSection = plugin?.PropertiesSection;

  function handleTypeChange(newType: string) {
    // Route through the shared cascade so panel edits behave exactly like the
    // table-cell path (source-outbound → destination inbound, destination-outbound
    // → response row). Plain single-row replacement here would drop the cascade.
    onChangeType(row.id, side, newType);
    setRestoreKey((k) => k + 1);
  }

  const { viewDensity } = useCompactMode();
  const ppBarPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";
  const selectCls = `${densityHeight(viewDensity)} px-1.5 text-xs rounded border border-border
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 w-32`;

  function handleRestoreDefaults() {
    const newXml = defaultPropertiesXml(
      dataType,
      side === "in" ? "inboundProperties" : "outboundProperties",
      version
    );
    if (side === "in") onUpdateRow({ ...row, inboundPropertiesXml: newXml });
    else onUpdateRow({ ...row, outboundPropertiesXml: newXml });
    setRestoreKey((k) => k + 1);
  }

  function handleUpdatePropsXml(xml: string) {
    if (side === "in") onUpdateRow({ ...row, inboundPropertiesXml: xml });
    else onUpdateRow({ ...row, outboundPropertiesXml: xml });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Panel header */}
      <p
        className={`text-xs font-semibold text-gray-700 dark:text-gray-300 px-3 ${ppBarPy} shrink-0 border-b border-border`}
      >
        {title}
      </p>

      {/* Type selector row */}
      <div className={`flex items-center gap-2 px-3 ${ppBarPy} shrink-0 border-b border-border`}>
        {locked ? (
          <span
            className={`${selectCls} inline-flex items-center opacity-60 cursor-not-allowed select-none`}
            title={lockedTitle}
          >
            {dataType}
          </span>
        ) : (
          <select
            value={dataType}
            onChange={(e) => handleTypeChange(e.target.value)}
            className={selectCls}
          >
            {visibleTypes.map((t) => (
              <option key={t} value={t}>
                {DATA_TYPE_REGISTRY.get(t)?.displayName ?? t}
              </option>
            ))}
            {/* Pin the current type when it is gated off or unknown so the
                select can't silently switch it to the first option on save. */}
            {!visibleTypes.includes(dataType) && (
              <option value={dataType} disabled>
                {(DATA_TYPE_REGISTRY.get(dataType)?.displayName ?? dataType) + " (unavailable)"}
              </option>
            )}
          </select>
        )}
        {/* Restore Defaults regenerates the plugin's typed default XML. For an
            unregistered type there is no plugin, so defaultPropertiesXml would emit
            a class-less bare element the server cannot deserialize — hide it. */}
        {PluginSection && (
          <button
            onClick={handleRestoreDefaults}
            className="px-2 py-1 text-xs rounded border border-border text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
          >
            Restore Defaults
          </button>
        )}
      </div>

      {/* Properties content — delegate entirely to the plugin's PropertiesSection */}
      {PluginSection ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <PluginSection
            key={restoreKey}
            propsXml={propsXml}
            side={side === "in" ? "inbound" : "outbound"}
            transformerType={transformerType}
            onChange={handleUpdatePropsXml}
            isDark={isDark}
            channelId={channelId}
            version={version}
          />
        </div>
      ) : (
        <div
          className={`flex-1 overflow-y-auto px-3 ${viewDensity === "comfortable" ? "py-3" : viewDensity === "compact" ? "py-1.5" : "py-2"} min-h-0`}
        >
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            Properties for <span className="font-medium not-italic">{dataType}</span> can be
            configured in the XML tab.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main dialog ───────────────────────────────────────────────────────────────

interface SetDataTypesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataTypes: DataTypesState;
  onSave: (updated: DataTypesState) => void;
  /** Transport name of the source connector — used to check for a required inbound type. */
  sourceTransportName?: string;
  /** Properties XML of the source connector — used by connectors with conditional requirements. */
  sourcePropertiesXml?: string | null;
  /**
   * Channel ID, forwarded to the data-type PropertiesSection so the embedded
   * ScriptEditorDialog can filter code-template completions by channel library.
   */
  channelId?: string;
}

export function SetDataTypesDialog({
  open,
  onOpenChange,
  dataTypes,
  onSave,
  sourceTransportName,
  sourcePropertiesXml,
  channelId,
}: SetDataTypesDialogProps) {
  const { isDark } = useTheme();
  const { viewDensity } = useCompactMode();
  const visibleTypes = useVisibleDataTypes();
  const dtColConfig = useColumnConfig(DT_COLS, "bl-set-data-types-cols-v1");
  const selectCls = `${densityHeight(viewDensity)} px-1.5 text-xs rounded border border-border
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 w-32`;

  const [local, setLocal] = useState<DataTypesState>(dataTypes);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [selectedId, setSelectedId] = useState<string>("source");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkInbound, setBulkInbound] = useState<string>("RAW");
  const [bulkOutbound, setBulkOutbound] = useState<string>("RAW");

  // Reset when dialog opens
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(dataTypes);
    setMode("single");
    setSelectedId(dataTypes.connectors[0]?.id ?? "source");
    setExpanded(
      new Set(dataTypes.connectors.filter((c) => !c.parentId && c.id !== "source").map((c) => c.id))
    );
    setBulkInbound("RAW");
    setBulkOutbound("RAW");
  }, [open, dataTypes]);

  // ── Row helpers ──────────────────────────────────────────────────────────────

  function updateRowFull(updated: ConnectorDataTypeRow) {
    setLocal((prev) => ({
      ...prev,
      connectors: prev.connectors.map((c) => (c.id === updated.id ? updated : c)),
    }));
  }

  function changeType(id: string, side: "in" | "out", newType: string) {
    if (!local.connectors.find((c) => c.id === id)) return;
    setLocal((prev) => ({
      ...prev,
      connectors: applyDataTypeChange(prev.connectors, id, side, newType, prev.version),
    }));
    setSelectedId(id);
  }

  function applyBulk() {
    setLocal((prev) => ({
      ...prev,
      connectors: prev.connectors.map((c) => {
        const effectiveBulkInbound =
          c.id === "source" && requiredSourceType !== null ? requiredSourceType : bulkInbound;
        const updated = {
          ...c,
          inboundDataType: effectiveBulkInbound,
          inboundPropertiesXml: defaultPropertiesXml(
            effectiveBulkInbound,
            "inboundProperties",
            prev.version
          ),
          outboundDataType: bulkOutbound,
          outboundPropertiesXml: defaultPropertiesXml(
            bulkOutbound,
            "outboundProperties",
            prev.version
          ),
        };
        // Destination inbound must always match source outbound — override here too
        if (!c.parentId && c.id !== "source") {
          return {
            ...updated,
            inboundDataType: bulkOutbound,
            inboundPropertiesXml: defaultPropertiesXml(
              bulkOutbound,
              "inboundProperties",
              prev.version
            ),
          };
        }
        return updated;
      }),
    }));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(
      new Set(local.connectors.filter((c) => !c.parentId && c.id !== "source").map((c) => c.id))
    );
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const selectedRow = local.connectors.find((c) => c.id === selectedId) ?? local.connectors[0];
  const visibleRows = local.connectors.filter((c) => !c.parentId || expanded.has(c.parentId));

  // If the source connector forces a specific inbound type, compute it once here.
  const srcDef = sourceTransportName ? CONNECTOR_REGISTRY[sourceTransportName] : undefined;
  const requiredSourceType =
    srcDef?.getRequiredInboundDataType?.(sourcePropertiesXml ?? null) ?? null;
  const sourceLockTitle = requiredSourceType
    ? `${sourceTransportName} requires the inbound data type to be ${requiredSourceType}`
    : undefined;

  // Transformer context of the selected row — drives property-group gating and the
  // inbound lock, both mirroring the Java client.
  const selIsResponse = !!selectedRow?.parentId;
  const selIsDest = !!selectedRow && !selIsResponse && selectedRow.id !== "source";
  const selectedTransformerType: "source" | "destination" | "response" = selIsResponse
    ? "response"
    : selIsDest
      ? "destination"
      : "source";
  // Inbound selector is locked for destination rows (inbound always follows source
  // outbound) and for a source that forces a required inbound type — mirrors the
  // table cell so the panel can't bypass the lock.
  const inboundLocked = selIsDest || (selectedRow?.id === "source" && requiredSourceType !== null);
  const inboundLockedTitle =
    selectedRow?.id === "source"
      ? sourceLockTitle
      : "Destination inbound type is always set to the source outbound type";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden max-h-[85vh] !w-[min(1024px,95vw)] !max-w-none"
        aria-describedby={undefined}
      >
        {/* Header */}
        <DialogHeader className="px-4 pt-3 pb-2 shrink-0 border-b border-border">
          <DialogTitle>Set Data Types</DialogTitle>
        </DialogHeader>

        {/* Top control bar */}
        <div className="flex items-center justify-between px-4 py-1.5 shrink-0 border-b border-border bg-gray-50 dark:bg-gray-800/60">
          <div className="flex items-center gap-4 text-sm">
            {(["single", "bulk"] as const).map((m) => (
              <label
                key={m}
                className="flex items-center gap-1.5 cursor-pointer select-none text-gray-700 dark:text-gray-300"
              >
                <input
                  type="radio"
                  name="dt-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="accent-blue-600"
                />
                {m === "single" ? "Single Edit" : "Bulk Edit"}
              </label>
            ))}
          </div>
          {mode === "single" && (
            <div className="flex items-center gap-3 text-xs text-blue-600 dark:text-blue-400">
              <button onClick={expandAll} className="hover:underline">
                Expand All
              </button>
              <span className="text-gray-400 dark:text-gray-600">|</span>
              <button onClick={collapseAll} className="hover:underline">
                Collapse All
              </button>
            </div>
          )}
        </div>

        {/* Bulk edit controls */}
        {mode === "bulk" && (
          <div className="flex items-center gap-4 px-6 py-4 shrink-0 border-b border-border text-sm">
            <span className="text-gray-700 dark:text-gray-300 font-medium w-20 shrink-0">
              Inbound
            </span>
            <select
              value={bulkInbound}
              onChange={(e) => setBulkInbound(e.target.value)}
              className={`${selectCls} w-36`}
            >
              {visibleTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {!visibleTypes.includes(bulkInbound) && (
                <option value={bulkInbound} disabled>
                  {bulkInbound} (unavailable)
                </option>
              )}
            </select>
            <span className="text-gray-700 dark:text-gray-300 font-medium w-20 shrink-0">
              Outbound
            </span>
            <select
              value={bulkOutbound}
              onChange={(e) => setBulkOutbound(e.target.value)}
              className={`${selectCls} w-36`}
            >
              {visibleTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {!visibleTypes.includes(bulkOutbound) && (
                <option value={bulkOutbound} disabled>
                  {bulkOutbound} (unavailable)
                </option>
              )}
            </select>
            <button
              onClick={applyBulk}
              className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
            >
              Apply to All
            </button>
          </div>
        )}

        {/* Single Edit table */}
        {mode === "single" && (
          <TableContainer className="shrink-0 max-h-[16vh] rounded-none border-x-0 border-t-0">
            <Table>
              <TableColGroup cols={dtColConfig.visibleCols} colState={dtColConfig.colState} />
              <TableHead>
                <TableHeadRow>
                  {dtColConfig.visibleCols.map((c) => (
                    <HeaderCell
                      key={c.key}
                      col={c.key}
                      colDef={c}
                      width={dtColConfig.colState[c.key].width}
                      onResize={dtColConfig.setWidth}
                    />
                  ))}
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {visibleRows.map((row) => {
                  const isSelected = selectedId === row.id;
                  const isResponse = !!row.parentId;
                  const isDest = !isResponse && row.id !== "source";
                  const hasResponse = isDest && local.connectors.some((c) => c.parentId === row.id);
                  const isExpanded = isDest && expanded.has(row.id);

                  return (
                    <TableRow
                      key={row.id}
                      variant={isSelected ? "selected" : "default"}
                      onClick={() => setSelectedId(row.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {isResponse && <span className="w-5 shrink-0" />}
                          {isDest && hasResponse && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(row.id);
                              }}
                              className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                              title={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          {isDest && !hasResponse && <span className="w-5 shrink-0" />}
                          <span
                            className={
                              isResponse ? "text-xs text-gray-500 dark:text-gray-400" : undefined
                            }
                          >
                            {row.label}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isDest || (row.id === "source" && requiredSourceType !== null) ? (
                          <span
                            className={`${selectCls} inline-flex items-center opacity-60 cursor-not-allowed select-none`}
                            title={
                              row.id === "source" && requiredSourceType !== null
                                ? sourceLockTitle
                                : "Destination inbound type is always set to the source outbound type"
                            }
                          >
                            {DATA_TYPE_REGISTRY.get(row.inboundDataType)?.displayName ??
                              row.inboundDataType}
                          </span>
                        ) : (
                          <select
                            value={row.inboundDataType}
                            onChange={(e) => {
                              e.stopPropagation();
                              changeType(row.id, "in", e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={selectCls}
                          >
                            {visibleTypes.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                            {!visibleTypes.includes(row.inboundDataType) && (
                              <option value={row.inboundDataType} disabled>
                                {row.inboundDataType} (unavailable)
                              </option>
                            )}
                          </select>
                        )}
                      </TableCell>
                      <TableCell>
                        <select
                          value={row.outboundDataType}
                          onChange={(e) => {
                            e.stopPropagation();
                            changeType(row.id, "out", e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className={selectCls}
                        >
                          {visibleTypes.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                          {!visibleTypes.includes(row.outboundDataType) && (
                            <option value={row.outboundDataType} disabled>
                              {row.outboundDataType} (unavailable)
                            </option>
                          )}
                        </select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Properties panels */}
        {selectedRow && (
          <TooltipProvider delayDuration={400}>
            <div className="flex flex-1 min-h-0 divide-x divide-border overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden">
                <PropertiesPanel
                  title="Inbound Properties"
                  row={selectedRow}
                  side="in"
                  onUpdateRow={updateRowFull}
                  onChangeType={changeType}
                  transformerType={selectedTransformerType}
                  isDark={isDark}
                  locked={inboundLocked}
                  lockedTitle={inboundLockedTitle}
                  channelId={channelId}
                  version={local.version}
                />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <PropertiesPanel
                  title="Outbound Properties"
                  row={selectedRow}
                  side="out"
                  onUpdateRow={updateRowFull}
                  onChangeType={changeType}
                  transformerType={selectedTransformerType}
                  isDark={isDark}
                  channelId={channelId}
                  version={local.version}
                />
              </div>
            </div>
          </TooltipProvider>
        )}

        {/* Footer */}
        <DialogFooter className="px-4 py-2 shrink-0 border-t border-border flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-1.5 text-sm rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(local)}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useExpandState } from "@/lib/hooks/use-expand-state";
import {
  TableContainer,
  Table,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
  TableEmpty,
} from "@/components/data-table";
import { SimpleHeaderCell } from "@/components/sortable-header-cell";
import { Input } from "@/components/ui/input";
import {
  type AlertForm,
  type ChannelNode,
  type ChannelState,
  type ConnectorState,
} from "./alert-types";

// Mirrors Java AlertChannelPane: synthetic top-level "[New Channels]" row with
// two pseudo-connector children. Sentinel ids keep them distinct from real channels.
const NEW_CHANNELS_ID = "__new__";
const NEW_SOURCE_ROW_ID = "__new__:source";
const NEW_DEST_ROW_ID = "__new__:destination";

// Per-channel connector rowIds are "<channelId>:<metaDataId>". The per-channel
// "[New Destinations]" pseudo-connector has metaDataId null, encoded as the "new"
// sentinel so it survives the string rowId round-trip (Number("new") would be NaN).
const NEW_DEST_META = "new";
function connectorRowId(channelId: string, metaDataId: number | null): string {
  return `${channelId}:${metaDataId === null ? NEW_DEST_META : metaDataId}`;
}
function parseConnectorMeta(metaStr: string): number | null {
  return metaStr === NEW_DEST_META ? null : Number(metaStr);
}

type RowKind = "newChannel" | "newSource" | "newDestination" | "channel" | "connector";

interface VisibleRow {
  rowId: string;
  kind: RowKind;
  name: string;
  /** Defined for "channel" and "connector" rows. */
  channelId?: string;
  /** Defined only for "connector" rows. null = the per-channel [New Destinations] connector. */
  metaDataId?: number | null;
  depth: 0 | 1;
  hasChildren: boolean;
  state: ChannelState;
}

function computeNewChannelState(src: boolean, dest: boolean): ChannelState {
  if (src && dest) return "enabled";
  if (!src && !dest) return "disabled";
  return "partial";
}

export function ChannelsTab({
  form,
  setForm,
  channelNodes,
}: {
  form: AlertForm;
  setForm: React.Dispatch<React.SetStateAction<AlertForm>>;
  channelNodes: ChannelNode[];
}) {
  const { viewDensity } = useCompactMode();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);

  // Default to fully expanded — matches Java's expandAll() on open.
  const [expanded, toggleExpand] = useExpandState("bl-alerts-channel-tree", () => [
    NEW_CHANNELS_ID,
    ...channelNodes.map((n) => n.id),
  ]);

  // Filter channels by name/connector name (case-insensitive). [New Channels] always visible.
  const filteredNodes = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return channelNodes;
    return channelNodes.filter(
      (n) =>
        n.name.toLowerCase().includes(f) ||
        n.connectors.some((c) => c.name.toLowerCase().includes(f))
    );
  }, [channelNodes, filter]);

  // Flatten the tree into the list of currently visible rows, in display order.
  const visibleRows: VisibleRow[] = useMemo(() => {
    const rows: VisibleRow[] = [];

    rows.push({
      rowId: NEW_CHANNELS_ID,
      kind: "newChannel",
      name: "[New Channels]",
      depth: 0,
      hasChildren: true,
      state: computeNewChannelState(form.newChannelSource, form.newChannelDestination),
    });
    if (expanded.has(NEW_CHANNELS_ID)) {
      rows.push({
        rowId: NEW_SOURCE_ROW_ID,
        kind: "newSource",
        name: "Source",
        depth: 1,
        hasChildren: false,
        state: form.newChannelSource ? "enabled" : "disabled",
      });
      rows.push({
        rowId: NEW_DEST_ROW_ID,
        kind: "newDestination",
        name: "[New Destinations]",
        depth: 1,
        hasChildren: false,
        state: form.newChannelDestination ? "enabled" : "disabled",
      });
    }

    for (const node of filteredNodes) {
      const chState = form.channelStates.get(node.id) ?? "enabled";
      rows.push({
        rowId: node.id,
        kind: "channel",
        name: node.name,
        channelId: node.id,
        depth: 0,
        hasChildren: node.connectors.length > 0,
        state: chState,
      });
      if (expanded.has(node.id)) {
        for (const c of node.connectors) {
          const pcMap = form.connectorStates.get(node.id);
          const explicit = pcMap?.get(c.metaDataId);
          const cState: ConnectorState =
            explicit ?? (chState === "disabled" ? "disabled" : "enabled");
          rows.push({
            rowId: connectorRowId(node.id, c.metaDataId),
            kind: "connector",
            name: c.name,
            channelId: node.id,
            metaDataId: c.metaDataId,
            depth: 1,
            hasChildren: false,
            state: cState,
          });
        }
      }
    }

    return rows;
  }, [filteredNodes, form, expanded]);

  // ── Selection handlers ───────────────────────────────────────────────────

  function handleRowClick(idx: number, e: React.MouseEvent) {
    const rowId = visibleRows[idx].rowId;
    if (e.shiftKey && lastSelectedIdx !== null) {
      const [a, b] = [Math.min(lastSelectedIdx, idx), Math.max(lastSelectedIdx, idx)];
      const next = new Set(selected);
      for (let i = a; i <= b; i++) next.add(visibleRows[i].rowId);
      setSelected(next);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      setSelected(next);
      setLastSelectedIdx(idx);
    } else {
      setSelected(new Set([rowId]));
      setLastSelectedIdx(idx);
    }
  }

  // ── Bulk Enable / Disable: applies to selected rows + descendants ────────

  function applyToSelection(enable: boolean) {
    if (selected.size === 0) return;
    const targetState: ConnectorState = enable ? "enabled" : "disabled";

    setForm((prev) => {
      let newSource = prev.newChannelSource;
      let newDest = prev.newChannelDestination;
      const channelStates = new Map(prev.channelStates);
      const connectorStates = new Map(prev.connectorStates);

      for (const rowId of selected) {
        if (rowId === NEW_CHANNELS_ID) {
          newSource = enable;
          newDest = enable;
        } else if (rowId === NEW_SOURCE_ROW_ID) {
          newSource = enable;
        } else if (rowId === NEW_DEST_ROW_ID) {
          newDest = enable;
        } else if (rowId.includes(":")) {
          // Single connector
          const [channelId, metaStr] = rowId.split(":");
          const metaDataId = parseConnectorMeta(metaStr);
          const pcMap = new Map(
            connectorStates.get(channelId) ?? new Map<number | null, ConnectorState>()
          );
          // Seed pcMap with current effective states for all connectors in this channel,
          // so flipping one connector doesn't accidentally re-enable others.
          const node = channelNodes.find((n) => n.id === channelId);
          if (node) {
            const chState = channelStates.get(channelId) ?? "enabled";
            for (const c of node.connectors) {
              if (!pcMap.has(c.metaDataId)) {
                pcMap.set(c.metaDataId, chState === "disabled" ? "disabled" : "enabled");
              }
            }
          }
          pcMap.set(metaDataId, targetState);
          connectorStates.set(channelId, pcMap);
          // Recompute channel state from the connector map
          const states = [...pcMap.values()];
          const allOn = states.every((s) => s === "enabled");
          const allOff = states.every((s) => s === "disabled");
          channelStates.set(channelId, allOn ? "enabled" : allOff ? "disabled" : "partial");
        } else {
          // Whole channel — set channel state + every connector state
          channelStates.set(rowId, enable ? "enabled" : "disabled");
          const node = channelNodes.find((n) => n.id === rowId);
          if (node && node.connectors.length > 0) {
            const pcMap = new Map<number | null, ConnectorState>();
            for (const c of node.connectors) pcMap.set(c.metaDataId, targetState);
            connectorStates.set(rowId, pcMap);
          }
        }
      }

      return {
        ...prev,
        newChannelSource: newSource,
        newChannelDestination: newDest,
        channelStates,
        connectorStates,
      };
    });
  }

  // ── Density-derived spacing ──────────────────────────────────────────────

  const pad =
    viewDensity === "comfortable"
      ? "p-4 gap-3"
      : viewDensity === "compact"
        ? "p-2 gap-2"
        : "p-3 gap-2.5";
  const rowPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";

  const dotColor = (state: ChannelState) =>
    state === "enabled"
      ? "bg-green-500 border-green-600"
      : state === "disabled"
        ? "bg-red-400 border-red-500"
        : "bg-yellow-400 border-yellow-500";

  return (
    <div className={`flex flex-col ${pad}`}>
      {/* Filter input + Enable/Disable buttons (mirrors Java AlertChannelPane.setFilter() + bulk controls) */}
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter channels…"
          density={viewDensity}
          className="max-w-xs"
        />
        <button
          type="button"
          onClick={() => applyToSelection(true)}
          disabled={selected.size === 0}
          className="px-2.5 py-1 text-xs border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Enable
        </button>
        <button
          type="button"
          onClick={() => applyToSelection(false)}
          disabled={selected.size === 0}
          className="px-2.5 py-1 text-xs border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Minus className="w-3 h-3" /> Disable
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${channelNodes.length} channel${channelNodes.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Channel tree table */}
      <TableContainer className="max-h-72">
        <Table>
          <TableHead>
            <TableHeadRow>
              <SimpleHeaderCell>Channel / Connector</SimpleHeaderCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {visibleRows.length === 1 && channelNodes.length === 0 ? (
              <TableEmpty colSpan={1} message="No channels available" />
            ) : (
              visibleRows.map((row, idx) => {
                const isSelected = selected.has(row.rowId);
                const isExpanded = expanded.has(row.rowId);
                const indent = row.depth * 20;
                return (
                  <TableRow
                    key={row.rowId}
                    variant={isSelected ? "selected" : "default"}
                    onClick={(e) => handleRowClick(idx, e)}
                  >
                    <TableCell className={rowPy}>
                      <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
                        {/* Expand chevron */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (row.hasChildren) toggleExpand(row.rowId);
                          }}
                          className={`w-4 h-4 flex items-center justify-center text-gray-400 dark:text-gray-500 shrink-0 ${
                            row.hasChildren
                              ? "hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                              : "opacity-0 cursor-default"
                          }`}
                          tabIndex={-1}
                        >
                          {row.hasChildren &&
                            (isExpanded ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            ))}
                        </button>

                        {/* State dot */}
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-full border shrink-0 ${dotColor(row.state)}`}
                        />

                        {/* Row label */}
                        <span
                          className="truncate text-gray-800 dark:text-gray-200"
                          title={row.channelId ?? row.name}
                        >
                          {row.name}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

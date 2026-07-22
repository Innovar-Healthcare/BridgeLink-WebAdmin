"use client";

import { MutableRefObject } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import type { ConnectionLogItem } from "@/lib/types";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { DataTable } from "@/components/data-table";

// ─── Column definitions ──────────────────────────────────────────────────────

type ConnLogCol = "timestamp" | "channel" | "connector" | "status" | "info";

const CONN_LOG_COLS: ColDef<ConnLogCol>[] = [
  { key: "timestamp", label: "Timestamp", defaultWidth: 160, minWidth: 100, defaultVisible: true },
  { key: "channel", label: "Channel", defaultWidth: 200, minWidth: 80, defaultVisible: true },
  { key: "connector", label: "Connector", defaultWidth: 160, minWidth: 80, defaultVisible: true },
  { key: "status", label: "Status", defaultWidth: 100, minWidth: 60, defaultVisible: true },
  { key: "info", label: "Info", defaultWidth: 300, minWidth: 100, defaultVisible: true },
];

// ─── Event state styling ──────────────────────────────────────────────────────

function eventStateDot(state: string) {
  // eventState comes from the server in mixed case (e.g. "Idle", "Connected")
  const normalized = state?.toLowerCase() ?? "";
  if (normalized === "connected") return "bg-green-500";
  if (normalized === "idle") return "bg-yellow-400";
  if (normalized === "done") return "bg-yellow-400";
  if (normalized === "disconnected") return "bg-red-500";
  if (normalized === "initialized") return "bg-blue-400";
  return "bg-gray-400";
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConnectionLogTabProps {
  connLogs: ConnectionLogItem[];
  connLogPaused: boolean;
  onTogglePause: () => void;
  connLogSize: number;
  onConnLogSizeChange: (size: number) => void;
  connLogLastIdRef: MutableRefObject<number | undefined>;
  onClear: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectionLogTab({
  connLogs,
  connLogPaused,
  onTogglePause,
  connLogSize,
  onConnLogSizeChange,
  connLogLastIdRef,
  onClear,
}: ConnectionLogTabProps) {
  const colConfig = useColumnConfig(CONN_LOG_COLS, "bl-conn-log-cols-v1");
  const sortState = useSortable<ConnLogCol>("timestamp", "desc");

  const sortedRows = sortState.sorted(connLogs, (log) => {
    switch (sortState.sort.key) {
      case "timestamp":
        return log.dateAdded;
      case "channel":
        return log.channelName;
      case "connector":
        return log.connectorType;
      case "status":
        return log.eventState;
      case "info":
        return log.information;
      default:
        return undefined;
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-white dark:bg-gray-900">
        <button
          onClick={onTogglePause}
          className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          {connLogPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          {connLogPaused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => {
            onClear();
            connLogLastIdRef.current = undefined;
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">Log Size:</span>
        <input
          type="number"
          min={1}
          max={999}
          value={connLogSize}
          onChange={(e) => onConnLogSizeChange(Math.min(999, Math.max(1, Number(e.target.value))))}
          className="w-16 appearance-none border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {connLogPaused && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium ml-1">
            ⏸ Paused
          </span>
        )}
      </div>
      {/* Table */}
      <DataTable<ConnectionLogItem, ConnLogCol>
        variant="sortable"
        cols={CONN_LOG_COLS}
        rows={sortedRows}
        colConfig={colConfig}
        sortState={sortState}
        rowKey={(log) => log.logId}
        empty="No connection log entries."
        containerClassName="flex-1 min-h-0 m-2"
        cellMono={{ timestamp: true }}
        renderCell={(log, col) => {
          if (col === "timestamp") return log.dateAdded;
          if (col === "channel") return <span title={log.channelName}>{log.channelName}</span>;
          if (col === "connector")
            return <span title={log.connectorType}>{log.connectorType}</span>;
          if (col === "status")
            return (
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${eventStateDot(log.eventState)}`}
                />
                <span>{log.eventState}</span>
              </span>
            );
          return <span title={log.information}>{log.information}</span>;
        }}
      />
    </div>
  );
}

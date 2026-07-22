"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { ServerLogDetailDialog, formatLogDateLocal } from "@/components/server-log-detail-dialog";
import type { ServerLogItem } from "@/lib/types";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { DataTable } from "@/components/data-table";

// ─── Server log level helpers ────────────────────────────────────────────────

/** Small colored pill badge for log level. */
function logLevelBadgeClass(level: string): string {
  switch (level) {
    case "ERROR":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800";
    case "WARN":
    case "WARNING":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800";
    case "INFO":
      return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 border border-border";
    case "DEBUG":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-border";
    default:
      return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 border border-border";
  }
}

// ─── Column definitions ──────────────────────────────────────────────────────

type ServerLogCol = "level" | "timestamp" | "message";

const SERVER_LOG_COLS: ColDef<ServerLogCol>[] = [
  { key: "level", label: "Level", defaultWidth: 80, minWidth: 60, defaultVisible: true },
  { key: "timestamp", label: "Timestamp", defaultWidth: 180, minWidth: 100, defaultVisible: true },
  { key: "message", label: "Message", defaultWidth: 600, minWidth: 200, defaultVisible: true },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ServerLogTabProps {
  serverLogs: ServerLogItem[];
  serverLogPaused: boolean;
  onTogglePause: () => void;
  serverLogSize: number;
  onServerLogSizeChange: (size: number) => void;
  onClear: () => void;
  selectedLog: ServerLogItem | null;
  logDialogOpen: boolean;
  onSelectLog: (log: ServerLogItem) => void;
  onLogDialogOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ServerLogTab({
  serverLogs,
  serverLogPaused,
  onTogglePause,
  serverLogSize,
  onServerLogSizeChange,
  onClear,
  selectedLog,
  logDialogOpen,
  onSelectLog,
  onLogDialogOpenChange,
}: ServerLogTabProps) {
  const colConfig = useColumnConfig(SERVER_LOG_COLS, "bl-server-log-cols-v1");
  const sortState = useSortable<ServerLogCol>("timestamp", "desc");

  const sortedRows = sortState.sorted(serverLogs, (log) => {
    switch (sortState.sort.key) {
      case "level":
        return log.level;
      case "timestamp":
        return log.date;
      case "message":
        return log.message;
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
          {serverLogPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          {serverLogPaused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">Log Size:</span>
        <input
          type="number"
          min={1}
          max={99}
          value={serverLogSize}
          onChange={(e) => onServerLogSizeChange(Math.min(99, Math.max(1, Number(e.target.value))))}
          className="w-14 appearance-none border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {serverLogPaused && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium ml-1">
            ⏸ Paused
          </span>
        )}
      </div>
      {/* Log table */}
      <DataTable<ServerLogItem, ServerLogCol>
        variant="sortable"
        cols={SERVER_LOG_COLS}
        rows={sortedRows}
        colConfig={colConfig}
        sortState={sortState}
        rowKey={(log) => log.id}
        empty="No log entries."
        containerClassName="flex-1 min-h-0 m-2"
        cellMono={{ timestamp: true, message: true }}
        onRowClick={(log) => onSelectLog(log)}
        renderCell={(log, col) => {
          if (col === "level") {
            return (
              <span
                className={`inline-block text-[10px] font-semibold px-1.5 py-px rounded leading-tight ${logLevelBadgeClass(log.level)}`}
              >
                {log.level || "—"}
              </span>
            );
          }
          if (col === "timestamp") {
            return (
              <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {formatLogDateLocal(log.date)}
              </span>
            );
          }
          return (
            <span className="text-gray-700 dark:text-gray-300">
              {log.category && (
                <span className="text-gray-400 dark:text-gray-500">
                  {log.lineNumber ? `(${log.category}:${log.lineNumber}): ` : `(${log.category}): `}
                </span>
              )}
              <span>{log.message}</span>
              {log.throwableInformation && (
                <span className="ml-1.5 text-gray-400 dark:text-gray-500">[+stack trace]</span>
              )}
            </span>
          );
        }}
      />
      {/* Server Log detail dialog */}
      <ServerLogDetailDialog
        log={selectedLog}
        open={logDialogOpen}
        onOpenChange={onLogDialogOpenChange}
      />
    </div>
  );
}

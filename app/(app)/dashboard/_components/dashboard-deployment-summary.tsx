"use client";
import React from "react";
import type { DashboardStatus } from "@/lib/types";

interface DashboardDeploymentSummaryProps {
  statuses: DashboardStatus[];
  filteredStatuses: DashboardStatus[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

export function DashboardDeploymentSummary({
  statuses,
  filteredStatuses,
  selectedIds,
  onClearSelection,
}: DashboardDeploymentSummaryProps) {
  const chans = statuses.filter((s) => s.statusType === "CHANNEL" || !s.statusType);
  if (chans.length === 0) return <span />;

  const nStarted = chans.filter((s) => s.state === "STARTED").length;
  const nStopped = chans.filter((s) => s.state === "STOPPED").length;
  const nPaused = chans.filter((s) => s.state === "PAUSED").length;
  const breakdown = [
    nStarted > 0 ? `${nStarted} started` : "",
    nStopped > 0 ? `${nStopped} stopped` : "",
    nPaused > 0 ? `${nPaused} paused` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const filteredChans = filteredStatuses.filter((s) => s.statusType === "CHANNEL" || !s.statusType);

  return (
    <span className="text-xs text-gray-400 dark:text-gray-500">
      {chans.length} channel{chans.length !== 1 ? "s" : ""} deployed
      {breakdown && ` (${breakdown})`}
      {filteredChans.length !== chans.length && ` · ${filteredChans.length} shown`}
      {selectedIds.size > 1 && (
        <>
          {" · "}
          <span className="text-blue-500 dark:text-blue-400">{selectedIds.size} selected</span>{" "}
          <button
            onClick={onClearSelection}
            className="text-blue-500 dark:text-blue-400 hover:underline"
          >
            (clear)
          </button>
        </>
      )}
    </span>
  );
}

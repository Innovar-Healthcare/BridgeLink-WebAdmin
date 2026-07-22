"use client";
import React from "react";
import { Download, RefreshCw, BarChart3, ChevronDown, Check } from "lucide-react";
import { ColumnPicker } from "@/components/column-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { DashboardStatus } from "@/lib/types";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { ConnectorStateMap } from "@/lib/api/api-dashboard";
import { TREND_WINDOWS, type TrendEntry, type TrendWindow } from "../_lib/trend-utils";
import type { DashCol } from "./dashboard-row";
import { exportDashboardCsv } from "../_lib/csv-export";

interface DashboardFilterActionsProps {
  statsHidden: boolean;
  onToggleStats: () => void;
  messageTrendsEnabled: boolean;
  trendWindow: TrendWindow;
  setTrendWindow: (w: TrendWindow) => void;
  orderedCols: ColDef<DashCol>[];
  colState: Record<DashCol, { width: number; visible: boolean }>;
  onToggleCol: (key: DashCol) => void;
  onResetCols: () => void;
  onMoveCol: (from: number, to: number) => void;
  visibleCols: ColDef<DashCol>[];
  sortedStatuses: DashboardStatus[];
  loading: boolean;
  statsMode: StatsMode;
  portMap: Map<string, string>;
  connectorStates: ConnectorStateMap;
  trendSummary: Map<string, TrendEntry>;
  onRefresh: () => void;
}

export function DashboardFilterActions({
  statsHidden,
  onToggleStats,
  messageTrendsEnabled,
  trendWindow,
  setTrendWindow,
  orderedCols,
  colState,
  onToggleCol,
  onResetCols,
  onMoveCol,
  visibleCols,
  sortedStatuses,
  loading,
  statsMode,
  portMap,
  connectorStates,
  trendSummary,
  onRefresh,
}: DashboardFilterActionsProps) {
  const statsVariant = statsHidden ? "outline" : "secondary";

  return (
    <>
      {/* Stats split button */}
      <div className="flex">
        <Button
          variant={statsVariant}
          className={cn(
            "h-auto px-2.5 py-1.5 text-xs font-normal gap-1.5",
            messageTrendsEnabled && "rounded-r-none border-r-0"
          )}
          onClick={onToggleStats}
          title="Toggle Stats Panel"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Stats
        </Button>
        {messageTrendsEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={statsVariant}
                className="h-auto px-1.5 py-1.5 rounded-l-none border-l-0"
                title="Select trend window"
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Trend Window</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {TREND_WINDOWS.map((w) => (
                <DropdownMenuItem key={w.key} onClick={() => setTrendWindow(w.key)}>
                  <Check
                    className={cn(
                      "w-3.5 h-3.5 mr-2",
                      trendWindow === w.key ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {w.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ColumnPicker
        cols={orderedCols}
        colState={colState}
        onToggle={onToggleCol}
        onReset={onResetCols}
        onMove={onMoveCol}
      />
      <Button
        variant="outline"
        className="h-auto p-1.5"
        onClick={() =>
          exportDashboardCsv(visibleCols, sortedStatuses, {
            statsMode,
            portMap,
            connectorStates,
            trendSummary,
          })
        }
        disabled={loading || sortedStatuses.length === 0}
        title="Export visible data as CSV"
      >
        <Download className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="outline"
        className="h-auto px-2.5 py-1.5 text-xs font-normal gap-1.5"
        onClick={onRefresh}
        disabled={loading}
        title="Refresh (R)"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </>
  );
}

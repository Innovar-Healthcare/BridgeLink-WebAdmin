"use client";
import React from "react";
import {
  Layers,
  LayoutList,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Tag,
  Circle,
} from "lucide-react";
import { SegmentedControl } from "@/components/segmented-control";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { TagDisplayMode } from "@/lib/hooks/use-tag-display-mode";

interface DashboardViewTogglesProps {
  groupMode: boolean;
  onSetGroupMode: (v: boolean) => void;
  loading: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  statsMode: StatsMode;
  onSetStatsMode: (v: StatsMode) => void;
  tagDisplayMode: TagDisplayMode;
  onSetTagDisplayMode: (v: TagDisplayMode) => void;
}

export function DashboardViewToggles({
  groupMode,
  onSetGroupMode,
  loading,
  onExpandAll,
  onCollapseAll,
  statsMode,
  onSetStatsMode,
  tagDisplayMode,
  onSetTagDisplayMode,
}: DashboardViewTogglesProps) {
  return (
    <div className="flex items-center gap-2">
      <SegmentedControl
        options={[
          { value: "group", label: "Groups", icon: <Layers className="w-3.5 h-3.5" /> },
          { value: "flat", label: "Channels", icon: <LayoutList className="w-3.5 h-3.5" /> },
        ]}
        value={groupMode ? "group" : "flat"}
        onChange={(v) => onSetGroupMode(v === "group")}
      />
      <span className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
      <div className="flex items-center border border-border rounded-md overflow-hidden">
        <button
          onClick={onExpandAll}
          title="Expand All (E)"
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <ChevronDown className="w-3.5 h-3.5" /> Expand All
        </button>
        <button
          onClick={onCollapseAll}
          title="Collapse All (C)"
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-l border-border transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <ChevronUp className="w-3.5 h-3.5" /> Collapse All
        </button>
      </div>
      <span className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
      <SegmentedControl
        options={[
          {
            value: "current",
            label: "Current",
            icon: <Clock className="w-3.5 h-3.5" />,
            tooltip:
              "Show the statistics accumulated since the last time the statistics were reset",
          },
          {
            value: "lifetime",
            label: "Lifetime",
            icon: <History className="w-3.5 h-3.5" />,
            tooltip: "Show the statistics accumulated over the entire lifetime of the channel",
          },
        ]}
        value={statsMode}
        onChange={(v) => onSetStatsMode(v as StatsMode)}
      />
      <span className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
      <SegmentedControl
        options={[
          {
            value: "text",
            label: "Labels",
            icon: <Tag className="w-3.5 h-3.5" />,
            tooltip: "Display tags as names.",
          },
          {
            value: "icon",
            label: "Dots",
            icon: <Circle className="w-3.5 h-3.5" />,
            tooltip: "Display tags as icons.",
          },
        ]}
        value={tagDisplayMode}
        onChange={(v) => onSetTagDisplayMode(v as TagDisplayMode)}
        allowDeselect
        deselectedValue="hidden"
      />
    </div>
  );
}

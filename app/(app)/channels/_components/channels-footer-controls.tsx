"use client";

import React from "react";
import { Layers, LayoutList, ChevronDown, ChevronUp, Tag, Circle } from "lucide-react";
import { SegmentedControl } from "@/components/segmented-control";
import type { ChannelGroup } from "@/lib/types";
import type { TagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { formatCount, type ChannelsFooterCounts } from "@/lib/channel-footer-counts";

interface ChannelsFooterControlsProps {
  loading: boolean;
  groupMode: boolean;
  setGroupMode: (v: boolean) => void;
  allGroups: ChannelGroup[];
  counts: ChannelsFooterCounts;
  someSelected: boolean;
  effectiveSelectedCount: number;
  onClearSelection: () => void;
  setAllGroups: (ids: string[]) => void;
  tagDisplayMode: TagDisplayMode;
  setTagDisplayMode: (v: TagDisplayMode) => void;
}

export function ChannelsFooterControls({
  loading,
  groupMode,
  setGroupMode,
  allGroups,
  counts,
  someSelected,
  effectiveSelectedCount,
  onClearSelection,
  setAllGroups,
  tagDisplayMode,
  setTagDisplayMode,
}: ChannelsFooterControlsProps) {
  return (
    <div className="mt-2 flex items-center justify-between px-1">
      {/* Channel count summary */}
      {!loading ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
          <span>
            {groupMode
              ? `${formatCount(counts.groups)} Group${counts.groups.total !== 1 ? "s" : ""}, `
              : ""}
            {formatCount(counts.channels)} Channel{counts.channels.total !== 1 ? "s" : ""}
            {`, ${formatCount(counts.enabled)} Enabled`}
            {someSelected && ` · ${effectiveSelectedCount} selected`}
          </span>
          {someSelected && (
            <button
              onClick={onClearSelection}
              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 underline ml-1"
            >
              Clear
            </button>
          )}
        </div>
      ) : (
        <span />
      )}
      {/* View toggle controls */}
      <div className="flex items-center gap-2">
        <SegmentedControl
          options={[
            {
              value: "group",
              label: "Groups",
              icon: <Layers className="w-3.5 h-3.5" />,
            },
            {
              value: "flat",
              label: "Channels",
              icon: <LayoutList className="w-3.5 h-3.5" />,
            },
          ]}
          value={groupMode ? "group" : "flat"}
          onChange={(v) => setGroupMode(v === "group")}
        />
        {groupMode && (
          <>
            <span className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setAllGroups(allGroups.map((g) => g.id))}
                title="Expand All"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronDown className="w-3.5 h-3.5" /> Expand All
              </button>
              <button
                onClick={() => setAllGroups([])}
                title="Collapse All"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-l border-border transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronUp className="w-3.5 h-3.5" /> Collapse All
              </button>
            </div>
          </>
        )}
        <span className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
        <SegmentedControl
          options={[
            { value: "text", label: "Labels", icon: <Tag className="w-3.5 h-3.5" /> },
            { value: "icon", label: "Dots", icon: <Circle className="w-3.5 h-3.5" /> },
          ]}
          value={tagDisplayMode}
          onChange={(v) => setTagDisplayMode(v as TagDisplayMode)}
          allowDeselect
          deselectedValue="hidden"
        />
      </div>
    </div>
  );
}

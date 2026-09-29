"use client";
import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

interface GroupTagFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  groupOptions: { value: string; label: string }[];
  selectedGroupIds: Set<string>;
  onGroupChange: (ids: Set<string>) => void;
  /**
   * Group id -> name for every known group, including ones absent from `groupOptions`.
   * Group filters are keyed by id, so without this a still-existing group that dropped out
   * of the options (the dashboard lists only groups with a deployed channel) would show up
   * as a bare UUID once selected. Tags need no equivalent — they are keyed by name.
   */
  groupNames?: Map<string, string>;
  tagOptions: { value: string; label: string }[];
  selectedTagNames: Set<string>;
  onTagChange: (names: Set<string>) => void;
  /** AND/OR mode for the tag filter. Only shown when ≥2 tags are selected. */
  tagMode?: "or" | "and";
  onTagModeChange?: (mode: "or" | "and") => void;
  className?: string;
  actions?: React.ReactNode;
}

export function GroupTagFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Filter…",
  groupOptions,
  selectedGroupIds,
  onGroupChange,
  groupNames,
  tagOptions,
  selectedTagNames,
  onTagChange,
  tagMode = "or",
  onTagModeChange,
  className,
  actions,
}: GroupTagFilterBarProps) {
  const { viewDensity } = useCompactMode();
  const px = viewDensity === "comfortable" ? "px-6" : viewDensity === "compact" ? "px-2" : "px-4";
  const py = viewDensity === "comfortable" ? "py-3" : viewDensity === "compact" ? "py-1.5" : "py-2";

  return (
    <div
      className={`${px} ${py} border-b border-border bg-white dark:bg-gray-900 flex items-center gap-2 flex-wrap${className ? ` ${className}` : ""}`}
    >
      <div className="relative w-96">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          density={viewDensity}
          className="pl-8 text-sm"
        />
      </div>
      {/* Keep a dropdown mounted whenever something is selected, even with no options left:
          the options are derived from server data while the selection persists in
          sessionStorage, so deleting the last tag/group would otherwise unmount the only
          control that can clear the filter and strand the list empty. */}
      {(groupOptions.length > 0 || selectedGroupIds.size > 0) && (
        <MultiSelectDropdown
          label="Groups"
          options={groupOptions}
          selected={selectedGroupIds}
          onChange={onGroupChange}
          orphanLabels={groupNames}
        />
      )}
      {(tagOptions.length > 0 || selectedTagNames.size > 0) && (
        <MultiSelectDropdown
          label="Tags"
          options={tagOptions}
          selected={selectedTagNames}
          onChange={onTagChange}
        />
      )}
      {selectedTagNames.size >= 2 && onTagModeChange && (
        <HoverTooltip
          content={
            tagMode === "or"
              ? "OR: channels matching any selected tag"
              : "AND: channels matching all selected tags"
          }
        >
          <button
            onClick={() => onTagModeChange(tagMode === "or" ? "and" : "or")}
            className="px-2 py-1 text-xs font-semibold rounded border border-border bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 select-none"
          >
            {tagMode === "or" ? "OR" : "AND"}
          </button>
        </HoverTooltip>
      )}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

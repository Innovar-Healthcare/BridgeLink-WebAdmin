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
      {groupOptions.length > 0 && (
        <MultiSelectDropdown
          label="Groups"
          options={groupOptions}
          selected={selectedGroupIds}
          onChange={onGroupChange}
        />
      )}
      {tagOptions.length > 0 && (
        <MultiSelectDropdown
          label="Tags"
          options={tagOptions}
          selected={selectedTagNames}
          onChange={onTagChange}
        />
      )}
      {tagOptions.length > 0 && selectedTagNames.size >= 2 && onTagModeChange && (
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

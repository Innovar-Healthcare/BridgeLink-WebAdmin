"use client";
import React from "react";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
  SlidersHorizontal,
  Hash,
  Loader2,
} from "lucide-react";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { HoverTooltip } from "@/components/hover-tooltip";

const OUTCOMES = ["SUCCESS", "FAILURE"];

/** Field hover tooltips ported from Java EventBrowser. */
const TIP = {
  pageSize:
    "After changing the page size, a new search must be performed for the changes to take effect. The default page size can also be configured on the Settings panel.",
  pageNumber: "Enter a page number and press Enter to jump to that page.",
  count: "Count the number of overall messages for the current search criteria.",
} as const;

interface EventFilterBarProps {
  // Date filters
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  /** "All Day" mode: hide the time inputs; the range covers whole days. */
  allDay: boolean;
  onAllDayChange: (v: boolean) => void;

  // Name filter
  nameFilter: string;
  onNameFilterChange: (v: string) => void;

  // Level checkboxes
  levels: Record<string, boolean>;
  onLevelsChange: (levels: Record<string, boolean>) => void;

  // Advanced toggle
  showAdvanced: boolean;
  onToggleAdvanced: () => void;

  // Advanced filters
  outcomeFilter: string;
  onOutcomeFilterChange: (v: string) => void;
  userFilter: string;
  onUserFilterChange: (v: string) => void;
  ipFilter: string;
  onIpFilterChange: (v: string) => void;
  serverFilter: string;
  onServerFilterChange: (v: string) => void;
  attrFilter: string;
  onAttrFilterChange: (v: string) => void;

  // User list for user dropdown
  userList: User[];

  // Active filter indicator + clear
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  // Search action
  onSearch: () => void;
  loading: boolean;

  // Pagination
  page: number;
  pageSize: number;
  /** Rows currently displayed; drives the "Results X–Y" / "No results" label. */
  resultCount: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;

  // Page size (local override; mirrors the Messages browser)
  pageSizeInput: string;
  onPageSizeInputChange: (v: string) => void;
  onApplyPageSize: () => void;

  // Total count (lazy — user clicks Count)
  totalCount: number | null;
  totalPages: number | null;
  countLoading: boolean;
  onCount: () => void;

  // Page jump
  pageInput: string;
  onPageInputChange: (v: string) => void;
  onApplyPageJump: () => void;
}

export function EventFilterBar({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  allDay,
  onAllDayChange,
  nameFilter,
  onNameFilterChange,
  levels,
  onLevelsChange,
  showAdvanced,
  onToggleAdvanced,
  outcomeFilter,
  onOutcomeFilterChange,
  userFilter,
  onUserFilterChange,
  ipFilter,
  onIpFilterChange,
  serverFilter,
  onServerFilterChange,
  attrFilter,
  onAttrFilterChange,
  userList,
  hasActiveFilters,
  onClearFilters,
  onSearch,
  loading,
  page,
  pageSize,
  resultCount,
  hasNextPage,
  onPageChange,
  pageSizeInput,
  onPageSizeInputChange,
  onApplyPageSize,
  totalCount,
  totalPages,
  countLoading,
  onCount,
  pageInput,
  onPageInputChange,
  onApplyPageJump,
}: EventFilterBarProps) {
  const { viewDensity } = useCompactMode();
  return (
    <div className="px-6 py-3 border-b border-border bg-white dark:bg-gray-900 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            Start:
          </label>
          <Input
            type="date"
            value={startDate ? startDate.substring(0, 10) : ""}
            onChange={(e) => {
              const d = e.target.value;
              if (!d) {
                onStartDateChange("");
                return;
              }
              // Preserve the time portion in time mode; default to start of day.
              const t = !allDay && startDate.length >= 16 ? startDate.substring(11, 16) : "00:00";
              onStartDateChange(`${d}T${t}:00`);
            }}
            density={viewDensity}
            className="text-xs w-32"
          />
          {!allDay && (
            <Input
              type="time"
              value={startDate.length >= 16 ? startDate.substring(11, 16) : "00:00"}
              onChange={(e) => {
                const d = startDate ? startDate.substring(0, 10) : "";
                if (d) onStartDateChange(`${d}T${e.target.value}:00`);
              }}
              density={viewDensity}
              className="text-xs w-28"
            />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">End:</label>
          <Input
            type="date"
            value={endDate ? endDate.substring(0, 10) : ""}
            onChange={(e) => {
              const d = e.target.value;
              if (!d) {
                onEndDateChange("");
                return;
              }
              // Preserve the time portion in time mode; default to end of day.
              const t = !allDay && endDate.length >= 16 ? endDate.substring(11, 16) : "23:59";
              onEndDateChange(`${d}T${t}:00`);
            }}
            density={viewDensity}
            className="text-xs w-32"
          />
          {!allDay && (
            <Input
              type="time"
              value={endDate.length >= 16 ? endDate.substring(11, 16) : "23:59"}
              onChange={(e) => {
                const d = endDate ? endDate.substring(0, 10) : "";
                if (d) onEndDateChange(`${d}T${e.target.value}:00`);
              }}
              density={viewDensity}
              className="text-xs w-28"
            />
          )}
        </div>
        <FormCheckbox
          label="Include Time"
          checked={!allDay}
          onChange={(v) => onAllDayChange(!v)}
          size="xs"
        />
        <div className="relative flex-1 min-w-32 max-w-xs">
          <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder="Name…"
            value={nameFilter}
            onChange={(e) => onNameFilterChange(e.target.value)}
            density={viewDensity}
            className="pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-3">
          {(["INFORMATION", "WARNING", "ERROR"] as const).map((lvl) => (
            <FormCheckbox
              key={lvl}
              label={lvl.charAt(0) + lvl.slice(1).toLowerCase()}
              checked={levels[lvl]}
              onChange={(v) => onLevelsChange({ ...levels, [lvl]: v })}
              size="xs"
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 text-xs gap-1.5 ${showAdvanced ? "text-blue-600 bg-blue-50" : ""}`}
          onClick={onToggleAdvanced}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Advanced
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 text-gray-500"
            onClick={onClearFilters}
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
        <Button size="sm" className="h-7 text-xs" onClick={onSearch} disabled={loading}>
          Search
        </Button>
        <div className="flex items-center gap-1.5">
          <HoverTooltip content={TIP.count}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onCount}
              disabled={countLoading}
            >
              {countLoading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Hash className="w-3 h-3 mr-1" />
              )}
              Count
            </Button>
          </HoverTooltip>
          {totalCount !== null && (
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
              {totalCount.toLocaleString()} total
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Page Size:
            </label>
            <HoverTooltip content={TIP.pageSize}>
              <Input
                type="number"
                min={1}
                max={999}
                value={pageSizeInput}
                onChange={(e) => onPageSizeInputChange(e.target.value)}
                onBlur={onApplyPageSize}
                onKeyDown={(e) => e.key === "Enter" && onApplyPageSize()}
                density={viewDensity}
                className="h-6 w-16 text-xs"
              />
            </HoverTooltip>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {resultCount > 0
              ? `Results ${page * pageSize + 1}–${page * pageSize + resultCount}${totalCount !== null ? ` of ${totalCount.toLocaleString()}` : ""}`
              : "No results"}
          </span>
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onPageChange(0)}
              disabled={page === 0 || loading}
              title="First page"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0 || loading}
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="flex items-center gap-1">
              <span className="text-xs">Page</span>
              <HoverTooltip content={TIP.pageNumber}>
                <Input
                  type="number"
                  min={1}
                  max={totalPages ?? undefined}
                  value={pageInput}
                  onChange={(e) => onPageInputChange(e.target.value)}
                  onBlur={onApplyPageJump}
                  onKeyDown={(e) => e.key === "Enter" && onApplyPageJump()}
                  density={viewDensity}
                  className="h-6 w-12 text-xs text-center px-1"
                  disabled={loading}
                />
              </HoverTooltip>
              {totalPages !== null && (
                <span className="text-xs text-gray-500 dark:text-gray-400">of {totalPages}</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onPageChange(page + 1)}
              disabled={loading || (totalPages !== null ? page >= totalPages - 1 : !hasNextPage)}
              title="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            {totalPages !== null && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onPageChange(totalPages - 1)}
                disabled={loading || page >= totalPages - 1}
                title="Last page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {showAdvanced && (
        <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-border">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Outcome:
            </label>
            <Select
              value={outcomeFilter || "ALL"}
              onValueChange={(v) => onOutcomeFilterChange(v === "ALL" ? "" : v)}
            >
              <SelectTrigger density={viewDensity} className="w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any</SelectItem>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o.charAt(0) + o.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              User:
            </label>
            <Select
              value={userFilter || "ALL"}
              onValueChange={(v) => onUserFilterChange(v === "ALL" ? "" : v)}
            >
              <SelectTrigger density={viewDensity} className="w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any</SelectItem>
                <SelectItem value="0">System</SelectItem>
                {userList.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              IP:
            </label>
            <Input
              placeholder="IP Address…"
              value={ipFilter}
              onChange={(e) => onIpFilterChange(e.target.value)}
              density={viewDensity}
              className="text-xs w-36"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Server:
            </label>
            <Input
              placeholder="Server ID…"
              value={serverFilter}
              onChange={(e) => onServerFilterChange(e.target.value)}
              density={viewDensity}
              className="text-xs w-48"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Attributes:
            </label>
            <Input
              placeholder="Attribute search…"
              value={attrFilter}
              onChange={(e) => onAttrFilterChange(e.target.value)}
              density={viewDensity}
              className="text-xs w-40"
            />
          </div>
        </div>
      )}
    </div>
  );
}

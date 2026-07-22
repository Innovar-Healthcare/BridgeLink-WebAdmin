import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Hash,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { MESSAGE_STATUSES } from "../_lib/message-columns";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  AdvancedFilterPanel,
  type AdvancedFilterState,
  type ConnectorInfo,
  type MetaDataColumnInfo,
} from "@/components/messages/advanced-filter-panel";

/** Field hover tooltips ported from Java DefaultMessageBrowser / MessageBrowser. */
const TIP = {
  textSearch:
    "Search all message content for the given string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable.",
  textSearchRegex:
    "Search all message content for a match to the regular expression pattern. Regex matching could be a very costly operation and should be used with caution, especially with a large amount of messages. Any message content that was encrypted by this channel will not be searchable. Only supported on PostgreSQL, Oracle and MySQL databases.",
  pageSize:
    "After changing the page size, a new search must be performed for the changes to take effect. The default page size can also be configured on the Settings panel.",
  count: "Count the number of overall messages for the current search criteria.",
  status: {
    QUEUED:
      "The message either has not been attempted to be dispatched yet, or it has failed to dispatch and is waiting in the queue to be attempted again.",
    FILTERED:
      "The message has been rejected by the destination filter, and will not be dispatched by this destination. Other destinations may still dispatch this message.",
    SENT: "The message has been successfully dispatched / written out by the destination connector.",
    ERROR: "An error occurred while processing the message through the destination connector.",
    RECEIVED:
      "The inbound data for the destination connector has been committed to the database, but the destination has not yet finished processing the message.",
    PENDING:
      "The destination was able to dispatch / write the message outbound, but has not yet finished processing the message through the response transformer.",
    TRANSFORMED:
      "The message has passed the source filter/transformer, and the source encoded data has been dispatched to any destinations.",
  } as Record<string, string>,
} as const;

export interface MessageFilterBarProps {
  // Channel state
  channels: Map<string, string>;
  channelsLoading: boolean;
  selectedChannelId: string;
  onSelectChannel: (id: string) => void;
  sortedFilteredChannels: [string, string][];
  channelSearch: string;
  onChannelSearchChange: (v: string) => void;
  channelDropdownOpen: boolean;
  onChannelDropdownOpenChange: (open: boolean) => void;

  // Date filters
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  allDay: boolean;
  onAllDayChange: (v: boolean) => void;

  // Text search
  textSearch: string;
  onTextSearchChange: (v: string) => void;
  textSearchRegex: boolean;
  onTextSearchRegexChange: (v: boolean) => void;

  // Status filters
  statuses: string[];
  onToggleStatus: (s: string) => void;

  // Advanced filter
  advancedActive: boolean;
  advancedExpanded: boolean;
  onToggleAdvanced: () => void;
  advancedFilter: AdvancedFilterState;
  onAdvancedFilterChange: (state: AdvancedFilterState) => void;
  connectorInfos: ConnectorInfo[];
  metaDataColumns: MetaDataColumnInfo[];

  // Actions
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
  /** False while getMetaDataColumns is in-flight for the selected channel. Manual
   *  Search is disabled until true so isCURESPHILoggingOn is final before the
   *  PHI query audit decision is made. */
  metaColumnsReady: boolean;
  hasActiveFilters: boolean;

  // Page size
  pageSizeInput: string;
  onPageSizeInputChange: (v: string) => void;
  onApplyPageSize: () => void;

  // Count
  onCount: () => void;
  countLoading: boolean;
  totalCount: number | null;
  hasFilter: boolean;
}

export function MessageFilterBar({
  channels,
  channelsLoading,
  selectedChannelId,
  onSelectChannel,
  sortedFilteredChannels,
  channelSearch,
  onChannelSearchChange,
  channelDropdownOpen,
  onChannelDropdownOpenChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  allDay,
  onAllDayChange,
  textSearch,
  onTextSearchChange,
  textSearchRegex,
  onTextSearchRegexChange,
  statuses,
  onToggleStatus,
  advancedActive,
  advancedExpanded,
  onToggleAdvanced,
  advancedFilter,
  onAdvancedFilterChange,
  connectorInfos,
  metaDataColumns,
  onSearch,
  onReset,
  loading,
  metaColumnsReady,
  hasActiveFilters,
  pageSizeInput,
  onPageSizeInputChange,
  onApplyPageSize,
  onCount,
  countLoading,
  totalCount,
  hasFilter,
}: MessageFilterBarProps) {
  const { viewDensity } = useCompactMode();
  const outerPad =
    viewDensity === "comfortable"
      ? "px-6 py-3"
      : viewDensity === "compact"
        ? "px-3 py-1.5"
        : "px-4 py-2";
  const rowSpacing =
    viewDensity === "comfortable"
      ? "space-y-3"
      : viewDensity === "compact"
        ? "space-y-1.5"
        : "space-y-2";
  const fieldGap = viewDensity === "comfortable" ? "gap-3" : "gap-2";
  const inputH = densityHeight(viewDensity);
  return (
    <div className={`${outerPad} ${rowSpacing} border-b border-border bg-white dark:bg-gray-900`}>
      {/* Row 1: Channel, Dates, Text search, Buttons */}
      <div className={`flex items-end ${fieldGap} flex-wrap`}>
        {/* Channel selector – combobox with search */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-600 dark:text-gray-400">Channel</Label>
          <Popover.Root
            open={channelDropdownOpen}
            onOpenChange={(open) => {
              onChannelDropdownOpenChange(open);
              if (!open) onChannelSearchChange("");
            }}
          >
            <Popover.Trigger asChild>
              <button
                disabled={channelsLoading}
                className={`${inputH} w-64 text-sm flex items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 whitespace-nowrap shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-accent/50`}
              >
                <span className="line-clamp-1 flex-1 text-left truncate">
                  {selectedChannelId
                    ? (channels.get(selectedChannelId) ?? "Select channel…")
                    : "Select channel…"}
                </span>
                <ChevronDown className="size-4 opacity-50 shrink-0" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-50 w-96 rounded-md border bg-popover text-popover-foreground shadow-md outline-none p-0"
                align="start"
                sideOffset={4}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="p-2 border-b border-border">
                  <Input
                    density={viewDensity}
                    className="text-sm"
                    placeholder="Search channels…"
                    value={channelSearch}
                    onChange={(e) => onChannelSearchChange(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {sortedFilteredChannels.length === 0 ? (
                    <div className="py-2 px-3 text-sm text-muted-foreground">
                      No channels found.
                    </div>
                  ) : (
                    sortedFilteredChannels.map(([id, name]) => (
                      <button
                        key={id}
                        className={cn(
                          "flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground text-left",
                          id === selectedChannelId && "bg-accent text-accent-foreground"
                        )}
                        onClick={() => onSelectChannel(id)}
                      >
                        {name}
                      </button>
                    ))
                  )}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {/* Date range */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-600 dark:text-gray-400">Start Date</Label>
          <Input
            type="date"
            value={startDate ? startDate.substring(0, 10) : ""}
            onChange={(e) => {
              const d = e.target.value;
              if (!d) {
                onStartDateChange("");
                return;
              }
              // Preserve existing time when in time mode; default to midnight
              const t =
                !allDay && startDate && startDate.length >= 16
                  ? startDate.substring(11, 16)
                  : "00:00";
              onStartDateChange(`${d}T${t}:00`);
            }}
            density={viewDensity}
            className="text-sm w-36"
          />
          {/* Optional time input — visible when Include Time is on */}
          {!allDay && (
            <Input
              type="time"
              value={startDate && startDate.length >= 16 ? startDate.substring(11, 16) : "00:00"}
              onChange={(e) => {
                const d = startDate ? startDate.substring(0, 10) : "";
                if (d) onStartDateChange(`${d}T${e.target.value}:00`);
              }}
              density={viewDensity}
              className="text-sm w-32"
            />
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600 dark:text-gray-400">End Date</Label>
          <Input
            type="date"
            value={endDate ? endDate.substring(0, 10) : ""}
            onChange={(e) => {
              const d = e.target.value;
              if (!d) {
                onEndDateChange("");
                return;
              }
              // Preserve existing time when in time mode; default to end of day
              const t =
                !allDay && endDate && endDate.length >= 16 ? endDate.substring(11, 16) : "23:59";
              onEndDateChange(`${d}T${t}:00`);
            }}
            density={viewDensity}
            className="text-sm w-36"
          />
          {!allDay && (
            <Input
              type="time"
              value={endDate && endDate.length >= 16 ? endDate.substring(11, 16) : "23:59"}
              onChange={(e) => {
                const d = endDate ? endDate.substring(0, 10) : "";
                if (d) onEndDateChange(`${d}T${e.target.value}:00`);
              }}
              density={viewDensity}
              className="text-sm w-32"
            />
          )}
        </div>

        {/* Include Time toggle */}
        <FormCheckbox
          label="Include Time"
          checked={!allDay}
          onChange={(v) => onAllDayChange(!v)}
          size="xs"
          className="pb-1"
        />

        {/* Text search */}
        <div className="space-y-1 flex-1 min-w-40">
          <Label className="text-xs text-gray-600 dark:text-gray-400">Text Search</Label>
          <div className="flex items-center gap-1.5">
            <HoverTooltip content={TIP.textSearch}>
              <Input
                placeholder="Search message content…"
                value={textSearch}
                onChange={(e) => onTextSearchChange(e.target.value)}
                density={viewDensity}
                className="text-sm"
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
            </HoverTooltip>
            <FormCheckbox
              label="Regex"
              checked={textSearchRegex}
              onChange={onTextSearchRegexChange}
              size="xs"
              className="shrink-0"
              tooltip={TIP.textSearchRegex}
            />
          </div>
        </div>

        {/* Search + Advanced buttons */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className={`h-8 ${advancedActive ? "border-blue-400 text-blue-700 bg-blue-50 dark:border-blue-500 dark:text-blue-300 dark:bg-blue-950" : ""}`}
            onClick={onToggleAdvanced}
          >
            {advancedExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 mr-1" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 mr-1" />
            )}
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            Advanced{advancedActive ? " *" : ""}
          </Button>
          <Button
            size="sm"
            onClick={onSearch}
            disabled={loading || !selectedChannelId || !metaColumnsReady}
            className="h-8"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Search
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={!hasActiveFilters}
            className="h-8"
            title="Reset all filters"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Row 2: Status checkboxes + Page size + Count */}
      <div className={`flex items-center ${fieldGap} flex-wrap`}>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Status:</span>
          {MESSAGE_STATUSES.map((s) => (
            <FormCheckbox
              key={s}
              label={s}
              checked={statuses.includes(s)}
              onChange={() => onToggleStatus(s)}
              size="xs"
              tooltip={TIP.status[s]}
            />
          ))}
        </div>

        {/* Page size */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400">Page Size:</span>
          <HoverTooltip content={TIP.pageSize}>
            <Input
              type="number"
              min={1}
              max={500}
              value={pageSizeInput}
              onChange={(e) => onPageSizeInputChange(e.target.value)}
              onBlur={onApplyPageSize}
              onKeyDown={(e) => e.key === "Enter" && onApplyPageSize()}
              density={viewDensity}
              className="h-6 w-16 text-xs"
            />
          </HoverTooltip>
        </div>

        {/* Count button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <HoverTooltip content={TIP.count}>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={onCount}
              disabled={countLoading || !hasFilter}
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
      </div>

      {/* Row 3: Expandable advanced filter panel */}
      {advancedExpanded && (
        <>
          <div className="border-t border-border" />
          <div className="max-h-[50vh] overflow-y-auto">
            <AdvancedFilterPanel
              state={advancedFilter}
              onStateChange={onAdvancedFilterChange}
              connectors={connectorInfos}
              metaDataColumns={metaDataColumns}
            />
          </div>
        </>
      )}
    </div>
  );
}

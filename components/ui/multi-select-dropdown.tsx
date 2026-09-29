"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTooltip } from "@/components/hover-tooltip";

/** An option, plus the internal flag marking a selection that is no longer offered. */
type MergedOption = { value: string; label: string; unavailable?: boolean };

/**
 * Shown on a selected value that has dropped out of `options`. Deliberately neutral: the
 * cause may be a deleted tag, a renamed one, or (on the dashboard, where options are
 * narrowed to tags with a deployed channel) simply an undeployed channel.
 */
const UNAVAILABLE_HINT = "No longer available. Uncheck it to remove it from the filter.";

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  tooltip,
  orphanLabels,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional help text shown as a HoverTooltip when the user hovers the trigger. */
  tooltip?: string;
  /**
   * Display names for values that may drop out of `options` while still selected. Needed
   * where the value is an opaque id (channel groups) rather than the name itself (tags),
   * so an orphan row reads as "Inbound HL7" instead of a bare UUID. Values missing here
   * fall back to the raw value, which is the honest best for a genuinely deleted entry.
   */
  orphanLabels?: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // A selection can outlive the option that produced it — the caller derives `options`
  // fresh from server data while the selection persists in sessionStorage. Surfacing the
  // orphans as options keeps each one individually removable rather than stranding the
  // filter with no way to clear it.
  const allOptions = useMemo<MergedOption[]>(() => {
    const known = new Set(options.map((o) => o.value));
    const orphans = [...selected]
      .filter((v) => !known.has(v))
      .map((value) => ({ value, label: orphanLabels?.get(value) ?? value, unavailable: true }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return orphans.length > 0 ? [...options, ...orphans] : options;
  }, [options, selected, orphanLabels]);

  const displayOptions = search.trim()
    ? allOptions.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : allOptions;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const isActive = selected.size > 0;
  const activeLabel = selected.size === 0 ? `All ${label}` : `${label}: ${selected.size}`;

  // Hover the trigger to show the help text — no inline help icon. Tooltip.Trigger and
  // Popover.Trigger both compose onto the same button via asChild (standard Radix nesting).
  const trigger = (
    <Popover.Trigger asChild>
      <button
        type="button"
        className={cn(
          "h-full flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          isActive ? "rounded-l-md pl-3 pr-2" : "rounded-md px-3 hover:bg-accent/50"
        )}
      >
        {activeLabel}
        <ChevronDown className="w-3.5 h-3.5 opacity-50" />
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      {/* The clear control is a sibling button, not nested inside the popover trigger:
          nested interactive elements are invalid HTML and leave the clear unreachable by
          keyboard. The wrapper carries the border/background so the pair still reads as
          one control. */}
      <div
        className={cn(
          "h-8 inline-flex items-center rounded-md border text-sm whitespace-nowrap transition-colors",
          isActive
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            : "border-input bg-transparent text-gray-600 dark:text-gray-400"
        )}
      >
        {tooltip ? <HoverTooltip content={tooltip}>{trigger}</HoverTooltip> : trigger}
        {isActive && (
          <HoverTooltip content={`Clear the ${label.toLowerCase()} filter`}>
            <button
              type="button"
              aria-label={`Clear ${label} filter`}
              onClick={() => onChange(new Set())}
              className="h-full flex items-center rounded-r-md pl-0.5 pr-2 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="w-3 h-3" />
            </button>
          </HoverTooltip>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-56 rounded-md border bg-popover text-popover-foreground shadow-md outline-none p-0"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {allOptions.length > 6 && (
            <div className="p-2 border-b border-border">
              <input
                className="w-full h-7 px-2 text-xs rounded border border-border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                placeholder={`Search ${label.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto p-1">
            {displayOptions.length === 0 ? (
              <div className="py-2 px-3 text-sm text-muted-foreground">No results.</div>
            ) : (
              displayOptions.map((opt) => {
                const row = (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground select-none",
                      opt.unavailable && "italic text-muted-foreground"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(opt.value)}
                      onChange={() => toggle(opt.value)}
                      className="rounded"
                    />
                    {opt.label}
                  </label>
                );
                return opt.unavailable ? (
                  <HoverTooltip key={opt.value} content={UNAVAILABLE_HINT}>
                    {row}
                  </HoverTooltip>
                ) : (
                  row
                );
              })
            )}
          </div>
          {selected.size > 0 && (
            <div className="border-t border-border p-1">
              <button
                onClick={() => onChange(new Set())}
                className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1 px-2 rounded hover:bg-accent text-left"
              >
                Clear all
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

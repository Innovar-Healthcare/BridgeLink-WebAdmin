"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTooltip } from "@/components/hover-tooltip";

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  tooltip,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional help text shown as a HoverTooltip when the user hovers the trigger. */
  tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const displayOptions = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const activeLabel = selected.size === 0 ? `All ${label}` : `${label}: ${selected.size}`;

  // Hover the trigger to show the help text — no inline help icon. Tooltip.Trigger and
  // Popover.Trigger both compose onto the same button via asChild (standard Radix nesting).
  const trigger = (
    <Popover.Trigger asChild>
      <button
        className={cn(
          "h-8 text-sm flex items-center gap-1.5 rounded-md border px-3 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          selected.size > 0
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            : "border-input bg-transparent text-gray-600 dark:text-gray-400 hover:bg-accent/50"
        )}
      >
        {activeLabel}
        {selected.size > 0 && (
          <span
            role="button"
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange(new Set());
            }}
            className="hover:text-red-500"
          >
            <X className="w-3 h-3" />
          </span>
        )}
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
      {tooltip ? <HoverTooltip content={tooltip}>{trigger}</HoverTooltip> : trigger}
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-56 rounded-md border bg-popover text-popover-foreground shadow-md outline-none p-0"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {options.length > 6 && (
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
              displayOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground select-none"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="rounded"
                  />
                  {opt.label}
                </label>
              ))
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

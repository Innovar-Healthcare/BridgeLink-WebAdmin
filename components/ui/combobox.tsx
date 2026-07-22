"use client";

import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  density?: ViewDensity;
  className?: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the trigger. */
  tooltip?: string;
}

const TRIGGER_H: Record<ViewDensity, string> = {
  comfortable: "h-9",
  default: "h-8",
  compact: "h-7",
};

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  disabled = false,
  density = "default",
  className,
  tooltip,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Rank prefix matches above substring matches so typing "uni" surfaces "United States"
  // before "Réunion" (Java JComboBox typeahead is prefix-based).
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    const prefix: ComboboxOption[] = [];
    const substring: ComboboxOption[] = [];
    for (const o of options) {
      const label = o.label.toLowerCase();
      if (label.startsWith(q)) prefix.push(o);
      else if (label.includes(q)) substring.push(o);
    }
    return [...prefix, ...substring];
  })();

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSearch("");
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        onChange(filtered[activeIndex].value);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Hover the trigger to show the help text — no inline help icon. Tooltip.Trigger and
  // Popover.Trigger both compose onto the same button via asChild (standard Radix nesting).
  const trigger = (
    <Popover.Trigger asChild>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          TRIGGER_H[density],
          className
        )}
      >
        <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      {tooltip ? <HoverTooltip content={tooltip}>{trigger}</HoverTooltip> : trigger}

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Search input */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                // Highlight the first match so Enter selects it without an Arrow keypress.
                setActiveIndex(next.trim() ? 0 : -1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options list */}
          <ul ref={listRef} className="max-h-56 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No results.</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={cn(
                    "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm select-none",
                    idx === activeIndex && "bg-accent text-accent-foreground",
                    idx !== activeIndex && "hover:bg-accent/50"
                  )}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      opt.value === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

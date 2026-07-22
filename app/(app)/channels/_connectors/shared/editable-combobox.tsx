"use client";

import { useId, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableComboboxProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Fired only when an option is committed via the dropdown (click or Enter on a
   * highlighted option) — NOT while typing. When omitted, selection falls back to
   * onChange. This mirrors the Java editable combo box where cascade logic runs on the
   * combo *action* (selection) and not on every keystroke: callers wire per-keystroke
   * field updates to onChange and cascade side-effects to onSelect.
   */
  onSelect?: (next: string) => void;
  options: string[];
  className?: string;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * EditableCombobox — free-form text input with a dropdown of suggestions.
 *
 * Mirrors the Java MirthComboBox in editable mode: typing fires onChange with
 * arbitrary text (not constrained to options), and the dropdown chevron always
 * lists every option regardless of what's currently typed. The dropdown panel
 * may grow wider than the input so long endpoint / operation names render in
 * full instead of truncating.
 *
 * Selecting an option (click or Enter) fires onSelect when provided, otherwise
 * onChange — see onSelect above.
 */
export function EditableCombobox({
  value,
  onChange,
  onSelect,
  options,
  className,
  invalid,
  placeholder,
  ariaLabel,
  disabled,
  "aria-describedby": ariaDescribedBy,
}: EditableComboboxProps) {
  const safeOptions = Array.isArray(options) ? options : [];
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setActiveIdx(next ? safeOptions.indexOf(value) : -1);
  }

  function selectOption(opt: string) {
    (onSelect ?? onChange)(opt);
    handleOpenChange(false);
    inputRef.current?.focus();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && safeOptions.length > 0) {
        handleOpenChange(true);
        return;
      }
      setActiveIdx((i) => (safeOptions.length === 0 ? -1 : (i + 1) % safeOptions.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open && safeOptions.length > 0) {
        handleOpenChange(true);
        return;
      }
      setActiveIdx((i) =>
        safeOptions.length === 0 ? -1 : (i - 1 + safeOptions.length) % safeOptions.length
      );
    } else if (e.key === "Enter") {
      if (open && activeIdx >= 0 && activeIdx < safeOptions.length) {
        e.preventDefault();
        selectOption(safeOptions[activeIdx]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        handleOpenChange(false);
      }
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <Popover.Anchor asChild>
        <div className="relative w-full">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              className,
              "pr-7",
              invalid && "border-red-500 focus:border-red-500 focus:ring-red-500/30"
            )}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Toggle suggestions"
              disabled={disabled}
              onMouseDown={(e) => {
                // Avoid losing input focus when clicking the chevron.
                e.preventDefault();
              }}
              className="absolute inset-y-0 right-0 flex items-center px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none p-0
            min-w-[var(--radix-popover-trigger-width)] max-w-[90vw]"
        >
          <div id={listboxId} role="listbox" className="max-h-60 overflow-y-auto p-1">
            {safeOptions.length === 0 ? (
              <div className="py-2 px-3 text-sm text-muted-foreground">No options.</div>
            ) : (
              safeOptions.map((opt, i) => (
                <button
                  key={`${opt}-${i}`}
                  type="button"
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    "block w-full text-left rounded-sm px-2 py-1.5 text-sm cursor-pointer select-none whitespace-normal break-words",
                    i === activeIdx
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                    opt === value && "font-medium"
                  )}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

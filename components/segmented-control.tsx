"use client";
import React from "react";
import { HoverTooltip } from "@/components/hover-tooltip";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Optional help text shown as a HoverTooltip when the user hovers this segment. */
  tooltip?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** When true, clicking the active segment deselects it and emits `deselectedValue`. */
  allowDeselect?: boolean;
  /** Value emitted when the active segment is clicked while `allowDeselect` is true. */
  deselectedValue?: T;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  size = "sm",
  allowDeselect,
  deselectedValue,
}: SegmentedControlProps<T>) {
  const sizeClasses = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1.5 text-xs";

  return (
    <div className="flex items-center border border-border rounded-md overflow-hidden">
      {options.map((opt, idx) => {
        const active = opt.value === value;
        const borderLeft = idx > 0 ? "border-l border-border" : "";
        return (
          <HoverTooltip key={opt.value} content={opt.tooltip}>
            <button
              onClick={() => {
                if (active && allowDeselect && deselectedValue !== undefined) {
                  onChange(deselectedValue);
                } else {
                  onChange(opt.value);
                }
              }}
              disabled={disabled}
              className={`flex items-center gap-1.5 ${sizeClasses} ${borderLeft} transition-colors ${
                active
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              } disabled:opacity-50`}
            >
              {opt.icon}
              {opt.label}
            </button>
          </HoverTooltip>
        );
      })}
    </div>
  );
}

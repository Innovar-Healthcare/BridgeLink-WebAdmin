"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { HoverTooltip } from "@/components/hover-tooltip";

interface FormCheckboxProps {
  /** Label text or ReactNode to display beside the checkbox */
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** When true, renders the checkbox in an indeterminate (mixed) visual state. */
  indeterminate?: boolean;
  /** Checkbox + text size variant. Default "sm". */
  size?: "xs" | "sm";
  /** View density — when provided, overrides size (compact → xs, comfortable/default → sm). */
  density?: ViewDensity;
  /** Additional className applied to the outer <label> element */
  className?: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the checkbox. */
  tooltip?: string;
}

function FormCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  size = "sm",
  density,
  className,
  tooltip,
}: FormCheckboxProps) {
  const effectiveSize = density ? (density === "compact" ? "xs" : "sm") : size;
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const checkbox = (
    <label
      className={cn(
        "flex items-center cursor-pointer select-none",
        effectiveSize === "xs"
          ? "gap-1.5 text-xs text-gray-600 dark:text-gray-400"
          : "gap-2 text-sm text-gray-700 dark:text-gray-300",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={cn(
          "accent-blue-600 cursor-pointer disabled:cursor-not-allowed shrink-0",
          effectiveSize === "xs" ? "size-3" : "size-3.5"
        )}
      />
      {label}
    </label>
  );

  // Hover the checkbox/label to show the help text — no inline help icon.
  return tooltip ? <HoverTooltip content={tooltip}>{checkbox}</HoverTooltip> : checkbox;
}

export { FormCheckbox };

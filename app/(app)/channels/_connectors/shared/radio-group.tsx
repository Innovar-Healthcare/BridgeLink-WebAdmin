"use client";

import { HoverTooltip } from "@/components/hover-tooltip";

/** Generic radio-button group used across connector panels and source-tab. */
export function RadioGroup({
  name,
  value,
  onChange,
  disabled = false,
  options,
  title,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: { label: string; value: string }[];
  title?: string;
}) {
  return (
    <HoverTooltip content={title}>
      <div className={`flex items-center gap-4 ${disabled ? "opacity-40" : ""}`}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              className="accent-blue-600 disabled:cursor-not-allowed"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </HoverTooltip>
  );
}

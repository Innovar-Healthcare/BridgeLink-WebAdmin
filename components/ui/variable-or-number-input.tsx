"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface VariableOrNumberInputProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "onChange"
> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * A text input that accepts either a plain integer or a `${configurationMap.xxx}` variable
 * expression. Replaces `type="number"` in connector panels to match Java's MirthTextField
 * behavior — the browser's number input silently rejects non-numeric strings, causing
 * configurationMap variable expressions to render blank.
 *
 * Renders `inputMode="numeric"` so mobile keyboards still default to the numeric layout.
 * Validation (if needed) is the caller's responsibility at save time via `validate()`.
 */
function VariableOrNumberInput({
  value,
  onChange,
  className,
  ...props
}: VariableOrNumberInputProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(className)}
      {...props}
    />
  );
}

/**
 * Returns true when the value is either a plain non-negative integer or a
 * `${...}` variable expression. Useful for callers that want to validate
 * connector fields at save time.
 */
function isNumberOrVariable(value: string): boolean {
  return /^\d+$/.test(value) || /^\$\{[^}]+\}$/.test(value);
}

export { VariableOrNumberInput, isNumberOrVariable };

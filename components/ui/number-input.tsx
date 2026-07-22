"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * A digits-only text input. Mirrors the Java client's `MirthFieldConstraints(0, false, false, true)`
 * (digits only — no sign, no decimal, no other characters) used on the TCP numeric fields the engine
 * never variable-substitutes at runtime: maxConnections, reconnect interval, receive/send/response
 * timeouts, buffer size, and MLLP max retries. Unlike `VariableOrNumberInput`, it intentionally does
 * NOT accept `${...}` expressions — the server calls plain `NumberUtils.toInt(...)` on these fields
 * with no replacement, so a variable would silently resolve to 0 (broken thread pool / zero buffer).
 *
 * Rendered as `type="text"` + `inputMode="numeric"` (not `type="number"`) so the value can be filtered
 * deterministically and mobile keyboards still default to the numeric layout. Non-digit input is
 * stripped on change, matching how the Java field rejects the keystroke outright.
 */
function NumberInput({ value, onChange, className, ...props }: NumberInputProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      className={cn(className)}
      {...props}
    />
  );
}

/** Returns true when the value is a plain non-negative integer (digits only, non-empty). */
function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

export { NumberInput, isNonNegativeInteger };

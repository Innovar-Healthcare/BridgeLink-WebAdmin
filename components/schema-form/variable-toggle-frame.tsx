"use client";

/**
 * Variable-mode toggle frame for a runtime plugin collection field.
 *
 * Mirrors the compiled-in SMTP/HTTP/WS panels: a two-option radio switches
 * between the collection editor ("Use Table") and a single text input naming a
 * channel variable that supplies the collection at runtime ("Use Map"/"Use
 * List"/"Use Variable"). The inactive control is swap-unmounted, not disabled.
 *
 * This frame owns ONLY the radio + the variable text input; the collection editor
 * is passed as `children`. The toggle writes only the boolean and the variable
 * name — never the collection element — so table content is preserved while in
 * variable mode (the wrapper wires those two writes to the paired scalar
 * elements, e.g. `isUseHeadersVariable` / `headersVariable`).
 */

import { RadioGroup } from "@/app/(app)/channels/_connectors/shared/radio-group";
import { inputCls } from "@/app/(app)/channels/_connectors/shared/styles";
import { HoverTooltip } from "@/components/hover-tooltip";
import { cn } from "@/lib/utils";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

export interface VariableToggleFrameProps {
  /** Unique radio group name (namespace by field key to avoid collisions). */
  radioName: string;
  /** True → variable-name input shown; false → the collection editor (children). */
  useVariable: boolean;
  onUseVariableChange: (useVariable: boolean) => void;
  variableValue: string;
  onVariableValueChange: (value: string) => void;
  tableLabel?: string;
  variableLabel?: string;
  variablePlaceholder?: string;
  variableTooltip?: string;
  disabled?: boolean;
  density?: ViewDensity;
  /** The collection editor rendered in table mode. */
  children: React.ReactNode;
}

export function VariableToggleFrame({
  radioName,
  useVariable,
  onUseVariableChange,
  variableValue,
  onVariableValueChange,
  tableLabel = "Use Table",
  variableLabel = "Use Variable",
  variablePlaceholder,
  variableTooltip,
  disabled = false,
  density,
  children,
}: VariableToggleFrameProps) {
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        name={radioName}
        value={useVariable ? "variable" : "table"}
        onChange={(v) => onUseVariableChange(v === "variable")}
        disabled={disabled}
        options={[
          { label: tableLabel, value: "table" },
          { label: variableLabel, value: "variable" },
        ]}
      />
      {useVariable ? (
        <HoverTooltip content={variableTooltip}>
          <input
            type="text"
            value={variableValue}
            onChange={(e) => onVariableValueChange(e.target.value)}
            placeholder={variablePlaceholder}
            disabled={disabled}
            aria-label={variablePlaceholder ?? variableLabel}
            className={cn(inputCls(density), "w-72")}
          />
        </HoverTooltip>
      ) : (
        children
      )}
    </div>
  );
}

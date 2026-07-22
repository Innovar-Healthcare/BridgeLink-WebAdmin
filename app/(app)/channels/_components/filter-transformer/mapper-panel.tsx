"use client";

import type { MapperStep, MapperScope, Rule, Step } from "../../_lib/filter-transformer-xml";
import { replaceIteratorVariables } from "../../_lib/iterator-utils";
import { ReplacementsTable } from "./replacements-table";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { tryParseJs } from "@/lib/js-validation";

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

const labelCls = "text-sm text-gray-600 dark:text-gray-400 w-28 shrink-0 text-right";

// Order and labels mirror Java's Scope enum (MapperStep.java) — Scope.values()
// drives the combo box, so Connector comes first and labels use the "...Map" form.
const SCOPES: { value: MapperScope; label: string }[] = [
  { value: "CONNECTOR", label: "Connector Map" },
  { value: "CHANNEL", label: "Channel Map" },
  { value: "GLOBAL_CHANNEL", label: "Global Channel Map" },
  { value: "GLOBAL", label: "Global Map" },
  { value: "RESPONSE", label: "Response Map" },
];

/** Returns onDragOver + onDrop props for a text <input>.
 * `applyIterator` is called when the drag source is a message-tree node; it applies ancestor iterator index substitutions. */
function dropProps(
  currentValue: string,
  setValue: (v: string) => void,
  applyIterator?: (text: string) => string
): Pick<React.InputHTMLAttributes<HTMLInputElement>, "onDragOver" | "onDrop"> {
  return {
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      let text = e.dataTransfer.getData("text/plain");
      if (!text) return;
      if (applyIterator && e.dataTransfer.types.includes("application/x-bridgelink-tree-node")) {
        text = applyIterator(text);
      }
      const input = e.currentTarget as HTMLInputElement;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setValue(currentValue.slice(0, start) + text + currentValue.slice(end));
    },
  };
}

interface Props {
  step: MapperStep;
  onChange: (step: MapperStep) => void;
  showErrors?: boolean;
  elements?: (Rule | Step)[];
  selectedPath?: number[] | null;
}

export function MapperPanel({ step, onChange, showErrors, elements, selectedPath }: Props) {
  const { viewDensity } = useCompactMode();
  const applyIterator =
    elements && selectedPath && selectedPath.length > 1
      ? (text: string) => replaceIteratorVariables(text, elements, selectedPath.slice(0, -1))
      : undefined;
  const h = densityHeight(viewDensity);
  const mappingInvalid = showErrors && !!step.mapping?.trim() && !!tryParseJs(step.mapping);
  const variableInvalid =
    showErrors && !!step.variable?.trim() && !!tryParseJs(`x.put('${step.variable}', 0);`);
  const defaultValueInvalid =
    showErrors && !!step.defaultValue?.trim() && !!tryParseJs(step.defaultValue);
  const invalidReplacements = step.replacements.map((r) =>
    showErrors
      ? {
          regex: !!r.regex?.trim() && !!tryParseJs(r.regex),
          replaceWith: !!r.replaceWith?.trim() && !!tryParseJs(r.replaceWith),
        }
      : { regex: false, replaceWith: false }
  );
  const inputCls =
    `${h} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 flex-1";
  const selectCls =
    `${h} px-2 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  function set<K extends keyof MapperStep>(key: K, val: MapperStep[K]) {
    onChange({ ...step, [key]: val });
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={labelCls}>Variable:</span>
        <input
          value={step.variable}
          onChange={(e) => set("variable", e.target.value)}
          className={`${inputCls} ${showErrors && !step.variable?.trim() ? inputErrorCls : variableInvalid ? inputErrorCls : ""}`}
          placeholder="variableName"
          {...dropProps(step.variable, (v) => set("variable", v))}
        />
        <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">Add to:</span>
        <select
          value={step.scope}
          onChange={(e) => set("scope", e.target.value as MapperScope)}
          className={selectCls}
        >
          {SCOPES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <span className={labelCls}>Mapping:</span>
        <input
          value={step.mapping}
          onChange={(e) => set("mapping", e.target.value)}
          className={`${inputCls} ${showErrors && !step.mapping?.trim() ? inputErrorCls : mappingInvalid ? inputErrorCls : ""}`}
          placeholder="e.g. msg['MSH']['MSH.9']['MSH.9.1']"
          {...dropProps(step.mapping, (v) => set("mapping", v), applyIterator)}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className={labelCls}>Default Value:</span>
        <input
          value={step.defaultValue}
          onChange={(e) => set("defaultValue", e.target.value)}
          className={`${inputCls} ${defaultValueInvalid ? inputErrorCls : ""}`}
          placeholder="(optional)"
          {...dropProps(step.defaultValue, (v) => set("defaultValue", v))}
        />
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"} />
        <div className="flex-1">
          <ReplacementsTable
            replacements={step.replacements}
            onChange={(r) => set("replacements", r)}
            invalidReplacements={invalidReplacements}
          />
        </div>
      </div>
    </div>
  );
}

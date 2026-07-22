"use client";

import type {
  DestinationSetFilterStep,
  RuleCondition,
  DestBehavior,
} from "../../_lib/filter-transformer-xml";
import { generateDestSetFilterName } from "../../_lib/filter-transformer-xml";
import { StringListTable } from "./replacements-table";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

const labelCls = "text-sm text-gray-600 dark:text-gray-400 w-28 shrink-0 text-right";

const CONDITIONS: { value: RuleCondition; label: string }[] = [
  { value: "EXISTS", label: "Exists" },
  { value: "NOT_EXIST", label: "Does Not Exist" },
  { value: "EQUALS", label: "Equals" },
  { value: "NOT_EQUAL", label: "Does Not Equal" },
  { value: "CONTAINS", label: "Contains" },
  { value: "NOT_CONTAIN", label: "Does Not Contain" },
];

const VALUES_ENABLED: Set<RuleCondition> = new Set([
  "EQUALS",
  "NOT_EQUAL",
  "CONTAINS",
  "NOT_CONTAIN",
]);

interface DestInfo {
  metaDataId: number;
  name: string;
}

interface Props {
  step: DestinationSetFilterStep;
  onChange: (step: DestinationSetFilterStep) => void;
  /** Names of all destination connectors for the destinations table */
  destinations: DestInfo[];
  showErrors?: boolean;
}

export function DestinationSetFilterPanel({ step, onChange, destinations, showErrors }: Props) {
  const { viewDensity } = useCompactMode();
  const h = densityHeight(viewDensity);
  const inputCls =
    `${h} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 flex-1";
  const selectCls =
    `${h} px-2 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  function set<K extends keyof DestinationSetFilterStep>(key: K, val: DestinationSetFilterStep[K]) {
    const next = { ...step, [key]: val };
    next.name = generateDestSetFilterName(next.field, next.condition, next.values);
    onChange(next);
  }

  function toggleDestination(metaDataId: number, checked: boolean) {
    const next = checked
      ? [...step.metaDataIds, metaDataId]
      : step.metaDataIds.filter((id) => id !== metaDataId);
    set("metaDataIds", next);
  }

  const valuesEnabled = VALUES_ENABLED.has(step.condition);

  return (
    <div className="p-4 space-y-4">
      {/* Behavior */}
      <div className="flex items-center gap-3">
        <span className={labelCls}>Behavior:</span>
        <select
          value={step.behavior}
          onChange={(e) => set("behavior", e.target.value as DestBehavior)}
          className={selectCls}
        >
          <option value="REMOVE">Remove the following</option>
          <option value="REMOVE_ALL_EXCEPT">Remove All Except the Following</option>
          <option value="REMOVE_ALL">Remove All</option>
        </select>
      </div>

      {/* Destinations */}
      {(step.behavior === "REMOVE" || step.behavior === "REMOVE_ALL_EXCEPT") && (
        <div className="flex items-start gap-3">
          <span className={labelCls + " pt-1"}>Destinations:</span>
          <div className="flex-1 border rounded p-2 space-y-1 max-h-32 overflow-y-auto">
            {destinations.length === 0 ? (
              <span className="text-xs text-gray-400 italic">No destinations defined</span>
            ) : (
              destinations.map((d) => (
                <FormCheckbox
                  key={d.metaDataId}
                  label={d.name}
                  checked={step.metaDataIds.includes(d.metaDataId)}
                  onChange={(v) => toggleDestination(d.metaDataId, v)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Field */}
      <div className="flex items-center gap-3">
        <span className={labelCls}>Field:</span>
        <input
          value={step.field}
          onChange={(e) => set("field", e.target.value)}
          className={`${inputCls} ${showErrors && !step.field?.trim() ? inputErrorCls : ""}`}
          placeholder="e.g. msg['MSH']['MSH.9']['MSH.9.1']"
        />
      </div>

      {/* Condition */}
      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Condition:</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {CONDITIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name={`dsf-condition-${step.sequenceNumber}`}
                value={value}
                checked={step.condition === value}
                onChange={() => set("condition", value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Values */}
      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Values:</span>
        <div
          className={`flex-1${showErrors && valuesEnabled && (!step.values?.length || !step.values[0]?.trim()) ? " rounded outline outline-2 outline-red-500" : ""}`}
        >
          <StringListTable
            label=""
            values={step.values}
            onChange={(v) => set("values", v)}
            disabled={!valuesEnabled}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import {} from "react";
import type { RuleBuilderRule, RuleCondition, Rule, Step } from "../../_lib/filter-transformer-xml";
import { generateRuleBuilderName } from "../../_lib/filter-transformer-xml";
import { replaceIteratorVariables } from "../../_lib/iterator-utils";
import { StringListTable } from "./replacements-table";
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

interface Props {
  rule: RuleBuilderRule;
  onChange: (rule: RuleBuilderRule) => void;
  showErrors?: boolean;
  elements?: (Rule | Step)[];
  selectedPath?: number[] | null;
}

export function RuleBuilderPanel({ rule, onChange, showErrors, elements, selectedPath }: Props) {
  const { viewDensity } = useCompactMode();
  const applyIterator =
    elements && selectedPath && selectedPath.length > 1
      ? (text: string) => replaceIteratorVariables(text, elements, selectedPath.slice(0, -1))
      : undefined;
  const inputCls =
    `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 w-full";

  function set<K extends keyof RuleBuilderRule>(key: K, val: RuleBuilderRule[K]) {
    const next = { ...rule, [key]: val };
    // Auto-generate name
    next.name = generateRuleBuilderName(next.field, next.condition, next.values);
    onChange(next);
  }

  const valuesEnabled = VALUES_ENABLED.has(rule.condition);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className={labelCls}>Field:</span>
        <input
          value={rule.field}
          onChange={(e) => set("field", e.target.value)}
          className={`${inputCls} ${showErrors && !rule.field?.trim() ? inputErrorCls : ""}`}
          placeholder="e.g. msg['MSH']['MSH.9']['MSH.9.1']"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            let text = e.dataTransfer.getData("text/plain");
            if (!text) return;
            if (
              applyIterator &&
              e.dataTransfer.types.includes("application/x-bridgelink-tree-node")
            ) {
              text = applyIterator(text);
            }
            const input = e.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            set("field", rule.field.slice(0, start) + text + rule.field.slice(end));
          }}
        />
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Condition:</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {CONDITIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name={`condition-${rule.sequenceNumber}`}
                value={value}
                checked={rule.condition === value}
                onChange={() => set("condition", value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Values:</span>
        <div
          className={`flex-1${showErrors && valuesEnabled && (!rule.values?.length || !rule.values[0]?.trim()) ? " rounded outline outline-2 outline-red-500" : ""}`}
        >
          <StringListTable
            label=""
            values={rule.values}
            onChange={(v) => set("values", v)}
            disabled={!valuesEnabled}
          />
        </div>
      </div>
    </div>
  );
}

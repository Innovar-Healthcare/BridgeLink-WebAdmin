"use client";

import type { IteratorStep } from "../../_lib/filter-transformer-xml";
import { generateIteratorStepName } from "../../_lib/filter-transformer-xml";
import { StringListTable } from "./replacements-table";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

const labelCls = "text-sm text-gray-600 dark:text-gray-400 w-36 shrink-0 text-right";

interface Props {
  step: IteratorStep;
  onChange: (step: IteratorStep) => void;
  showErrors?: boolean;
}

export function IteratorStepPanel({ step, onChange, showErrors }: Props) {
  const { viewDensity } = useCompactMode();
  const inputCls =
    `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 flex-1";

  function set<K extends keyof IteratorStep>(key: K, val: IteratorStep[K]) {
    const next = { ...step, [key]: val };
    next.name = generateIteratorStepName(next.target);
    onChange(next);
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={labelCls}>Iterate On:</span>
        <input
          value={step.target}
          onChange={(e) => set("target", e.target.value)}
          className={`${inputCls} ${showErrors && !step.target?.trim() ? inputErrorCls : ""}`}
          placeholder="e.g. msg.segment('OBX')"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const text = e.dataTransfer.getData("text/plain");
            if (!text) return;
            const input = e.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            set("target", step.target.slice(0, start) + text + step.target.slice(end));
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className={labelCls}>Index Variable:</span>
        <input
          value={step.indexVariable}
          onChange={(e) => set("indexVariable", e.target.value)}
          className={`${inputCls} ${showErrors && !step.indexVariable?.trim() ? inputErrorCls : ""}`}
          placeholder="i"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const text = e.dataTransfer.getData("text/plain");
            if (!text) return;
            const input = e.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            set(
              "indexVariable",
              step.indexVariable.slice(0, start) + text + step.indexVariable.slice(end)
            );
          }}
        />
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Prefix Substitutions:</span>
        <div className="flex-1">
          <StringListTable
            label=""
            values={step.prefixSubstitutions}
            onChange={(v) => set("prefixSubstitutions", v)}
          />
        </div>
      </div>
    </div>
  );
}

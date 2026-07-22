"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Replacement } from "../../_lib/filter-transformer-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

// ─── Shared "string list" table (for Values in RuleBuilder / DestSetFilter) ───

interface StringListTableProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

export function StringListTable({ label, values, onChange, disabled }: StringListTableProps) {
  const { viewDensity } = useCompactMode();
  const inputCls =
    `${densityHeight(viewDensity)} px-2 text-xs rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 w-full";

  function addRow() {
    onChange([...values, ""]);
  }
  function removeRow(i: number) {
    onChange(values.filter((_, j) => j !== i));
  }
  function updateRow(i: number, v: string) {
    onChange(values.map((old, j) => (j === i ? v : old)));
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-border text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {values.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-1">No values</div>
      ) : (
        <div className="space-y-1">
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={v}
                onChange={(e) => updateRow(i, e.target.value)}
                disabled={disabled}
                className={inputCls}
                placeholder="value"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={disabled}
                className="text-red-400 hover:text-red-600 shrink-0 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Replacements table (regex → replace with) ────────────────────────────────

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

interface ReplacementsTableProps {
  replacements: Replacement[];
  onChange: (replacements: Replacement[]) => void;
  invalidReplacements?: { regex: boolean; replaceWith: boolean }[];
}

export function ReplacementsTable({
  replacements,
  onChange,
  invalidReplacements,
}: ReplacementsTableProps) {
  const { viewDensity } = useCompactMode();
  const inputCls =
    `${densityHeight(viewDensity)} px-2 text-xs rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 w-full";

  function addRow() {
    onChange([...replacements, { regex: "", replaceWith: "" }]);
  }
  function removeRow(i: number) {
    onChange(replacements.filter((_, j) => j !== i));
  }
  function update(i: number, field: keyof Replacement, v: string) {
    onChange(replacements.map((r, j) => (j === i ? { ...r, [field]: v } : r)));
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Replacements</span>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-border text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {replacements.length > 0 && (
        <div
          className="grid text-xs font-medium text-gray-500 dark:text-gray-400 px-1"
          style={{ gridTemplateColumns: "1fr 1fr auto" }}
        >
          <span>Regular Expression</span>
          <span>Replace With</span>
          <span />
        </div>
      )}

      {replacements.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-1">No replacements</div>
      ) : (
        <div className="space-y-1">
          {replacements.map((r, i) => {
            const inv = invalidReplacements?.[i];
            return (
              <div
                key={i}
                className="grid gap-1 items-center"
                style={{ gridTemplateColumns: "1fr 1fr auto" }}
              >
                <input
                  value={r.regex}
                  onChange={(e) => update(i, "regex", e.target.value)}
                  className={`${inputCls} ${inv?.regex ? inputErrorCls : ""}`}
                  placeholder="regex"
                />
                <input
                  value={r.replaceWith}
                  onChange={(e) => update(i, "replaceWith", e.target.value)}
                  className={`${inputCls} ${inv?.replaceWith ? inputErrorCls : ""}`}
                  placeholder="replacement"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-red-400 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

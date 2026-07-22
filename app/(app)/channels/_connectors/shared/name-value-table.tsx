"use client";

import { Plus, Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { NameValueEntry } from "../../_lib/channel-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

/** Shared name/value table used by HTTP Sender (headers, query params), SMTP, WS, JMS. */
export function NameValueTable({
  entries,
  onChange,
  nameLabel = "Name",
  valueLabel = "Value",
  addLabel = "Add Row",
  namePlaceholder = "name",
  valuePlaceholder = "value",
}: {
  entries: NameValueEntry[];
  onChange: (entries: NameValueEntry[]) => void;
  nameLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}) {
  function add() {
    onChange([...entries, { name: "", value: "" }]);
  }

  function remove(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }

  function update(i: number, field: keyof NameValueEntry, value: string) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  }

  const { viewDensity } = useCompactMode();
  const rowCls = `${densityHeight(viewDensity)} px-2 text-xs rounded border border-border
    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
    focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;

  return (
    <div className="flex flex-col gap-1">
      {entries.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-1.5 px-0.5 mb-0.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {nameLabel}
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {valueLabel}
          </span>
          <span />
        </div>
      )}

      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.5rem] gap-1.5 items-center">
          <input
            type="text"
            value={e.name}
            onChange={(ev) => update(i, "name", ev.target.value)}
            placeholder={namePlaceholder}
            className={rowCls}
          />
          <input
            type="text"
            value={e.value}
            onChange={(ev) => update(i, "value", ev.target.value)}
            placeholder={valuePlaceholder}
            className={rowCls}
          />
          <HoverTooltip content="Remove row">
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex items-center justify-center w-6 h-6 rounded text-gray-400
              hover:text-red-500 dark:hover:text-red-400
              hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </HoverTooltip>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded
          border border-dashed border-border
          text-gray-500 dark:text-gray-400
          hover:border-blue-400 dark:hover:border-blue-500
          hover:text-blue-600 dark:hover:text-blue-400
          hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors mt-0.5"
      >
        <Plus className="w-3 h-3" />
        {addLabel}
      </button>
    </div>
  );
}

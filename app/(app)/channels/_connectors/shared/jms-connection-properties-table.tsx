"use client";

import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  nextJmsPropertyName,
  resolveJmsPropertyKey,
  type NameValueEntry,
} from "../../_lib/channel-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

/**
 * Name/value editor for JMS connection properties, shared by the JMS Listener and JMS
 * Sender. Mirrors Java `MirthPropertiesTable` (map-backed): new rows get an auto-named
 * unique key ("Property N"), and a key edited to a blank or duplicate (case-insensitive)
 * value reverts on commit. Keeping the map invariant in the editor means the serialized
 * `<connectionProperties>` map never carries blank or duplicate keys for the server to
 * silently merge.
 */
export function JmsConnectionPropertiesTable({
  entries,
  onChange,
}: {
  entries: NameValueEntry[];
  onChange: (entries: NameValueEntry[]) => void;
}) {
  const { viewDensity } = useCompactMode();
  // The key value captured on focus, so a blank/duplicate edit can revert on blur.
  const originalKey = useRef("");

  function add() {
    onChange([...entries, { name: nextJmsPropertyName(entries.map((e) => e.name)), value: "" }]);
  }

  function remove(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }

  function update(i: number, field: keyof NameValueEntry, value: string) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  }

  function commitName(i: number) {
    const others = entries.filter((_, idx) => idx !== i).map((e) => e.name);
    const resolved = resolveJmsPropertyKey(entries[i].name, originalKey.current, others);
    if (resolved !== entries[i].name) update(i, "name", resolved);
  }

  const rowCls = `${densityHeight(viewDensity)} px-2 text-xs rounded border border-border
    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
    focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;

  return (
    <div className="flex flex-col gap-1">
      {entries.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-1.5 px-0.5 mb-0.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Property
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Value
          </span>
          <span />
        </div>
      )}

      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.5rem] gap-1.5 items-center">
          <input
            type="text"
            value={e.name}
            onFocus={() => {
              originalKey.current = e.name;
            }}
            onChange={(ev) => update(i, "name", ev.target.value)}
            onBlur={() => commitName(i)}
            placeholder="name"
            className={rowCls}
          />
          <input
            type="text"
            value={e.value}
            onChange={(ev) => update(i, "value", ev.target.value)}
            placeholder="value"
            className={rowCls}
          />
          <HoverTooltip content="Remove property">
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
        Add Property
      </button>
    </div>
  );
}

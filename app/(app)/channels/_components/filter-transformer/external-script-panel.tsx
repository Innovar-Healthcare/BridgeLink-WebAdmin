"use client";

import type { ExternalScriptRule, ExternalScriptStep } from "../../_lib/filter-transformer-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

interface Props {
  element: ExternalScriptRule | ExternalScriptStep;
  onChange: (element: ExternalScriptRule | ExternalScriptStep) => void;
  showErrors?: boolean;
}

export function ExternalScriptPanel({ element, onChange, showErrors }: Props) {
  const { viewDensity } = useCompactMode();
  const inputCls =
    `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 flex-1";

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Enter the path of an external JavaScript file accessible from the BridgeLink server.
      </p>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-400 w-24 shrink-0 text-right">
          Script Path:
        </span>
        <input
          value={element.scriptPath}
          onChange={(e) => onChange({ ...element, scriptPath: e.target.value })}
          className={`${inputCls} ${showErrors && !element.scriptPath?.trim() ? inputErrorCls : ""}`}
          placeholder="/path/to/script.js"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const text = e.dataTransfer.getData("text/plain");
            if (!text) return;
            const input = e.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            const cur = element.scriptPath;
            onChange({ ...element, scriptPath: cur.slice(0, start) + text + cur.slice(end) });
          }}
        />
      </div>
    </div>
  );
}

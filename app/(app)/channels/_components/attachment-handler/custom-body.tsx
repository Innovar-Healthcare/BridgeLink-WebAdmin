"use client";

import { type MutableRefObject, useEffect } from "react";
import { Plus, Trash2, HelpCircle } from "lucide-react";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import type { AttachmentHandlerState, AttachmentCommitResult } from "../../_lib/channel-xml";
import { customHandlerSaveWarning } from "../../_lib/attachment-validation";

// ─── CustomBody ───────────────────────────────────────────────────────────────

interface CustomBodyProps {
  local: AttachmentHandlerState;
  setLocal: (s: AttachmentHandlerState) => void;
  commitRef: MutableRefObject<() => AttachmentCommitResult>;
}

export function CustomBody({ local, setLocal, commitRef }: CustomBodyProps) {
  const { viewDensity } = useCompactMode();
  const h = densityHeight(viewDensity);
  const inputCls = `${h} px-3 text-sm rounded border border-border
    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
    placeholder:text-gray-400 dark:placeholder:text-gray-500
    focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;

  // Keep commitRef up-to-date so the shell can call it at save time. Validation is a
  // soft warning ("Save anyway?"), not a hard block — Java saves incomplete custom
  // handlers freely #45).
  useEffect(() => {
    commitRef.current = () => {
      const value = { ...local, customClassName: local.customClassName.trim() };
      const warning = customHandlerSaveWarning(value);
      return warning ? { warning, value } : value;
    };
  });

  function addProperty() {
    setLocal({ ...local, customProperties: [...local.customProperties, { name: "", value: "" }] });
  }
  function removeProperty(idx: number) {
    setLocal({ ...local, customProperties: local.customProperties.filter((_, i) => i !== idx) });
  }
  function updateProperty(idx: number, field: "name" | "value", val: string) {
    setLocal({
      ...local,
      customProperties: local.customProperties.map((p, i) =>
        i === idx ? { ...p, [field]: val } : p
      ),
    });
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* ── Class Name ───────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Fully Qualified Java Class Name
          </h3>
          <span
            title="com.mirth.connect.server.util.MirthAttachmentHandler"
            className="text-gray-400 dark:text-gray-500 cursor-help"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        </div>
        <input
          type="text"
          value={local.customClassName}
          onChange={(e) => setLocal({ ...local, customClassName: e.target.value })}
          placeholder="com.example.MyAttachmentHandler"
          className={`${inputCls} w-full font-mono`}
          autoFocus
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The specified class must extend MirthAttachmentHandler.
        </p>
      </section>

      {/* ── Properties ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Properties</h3>

        {local.customProperties.length > 0 && (
          <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 px-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Name
            </span>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Value
            </span>
            <span />
          </div>
        )}

        {local.customProperties.map((prop, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 items-center">
            <input
              type="text"
              value={prop.name}
              onChange={(e) => updateProperty(idx, "name", e.target.value)}
              placeholder="propertyName"
              className={`${inputCls} font-mono`}
            />
            <input
              type="text"
              value={prop.value}
              onChange={(e) => updateProperty(idx, "value", e.target.value)}
              placeholder="value"
              className={`${inputCls} font-mono`}
            />
            <button
              onClick={() => removeProperty(idx)}
              title="Remove property"
              className="flex items-center justify-center w-6 h-6 rounded text-gray-400
                hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
                transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        <button
          onClick={addProperty}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed
            border-border text-gray-500 dark:text-gray-400
            hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
            hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Property
        </button>
      </section>
    </div>
  );
}

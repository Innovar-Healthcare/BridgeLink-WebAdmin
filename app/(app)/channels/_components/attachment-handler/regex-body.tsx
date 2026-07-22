"use client";

import { type MutableRefObject, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import type {
  AttachmentHandlerState,
  AttachmentCommitResult,
  ReplacementEntry,
} from "../../_lib/channel-xml";

// ─── OBX 5.5 example — from RegexAttachmentDialog.java ───────────────────────
const OBX_5_5_EXAMPLE = "(?:OBX\\|(?:[^|]*\\|){4}(?:[^|^]*\\^){4})([^|^\\r\\n]*)(?:[|^\\r\\n]|$)";

// ─── Local reusable sub-table ─────────────────────────────────────────────────

interface EditableKvTableProps {
  rows: Array<{ key: string; value: string }>;
  colLabels: [string, string];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: "key" | "value", val: string) => void;
  inputCls: string;
}

function EditableKvTable({
  rows,
  colLabels,
  onAdd,
  onRemove,
  onUpdate,
  inputCls,
}: EditableKvTableProps) {
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 px-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {colLabels[0]}
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {colLabels[1]}
          </span>
          <span />
        </div>
      )}
      {rows.map((row, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 items-center">
          <input
            type="text"
            value={row.key}
            onChange={(e) => onUpdate(idx, "key", e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => onUpdate(idx, "value", e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <button
            onClick={() => onRemove(idx)}
            title="Remove"
            className="flex items-center justify-center w-6 h-6 rounded text-gray-400
              hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
              transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed
          border-border text-gray-500 dark:text-gray-400
          hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
          hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Row
      </button>
    </div>
  );
}

// ─── RegexBody ────────────────────────────────────────────────────────────────

interface RegexBodyProps {
  local: AttachmentHandlerState;
  setLocal: (s: AttachmentHandlerState) => void;
  commitRef: MutableRefObject<() => AttachmentCommitResult>;
}

export function RegexBody({ local, setLocal, commitRef }: RegexBodyProps) {
  const { viewDensity } = useCompactMode();
  const h = densityHeight(viewDensity);
  const inputCls = `${h} px-2 text-sm rounded border border-border
    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
    focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;

  // Keep commitRef up-to-date with latest local state so the shell can call it at save time
  useEffect(() => {
    commitRef.current = () => local;
  });

  // ── Pattern helpers ──────────────────────────────────────────────────────
  function addPattern() {
    setLocal({ ...local, regexPatterns: [...local.regexPatterns, { pattern: "", mimeType: "" }] });
  }
  function removePattern(idx: number) {
    setLocal({ ...local, regexPatterns: local.regexPatterns.filter((_, i) => i !== idx) });
  }
  function updatePattern(idx: number, field: "pattern" | "mimeType", val: string) {
    setLocal({
      ...local,
      regexPatterns: local.regexPatterns.map((r, i) => (i === idx ? { ...r, [field]: val } : r)),
    });
  }

  // ── Inbound replacement helpers ──────────────────────────────────────────
  function addInbound() {
    setLocal({
      ...local,
      inboundReplacements: [...local.inboundReplacements, { key: "", value: "" }],
    });
  }
  function removeInbound(idx: number) {
    setLocal({
      ...local,
      inboundReplacements: local.inboundReplacements.filter((_, i) => i !== idx),
    });
  }
  function updateInbound(idx: number, field: "key" | "value", val: string) {
    setLocal({
      ...local,
      inboundReplacements: local.inboundReplacements.map((r, i) =>
        i === idx ? { ...r, [field]: val } : r
      ),
    });
  }

  // ── Outbound replacement helpers ─────────────────────────────────────────
  function addOutbound() {
    setLocal({
      ...local,
      outboundReplacements: [...local.outboundReplacements, { key: "", value: "" }],
    });
  }
  function removeOutbound(idx: number) {
    setLocal({
      ...local,
      outboundReplacements: local.outboundReplacements.filter((_, i) => i !== idx),
    });
  }
  function updateOutbound(idx: number, field: "key" | "value", val: string) {
    setLocal({
      ...local,
      outboundReplacements: local.outboundReplacements.map((r, i) =>
        i === idx ? { ...r, [field]: val } : r
      ),
    });
  }

  // ── Coerce replacement to ReplacementEntry shape (type-safe helper) ──────
  function asReplacement(r: ReplacementEntry): { key: string; value: string } {
    return r;
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* ── Regular Expressions ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Regular Expressions
        </h3>

        {/* OBX 5.5 example */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400 shrink-0">Example for OBX 5.5:</span>
          <input
            readOnly
            value={OBX_5_5_EXAMPLE}
            onClick={(e) => e.currentTarget.select()}
            title="Click to select — then copy"
            className={`${h} flex-1 min-w-0 px-2 text-sm font-mono rounded border border-border
              bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300
              cursor-text select-all focus:outline-none overflow-x-auto`}
          />
        </div>

        {/* Pattern + MIME type rows */}
        <div className="space-y-2">
          {local.regexPatterns.length > 0 && (
            <div className="grid grid-cols-[1fr_14rem_1.5rem] gap-2 px-1">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Pattern (Regex)
              </span>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                MIME Type
              </span>
              <span />
            </div>
          )}
          {local.regexPatterns.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_14rem_1.5rem] gap-2 items-center">
              <input
                type="text"
                value={row.pattern}
                onChange={(e) => updatePattern(idx, "pattern", e.target.value)}
                placeholder=".*"
                className={`${inputCls} font-mono overflow-x-auto`}
              />
              <input
                type="text"
                value={row.mimeType}
                onChange={(e) => updatePattern(idx, "mimeType", e.target.value)}
                placeholder="text/plain"
                className={`${inputCls} font-mono`}
              />
              <button
                onClick={() => removePattern(idx)}
                disabled={local.regexPatterns.length === 1}
                title="Remove pattern"
                className="flex items-center justify-center w-6 h-6 rounded text-gray-400
                  hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
                  disabled:opacity-30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addPattern}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed
              border-border text-gray-500 dark:text-gray-400
              hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
              hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Pattern
          </button>
        </div>
      </section>

      {/* ── String Replacement ───────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            String Replacement
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Replace strings on the matched data before storing. Do not use regular expressions in
            these fields or surround with quotes. Example: Use{" "}
            <code className="font-mono text-xs">\\X0D0A\\</code> and{" "}
            <code className="font-mono text-xs">\r\n</code> to replace \X0D0A\ with actual CRLF
            characters.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Inbound Replacements
          </h4>
          <EditableKvTable
            rows={local.inboundReplacements.map(asReplacement)}
            colLabels={["Replace All", "Replace With"]}
            onAdd={addInbound}
            onRemove={removeInbound}
            onUpdate={updateInbound}
            inputCls={inputCls}
          />
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Outbound Replacements
          </h4>
          <EditableKvTable
            rows={local.outboundReplacements.map(asReplacement)}
            colLabels={["Replace All", "Replace With"]}
            onAdd={addOutbound}
            onRemove={removeOutbound}
            onUpdate={updateOutbound}
            inputCls={inputCls}
          />
        </div>
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { getLookupValue } from "@/lib/api-client";
import type { LookupGroup } from "@/lib/api-client";
import { useTheme } from "@/lib/hooks/use-theme";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { useMonacoOverflowHost } from "@/lib/hooks/use-monaco-overflow-host";
import { FormDialog } from "@/components/form-dialog";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ValueDialogProps {
  mode: "add" | "edit";
  group: LookupGroup;
  initialKey?: string;
  initialValue?: string;
  onSave: (key: string, value: string) => Promise<void>;
  onClose: () => void;
}

// ─── JSON validation ──────────────────────────────────────────────────────────

function validateJsonValue(raw: string): string | null {
  if (!raw.trim()) return "Value is required.";
  try {
    JSON.parse(raw);
    return null;
  } catch {
    return "Invalid JSON. Please provide a valid JSON value.";
  }
}

// ─── JSON Tree view ───────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface TreeNodeProps {
  /** Display label (field name, array index like "[0]", or null for root) */
  label: string | null;
  value: JsonValue;
  depth: number;
}

function JsonTreeNode({ label, value, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);

  const isArray = Array.isArray(value);
  const isObject = typeof value === "object" && value !== null && !isArray;
  const isExpandable = isArray || isObject;

  // ── Primitive rendering ──────────────────────────────────────────────
  function renderPrimitive(v: JsonValue) {
    if (v === null) return <span className="text-gray-400 italic">null</span>;
    if (typeof v === "boolean")
      return <span className="text-purple-600 dark:text-purple-400">{String(v)}</span>;
    if (typeof v === "number")
      return <span className="text-green-700 dark:text-green-400">{v}</span>;
    if (typeof v === "string")
      return <span className="text-amber-700 dark:text-amber-400">&quot;{v}&quot;</span>;
    return null;
  }

  const indent = { paddingLeft: `${depth * 16 + 4}px` };

  // ── Leaf node ────────────────────────────────────────────────────────
  if (!isExpandable) {
    return (
      <div className="flex items-center gap-1 py-0.5 select-text" style={indent}>
        <span className="w-4 shrink-0" />
        {label !== null && (
          <span className="text-blue-700 dark:text-blue-400 font-medium">{label}:</span>
        )}
        <span className="ml-0.5">{renderPrimitive(value)}</span>
      </div>
    );
  }

  // ── Expandable node ──────────────────────────────────────────────────
  const entries: { key: string; val: JsonValue }[] = isArray
    ? (value as JsonValue[]).map((v, i) => ({ key: String(i), val: v }))
    : Object.entries(value as { [k: string]: JsonValue }).map(([k, v]) => ({ key: k, val: v }));

  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];

  const collapsedSummary = isArray
    ? `Array[${entries.length}]`
    : `{ ${Object.keys(value as object)
        .slice(0, 3)
        .join(", ")}${Object.keys(value as object).length > 3 ? " …" : ""} }`;

  return (
    <div>
      {/* Row header */}
      <div
        className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/40 rounded"
        style={indent}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-4 shrink-0 flex items-center justify-center text-gray-400">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        {label !== null && (
          <span className="text-blue-700 dark:text-blue-400 font-medium">{label}:</span>
        )}
        <span className="text-gray-600 dark:text-gray-300 ml-0.5">
          {expanded ? open : `${open} … ${close}`}
        </span>
        {!expanded && <span className="text-xs text-gray-400 ml-1">{collapsedSummary}</span>}
      </div>

      {/* Children */}
      {expanded && (
        <>
          {entries.map(({ key, val }) => (
            <JsonTreeNode
              key={key}
              label={isArray ? `[${key}]` : key}
              value={val}
              depth={depth + 1}
            />
          ))}
          {/* Closing bracket */}
          <div className="py-0.5 select-text" style={{ paddingLeft: `${depth * 16 + 4 + 16}px` }}>
            <span className="text-gray-600 dark:text-gray-300">{close}</span>
          </div>
        </>
      )}
    </div>
  );
}

function JsonTreeView({ json }: { json: string }) {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(json) as JsonValue;
  } catch {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500 italic px-4 text-center">
        Invalid JSON — switch to Raw tab to fix the syntax error.
      </div>
    );
  }

  return (
    <div className="font-mono text-xs leading-5 overflow-auto p-2 h-full">
      <JsonTreeNode label={null} value={parsed} depth={0} />
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function ValueDialog({
  mode,
  group,
  initialKey,
  initialValue,
  onSave,
  onClose,
}: ValueDialogProps) {
  const isEdit = mode === "edit";
  const isJsonGroup = group.valueType === "JSON";

  // For JSON groups, pretty-print the stored compact JSON for editing
  const initialDisplayValue = (() => {
    if (isJsonGroup && initialValue) {
      try {
        return JSON.stringify(JSON.parse(initialValue), null, 2);
      } catch {
        return initialValue;
      }
    }
    return initialValue ?? "";
  })();

  const [key, setKey] = useState(initialKey ?? "");
  const [value, setValue] = useState(initialDisplayValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [activeTab, setActiveTab] = useState<"raw" | "tree">("raw");
  const [copiedKey, setCopiedKey] = useState(false);

  const { isDark } = useTheme();
  // This editor lives inside a Radix modal dialog — host Monaco's widgets (context
  // menu, find widget) inside the dialog subtree or clicking them dismisses the
  // dialog (see useMonacoOverflowHost /.
  const { overflowHost, hostRef } = useMonacoOverflowHost();

  function validate(): string | null {
    if (!key.trim()) return "Key is required.";
    if (!value.trim()) return "Value is required.";
    if (isJsonGroup) return validateJsonValue(value);
    return null;
  }

  async function doSave() {
    setSaving(true);
    setError(null);
    try {
      // JSON groups: compact the JSON before saving (normalises whitespace)
      const saveValue = isJsonGroup ? JSON.stringify(JSON.parse(value)) : value;
      await onSave(key.trim(), saveValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setConfirmOverwrite(false);

    const err = validate();
    if (err) {
      setError(err);
      // If JSON error, make sure Raw tab is visible so the user can fix it
      if (isJsonGroup) setActiveTab("raw");
      return;
    }

    // Duplicate key check — only on Add
    if (!isEdit) {
      setSaving(true);
      try {
        await getLookupValue(group.id, key.trim());
        // Key exists → prompt before overwriting
        setSaving(false);
        setConfirmOverwrite(true);
        return;
      } catch {
        // 404 → key does not exist, safe to create
        setSaving(false);
      }
    }

    await doSave();
  }

  const { viewDensity } = useCompactMode();
  const labelCls = "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <FormDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={isEdit ? "Edit Value" : "Add Value"}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitDisabled={confirmOverwrite}
      maxWidth={isJsonGroup ? "sm:max-w-2xl" : "sm:max-w-md"}
    >
      <div className="space-y-4">
        {/* Overwrite confirmation */}
        {confirmOverwrite && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-600 px-4 py-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-3">
              A value with the same key already exists. Do you want to overwrite it?
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmOverwrite(false);
                  void doSave();
                }}
              >
                Yes, Overwrite
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmOverwrite(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Key */}
        <div>
          <label className={labelCls}>
            {isEdit ? (
              <>
                Key <span className="ml-1 text-gray-400 font-normal">(read-only)</span>
              </>
            ) : (
              <>
                Key <span className="text-red-500">*</span>
              </>
            )}
          </label>
          {isEdit ? (
            <div className="flex items-center gap-1.5">
              <Input
                density={viewDensity}
                className="bg-muted text-muted-foreground"
                value={key}
                readOnly
              />
              <button
                type="button"
                title="Copy key"
                onClick={() => {
                  void navigator.clipboard.writeText(key).then(() => {
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  });
                }}
                className="shrink-0 p-1.5 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              >
                {copiedKey ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          ) : (
            <Input
              density={viewDensity}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. BILLING_CODE_001"
              autoFocus
            />
          )}
        </div>

        {/* Value — JSON groups: Monaco editor with Raw / Tree tabs */}
        {isJsonGroup ? (
          <div>
            <label className={labelCls}>
              Value <span className="text-red-500">*</span>
            </label>

            {/* Tab strip */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "raw" | "tree")}>
              <TabsList>
                <TabsTrigger value="raw">Raw</TabsTrigger>
                <TabsTrigger value="tree">Tree</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Tab panels — resizable height so Monaco can render correctly */}
            <ResizableEditorBox
              className="border border-t-0 border-border rounded-b-md overflow-hidden"
              height={300}
            >
              {activeTab === "raw" ? (
                <MonacoEditor
                  height="100%"
                  language="json"
                  theme={isDark ? "vs-dark" : "vs"}
                  value={value}
                  onChange={(val) => setValue(val ?? "")}
                  options={{
                    ...MONACO_BASE_OPTIONS,
                    ...(overflowHost && { overflowWidgetsDomNode: overflowHost }),
                    renderLineHighlight: "line",
                    formatOnPaste: true,
                    formatOnType: false,
                  }}
                />
              ) : (
                <JsonTreeView json={value} />
              )}
            </ResizableEditorBox>
            <div ref={hostRef} />
          </div>
        ) : (
          /* TEXT groups: plain resizable textarea */
          <div>
            <label className={labelCls}>
              Value <span className="text-red-500">*</span>
            </label>
            <Textarea
              density={viewDensity}
              rows={5}
              className="resize-y font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter value…"
              autoFocus={isEdit}
            />
          </div>
        )}
      </div>
    </FormDialog>
  );
}

"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import type { LookupGroup, LookupGroupRequest } from "@/lib/api-client";
import { FormDialog } from "@/components/form-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";

interface GroupDialogProps {
  mode: "add" | "edit";
  initialGroup?: LookupGroup;
  onSave: (req: LookupGroupRequest) => Promise<void>;
  onClose: () => void;
}

interface FormState {
  name: string;
  description: string;
  version: string;
  cacheSize: string;
  cachePolicy: "LRU" | "FIFO";
  statisticsEnabled: boolean;
  valueType: "TEXT" | "JSON";
  jsonIndexMode: "NONE" | "FIELD";
  indexedJsonFields: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  version: "",
  cacheSize: "1000",
  cachePolicy: "LRU",
  statisticsEnabled: true,
  valueType: "TEXT",
  jsonIndexMode: "NONE",
  indexedJsonFields: [],
};

function parseIndexedJsonFields(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string" && v.length > 0);
  } catch {
    // tolerant fallback for legacy newline/comma-separated values saved by the old buggy UI
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function groupToForm(g: LookupGroup): FormState {
  return {
    name: g.name,
    description: g.description ?? "",
    version: g.version,
    cacheSize: String(g.cacheSize),
    cachePolicy: g.cachePolicy,
    statisticsEnabled: g.statisticsEnabled,
    valueType: g.valueType,
    jsonIndexMode: g.extra?.jsonIndexMode ?? "NONE",
    indexedJsonFields: parseIndexedJsonFields(g.extra?.indexedJsonFields),
  };
}

export function GroupDialog({ mode, initialGroup, onSave, onClose }: GroupDialogProps) {
  const [form, setForm] = useState<FormState>(
    mode === "edit" && initialGroup ? groupToForm(initialGroup) : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addField() {
    const trimmed = fieldDraft.trim();
    const err = validateFieldPath(trimmed);
    if (err) {
      setFieldError(err);
      return;
    }
    if (form.indexedJsonFields.includes(trimmed)) {
      setFieldDraft("");
      setFieldError(null);
      return;
    }
    set("indexedJsonFields", [...form.indexedJsonFields, trimmed]);
    setFieldDraft("");
    setFieldError(null);
  }

  function removeField(idx: number) {
    set(
      "indexedJsonFields",
      form.indexedJsonFields.filter((_, i) => i !== idx)
    );
  }

  // Mirrors Java FieldPathFormatValidator
  function validateFieldPath(path: string): string | null {
    const f = path.trim();
    if (!f) return "Field path cannot be empty.";
    if (!/^[A-Za-z0-9_.]+$/.test(f))
      return `Invalid field path "${f}". Only letters, digits, underscore (_), and dot (.) are allowed.`;
    if (f.startsWith(".") || f.endsWith(".") || f.includes(".."))
      return `Invalid field path "${f}". Field path must be dot-separated (e.g. user.profile.age).`;
    return null;
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Name is required.";
    if (!form.version.trim()) return "Version is required.";
    const cs = parseInt(form.cacheSize, 10);
    if (isNaN(cs) || cs < 0) return "Cache Size must be a number ≥ 0.";

    // Validate indexed JSON field paths (only on Add; locked in Edit)
    if (mode === "add" && form.valueType === "JSON" && form.jsonIndexMode === "FIELD") {
      if (form.indexedJsonFields.length === 0)
        return "At least one indexed JSON field is required when Index Mode is FIELD.";
      for (let i = 0; i < form.indexedJsonFields.length; i++) {
        const err = validateFieldPath(form.indexedJsonFields[i]);
        if (err) return `Indexed field #${i + 1}: ${err}`;
      }
    }

    return null;
  }

  async function handleSubmit() {
    setError(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    const req: LookupGroupRequest = {
      name: form.name.trim(),
      description: form.description.trim(),
      version: form.version.trim(),
      cacheSize: parseInt(form.cacheSize, 10),
      cachePolicy: form.cachePolicy,
      statisticsEnabled: form.statisticsEnabled,
      valueType: form.valueType,
    };

    if (form.valueType === "JSON") {
      req.extra = {
        jsonIndexMode: form.jsonIndexMode,
        ...(form.jsonIndexMode === "FIELD"
          ? { indexedJsonFields: JSON.stringify(form.indexedJsonFields) }
          : {}),
      };
    }

    setSaving(true);
    try {
      await onSave(req);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Group" : "Add Group";

  const { viewDensity } = useCompactMode();
  const selectH = densityHeight(viewDensity);

  // Shared input/label classes
  const labelCls = "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1";
  const disabledCls = "opacity-50 pointer-events-none";

  return (
    <FormDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={title}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      maxWidth="sm:max-w-lg"
    >
      <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
        {/* Name */}
        <div>
          <label className={labelCls}>
            Name <span className="text-red-500">*</span>
          </label>
          <Input
            density={viewDensity}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Billing Codes"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <Textarea
            density={viewDensity}
            rows={2}
            className="resize-none"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional description"
          />
        </div>

        {/* Version */}
        <div>
          <label className={labelCls}>
            Version <span className="text-red-500">*</span>
          </label>
          <Input
            density={viewDensity}
            value={form.version}
            onChange={(e) => set("version", e.target.value)}
            placeholder="e.g. 1.0.0"
          />
        </div>

        {/* Cache Size + Cache Policy — 2-col */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              Cache Size
              <span className="ml-1 text-gray-400 font-normal">(0 = disabled)</span>
            </label>
            <Input
              density={viewDensity}
              type="number"
              min={0}
              value={form.cacheSize}
              onChange={(e) => set("cacheSize", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Cache Policy</label>
            <select
              className={`w-full ${selectH} rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
              value={form.cachePolicy}
              onChange={(e) => set("cachePolicy", e.target.value as "LRU" | "FIFO")}
            >
              <option value="LRU">LRU</option>
              <option value="FIFO">FIFO</option>
            </select>
          </div>
        </div>

        {/* Statistics Enabled */}
        <FormCheckbox
          label="Statistics Enabled"
          checked={form.statisticsEnabled}
          onChange={(v) => set("statisticsEnabled", v)}
        />

        {/* Value Type — locked in edit mode */}
        <div className={isEdit ? disabledCls : ""}>
          <label className={labelCls}>
            Value Type
            {isEdit && (
              <span className="ml-1 text-gray-400 font-normal">
                (cannot be changed after creation)
              </span>
            )}
          </label>
          <select
            className={`w-full ${selectH} rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
            value={form.valueType}
            onChange={(e) => set("valueType", e.target.value as "TEXT" | "JSON")}
            disabled={isEdit}
          >
            <option value="TEXT">TEXT</option>
            <option value="JSON">JSON</option>
          </select>
        </div>

        {/* JSON-only fields — locked in edit mode */}
        {form.valueType === "JSON" && (
          <>
            <div className={isEdit ? disabledCls : ""}>
              <label className={labelCls}>JSON Index Mode</label>
              <select
                className={`w-full ${selectH} rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
                value={form.jsonIndexMode}
                onChange={(e) => set("jsonIndexMode", e.target.value as "NONE" | "FIELD")}
                disabled={isEdit}
              >
                <option value="NONE">NONE</option>
                <option value="FIELD">FIELD</option>
              </select>
            </div>

            {form.jsonIndexMode === "FIELD" && (
              <div className={isEdit ? disabledCls : ""}>
                <label className={labelCls}>Indexed JSON Fields</label>
                {!isEdit && (
                  <div className="flex gap-2 mb-1">
                    <Input
                      density={viewDensity}
                      className="font-mono flex-1"
                      value={fieldDraft}
                      onChange={(e) => {
                        setFieldDraft(e.target.value);
                        setFieldError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addField();
                        }
                      }}
                      placeholder="e.g. email, address.city"
                    />
                    <button
                      type="button"
                      onClick={addField}
                      className="px-3 py-1 text-xs rounded border border-input bg-background hover:bg-muted transition-colors"
                    >
                      Add
                    </button>
                  </div>
                )}
                {fieldError && <p className="text-xs text-red-500 mb-1">{fieldError}</p>}
                <div className="max-h-32 overflow-y-auto rounded border border-input bg-background">
                  {form.indexedJsonFields.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400 italic">No fields added yet.</p>
                  ) : (
                    form.indexedJsonFields.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-1 text-xs font-mono hover:bg-muted/50 group"
                      >
                        <span>{f}</span>
                        {!isEdit && (
                          <button
                            type="button"
                            onClick={() => removeField(i)}
                            className="ml-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                            aria-label={`Remove ${f}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </FormDialog>
  );
}
